import { v7 as uuidv7 } from "uuid";
import {
  appendOutboxEvent,
  deferSignal,
  getSharedSql,
  isFeatureEnabled,
  type ClaimedJob,
  type Sql,
} from "@su-maek/db";
import {
  ASSESSMENT_GENERATION_SWITCH,
  assessmentJobKey,
  generateConfirmationTest,
  generateDailyTest,
  type AssessmentGenerateJobPayload,
  type GenerationFailureReason,
} from "@su-maek/db/domain";
import { isRetryable } from "../loop";

/* ─────────────────────────────────────────────────────────────
 * 평가 자동 생성 소비자 (T3.2 · G-04 · ADR-0018 §5).
 *
 * 생산자(`produceAssessmentJobs`)가 만든 `assessment.generate` 작업을 받아
 * 실제 생성을 부른다. **이벤트 소비자가 아니다** — 그래서 Inbox 표시를 하지
 * 않는다. 생성 요청은 이벤트가 아니라 작업이고(`jobs` 행이 요청·멱등 키·
 * 시도 횟수·상태를 전부 담는다), 같은 사실을 outbox에 또 남기면 둘이
 * 어긋난다.
 *
 * 멱등은 두 겹으로 이미 서 있다:
 *   ① `jobs.idempotency_key` — 같은 작업이 둘 만들어지지 않는다
 *   ② `assessments_group_idempotent_uq` — 작업이 중복 실행돼도 평가는 하나
 * 그 위에 생성 서비스 자신의 「이미 있으면 그대로 반환」이 얹힌다. 워커
 * 재시작으로 클레임된 작업이 다시 도는 경우가 정확히 여기로 온다.
 *
 * 생성 시점의 신선도: 여기서 부르는 시점의 숙련도·복습을 읽는다. 학기 초에
 * 미리 계산해 두지 않는다 — 생산자가 창을 좁게 잡는 이유가 그것이다.
 *
 * ── 실패는 큐에만 남지 않는다 (T3.4) ──────────────────────
 * 실패한 작업이 `failed_final`로 큐에만 남으면 교사는 수업 당일 아침에
 * 학생 화면의 빈 시험 칸으로 알게 된다. 그때는 이미 늦다 — 문항 부족이나
 * 정책 없음은 **미리 알면 고칠 수 있는** 문제다. 그래서 최종 실패에서
 * E-17을 발행해 교사 업무함으로 보낸다.
 * ───────────────────────────────────────────────────────────── */

/**
 * 재시도해도 낫지 않는 실패.
 *
 * 정책이 없다·수업이 없다·출제할 문항이 없다 — 전부 사람이 뭔가 해야 낫는다.
 * 이것을 재시도로 돌리면 같은 실패를 5번 반복한 뒤에야 DLQ에 닿고, 그동안
 * 로그만 다섯 배가 된다. `loop.ts`의 isRetryable이 이 표시를 읽는다.
 */
function permanent(message: string): Error {
  const error = new Error(message);
  (error as Error & { retryable?: boolean }).retryable = false;
  return error;
}

/** E-17이 나르는 사유 — 생성기의 판단(코드)에 던져진 예외 분류를 더한다 */
export type AssessmentFailureReason =
  | GenerationFailureReason
  | "transient_db"
  | "bad_payload";

/** 사유별 복구 안내 — 교사 업무함·화면이 같은 문구를 쓴다 */
export const FAILURE_RECOVERY: Readonly<
  Record<AssessmentFailureReason, { why: string; action: string }>
