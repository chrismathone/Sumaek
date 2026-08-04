import { v7 as uuidv7 } from "uuid";
import {
  checkpointJob,
  deferSignal,
  getSharedSql,
  isFeatureEnabled,
  tryMarkInbox,
  type ClaimedJob,
} from "@su-maek/db";
import {
  materializeGroupSchedule,
  materializeLearnerSchedule,
} from "@su-maek/db/domain";
import { todayInKst } from "@su-maek/core/shared";
import { FAILURE_RECOVERY } from "./assessment";

/* ─────────────────────────────────────────────────────────────
 * 일정 재계산 소비자 — 결과 기반 미래 일정 갱신 (20장 재계산 트리거).
 * MasteryUpdated·LearningAvailabilityChanged·SessionCompleted 이벤트가
 * Outbox → schedule.recalculate 작업으로 라우팅되어 여기 도착한다.
 * Inbox(consumer+event_id)로 중복 전달을 멱등 처리한다.
 * ───────────────────────────────────────────────────────────── */

interface EventJobPayload {
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export async function handleScheduleRecalculate(
  job: ClaimedJob,
): Promise<unknown> {
  const sql = getSharedSql();
  const data = job.payload as EventJobPayload;
  const organizationId = job.organization_id;
  if (!organizationId) return { skipped: "조직 없음" };

  /* 조직 스코프 kill switch (인수 40) — Inbox 마킹 전에 확인해야
   * 스위치 복구 후 이벤트가 소비될 수 있다 */
  if (!(await isFeatureEnabled(sql, "auto_reschedule", organizationId))) {
    return deferSignal("kill switch: auto_reschedule 중지 — 복구 후 재개");
  }

  /* Inbox 멱등 — at-least-once 전달 방어. 체크포인트가 있으면 같은 작업의
   * 재개(lease 만료 회수)이므로 중복이 아니라 이어서 처리한다 (인수 21). */
  const checkpoint = parseCheckpoint(job.checkpoint);
  const fresh = await sql.begin((tx) =>
    tryMarkInbox(tx as never, "schedule.recalculate", data.eventId),
  );
  if (!fresh && !checkpoint) return { skipped: "중복 이벤트 (inbox)" };

  /* 대상 학습 그룹 해석 */
  const groupIds = new Set<string>();
  const p = data.payload ?? {};
  if (typeof p.learningGroupId === "string" && p.learningGroupId) {
    groupIds.add(p.learningGroupId);
  }
  if (typeof p.learnerId === "string" && p.learnerId) {
    const rows = await sql<{ learning_group_id: string }[]>`
      select learning_group_id from learning_group_memberships
      where learner_id = ${p.learnerId} and status = 'active'
    `;
    for (const r of rows) groupIds.add(r.learning_group_id);
  }
  if (groupIds.size === 0) return { skipped: "대상 그룹 없음" };

  const today = todayInKst();

  /* 그룹 단위 체크포인트 — 배치 경계마다 기록해 중단 지점부터 재개 */
  const done = new Set(checkpoint?.doneGroupIds ?? []);
  const results: Record<string, unknown> = {};
  for (const groupId of [...groupIds].sort()) {
    if (done.has(groupId)) {
      results[groupId] = { skipped: "체크포인트 완료분" };
      continue;
    }
    const result = await materializeGroupSchedule({
      organizationId,
      learningGroupId: groupId,
      actorUserId: null, // 자동화 실행
      today,
    });
    results[groupId] = {
      ok: result.ok,
      created: result.createdSessions,
      conflicts: result.conflicts,
    };
    done.add(groupId);
    await checkpointJob(sql, job.id, { doneGroupIds: [...done] });
  }
  return results;
}

/* ─────────────────────────────────────────────────────────────
 * 학습자 스코프 자동 재계산 (인수 4).
 *
 * LearnerRouteOverrideChanged(오버라이드 생성·취소) → Outbox →
 * schedule.materialize-learner 작업으로 여기 도착한다. 반 공통 일정은
 * 건드리지 않는다 — materializeLearnerSchedule이 sessions를 쓰지 않는다.
 *
 * 소비자 등록의 짝: `EVENT_CONSUMERS.LearnerRouteOverrideChanged`(queue.ts)와
 * main.ts의 `register("schedule.materialize-learner", ...)`가 **함께** 있어야
 * 한다. 한쪽만 있으면 디스패처가 작업 0건을 만들고도 outbox 행을 delivered로
 * 표시해 이벤트가 영구 유실된다 (queue.ts 340-344).
 * ───────────────────────────────────────────────────────────── */
export async function handleLearnerScheduleMaterialize(
  job: ClaimedJob,
): Promise<unknown> {
  const sql = getSharedSql();
  const data = job.payload as EventJobPayload;
  const organizationId = job.organization_id;
  if (!organizationId) return { skipped: "조직 없음" };

  /* 조직 스코프 kill switch — Inbox 마킹 **전에** 확인해야 스위치 복구 후
   * 이벤트가 소비될 수 있다 (마킹 후 defer하면 재개 시 중복으로 걸러진다). */
  if (!(await isFeatureEnabled(sql, "auto_reschedule", organizationId))) {
    return deferSignal("kill switch: auto_reschedule 중지 — 복구 후 재개");
  }

  const learnerId = (data.payload ?? {}).learnerId;
  if (typeof learnerId !== "string" || !learnerId) {
    return { skipped: "대상 학습자 없음" };
  }

  /* Inbox 멱등 — at-least-once 전달 방어. 실체화 자체도 멱등이지만
   * (같은 입력 → 같은 항목), 재실행마다 리비전·변경안·감사 행이 늘어난다. */
  const fresh = await sql.begin((tx) =>
    tryMarkInbox(tx as never, "schedule.materialize-learner", data.eventId),
  );
  if (!fresh) return { skipped: "중복 이벤트 (inbox)" };

  const today = todayInKst();

  const result = await materializeLearnerSchedule({
    organizationId,
    learnerId,
    actorUserId: null, // 자동화 실행
    today,
  });
  /* 실체화 거절(기준 반 루트 없음 등)은 일시적 오류가 아니다 — 던져서
   * 재시도·DLQ로 밀지 않고 결과로 남긴다 (jobs.meta.result에 보존된다). */
  return {
    learnerId,
    ok: result.ok,
    message: result.message,
    created: result.createdItems,
    diverging: result.divergingItems,
    rejoinDate: result.rejoinDate,
    conflicts: result.conflicts,
  };
}

function parseCheckpoint(
  value: unknown,
): { doneGroupIds: string[] } | null {
  if (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { doneGroupIds?: unknown }).doneGroupIds)
  ) {
    return {
      doneGroupIds: (value as { doneGroupIds: unknown[] }).doneGroupIds.filter(
        (v): v is string => typeof v === "string",
      ),
    };
  }
  return null;
}

