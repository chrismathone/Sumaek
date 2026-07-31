import { v7 as uuidv7 } from "uuid";
import {
  checkpointJob,
  deferSignal,
  getSharedSql,
  isFeatureEnabled,
  tryMarkInbox,
  type ClaimedJob,
} from "@su-maek/db";
import { materializeGroupSchedule } from "@su-maek/db/domain";

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

  const [org] = await sql<{ timezone: string }[]>`
    select timezone from organizations where id = ${organizationId}
  `;
  const timezone = org?.timezone ?? "Asia/Seoul";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });

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
      timezone,
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
        ${`${data.eventType}:${new Date().toISOString().slice(0, 10)}`}
      )
    `;
  }
  return { notified: recipients.length };
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