> = {
  no_policy: {
    why: "이 반에 적용할 평가 정책이 없습니다.",
    action: "반 설정에서 평가 정책을 지정하거나 학원 기본 정책을 만드세요.",
  },
  no_session: {
    why: "그날 예정된 수업이 없습니다.",
    action: "학습 루트에서 일정을 먼저 만드세요.",
  },
  no_route: {
    why: "게시된 루트가 없어 확인테스트의 단원 범위를 정할 수 없습니다.",
    action: "루트를 게시한 뒤 다시 실행하세요.",
  },
  insufficient_questions: {
    why: "출제할 수 있는 문항이 부족합니다.",
    action: "문항의 개념 정렬과 검수·사용 권한 상태를 확인하세요.",
  },
  no_repeat_window: {
    why: "후보 문항이 모두 최근 출제분입니다.",
    action: "정책의 무반복 기간을 줄이거나 이 개념의 문항을 늘리세요.",
  },
  difficulty_unsatisfiable: {
    why: "난이도 배분 조건을 만족하는 조합이 없습니다.",
    action: "정책의 난이도 배분을 확인하세요.",
  },
  transient_db: {
    why: "저장 중 오류가 반복돼 재시도를 모두 소진했습니다.",
    action: "다시 실행하세요. 계속 실패하면 운영에 알리세요.",
  },
  bad_payload: {
    why: "생성 요청의 형식이 올바르지 않습니다.",
    action: "운영에 알리세요 — 자동으로 낫지 않습니다.",
  },
};

export async function handleAssessmentGenerate(
  job: ClaimedJob,
): Promise<unknown> {
  const sql = getSharedSql();
  const payload = (job.payload ?? {}) as Partial<AssessmentGenerateJobPayload>;
  const organizationId = job.organization_id ?? payload.organizationId ?? null;
  if (!organizationId) return { skipped: "조직 없음" };

  /* 조직 스코프 kill switch — 전역 스위치는 클레임 단계에서 걸리지만
   * (loop.ts), 조직 스위치는 클레임된 뒤 여기서 미룬다. 시도를 소모하지
   * 않으므로 DLQ로 밀리지 않고 복구 후 그대로 재개된다 (인수 40). */
  if (!(await isFeatureEnabled(sql, ASSESSMENT_GENERATION_SWITCH, organizationId))) {
    return deferSignal(
      `kill switch: ${ASSESSMENT_GENERATION_SWITCH} 중지 — 복구 후 재개`,
    );
  }

  const { learningGroupId, planDate, purpose } = payload;
  if (!learningGroupId || !planDate || !purpose) {
    /* 생산자가 만들지 않은 모양의 작업이다. 재시도로 낫지 않는다. */
    const message = `작업 payload가 불완전합니다 (반=${learningGroupId ?? "없음"} 날짜=${planDate ?? "없음"} 목적=${purpose ?? "없음"}).`;
    await reportFailure(sql, job, organizationId, "bad_payload", false, message);
    throw permanent(message);
  }
  if (purpose !== "formative" && purpose !== "confirmation") {
    const message = `자동 생성 대상이 아닌 목적입니다: ${purpose}`;
    await reportFailure(sql, job, organizationId, "bad_payload", false, message);
    throw permanent(message);
  }

  const options = {
    organizationId,
    learningGroupId,
    targetDate: planDate,
    /* 사람이 아니라 워커가 만든다 — 감사 행이 `automation`으로 남는다 */
    actorUserId: null,
    /* 어느 수업의 어느 노드가 불렀는지 — 생성 맥락에 그대로 남는다.
     * 없으면 나중에 「이 시험은 왜 있나」에 답할 수 없다 (T3.3). */
    sessionId: payload.sessionId ?? null,
    routeNodeId: payload.routeNodeId ?? null,
  };

  let result;
  try {
    result =
      purpose === "formative"
        ? await generateDailyTest(options)
        : await generateConfirmationTest(options);
  } catch (error) {
    /* 던져진 예외 — DB 순단·제약 위반 같은 것. 재시도로 나을 수 있으므로
     * **재시도가 남아 있는 동안은 알리지 않는다.** DB가 1초 끊겼다고 교사에게
     * 알림을 쏘면 알림이 신호가 아니라 소음이 된다. */
    const message = error instanceof Error ? error.message : String(error);
    const retryable = isRetryable(error);
    if (!retryable || job.attempts >= job.max_attempts) {
      await reportFailure(
        sql,
        job,
        organizationId,
        "transient_db",
        retryable,
        message,
      );
    }
    throw error;
  }

  if (!result.ok) {
    /* 결과를 그대로 돌려주면 작업이 `succeeded`가 되고 실패는 meta 안에만
     * 남는다. 현황판은 초록인데 학생 화면에는 시험이 없다 — 가장 나쁜 실패다.
     * 던져서 `failed_final`로 남기고, 교사에게도 알린다. */
    await reportFailure(
      sql,
      job,
      organizationId,
      result.reason ?? "insufficient_questions",
      false,
      result.message,
    );
    throw permanent(result.message);
  }

  return {
    purpose,
    learningGroupId,
    planDate,
    assessmentId: result.assessmentId,
    questionCount: result.questionCount,
    assignedLearners: result.assignedLearners,
    deduplicated: result.deduplicated,
    shortfalls: result.shortfalls,
  };
}

