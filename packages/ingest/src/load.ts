import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import type postgres from "postgres";
import { processExpression } from "@su-maek/core/math";
import type { ParsedAnswer } from "./answers";
import { renderRuns } from "./answers";
import type { ExtractionProfile } from "./profiles/types";
import type { ConceptDefinition, ConceptWeight } from "./profiles/rpm-2022-concepts";
import type { ExtractedQuestion, Run } from "./types";

/* ─────────────────────────────────────────────────────────────
 * 추출 결과 → 문제은행
 *
 * 여기서 지키는 것 셋:
 *
 * 1. **권한 없는 문항은 자동 출제 풀에 들어가지 않는다** (원칙 9).
 *    상업 교재이므로 content_rights는 under_review로 들어가고,
 *    is_auto_assignable은 전부 false다. 사람이 권한을 확인해야 열린다.
 *
 * 2. **수식이 깨진 문항은 게시하지 않는다** (원칙 12). 해독 못 한 글리프가
 *    있거나 KaTeX 렌더가 실패하면 formula_review_required로 격리한다.
 *
 * 3. **없는 답을 지어내지 않는다.** 별책에서 답을 못 찾은 문항은 answer를
 *    비운 채 review_required로 둔다. 그럴듯한 답을 넣으면 학생이 맞는 답을
 *    쓰고 틀렸다는 채점을 받는다.
 *
 * 멱등이다 — 같은 원본(체크섬)과 같은 인쇄 번호는 다시 넣지 않는다.
 * ───────────────────────────────────────────────────────────── */

export interface LoadTarget {
  organizationId: string;
  actorUserId: string;
}

export interface BookRef {
  publisherName: string;
  title: string;
  schoolLevel: string;
  gradeBand: string;
  editionLabel: string;
  publishedYear: number;
}

export interface SourceRef {
  fileName: string;
  checksum: string;
  pageCount: number;
  /** 객체 스토리지 경로 — 원본을 올리지 않았으면 로컬 경로를 남긴다 */
  storagePath: string;
}

export interface RightsRef {
  holder: string;
  /** 상업 교재는 under_review로 시작한다. usable은 사람이 확인한 뒤에만. */
  status: "draft" | "under_review" | "usable" | "restricted";
  evidenceRef?: string;
}

export interface LoadInput extends LoadTarget {
  book: BookRef;
  source: SourceRef;
  rights: RightsRef;
  profile: ExtractionProfile;
  /** 이 반입이 다루는 단원 (출처 메타데이터에 실린다) */
  chapter: { number: string; title: string };
  concepts: ConceptDefinition[];
  titleToConcept: ReadonlyMap<string, ConceptWeight[]>;
  questions: ExtractedQuestion[];
  answers: Map<string, ParsedAnswer>;
}

export interface LoadResult {
  bookEditionId: string;
  sourceFileId: string;
  inserted: number;
  skipped: number;
  byReviewStatus: Record<string, number>;
  /** 개념에 걸리지 않은 문항 — 검수자가 지정해야 한다 */
  unaligned: string[];
  /** 답을 찾지 못한 문항 */
  withoutAnswer: string[];
}

type Block = Record<string, unknown>;

/** 조각 배열 → 구조화 블록의 runs. 수식은 math_expressions 행을 가리킨다 */
function toContractRuns(
  runs: Run[],
  expressions: { id: string; raw: string; latex: string }[],
): Block[] {
  return runs.map((run) => {
    if (run.kind === "text") return { kind: "text", text: run.text };
    const id = uuidv7();
    expressions.push({ id, raw: run.raw, latex: run.latex });
    return { kind: "math", math: { expressionId: id, latex: run.latex } };
  });
}