/** 앱 내 알림 생성 — 외부 공급자와 무관하게 업무함은 항상 동작 (22장) */
export async function handleNotificationDispatch(
  job: ClaimedJob,
): Promise<unknown> {
  const sql = getSharedSql();
  const data = job.payload as EventJobPayload;
  const organizationId = job.organization_id;
  if (!organizationId) return { skipped: "조직 없음" };

  const fresh = await sql.begin((tx) =>
    tryMarkInbox(tx as never, "notification.dispatch", data.eventId),
  );
  if (!fresh) return { skipped: "중복 이벤트 (inbox)" };

  /* 하루 1회 묶음 키는 **KST**로 끊는다.
   * UTC 날짜를 쓰면 KST 00:00~09:00 사이가 전날로 잡혀 하루 경계가
   * 자정이 아니라 오전 9시에 넘어간다. */
  const localDay = todayInKst();

  /* 자동 평가 생성 실패 (E-17)는 고정 문구로 처리할 수 없다 — 사유마다
   * 무엇을 하면 되는지가 다르고, 복구 링크가 payload에 들어 있다. 일반
   * 템플릿보다 **먼저** 처리한다. */
  if (data.eventType === "DailyAssessmentGenerationFailed") {
    return dispatchGenerationFailure(sql, organizationId, data, localDay);
  }

  const templates: Record<
    string,
    { kind: string; title: string; link: string } | undefined
  > = {
    AssessmentPublished: {
      kind: "today_task",
      title: "테스트가 게시되었습니다",
      link: "/app/tests",
    },
    ScheduleProposalCreated: {
      kind: "route_approval",
      title: "일정 변경안이 승인을 기다립니다",
      link: "/app/routes",
    },
    FormulaReviewRequired: {
      kind: "content_review",
      title: "수식 검수가 필요한 문항이 있습니다",
      link: "/app/content/review",
    },
    QuestionQuarantined: {
      kind: "content_review",
      title: "문항이 격리되었습니다 — 영향 확인 필요",
      link: "/app/content/questions",
    },
    ContentRightsRevoked: {
      kind: "content_review",
      title: "콘텐츠 사용 권한이 회수되었습니다",
      link: "/app/content/books",
    },
    ScheduleProposalApplied: {
      kind: "today_task",
      title: "일정 변경이 적용되었습니다",
      link: "/app/calendar",
    },
  };
  const template = templates[data.eventType];
  if (!template) return { skipped: `알림 대상 아님: ${data.eventType}` };

  /* 수신자: 조직의 owner·program_director·teacher */
  const recipients = await sql<{ user_id: string }[]>`
    select user_id from memberships
    where organization_id = ${organizationId}
      and status = 'active' and role in ('owner', 'program_director', 'teacher')
  `;
  for (const r of recipients) {
    await sql`
      insert into notifications (
        id, organization_id, recipient_user_id, kind, title, body, link_path,
        related_type, related_id, group_key
      ) values (
        ${uuidv7()}, ${organizationId}, ${r.user_id}, ${template.kind},
        ${template.title},
        ${sql.json({
          what: template.title,
          why: data.eventType,
          action: "확인",
        } as never)},
        ${template.link}, 'event', ${data.eventId},
        ${`${data.eventType}:${localDay}`}
      )
    `;
  }
  return { notified: recipients.length };
}

