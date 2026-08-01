import { v7 as uuidv7 } from "uuid";
import { getSharedSql } from "../client";
import {
  ENGINE_VERSION,
  calculateSchedule,
  type BusyInterval,
  type LessonSlotRule,
  type RouteNodeInput,
  type ScheduleEngineInput,
  type ScheduledItem,
} from "@su-maek/core/scheduling";
import { eachDate, zonedTimeToUtc, type IsoDate } from "@su-maek/core/shared";

/* ─────────────────────────────────────────────────────────────
 * 일정 실체화 — 게시된 루트 버전 → 실제 수업(sessions) 생성.
 * (시퀀스 1: 반 루트 게시와 날짜별 수업 생성)
 *
 * - 결정론적 엔진에 불변 스냅샷을 넘기고, 결과를 ScheduleChangeProposal로
 *   기록한 뒤 같은 트랜잭션에서 적용한다 (선생님의 명시적 실행 = 승인).
 * - 완료·잠금 수업은 보존한다. 미래의 잠기지 않은 planned 수업만 교체한다.
 * - 같은 날짜·슬롯의 여러 노드는 하나의 수업으로 합쳐진다 (plannedNodeIds).
 * ───────────────────────────────────────────────────────────── */

export interface MaterializeResult {
  ok: boolean;
  message: string;
  createdSessions: number;
  preservedSessions: number;
  conflicts: number;
  firstDate: string | null;
  lastDate: string | null;
}

