import { v7 as uuidv7 } from "uuid";
import {
  createAiProvider,
  getSharedBreaker,
  withCircuitBreaker,
} from "@su-maek/core/ai";
import { normalizeMixedText, renderMixedText } from "@su-maek/core/math";
import { getSharedSql } from "../client";

/* ─────────────────────────────────────────────────────────────
 * 문제집 반입 파이프라인 (15장 · 시퀀스 7).
 *
 * 원본 등록 → (mock) 추출 → LaTeX 무손실 정규화 → KaTeX 게이트 →
 * 개념 별칭 매핑(승인분만) → 검수 대기.
 *
 * - 새 문항은 검수 전 자동 게시하지 않는다 (원칙 9·15장).
 * - 수식 게이트 실패는 formula_review_required로 격리 + 검수 항목 생성.
 * - 저신뢰(정책 임계 미만) 추출은 검수 필수 표시.
 * - AI 제안 개념 연결은 승인된 SourceAlias 경유만 자동 적용, 나머지는
 *   제안으로만 기록 (2K — AI 매핑은 승인 전 자동 계획 사용 금지).
 * ───────────────────────────────────────────────────────────── */

export interface ProcessResult {
  ok: boolean;
  message: string;
  extracted: number;
  gatePassed: number;
  formulaQuarantined: number;
  lowConfidence: number;
}

const LOW_CONFIDENCE_THRESHOLD = 0.7;

