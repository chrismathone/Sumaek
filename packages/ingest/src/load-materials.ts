import { contentWriteOrganizationId } from "@su-maek/core/shared";
import { v7 as uuidv7 } from "uuid";
import type postgres from "postgres";
import { processExpression } from "@su-maek/core/math";
import type { ExtractedConcept } from "./concepts";
import type { ConceptExtractionProfile } from "./profiles/kwr-2022";
import { conceptTargetKey } from "./profiles/kwr-2022";
import type { ConceptDefinition } from "./profiles/rpm-2022-concepts";
import type { BookRef, RightsRef, SourceRef } from "./load";
import type { Run } from "./types";

/* ─────────────────────────────────────────────────────────────
 * 개념 블록 → 학습 자료 (learning_materials, kind='reading')
 *
 * 문항 반입(load.ts)과 같은 원칙을 지킨다:
 *  1. **상업 교재는 검수 전에 학생에게 나가지 않는다.** status='draft'로
 *     넣고, content_rights는 under_review다. 게시는 사람이 한다.
 *  2. **수식이 깨진 채 넣지 않는다.** 모든 수식을 KaTeX 게이트에 통과시키고,
 *     실패·미해독 글리프는 source_ref.formulaIssues에 남긴다 — 검수자가
 *     무엇을 봐야 하는지 알 수 있게.
 *  3. **멱등이다.** 같은 조직·개념·제목의 reading 자료는 다시 넣지 않는다.
 *
 * 왜 learning_materials인가: 학생 「개념 공부」 화면이 읽는 자리가
 * 여기다(0009a). 개념(canonical_concepts)에 붙으므로 RPM 문항과 같은
 * 개념 노드에서 만난다 — 설명과 문항이 한 줄로 이어진다.
 * ───────────────────────────────────────────────────────────── */

export interface LoadMaterialsInput {
  organizationId: string;
  actorUserId: string;
  book: BookRef;
  source: SourceRef;
  rights: RightsRef;
  profile: ConceptExtractionProfile;
  chapter: { number: string; title: string };
  /** slug → 정본 개념. 없으면 만들어 쓴다 (load.ts와 같은 멱등 규칙) */
  concepts: ConceptDefinition[];
  /** `소단원|번호` → slug (사람이 쓴 표) */
  targets: ReadonlyMap<string, string>;
  blocks: ExtractedConcept[];
}

export interface LoadMaterialsResult {
  bookEditionId: string;
  sourceFileId: string;
  inserted: number;
  skipped: number;
  /** 표에 없어 개념을 못 찾은 블록 — 넣지 않고 보고한다 */
  unmapped: string[];
  /** 수식 게이트 실패·미해독 글리프가 있는 블록 (draft로 들어는 간다) */
  withFormulaIssues: string[];
}

type Block = Record<string, unknown>;

/**
 * 문단 → 계약 블록. **줄바꿈을 보존한다** — 줄 사이에 `\n` 텍스트 런을
 * 끼우면 화면(renderMixedText)이 `<br/>`로 그린다. 지면의 판짜임이
 * 그대로 살아야 정의·예·단계가 읽힌다.
 */
function paragraphToBlock(lines: Run[][]): Block {
  const runs: Block[] = [];
  lines.forEach((line, i) => {
    if (i > 0) runs.push({ kind: "text", text: "\n" });
    for (const run of line) {
      if (run.kind === "text") runs.push({ kind: "text", text: run.text });
      else runs.push({ kind: "math", math: { latex: run.latex } });
    }
  });
  return { type: "paragraph", runs };
}