export async function materializeGroupSchedule(options: {
  organizationId: string;
  learningGroupId: string;
  /** null이면 자동화 실행 (감사 actor_type=automation) */
  actorUserId: string | null;
  timezone: string;
  /** 기준 날짜 (워크스페이스 시간대 오늘) — 테스트 재현성 위해 주입 */
  today: IsoDate;
}): Promise<MaterializeResult> {
  const sql = getSharedSql();
  const { organizationId, learningGroupId, timezone, today } = options;

  /* ── 입력 스냅샷 로드 ── */
  const [group] = await sql<
    { id: string; name: string; course_period_id: string; ends_on: string }[]
  >`
    select g.id, g.name, g.course_period_id, p.ends_on::text as ends_on
    from learning_groups g
    join course_periods p on p.id = g.course_period_id
    where g.id = ${learningGroupId} and g.organization_id = ${organizationId}
  `;
  if (!group) {
    return fail("학습 그룹을 찾을 수 없습니다.");
  }

  const [plan] = await sql<
    { id: string; active_version_id: string | null }[]
  >`
    select id, active_version_id from route_plans
    where organization_id = ${organizationId}
      and learning_group_id = ${learningGroupId}
      and status = 'published'
    order by updated_at desc limit 1
  `;
  if (!plan?.active_version_id) {
    return fail("게시된 루트가 없습니다. 루트를 먼저 게시하세요.");
  }

  const nodes = await sql<
    {
      id: string;
      kind: string;
      title: string;
      sort_order: number;
      expected_minutes: number | null;
    }[]
  >`
    select id, kind, title, sort_order, expected_minutes
    from route_nodes
    where route_version_id = ${plan.active_version_id}
    order by sort_order
  `;
  if (nodes.length === 0) {
    return fail("루트에 노드가 없습니다.");
  }

  const slots = await sql<
    {
      weekday: number;
      start_time: string;
      end_time: string;
      effective_from: string;
      effective_to: string | null;
    }[]
  >`
    select weekday, start_time::text, end_time::text,
           effective_from::text, effective_to::text
    from calendar_rules
    where organization_id = ${organizationId}
      and subject_type = 'learning_group' and subject_id = ${learningGroupId}
  `;
  if (slots.length === 0) {
    return fail("수업 가능 시간이 설정되지 않았습니다. 설정에서 수업 요일·시간을 등록하세요.");
  }

  const holidays = await sql<{ starts_on: string; ends_on: string }[]>`
    select starts_on::text, ends_on::text from holidays
    where organization_id = ${organizationId}
      and (learning_group_id is null or learning_group_id = ${learningGroupId})
  `;

  /* 휴강(group_cancelled) 이벤트 — 해당 날짜 전체를 하드 충돌로 넣어 배치를
   * 막는다 (인수 2·5의 재계산 입력). 학생 불참(learner_absence)은 반 공통
   * 일정을 움직이지 않으므로 여기서 소비하지 않는다 — 학생 오버라이드의 입력. */
  const cancellations = await sql<
    { id: string; starts_on: string; ends_on: string; reason: string | null }[]
  >`
    select id, starts_on::text, ends_on::text, reason
    from learning_availability_events
    where organization_id = ${organizationId}
      and learning_group_id = ${learningGroupId}
      and kind = 'group_cancelled'
      and status <> 'dismissed'
      and ends_on >= ${today}::date
    order by starts_on
  `;
  const busy: BusyInterval[] = [];
  for (const c of cancellations) {
    for (const d of eachDate(c.starts_on as IsoDate, c.ends_on as IsoDate)) {
      busy.push({
        date: d,
        startTime: "00:00",
        endTime: "23:59",
        label: c.reason ? `휴강: ${c.reason}` : "휴강",
      });
    }
  }

  const existingSessions = await sql<
    {
      id: string;
      session_date: string;
      starts_at: Date;
      ends_at: Date;
      status: string;
      locked_at: Date | null;
      planned_node_ids: unknown;
    }[]
  >`
    select id, session_date::text, starts_at, ends_at, status, locked_at, planned_node_ids
    from sessions
    where organization_id = ${organizationId}
      and learning_group_id = ${learningGroupId}
  `;

  const completedNodeIds = new Set<string>();
  const existingItems: ScheduledItem[] = [];
  for (const s of existingSessions) {
    const nodeIds = Array.isArray(s.planned_node_ids)
      ? (s.planned_node_ids as string[])
      : [];
    const completed = s.status === "completed";
    if (completed) for (const n of nodeIds) completedNodeIds.add(n);
    // 엔진 항목은 노드 단위 — 세션의 각 노드를 항목으로 전개
    for (const nodeId of nodeIds) {
      existingItems.push({
        itemId: `${s.id}:${nodeId}`,
        nodeId,
        date: s.session_date,
        startTime: toHm(s.starts_at, timezone),
        endTime: toHm(s.ends_at, timezone),
        minutes: 60,
        locked: s.locked_at !== null,
        completed,
      });
    }
  }

  const engineNodes: RouteNodeInput[] = nodes.map((n) => ({
    nodeId: n.id,
    kind: n.kind,
    title: n.title,
    sortOrder: n.sort_order,
    expectedMinutes: n.expected_minutes ?? 60,
    isCheckpoint: n.kind === "confirmation_test",
  }));

  const lessonSlots: LessonSlotRule[] = slots.map((s) => ({
    weekday: s.weekday,
    startTime: s.start_time.slice(0, 5),
    endTime: s.end_time.slice(0, 5),
    effectiveFrom: s.effective_from,
    effectiveTo: s.effective_to,
  }));

  const input: ScheduleEngineInput = {
    engineVersion: ENGINE_VERSION,
    seed: `${plan.active_version_id}:${learningGroupId}`,
    timezone,
    scope: { type: "learning_group", id: learningGroupId },
    cutoffDate: today,
    horizon: { from: today, to: group.ends_on },
    routeVersionId: plan.active_version_id,
    nodes: engineNodes,
    overrides: [],
    lessonSlots,
    holidays: holidays.map((h) => ({ from: h.starts_on, to: h.ends_on })),
    busy,
    existingItems,
    completedNodeIds: [...completedNodeIds],
    maxMinutesPerDay: 120,
    inputVersions: { routeVersion: plan.active_version_id },
  };

  const result = calculateSchedule(input);

  /* ── 검증 게이트 (인수 22·2H) — 배치 불가 충돌이 있으면 어떤 세션도
   * 바꾸지 않고 이전 활성 리비전을 유지한다. 실패한 변경안은 기록만 남긴다
   * — 실패한 중간 결과를 일정으로 노출하지 않는다. ── */
  if (result.conflicts.length > 0) {
    const failedProposalId = uuidv7();
    await sql.begin(async (tx) => {
      await tx`
        insert into schedule_change_proposals (
          id, organization_id, scope_type, scope_id, trigger_type, status,
          input_snapshot, input_hash, engine_version, seed, cutoff_at,
          diff, reason_codes, conflicts, output_hash, failure_reason
        ) values (
          ${failedProposalId}, ${organizationId}, 'learning_group', ${learningGroupId},
          'manual', 'failed',
          ${tx.json({ summary: result.summary, itemCount: result.items.length } as never)},
          ${result.inputHash}, ${input.engineVersion}, ${input.seed}, ${new Date()},
          ${tx.json(result.diff as never)}, ${tx.json(result.reasonCodes as never)},
          ${tx.json(result.conflicts as never)}, ${result.outputHash},
          ${`배치 불가 ${result.conflicts.length}건 — 이전 활성 리비전 유지`}
        )
      `;
      await tx`
        insert into audit_events (
          id, organization_id, actor_type, actor_id, action, target_type, target_id,
          reason, after, rule_version
        ) values (
          ${uuidv7()}, ${organizationId},
          ${options.actorUserId ? "user" : "automation"}, ${options.actorUserId},
          'schedule.materialize-rejected', 'learning_group', ${learningGroupId},
          '검증 실패 — 기존 일정 유지', ${tx.json(result.conflicts as never)},
          ${ENGINE_VERSION}
        )
      `;
    });
    const first = result.conflicts[0]!;
    return fail(
      `배치 불가 ${result.conflicts.length}건 — 기존 일정을 유지합니다. ${first.detail} 과정 기간·수업 시간을 늘리거나 루트를 줄이세요.`,
    );
  }

  /* ── 적용: 제안 기록 + 세션 교체 (원자적) ── */
  const proposalId = uuidv7();
  const revisionId = uuidv7();

  // 날짜·슬롯별로 노드를 묶어 세션 구성
  const sessionsByKey = new Map<
    string,
    { date: IsoDate; startTime: string; endTime: string; nodeIds: string[] }
  >();
  for (const item of result.items) {
    /* 보존 항목은 재생성 대상이 아니다 — 이미 sessions에 있고 아래 DELETE
     * 가드가 지킨다. completed·locked만 걸러서는 부족하다: 과거 날짜의
     * planned 수업(노드가 달린)은 둘 다 false지만 엔진이 PAST_PRESERVED로
     * 보존하고 DELETE 가드(session_date >= today)도 남긴다. 그걸 다시 넣으면
     * 같은 시각에 수업이 둘이 되어 sessions_group_no_overlap에 걸린다. */
    if (item.reason === "PAST_PRESERVED" || item.reason === "LOCK_PRESERVED") {
      continue;
    }
    const key = `${item.date}T${item.startTime}`;
    const entry =
      sessionsByKey.get(key) ??
      { date: item.date, startTime: item.startTime, endTime: item.endTime, nodeIds: [] };
    entry.nodeIds.push(item.nodeId);
    sessionsByKey.set(key, entry);
  }

  await sql.begin(async (tx) => {
    // 같은 스코프의 동시 재계산 직렬화 (2H — 전역 잠금 금지, 스코프 단위).
    // 동시 실행 시 revision_number max+1이 충돌한다 (워커 동시성에서 실측).
    await tx`
      select pg_advisory_xact_lock(hashtext(${`schedule:learning_group:${learningGroupId}`}))
    `;
    await tx`
      insert into schedule_change_proposals (
        id, organization_id, scope_type, scope_id, trigger_type, status,
        input_snapshot, input_hash, engine_version, seed, cutoff_at,
        diff, reason_codes, conflicts, output_hash,
        approved_by, approved_at, applied_at, result_revision_id
      ) values (
        ${proposalId}, ${organizationId}, 'learning_group', ${learningGroupId},
        'manual', 'applied',
        ${tx.json({ summary: result.summary, itemCount: result.items.length } as never)},
        ${result.inputHash}, ${input.engineVersion}, ${input.seed},
        ${new Date()},
        ${tx.json(result.diff as never)}, ${tx.json(result.reasonCodes as never)},
        ${tx.json(result.conflicts as never)}, ${result.outputHash},
        ${options.actorUserId}, now(), now(), ${revisionId}
      )
    `;
    await tx`
      insert into schedule_revisions (
        id, organization_id, scope_type, scope_id, revision_number, proposal_id, is_active, activated_at
      ) values (
        ${revisionId}, ${organizationId}, 'learning_group', ${learningGroupId},
        (select coalesce(max(revision_number), 0) + 1 from schedule_revisions
          where scope_type = 'learning_group' and scope_id = ${learningGroupId}),
        ${proposalId}, false, null
      )
    `;

    // 미래의 잠기지 않은 planned 수업 제거 (완료·잠금·과거 보존 — 불변 5)
    await tx`
      delete from sessions
      where organization_id = ${organizationId}
        and learning_group_id = ${learningGroupId}
        and status = 'planned'
        and locked_at is null
        and session_date >= ${today}
    `;

    for (const s of sessionsByKey.values()) {
      await tx`
        insert into sessions (
          id, organization_id, learning_group_id, session_date, timezone,
          starts_at, ends_at, status, schedule_revision_id, planned_node_ids
        ) values (
          ${uuidv7()}, ${organizationId}, ${learningGroupId}, ${s.date}, ${timezone},
          ${zonedTimeToUtc(s.date, s.startTime, timezone)},
          ${zonedTimeToUtc(s.date, s.endTime, timezone)},
          'planned', ${revisionId}, ${tx.json(s.nodeIds as never)}
        )
      `;
    }

    // 소비한 휴강 이벤트를 반영됨으로 전이 (어느 변경안이 반영했는지 추적)
    if (cancellations.length > 0) {
      await tx`
        update learning_availability_events
        set status = 'applied', schedule_proposal_id = ${proposalId}, updated_at = now()
        where id = any(${cancellations.map((c) => c.id)}::uuid[])
          and status = 'received'
      `;
    }

    // 활성 리비전 원자적 전환
    await tx`
      update schedule_revisions set is_active = false
      where scope_type = 'learning_group' and scope_id = ${learningGroupId} and is_active = true
    `;
    await tx`
      update schedule_revisions set is_active = true, activated_at = now()
      where id = ${revisionId}
    `;

    // Outbox — 같은 트랜잭션 (2D)
    await tx`
      insert into outbox_events (
        id, organization_id, aggregate_type, aggregate_id, aggregate_version,
        event_type, occurred_at, payload
      ) values (
        ${uuidv7()}, ${organizationId}, 'schedule', ${learningGroupId}, 1,
        'ScheduleProposalApplied', now(),
        ${tx.json({ proposalId, resultRevisionId: revisionId, appliedBy: options.actorUserId } as never)}
      )
    `;

    // 감사 로그
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id,
        reason, after, rule_version
      ) values (
        ${uuidv7()}, ${organizationId},
        ${options.actorUserId ? "user" : "automation"}, ${options.actorUserId},
        'schedule.materialize', 'learning_group', ${learningGroupId},
        '루트 기반 미래 일정 생성', ${tx.json(result.summary as never)}, ${ENGINE_VERSION}
      )
    `;
  });

  const dates = [...sessionsByKey.values()].map((s) => s.date).sort();
  return {
    ok: true,
    message: `미래 수업 ${sessionsByKey.size}건을 생성했습니다.`,
    createdSessions: sessionsByKey.size,
    preservedSessions: result.items.filter((i) => i.completed || i.locked).length,
    conflicts: result.conflicts.length,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}

function fail(message: string): MaterializeResult {
  return {
    ok: false,
    message,
    createdSessions: 0,
    preservedSessions: 0,
    conflicts: 0,
    firstDate: null,
    lastDate: null,
  };
}

function toHm(d: Date, timezone: string): string {
  return new Date(d).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  });
}
