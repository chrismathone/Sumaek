import {
  deferSignal,
  getSharedSql,
  isFeatureEnabled,
  type ClaimedJob,
} from "@su-maek/db";
import {
  ASSESSMENT_GENERATION_SWITCH,
  generateConfirmationTest,
  generateDailyTest,
  type AssessmentGenerateJobPayload,
} from "@su-maek/db/domain";

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
    throw permanent(
      `작업 payload가 불완전합니다 (반=${learningGroupId ?? "없음"} 날짜=${planDate ?? "없음"} 목적=${purpose ?? "없음"}).`,
    );
  }
  if (purpose !== "formative" && purpose !== "confirmation") {
    throw permanent(`자동 생성 대상이 아닌 목적입니다: ${purpose}`);
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
  const result =
    purpose === "formative"
      ? await generateDailyTest(options)
      : await generateConfirmationTest(options);

  if (!result.ok) {
    /* 결과를 그대로 돌려주면 작업이 `succeeded`가 되고 실패는 meta 안에만
     * 남는다. 현황판은 초록인데 학생 화면에는 시험이 없다 — 가장 나쁜 실패다.
     * 던져서 `failed_final`로 남긴다. 그 목록이 T3.4의 복구 대상이다. */
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