export async function processSourceFile(options: {
  organizationId: string;
  sourceFileId: string;
  actorUserId: string | null;
}): Promise<ProcessResult> {
  const sql = getSharedSql();
  const { organizationId, sourceFileId } = options;

  const [file] = await sql<
    {
      id: string;
      file_name: string;
      checksum: string;
      page_count: number | null;
      status: string;
      content_right_id: string | null;
    }[]
  >`
    select f.id, f.file_name, f.checksum, f.page_count, f.status,
           (select id from content_rights r
             where r.organization_id = f.organization_id
               and r.evidence_ref = f.id::text limit 1) as content_right_id
    from source_files f
    where f.id = ${sourceFileId} and f.organization_id = ${organizationId}
  `;
  if (!file) {
    return {
      ok: false,
      message: "원본 파일을 찾을 수 없습니다.",
      extracted: 0,
      gatePassed: 0,
      formulaQuarantined: 0,
      lowConfidence: 0,
    };
  }

  /* 멱등: 이미 처리된 파일은 재추출하지 않는다 (원본 해시 기준) */
  const [already] = await sql<{ cnt: number }[]>`
    select count(*)::int as cnt from questions
    where source_file_id = ${sourceFileId}
  `;
  if ((already?.cnt ?? 0) > 0) {
    return {
      ok: true,
      message: `이미 처리된 파일입니다 (문항 ${already?.cnt}개). 같은 원본은 중복 추출하지 않습니다.`,
      extracted: already?.cnt ?? 0,
      gatePassed: 0,
      formulaQuarantined: 0,
      lowConfidence: 0,
    };
  }

  await sql`
    update source_files set status = 'extracting', updated_at = now()
    where id = ${sourceFileId}
  `;

  /* 회로 차단기 (인수 23) — 공급자 장애 시 빠른 실패로 격리하고,
   * 파일은 uploaded로 되돌려 복구 후 재시도 가능하게 한다 */
  const rawProvider = createAiProvider(process.env.AI_PROVIDER);
  const provider = withCircuitBreaker(
    rawProvider,
    getSharedBreaker(rawProvider.name),
  );
  let extraction: Awaited<ReturnType<typeof provider.extractQuestions>>;
  try {
    extraction = await provider.extractQuestions({
      fileName: file.file_name,
      checksum: file.checksum,
      pageCount: file.page_count ?? 1,
    });
  } catch (error) {
    await sql`
      update source_files set status = 'uploaded', updated_at = now()
      where id = ${sourceFileId}
    `;
    throw error;
  }

  let gatePassed = 0;
  let quarantined = 0;
  let lowConfidence = 0;

  for (const [index, eq] of extraction.questions.entries()) {
    /* 1) 무손실 정규화 (규칙 ID 기록) + 게시 게이트 검사 */
    const normalized = normalizeMixedText(eq.bodyText);
    const gate = renderMixedText(normalized.normalized, "publish");
    const gateFailed =
      gate.failures.length > 0 || normalized.reviewFlags.length > 0;
    const isLowConfidence = eq.confidence < LOW_CONFIDENCE_THRESHOLD;
    if (gateFailed) quarantined++;
    else gatePassed++;
    if (isLowConfidence) lowConfidence++;

    const questionId = uuidv7();
    const versionId = uuidv7();
    const reviewStatus = gateFailed
      ? "formula_review_required"
      : "review_required";

    /* 2) 승인된 별칭 경유 개념 매핑 */
    const aliasRows = await sql<{ concept_id: string; alias_text: string }[]>`
      select concept_id, alias_text from source_aliases
      where alias_text = any(${eq.conceptAliases})
        and approved_at is not null
        and (organization_id is null or organization_id = ${organizationId})
    `;

    await sql.begin(async (tx) => {
      await tx`
        insert into questions (
          id, organization_id, kind, review_status, source_file_id,
          printed_number, content_right_id, is_auto_assignable, current_version_id
        ) values (
          ${questionId}, ${organizationId}, ${eq.kind}, ${reviewStatus},
          ${sourceFileId}, ${eq.printedNumber}, ${file.content_right_id},
          false, ${versionId}
        )
      `;
      await tx`
        insert into question_versions (
          id, organization_id, question_id, version_number, body, choices,
          answer, points, content_checksum, extraction
        ) values (
          ${versionId}, ${organizationId}, ${questionId}, 1,
          ${tx.json([{ type: "text", text: normalized.normalized }] as never)},
          ${
            eq.choices
              ? tx.json(
                  eq.choices.map((c, i) => ({
                    choiceId: `c${i + 1}`,
                    order: i + 1,
                    content: [{ kind: "text", text: c.text }],
                    hasTallMath: false,
                  })) as never,
                )
              : null
          },
          ${tx.json(
            (eq.kind === "multiple_choice"
              ? {
                  kind: "multiple_choice",
                  correctChoiceIds: [
                    `c${["①", "②", "③", "④", "⑤"].indexOf(eq.proposedAnswer) + 1}`,
                  ],
                }
              : {
                  kind: "short_answer",
                  accepted: [
                    {
                      value: eq.proposedAnswer,
                      form: "number",
                      allowEquivalence: true,
                    },
                  ],
                }) as never,
          )},
          '10', ${`${file.checksum}:${index}`},
          ${tx.json({
            provider: extraction.provider,
            model: extraction.model,
            promptVersion: extraction.promptVersion,
            confidence: eq.confidence,
            lowConfidence: isLowConfidence,
            repairs: normalized.repairs,
            reviewFlags: normalized.reviewFlags,
            suggestedAliases: eq.conceptAliases,
            // AI 제안 정답은 독립 검증 전 초안 (15장)
            answerVerification: "pending_review",
          } as never)}
        )
      `;

      for (const alias of aliasRows) {
        await tx`
          insert into question_alignments (
            id, organization_id, question_id, concept_id, weight, provenance
          ) values (
            ${uuidv7()}, ${organizationId}, ${questionId}, ${alias.concept_id},
            '1', 'imported'
          )
          on conflict do nothing
        `;
      }

      /* 검수 항목 */
      await tx`
        insert into content_reviews (
          id, organization_id, subject_type, subject_id, status, checklist
        ) values (
          ${uuidv7()}, ${organizationId}, 'question', ${questionId}, 'open',
          ${tx.json({
            formulaGate: !gateFailed,
            confidence: eq.confidence,
            needsAnswerVerification: true,
            unmappedAliases: eq.conceptAliases.filter(
              (a) => !aliasRows.some((r) => r.alias_text === a),
            ),
          } as never)}
        )
      `;
      if (gateFailed) {
        await tx`
          insert into formula_reviews (
            id, organization_id, expression_id, question_id, diagnosis, status
          ) values (
            ${uuidv7()}, ${organizationId}, ${versionId}, ${questionId},
            ${tx.json({
              failures: gate.failures,
              reviewFlags: normalized.reviewFlags,
            } as never)},
            'open'
          )
        `;
      }
    });
  }

  await sql`
    update source_files set status = 'review_required', updated_at = now()
    where id = ${sourceFileId}
  `;
  await sql`
    insert into audit_events (
      id, organization_id, actor_type, actor_id, action, target_type, target_id, after
    ) values (
      ${uuidv7()}, ${organizationId},
      ${options.actorUserId ? "user" : "automation"}, ${options.actorUserId},
      'ingestion.extract', 'source_file', ${sourceFileId},
      ${sql.json({
        provider: extraction.provider,
        extracted: extraction.questions.length,
        gatePassed,
        quarantined,
        lowConfidence,
      } as never)}
    )
  `;

  return {
    ok: true,
    message: `${extraction.questions.length}문항을 추출했습니다. 게이트 통과 ${gatePassed} · 수식 격리 ${quarantined} · 저신뢰 ${lowConfidence}. 전부 검수 대기 상태입니다.`,
    extracted: extraction.questions.length,
    gatePassed,
    formulaQuarantined: quarantined,
    lowConfidence,
  };
}

