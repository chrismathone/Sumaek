import { v7 as uuidv7 } from "uuid";
import { getSharedSql } from "../client";

/* ─────────────────────────────────────────────────────────────
 * 개인정보 삭제 요청 집행 (ADR-0015 §5 · 인수 39).
 *
 * 삭제가 아니라 **익명화**다:
 * - learners.display_name → 안정 토큰 치환, 로그인 연결 해제, 보관 전이
 * - 서술·주관식 답안 본문 → {"redacted": true} (객관식 선택은 점수 재현을
 *   위해 유지)
 * - 점수·채점 이력·숙련도 증거 → 유지 (learner_id UUID가 안정 토큰)
 * - audit_events → 불변(트리거) — 페이로드 속 이름은 5년 보존 후 파티션
 *   파기로만 사라진다 (ADR-0015 §3, 감사 무결성이 우선)
 *
 * PITR 복원 후에는 data_deletion_requests의 완료 행을 재실행해야 한다
 * (F-5) — 이 함수는 멱등이다.
 * ───────────────────────────────────────────────────────────── */

export interface ErasureResult {
  ok: boolean;
  message: string;
  tokenizedName: string | null;
  redactedResponses: number;
  backupExpiresOn: string | null;
}

export async function executeLearnerErasure(options: {
  organizationId: string;
  requestId: string;
  executedBy: string | null;
}): Promise<ErasureResult> {
  const sql = getSharedSql();
  const { organizationId, requestId } = options;

  const [request] = await sql<
    { id: string; learner_id: string | null; status: string; reason: string }[]
  >`
    select id, learner_id, status, reason from data_deletion_requests
    where id = ${requestId} and organization_id = ${organizationId}
      and subject_type = 'learner'
  `;
  if (!request) {
    return failResult("삭제 요청을 찾을 수 없습니다.");
  }
  if (!request.learner_id) {
    return failResult("요청에 대상 학습자가 없습니다.");
  }
  if (request.status === "rejected") {
    return failResult("반려된 요청은 집행할 수 없습니다.");
  }

  const [learner] = await sql<{ id: string; display_name: string }[]>`
    select id, display_name from learners
    where id = ${request.learner_id} and organization_id = ${organizationId}
  `;
  if (!learner) {
    return failResult("대상 학습자를 찾을 수 없습니다.");
  }

  const token = `삭제된 학습자-${learner.id.slice(0, 8)}`;
  const alreadyTokenized = learner.display_name === token;

  let redactedResponses = 0;
  let backupExpiresOn: string | null = null;

  await sql.begin(async (tx) => {
    /* 1. 표시명 토큰화 + 로그인 연결 해제 + 보관 전이 (멱등) */
    await tx`
      update learners
      set display_name = ${token}, user_id = null, grade_level = null,
          status = 'archived', updated_at = now()
      where id = ${learner.id}
    `;

    /* 1b. 활성 반 소속 종료 — 보관된 학습자는 배정·출제 대상이 아니다 */
    await tx`
      update learning_group_memberships
      set status = 'left', left_on = current_date, updated_at = now()
      where organization_id = ${organizationId}
        and learner_id = ${learner.id} and status = 'active'
    `;

    /* 2. 서술·주관식 답안 본문 삭제 — 객관식 선택은 유지 (점수 재현) */
    const redacted = await tx`
      update responses
      set answer = jsonb_build_object('redacted', true), updated_at = now()
      from attempts a
      where responses.attempt_id = a.id
        and a.organization_id = ${organizationId}
        and a.learner_id = ${learner.id}
        and responses.answer is not null
        and (responses.answer ? 'text' or responses.answer ? 'value')
        and not (responses.answer ? 'redacted')
    `;
    redactedResponses = redacted.count;

    /* 3. 요청 완료 기록 + 백업 만료 예정일 (PITR 최대 35일) 고지 근거 */
    const [updated] = await tx<{ backup_expires_on: string }[]>`
      update data_deletion_requests
      set status = 'completed',
          executed_at = now(),
          executed_by = ${options.executedBy},
          backup_expires_on = (now() + interval '35 days')::date,
          summary = ${tx.json({
            tokenizedName: token,
            redactedResponses,
            kept: "점수·채점 이력·숙련도 증거 (안정 토큰 = learner_id)",
            auditNote:
              "audit_events는 불변 — 5년 보존 후 파티션 파기 (ADR-0015 §3)",
            idempotentRerun: alreadyTokenized,
          } as never)},
          updated_at = now()
      where id = ${request.id}
      returning backup_expires_on::text
    `;
    backupExpiresOn = updated?.backup_expires_on ?? null;

    /* 4. 감사 — privacy.erase (ADR-0015 §5) */
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id,
        reason, after
      ) values (
        ${uuidv7()}, ${organizationId},
        ${options.executedBy ? "user" : "automation"}, ${options.executedBy},
        'privacy.erase', 'learner', ${learner.id}, ${request.reason},
        ${tx.json({ tokenizedName: token, redactedResponses } as never)}
      )
    `;
  });

  return {
    ok: true,
    message: alreadyTokenized
      ? `이미 익명화된 학습자입니다 — 요청 기록만 갱신했습니다 (멱등 재실행).`
      : `익명화를 완료했습니다. 서술 답안 ${redactedResponses}건 본문 삭제, 백업 만료 예정일 ${backupExpiresOn ?? "미정"}.`,
    tokenizedName: token,
    redactedResponses,
    backupExpiresOn,
  };
}

function failResult(message: string): ErasureResult {
  return {
    ok: false,
    message,
    tokenizedName: null,
    redactedResponses: 0,
    backupExpiresOn: null,
  };
}