export async function loadConceptMaterials(
  sql: postgres.Sql,
  input: LoadMaterialsInput,
): Promise<LoadMaterialsResult> {
  /* 개념서 자료도 플랫폼 자산이다 (ADR-0020) */
  const org = contentWriteOrganizationId(input.organizationId);

  /* ── 교재·판·권한·원본 (load.ts와 같은 멱등 upsert) ────────
   * 문항 반입과 코드가 닮았지만 합치지 않았다 — 문항 쪽은 source_pages·
   * 개념 표 배선까지 얽혀 있어, 공유하려면 그쪽을 흔들어야 한다. */
  const [publisher] = await sql<{ id: string }[]>`
    insert into publishers (id, organization_id, name)
    values (${uuidv7()}, ${org}, ${input.book.publisherName})
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
  const profileRecord = {
    id: input.profile.id,
    version: input.profile.version,
    label: input.profile.label,
    appliesTo: input.profile.appliesTo,
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

  const [existingRight] = await sql<{ id: string }[]>`
    select id::text as id from content_rights
    where organization_id = ${org} and book_edition_id = ${bookEditionId}
  `;
  if (!existingRight) {
    await sql`
      insert into content_rights (
        id, organization_id, book_edition_id, rights_holder, status, allowed_uses, evidence_ref
      ) values (
        ${uuidv7()}, ${org}, ${bookEditionId}, ${input.rights.holder},
        ${input.rights.status},
        ${sql.json({ note: "반입 시점 미확인 — 사람이 확인해야 게시 가능" } as never)},
        ${input.rights.evidenceRef ?? null}
      )
    `;
  }

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

  /* ── 정본 개념 (멱등 — load.ts와 같은 규칙) ───────────────── */
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

  /* ── 개념 블록 → 자료 ─────────────────────────────────────── */
  const result: LoadMaterialsResult = {
    bookEditionId,
    sourceFileId,
    inserted: 0,
    skipped: 0,
    unmapped: [],
    withFormulaIssues: [],
  };

  for (const block of input.blocks) {
    const key = conceptTargetKey(block.page, block.subsection, block.no);
    const slug = input.targets.get(key);
    const conceptId = slug ? conceptIdBySlug.get(slug) : undefined;
    if (!conceptId) {
      /* 표에 없다 — **추측으로 붙이지 않는다.** 사람이 표를 고친 뒤 다시
       * 돌리면 그때 들어간다. */
      result.unmapped.push(`${key} (p.${block.page} ${block.title})`);
      continue;
    }

    const title = block.title;
    /* **같은 자료인지는 지면 자리로 가른다.**
     *
     * 제목만으로 보면 한 소단원의 개념 여럿이 같은 자료가 된다. 이 교재는
     * 제목에 수식을 넣기 때문이다 — 개념원리 중2-1 p.36의 「aᵐ×aⁿ은 어떻게
     * 간단히 하는가?」와 「aᵐ÷aⁿ은…」과 「(aᵐ)ⁿ은…」이 추출되면 셋 다
     * 「은 어떻게 간단히 하는가?」다. 제목으로 멱등을 걸었더니 지수법칙
     * ⑵⑶⑷ 중 둘이 **조용히 안 들어갔다.** 쪽과 개념 번호까지 봐야 한다. */
    const [duplicate] = await sql<{ id: string }[]>`
      select id::text as id from learning_materials
      where organization_id = ${org} and concept_id = ${conceptId}
        and kind = 'reading' and title = ${title}
        and (source_ref->>'printedPage')::int = ${block.page}
        and coalesce(source_ref->>'conceptNo', '') = ${block.no ?? ""}
    `;
    if (duplicate) {
      result.skipped += 1;
      continue;
    }

    /* 수식 게이트 — core 파이프라인 그대로 (별도 처리기 금지).
     * 실패해도 넣기는 한다: 자료는 draft라 학생에게 안 나가고, 검수자는
     * formulaIssues를 보고 지면과 대조한다. 아예 빼면 「무엇이 안 됐는지」가
     * DB에 남지 않는다. */
    const failures: string[] = [];
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        for (const run of line) {
          if (run.kind !== "math") continue;
          const processed = processExpression(run.latex, "inline");
          if (processed.status !== "render_validated") failures.push(run.latex);
        }
      }
    }
    const issues = {
      renderFailures: failures,
      unknownGlyphs: [...new Set(block.unknownGlyphs)],
    };
    const hasIssues =
      issues.renderFailures.length > 0 || issues.unknownGlyphs.length > 0;
    if (hasIssues) result.withFormulaIssues.push(`p.${block.page} ${title}`);

    const body = block.paragraphs.map((p) => paragraphToBlock(p.lines));

    const sourceRef = {
      publisher: input.book.publisherName,
      book: input.book.title,
      edition: input.book.editionLabel,
      chapter: input.chapter,
      unit: block.unit,
      subsection: block.subsection,
      conceptNo: block.no,
      /** 지면에 인쇄된 개념→핵심문제 연결 — 나중에 문항 매핑의 근거 */
      xref: block.xref,
      printedPage: block.page,
      /** 교사용 여백 주석(강의Plus) — 본문이 아니라 지도용 */
      teacherNotes: block.teacherNotes,
      formulaIssues: hasIssues ? issues : null,
      extractedBy: { profile: input.profile.id, version: input.profile.version },
    };

    await sql`
      insert into learning_materials (
        id, organization_id, concept_id, kind, title, body,
        sort_order, status, created_by, source_ref
      ) values (
        ${uuidv7()}, ${org}, ${conceptId}, 'reading', ${title},
        ${sql.json(body as never)},
        ${block.order},
        /* 상업 교재 + 검수 전 — 게시는 사람이 한다 (원칙 9의 정신) */
        'draft',
        ${input.actorUserId},
        ${sql.json(sourceRef as never)}
      )
    `;
    result.inserted += 1;
  }

  return result;
}