/**
 * 문항 검수 승인 — 사람 확인 후에만 출제 가능 (원칙 9).
 * 사용 권한이 usable이 아니면 게시하되 자동 출제는 막는다.
 */
export async function approveQuestion(options: {
  organizationId: string;
  questionId: string;
  reviewerUserId: string;
  note?: string;
}): Promise<{ ok: boolean; message: string }> {
  const sql = getSharedSql();
  const { organizationId, questionId } = options;

  const [question] = await sql<
    { review_status: string; right_status: string | null }[]
  >`
    select q.review_status, r.status as right_status
    from questions q
    left join content_rights r on r.id = q.content_right_id
    where q.id = ${questionId} and q.organization_id = ${organizationId}
  `;
  if (!question) return { ok: false, message: "문항을 찾을 수 없습니다." };
  if (question.review_status === "formula_review_required") {
    return {
      ok: false,
      message: "수식 검수가 먼저 해결되어야 합니다 (수식 격리 상태).",
    };
  }
  if (question.review_status === "published") {
    return { ok: false, message: "이미 게시된 문항입니다." };
  }

  const rightUsable = question.right_status === "usable";

  await sql.begin(async (tx) => {
    await tx`
      update questions
      set review_status = 'published',
          is_auto_assignable = ${rightUsable},
          updated_at = now()
      where id = ${questionId}
    `;
    await tx`
      update content_reviews
      set status = 'resolved', decision = 'approve',
          reviewer_id = ${options.reviewerUserId}, decided_at = now(),
          notes = ${options.note ?? null}, updated_at = now()
      where subject_type = 'question' and subject_id = ${questionId}
        and status = 'open'
    `;
    await tx`
      insert into outbox_events (
        id, organization_id, aggregate_type, aggregate_id, aggregate_version,
        event_type, occurred_at, payload
      ) values (
        ${uuidv7()}, ${organizationId}, 'question', ${questionId}, 1,
        'ContentApproved', now(),
        ${tx.json({
          questionId,
          questionVersionId: null,
          reviewerId: options.reviewerUserId,
        } as never)}
      )
    `;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id, reason
      ) values (
        ${uuidv7()}, ${organizationId}, 'user', ${options.reviewerUserId},
        'content.approve-question', 'question', ${questionId},
        ${options.note ?? "검수 승인"}
      )
    `;
  });

  return {
    ok: true,
    message: rightUsable
      ? "게시했습니다. 자동 출제 풀에 포함됩니다."
      : "게시했습니다. 사용 권한이 '사용 가능'이 아니어서 자동 출제에서는 제외됩니다.",
  };
}