function buildBody(
  question: ExtractedQuestion,
  expressions: { id: string; raw: string; latex: string }[],
): Block[] {
  const blocks: Block[] = [
    { type: "paragraph", runs: toContractRuns(question.stem, expressions) },
  ];

  if (question.conditionBox) {
    blocks.push({
      type: "condition_box",
      label: question.conditionBox.label,
      items: question.conditionBox.items.map((item) => ({
        ...(item.marker === undefined ? {} : { marker: item.marker }),
        content: toContractRuns(item.runs, expressions),
      })),
    });
  }

  if (question.choices) {
    blocks.push({
      type: "choice_group",
      layout: "auto",
      choices: question.choices.map((choice, index) => ({
        /* 선택지 ID는 표시 문자(①)가 아니라 불변 값이다 (2P).
         * 보기 순서를 섞어도 채점이 따라가야 한다. */
        choiceId: `c${index + 1}`,
        order: index + 1,
        content: toContractRuns(choice.runs, expressions),
        hasTallMath: choice.runs.some(
          (r) => r.kind === "math" && r.latex.includes("\\frac"),
        ),
      })),
    });
  }

  return blocks;
}

/** 별책의 「답」을 계약 형식으로. 읽지 못하면 null — 지어내지 않는다. */
function buildAnswerKey(
  question: ExtractedQuestion,
  parsed: ParsedAnswer | undefined,
): { key: Record<string, unknown>; kind: string } | null {
  if (!parsed) return null;
  const text = renderRuns(parsed.answer);
  if (text === "") return null;

  if (question.choices) {
    /* 객관식 — 「답 ②」의 기호를 불변 선택지 ID로 옮긴다.
     * 「정답 2개」인 문항이 있으므로 여러 개를 받는다. */
    const markers = [...text.matchAll(/[①②③④⑤]/g)].map((m) => m[0]);
    const order = "①②③④⑤";
    const ids = markers
      .map((m) => order.indexOf(m) + 1)
      .filter((n) => n >= 1 && n <= question.choices!.length)
      .map((n) => `c${n}`);
    if (ids.length === 0) return null;
    return { kind: "multiple_choice", key: { kind: "multiple_choice", correctChoiceIds: ids } };
  }

  /* 단답 — 「3개」 「47」 「1, 2, 4, 5」처럼 온다. 원문을 그대로 기준값으로
   * 두고 정규화·동치 판정은 채점 파이프라인에 맡긴다. 여기서 숫자만
   * 뽑아내면 「3개」가 「3」이 되어 단위가 사라진다. */
  return {
    kind: "short_answer",
    key: {
      kind: "short_answer",
      accepted: [{ value: text, form: "text", allowEquivalence: false }],
    },
  };
}