/**
 * E-17 `DailyAssessmentGenerationFailed` 발행 — **최종 실패에서만**.
 *
 * 멱등하다: 같은 작업의 실패가 여러 번 도착해도 이벤트는 하나다. 재시도와
 * 워커 재시작으로 같은 실패가 반복해서 도달하는데, 그때마다 알림을 만들면
 * 교사 업무함이 같은 말로 가득 찬다 — 그러면 아무도 읽지 않는다.
 *
 * 발행 실패가 작업 실패를 덮지 않는다. 알리지 못한 것은 알리지 못한 것이고,
 * 원래 실패는 원래 실패다 — 여기서 던지면 **원인이 바뀌어 보인다.**
 */
async function reportFailure(
  sql: Sql,
  job: ClaimedJob,
  organizationId: string,
  reason: AssessmentFailureReason,
  retryable: boolean,
  message: string,
): Promise<void> {
  const payload = (job.payload ?? {}) as Partial<AssessmentGenerateJobPayload>;
  try {
    await sql.begin(async (tx) => {
      /* 작업 하나당 이벤트 하나. outbox에는 이것을 강제할 유니크가 없으므로
       * (집계가 수업이고 한 수업에 목적별로 여럿이 날 수 있다) job_id로
       * 직접 확인한다. */
      const [existing] = await tx<{ id: string }[]>`
        select id from outbox_events
        where organization_id = ${organizationId}
          and event_type = 'DailyAssessmentGenerationFailed'
          and payload->>'jobId' = ${job.id}
        limit 1
      `;
      if (existing) return;

      const sessionId = payload.sessionId ?? null;
      await appendOutboxEvent(tx as never, {
        eventId: uuidv7(),
        organizationId,
        /* 집계는 수업이다 (event-catalog E-17). 수업이 없는 실패
         * (no_session·bad_payload)는 붙일 곳이 없어 반으로 대신한다 —
         * 그 사실은 payload의 sessionId=null로 남는다. */
        aggregateType: sessionId ? "session" : "learning_group",
        aggregateId: sessionId ?? payload.learningGroupId ?? job.id,
        aggregateVersion: 1,
        eventType: "DailyAssessmentGenerationFailed",
        occurredAt: new Date(),
        payload: {
          sessionId,
          learningGroupId: payload.learningGroupId ?? null,
          routeNodeId: payload.routeNodeId ?? null,
          planDate: payload.planDate ?? null,
          purpose: payload.purpose ?? null,
          jobId: job.id,
          idempotencyKey:
            payload.planDate && payload.purpose
              ? assessmentJobKey({
                  organizationId,
                  learningGroupId: payload.learningGroupId ?? null,
                  learnerId: payload.learnerId ?? null,
                  planDate: payload.planDate,
                  purpose: payload.purpose,
                })
              : null,
          reason,
          retryable,
          attemptCount: job.attempts,
          /* 「무엇이 잘못됐다」만으로는 아무것도 못 한다. 어디로 가면 고칠 수
           * 있는지가 같이 있어야 한다. */
          recoveryHref: recoveryHref(payload),
          message,
        },
      });
    });
  } catch (error) {
    /* 알림을 못 남긴 것으로 작업 실패의 원인을 덮지 않는다. 로그로만 남긴다. */
    console.error(
      `[assessment] 실패 알림 발행 실패 (job=${job.id}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function recoveryHref(payload: Partial<AssessmentGenerateJobPayload>): string {
  const params = new URLSearchParams();
  if (payload.learningGroupId) params.set("group", payload.learningGroupId);
  if (payload.planDate) params.set("date", payload.planDate);
  const query = params.toString();
  return query ? `/app/tests?${query}` : "/app/tests";
}