/**
 * 자동 평가 생성 실패 → 교사 업무함 (T3.4 · E-17).
 *
 * 일반 알림 템플릿과 다른 점: **무엇을 하면 되는지가 사유마다 다르다.**
 * "테스트 생성에 실패했습니다"만 보내면 교사는 무엇을 고쳐야 할지 모른 채
 * 수업 시간을 맞는다. 사유 코드 → 원인·조치 문구는 핸들러가 단일 정의처로
 * 들고 있고(FAILURE_RECOVERY), 복구 링크는 이벤트가 나른다.
 */
async function dispatchGenerationFailure(
  sql: ReturnType<typeof getSharedSql>,
  organizationId: string,
  data: EventJobPayload,
  localDay: string,
): Promise<unknown> {
  const p = (data.payload ?? {}) as {
    reason?: string;
    planDate?: string;
    purpose?: string;
    recoveryHref?: string;
    message?: string;
  };
  const reason = (p.reason ?? "insufficient_questions") as
    keyof typeof FAILURE_RECOVERY;
  const guide = FAILURE_RECOVERY[reason] ?? {
    why: p.message ?? "알 수 없는 오류입니다.",
    action: "운영에 알리세요.",
  };
  const label = p.purpose === "confirmation" ? "확인테스트" : "일일테스트";
  const title = `${p.planDate ?? ""} ${label} 자동 생성에 실패했습니다`.trim();
  const link = p.recoveryHref ?? "/app/tests";

  const recipients = await sql<{ user_id: string }[]>`
    select user_id from memberships
    where organization_id = ${organizationId}
      and status = 'active' and role in ('owner', 'program_director', 'teacher')
  `;
  for (const r of recipients) {
    await sql`
      insert into notifications (
        id, organization_id, recipient_user_id, kind, title, body, link_path,
        related_type, related_id, group_key
      ) values (
        ${uuidv7()}, ${organizationId}, ${r.user_id}, 'today_task', ${title},
        ${sql.json({ what: title, why: guide.why, action: guide.action } as never)},
        ${link}, 'event', ${data.eventId},
        /* 같은 날 같은 사유는 한 줄로 묶는다 — 반이 스물이면 알림도 스물이다 */
        ${`${data.eventType}:${reason}:${localDay}`}
      )
    `;
  }
  return { notified: recipients.length, reason };
}

/** 소비 완료 표시만 하는 핸들러 (파생 재계산이 인라인으로 끝난 이벤트) */
export function makeInboxNoop(consumerName: string) {
  return async (job: ClaimedJob): Promise<unknown> => {
    const sql = getSharedSql();
    const data = job.payload as EventJobPayload;
    await sql.begin((tx) =>
      tryMarkInbox(tx as never, consumerName, data.eventId),
    );
    return { acknowledged: true };
  };
}