export async function loadQuestions(
  sql: postgres.Sql,
  input: LoadInput,
): Promise<LoadResult> {
  const org = input.organizationId;

  /* ── 교재·판 (멱등) ─────────────────────────────────────── */
  const publisherId = uuidv7();
  const [publisher] = await sql<{ id: string }[]>`
    insert into publishers (id, organization_id, name)
    values (${publisherId}, ${org}, ${input.book.publisherName})
    on conflict (organization_id, name) do update set updated_at = now()
    returning id::text as id
  `;

  const [existingBook] = await sql<{ id: string }[]>`
    select id::text as id from books
    where organization_id = ${org} and title = ${input.book.title}
  `;
  const bookId = existingBook?.id ?? uuidv7();
  if (!existingBook) {
    await sql`
      insert into books (id, organization_id, publisher_id, title, school_level, grade_band)
      values (${bookId}, ${org}, ${publisher!.id}, ${input.book.title},
              ${input.book.schoolLevel}, ${input.book.gradeBand})
    `;
  }

  const [existingEdition] = await sql<{ id: string }[]>`
    select id::text as id from book_editions
    where book_id = ${bookId} and edition_label = ${input.book.editionLabel}
  `;
  const bookEditionId = existingEdition?.id ?? uuidv7();
  /* 추출 프로파일을 판에 적어 둔다 — "이 문항 왜 이렇게 뽑혔지"를 나중에
   * 물었을 때 그때 쓴 규칙이 남아 있어야 답할 수 있다. */
  const profileRecord = {
    id: input.profile.id,
    version: input.profile.version,
    label: input.profile.label,
    appliesTo: input.profile.appliesTo,
    layout: input.profile.layout,
    figures: input.profile.figures,
  };
  if (existingEdition) {
    await sql`
      update book_editions
      set extraction_profile = ${sql.json(profileRecord as never)}, updated_at = now()
      where id = ${bookEditionId}
    `;
  } else {
    await sql`
      insert into book_editions (
        id, organization_id, book_id, edition_label, published_year, extraction_profile
      ) values (
        ${bookEditionId}, ${org}, ${bookId}, ${input.book.editionLabel},
        ${input.book.publishedYear}, ${sql.json(profileRecord as never)}
      )
    `;
  }

  /* ── 권한 (원칙 9) ──────────────────────────────────────── */
  const [existingRight] = await sql<{ id: string }[]>`
    select id::text as id from content_rights
    where organization_id = ${org} and book_edition_id = ${bookEditionId}
  `;
  const contentRightId = existingRight?.id ?? uuidv7();
  if (!existingRight) {
    await sql`
      insert into content_rights (
        id, organization_id, book_edition_id, rights_holder, status, allowed_uses, evidence_ref
      ) values (
        ${contentRightId}, ${org}, ${bookEditionId}, ${input.rights.holder},
        ${input.rights.status},
        ${sql.json({ note: "반입 시점 미확인 — 사람이 확인해야 자동 출제 가능" } as never)},
        ${input.rights.evidenceRef ?? null}
      )
    `;
  }

  /* ── 원본 파일·쪽 (체크섬 멱등) ─────────────────────────── */
  const [existingSource] = await sql<{ id: string }[]>`
    select id::text as id from source_files
    where organization_id = ${org} and checksum = ${input.source.checksum}
  `;
  const sourceFileId = existingSource?.id ?? uuidv7();
  if (!existingSource) {
    await sql`
      insert into source_files (
        id, organization_id, book_edition_id, storage_path, file_name, mime_type,
        byte_size, checksum, page_count, status, uploaded_by, scan_result
      ) values (
        ${sourceFileId}, ${org}, ${bookEditionId}, ${input.source.storagePath},
        ${input.source.fileName}, 'application/pdf', 0, ${input.source.checksum},
        ${input.source.pageCount}, 'review_required', ${input.actorUserId},
        ${sql.json({ signature: "pdf", extractor: input.profile.id } as never)}
      )
    `;
  }

  const pages = [...new Set(input.questions.map((q) => q.page))].sort((a, b) => a - b);
  const pageIdByNumber = new Map<number, string>();
  for (const pageNumber of pages) {
    const [existing] = await sql<{ id: string }[]>`
      select id::text as id from source_pages
      where source_file_id = ${sourceFileId} and page_number = ${pageNumber}
    `;
    const id = existing?.id ?? uuidv7();
    if (!existing) {
      await sql`
        insert into source_pages (id, organization_id, source_file_id, page_number, ocr_status)
        values (${id}, ${org}, ${sourceFileId}, ${pageNumber}, 'not_required')
      `;
    }
    pageIdByNumber.set(pageNumber, id);
  }

  /* ── 개념 (멱등) ────────────────────────────────────────── */
  const conceptIdBySlug = new Map<string, string>();
  for (const concept of input.concepts) {
    const [existing] = await sql<{ id: string }[]>`
      select id::text as id from canonical_concepts where slug = ${concept.slug}
    `;
    const id = existing?.id ?? uuidv7();
    if (!existing) {
      await sql`
        insert into canonical_concepts (
          id, slug, name, description, school_level, grade_band, domain_name, status, evidence
        ) values (
          ${id}, ${concept.slug}, ${concept.name}, ${concept.description},
          ${concept.schoolLevel}, ${concept.gradeBand}, ${concept.domainName},
          'active', '[]'::jsonb
        )
      `;
    }
    conceptIdBySlug.set(concept.slug, id);
  }

  /* ── 문항 ───────────────────────────────────────────────── */
  const result: LoadResult = {
    bookEditionId,
    sourceFileId,
    inserted: 0,
    skipped: 0,
    byReviewStatus: {},
    unaligned: [],
    withoutAnswer: [],
  };

  for (const question of input.questions) {
    const printedNumber = question.printedNumber;

    /* 같은 판·같은 인쇄 번호는 다시 넣지 않는다 */
    const [duplicate] = await sql<{ id: string }[]>`
      select id::text as id from questions
      where organization_id = ${org} and book_edition_id = ${bookEditionId}
        and printed_number = ${printedNumber}
    `;
    if (duplicate) {
      result.skipped += 1;
      continue;
    }

    const expressions: { id: string; raw: string; latex: string }[] = [];
    const body = buildBody(question, expressions);
    const parsedAnswer = input.answers.get(printedNumber);
    const answerKey = buildAnswerKey(question, parsedAnswer);
    const explanation =
      parsedAnswer && parsedAnswer.explanation.length > 0
        ? [{ type: "paragraph", runs: toContractRuns(parsedAnswer.explanation, expressions) }]
        : null;

    /* 서술형 채점 기준표. 계약(essayKey)이 요구하는 rubricKey·points 구조로
     * 쪼개려면 표의 행을 읽어야 하는데, 별책의 표는 칸 경계가 벡터라
     * 텍스트만으로는 어느 비율이 어느 요소의 것인지 확정할 수 없다.
     * **추측해서 점수를 배분하지 않는다** — 원문을 그대로 두고 검수자가
     * 쪼개게 한다. 버리는 것보다 낫고, 지어내는 것보다 훨씬 낫다. */
    const rubric =
      parsedAnswer && parsedAnswer.rubric.length > 0
        ? {
            source: "별책 채점 기준표",
            raw: renderRuns(parsedAnswer.rubric),
            structured: false,
            note: "표의 칸 경계가 벡터라 요소·비율 대응을 확정할 수 없다 — 검수자가 쪼갠다",
          }
        : null;

    /* 수식 게이트 — core의 파이프라인을 그대로 쓴다 (별도 처리기 금지) */
    const processed = expressions.map((expression) => ({
      ...expression,
      result: processExpression(expression.latex, "inline"),
    }));
    const unknownGlyphs = [
      ...question.stem,
      ...(question.choices?.flatMap((c) => c.runs) ?? []),
      ...(question.conditionBox?.items.flatMap((i) => i.runs) ?? []),
    ].flatMap((r) => (r.kind === "math" ? r.unknown : []));
    const formulaBroken =
      unknownGlyphs.length > 0 ||
      processed.some((e) => e.result.status !== "render_validated");

    /* 검수 상태 — 무엇이 모자란지에 따라 다른 함으로 보낸다.
     * 전부 review_required로 뭉치면 검수자가 무엇을 봐야 할지 모른다. */
    const reviewStatus = formulaBroken
      ? "formula_review_required"
      : question.figureBoxes.length > 0
        ? "layout_review_required" // 그림이 있는데 아직 자산이 없다
        : "review_required";

    const kind = question.choices ? "multiple_choice" : "short_answer";

    const sourceRef = {
      publisher: input.book.publisherName,
      book: input.book.title,
      edition: input.book.editionLabel,
      chapter: input.chapter,
      section:
        question.typeContext?.kind === "section" ? question.typeContext.title : null,
      type:
        question.typeContext?.kind === "type"
          ? { number: question.typeContext.number, title: question.typeContext.title }
          : null,
      textbookRef: question.typeContext?.textbookRef ?? null,
      printedNumber,
      printedPage: question.page,
      column: question.column,
      bbox: question.bbox,
      figureBoxes: question.figureBoxes,
      figureLabels: question.figureLabels,
      extractedBy: { profile: input.profile.id, version: input.profile.version },
    };

    const questionId = uuidv7();
    const versionId = uuidv7();
    const checksum = createHash("sha256")
      .update(JSON.stringify({ body, answer: answerKey?.key ?? null }))
      .digest("hex");

    await sql.begin(async (tx) => {
      await tx`
        insert into questions (
          id, organization_id, current_version_id, kind, review_status,
          source_file_id, source_page_id, book_edition_id, printed_number,
          content_right_id, source_coords, source_ref, is_auto_assignable
        ) values (
          ${questionId}, ${org}, ${versionId}, ${kind}, ${reviewStatus},
          ${sourceFileId}, ${pageIdByNumber.get(question.page) ?? null},
          ${bookEditionId}, ${printedNumber}, ${contentRightId},
          ${tx.json({ page: question.page, ...question.bbox } as never)},
          ${tx.json(sourceRef as never)},
          /* 권한 미확인 + 검수 전이므로 자동 출제 금지 (원칙 9) */
          false
        )
      `;
      await tx`
        insert into question_versions (
          id, organization_id, question_id, version_number, body, choices, answer,
          explanation, rubric, points, difficulty, question_type_tags, content_checksum,
          extraction, created_by
        ) values (
          ${versionId}, ${org}, ${questionId}, 1,
          ${tx.json(body as never)},
          ${question.choices ? tx.json(question.choices.map((c, i) => ({ choiceId: `c${i + 1}`, order: i + 1, marker: c.marker })) as never) : null},
          ${answerKey ? tx.json(answerKey.key as never) : null},
          ${explanation ? tx.json(explanation as never) : null},
          ${rubric ? tx.json(rubric as never) : null},
          '10',
          /* 난이도 뱃지(중하·중·상)는 지면에서 벡터 그림이라 뽑을 수 없다.
           * 추측하지 않고 비워 둔다 — 검수자가 지정한다. */
          ${tx.json({ band: null, source: "미측정 — 지면 뱃지가 벡터라 추출 불가" } as never)},
          ${tx.json(question.typeContext ? [`${question.typeContext.kind}:${question.typeContext.title}`] : [] as never)},
          ${checksum},
          ${tx.json({ profile: input.profile.id, version: input.profile.version, method: "pdf-text-layer", ocr: false } as never)},
          ${input.actorUserId}
        )
      `;

      for (const expression of processed) {
        await tx`
          insert into math_expressions (
            id, organization_id, question_version_id, raw_source, normalized_latex,
            display_mode, semantic_fingerprint, parse_status, render_hash,
            normalizer_version, katex_version, macro_policy_version
          ) values (
            ${expression.id}, ${org}, ${versionId}, ${expression.raw},
            ${expression.result.normalizedLatex}, 'inline',
            ${expression.result.semanticFingerprint},
            ${expression.result.status === "render_validated" ? "render_validated" : "review_required"},
            ${expression.result.renderHash},
            ${expression.result.versions.normalizer},
            ${expression.result.versions.katex},
            ${expression.result.versions.macroPolicy}
          )
        `;
      }

      const title = question.typeContext?.title ?? "";
      const weights = input.titleToConcept.get(title) ?? [];
      for (const weight of weights) {
        const conceptId = conceptIdBySlug.get(weight.slug);
        if (!conceptId) continue;
        await tx`
          insert into question_alignments (
            id, organization_id, question_id, concept_id, weight, provenance
          ) values (
            ${uuidv7()}, ${org}, ${questionId}, ${conceptId}, ${String(weight.weight)},
            /* 사람이 쓴 표로 이었다 — AI 추측이 아니다 */
            'human'
          )
        `;
      }
      if (weights.length === 0) result.unaligned.push(printedNumber);
    });

    if (!answerKey) result.withoutAnswer.push(printedNumber);
    result.inserted += 1;
    result.byReviewStatus[reviewStatus] = (result.byReviewStatus[reviewStatus] ?? 0) + 1;
  }

  return result;
}
