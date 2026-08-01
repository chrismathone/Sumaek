import { v7 as uuidv7 } from "uuid";
import { getSharedSql } from "../client";
import {
  ENGINE_VERSION,
  calculateSchedule,
  type BusyInterval,
  type LessonSlotRule,
  type OverrideDeltaInput,
  type RouteNodeInput,
  type ScheduleEngineInput,
  type ScheduledItem,
} from "@su-maek/core/scheduling";
import { eachDate, zonedTimeToUtc, type IsoDate } from "@su-maek/core/shared";

/* ─────────────────────────────────────────────────────────────
 * 학습자 스코프 일정 실체화 (인수 4).
 *
 * 반 공통 실체화(domain/schedule.ts)가 반 루트를 sessions로 만든다면,
 * 이쪽은 **그 위에 학생 오버라이드를 얹은 학생 개인 경로**를 만든다.
 *
 * 설계에서 가장 중요한 결정 — sessions를 건드리지 않는다.
 *   불변 조건 4는 "학생 오버라이드가 반 루트나 다른 학생을 바꾸지 않는다"다.
 *   학생 경로를 sessions에 쓰면 반 수업 행을 늘리거나 쪼개게 되고,
 *   sessions_group_no_overlap(반 단위 시간 배타)에도 정면으로 부딪힌다.
 *   그래서 학생 항목은 learner_schedule_items라는 별도 테이블에 쓰고,
 *   같은 날짜·시각의 반 수업이 있으면 session_id로 잇기만 한다.
 *   → 학생 일정을 몇 번을 다시 계산해도 sessions 행 수·시각은 불변이다.
 *
 * 반 공통과의 병합·재합류:
 *   - 오버라이드가 없으면 학생 경로 = 반 경로 (matches_group = true 전부).
 *   - 보충 삽입·건너뛰기가 있으면 그 차시부터 갈라진다 (matches_group=false).
 *   - 오버라이드의 rejoin_node_id가 가리키는 노드가 놓인 차시가 재합류 지점
 *     (is_rejoin = true) — "학생이 어느 차시에서 반 진도로 돌아오는가"의 답.
 *   재합류 지점 앞의 반 공통 노드를 학생 경로에서 떨구는 판단은 엔진의
 *   applyOverrides가 한다 (반이 이미 지나간 구간을 따라잡지 않는다).
 *
 * 과거 보존은 반 쪽과 같은 모양으로 지킨다 — 과거 항목, 그리고 완료·잠금된
 * 반 수업에 매인 항목은 재계산이 건드리지 않는다.
 * ───────────────────────────────────────────────────────────── */

export interface MaterializeLearnerResult {
  ok: boolean;
  message: string;
  /** 새로 만든 학습자 일정 항목(차시) 수 */
  createdItems: number;
  /** 과거·완료·잠금으로 보존한 항목 수 */
  preservedItems: number;
  /** 반 공통과 계획이 다른 차시 수 */
  divergingItems: number;
  /** 재합류 차시 날짜 — 오버라이드에 재합류 지점이 없으면 null */
  rejoinDate: string | null;
  /** 오버라이드로 학생 경로에서 빠진 반 공통 노드 수 */
  skippedNodes: number;
  conflicts: number;
  firstDate: string | null;
  lastDate: string | null;
}

interface OverrideRow {
  id: string;
  kind: string;
  delta: unknown;
  rejoin_node_id: string | null;
}

interface GroupSessionRow {
  id: string;
  session_date: string;
  starts_at: Date;
  status: string;
  locked_at: Date | null;
  planned_node_ids: unknown;
}

export async function materializeLearnerSchedule(options: {
  organizationId: string;
  learnerId: string;
  /** null이면 자동화 실행 (감사 actor_type=automation) */
  actorUserId: string | null;
  timezone: string;
  /** 기준 날짜 (워크스페이스 시간대 오늘) — 테스트 재현성 위해 주입 */
  today: IsoDate;
}): Promise<MaterializeLearnerResult> {
  const sql = getSharedSql();
  const { organizationId, learnerId, timezone, today } = options;

  /* ── 입력 스냅샷 로드 ── */
  const [learner] = await sql<{ id: string; display_name: string }[]>`
    select id, display_name from learners
    where id = ${learnerId} and organization_id = ${organizationId}
  `;
  if (!learner) return fail("학습자를 찾을 수 없습니다.");

  /* 학생이 속한 반과 그 반의 게시된 루트. 학생 경로는 반 루트 위의 차이이므로
   * 기준 반이 없으면 계산할 것도 없다 (원칙 3·4). */
  const [base] = await sql<
    {
      learning_group_id: string;
      group_name: string;
      ends_on: string;
      active_version_id: string;
    }[]
  >`
    select g.id as learning_group_id, g.name as group_name,
           p.ends_on::text as ends_on, rp.active_version_id
    from learning_group_memberships m
    join learning_groups g on g.id = m.learning_group_id
    join course_periods p on p.id = g.course_period_id
    join route_plans rp on rp.learning_group_id = g.id and rp.status = 'published'
    where m.organization_id = ${organizationId}
      and m.learner_id = ${learnerId}
      and m.status = 'active'
      and rp.active_version_id is not null
    order by m.joined_on desc nulls last, g.id
    limit 1
  `;
  if (!base) {
    return fail(
      "기준이 될 반 루트가 없습니다. 학생을 반에 배정하고 반 루트를 게시하세요.",
    );
  }
  const learningGroupId = base.learning_group_id;
  const routeVersionId = base.active_version_id;

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
    where route_version_id = ${routeVersionId}
    order by sort_order
  `;
  if (nodes.length === 0) return fail("루트에 노드가 없습니다.");

  /* 활성 오버라이드 — 지금 게시된 반 루트 버전을 기준으로 만든 것만 소비한다.
   * 반 루트가 재게시되면 옛 버전 기준 오버라이드는 노드 ID가 더 이상 맞지
   * 않으므로 조용히 적용하지 않고 수를 세어 메시지로 알린다. */
  const overrideRows = await sql<OverrideRow[]>`
    select id, kind::text as kind, delta, rejoin_node_id::text as rejoin_node_id
    from student_route_overrides
    where organization_id = ${organizationId}
      and learner_id = ${learnerId}
      and status = 'active'
      and base_route_version_id = ${routeVersionId}
    order by id
  `;
  const [staleRow] = await sql<{ stale: number }[]>`
    select count(*)::int as stale from student_route_overrides
    where organization_id = ${organizationId}
      and learner_id = ${learnerId}
      and status = 'active'
      and base_route_version_id <> ${routeVersionId}
  `;

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
    return fail("수업 가능 시간이 설정되지 않았습니다.");
  }

  const holidays = await sql<{ starts_on: string; ends_on: string }[]>`
    select starts_on::text, ends_on::text from holidays
    where organization_id = ${organizationId}
      and (learning_group_id is null or learning_group_id = ${learningGroupId})
  `;

  /* 하드 충돌 입력.
   * - 휴강(group_cancelled): 반 전체가 쉬므로 학생도 그날 배치되지 않는다.
   * - 학생 불참·수업 불가(learner_absence·learner_unavailable): 반 공통 일정은
   *   움직이지 않지만(domain/schedule.ts 주석) 학생 경로에는 반영돼야 한다.
   *   여기가 그 이벤트를 실제로 소비하는 유일한 지점이다. */
  const events = await sql<
    {
      id: string;
      kind: string;
      starts_on: string;
      ends_on: string;
      reason: string | null;
    }[]
  >`
    select id, kind::text as kind, starts_on::text, ends_on::text, reason
    from learning_availability_events
    where organization_id = ${organizationId}
      and status <> 'dismissed'
      and ends_on >= ${today}::date
      and (
        (kind = 'group_cancelled' and learning_group_id = ${learningGroupId})
        or (kind in ('learner_absence', 'learner_unavailable')
            and learner_id = ${learnerId})
      )
    order by id
  `;
  const busy: BusyInterval[] = [];
  for (const e of events) {
    for (const d of eachDate(e.starts_on as IsoDate, e.ends_on as IsoDate)) {
      busy.push({
        date: d,
        startTime: "00:00",
        endTime: "23:59",
        label: `${e.kind}${e.reason ? `: ${e.reason}` : ""}`,
      });
    }
  }

  /* 기존 학습자 항목 — 매인 반 수업의 상태로 완료·잠금을 판정한다.
   * 아래 DELETE 가드와 같은 조건이어야 엔진이 보존한 항목을 DB가 지우거나,
   * DB가 남긴 항목을 엔진이 다시 배치하는 어긋남이 생기지 않는다. */
  const existingRows = await sql<
    {
      id: string;
      item_date: string;
      starts_at: Date;
      ends_at: Date;
      planned_node_ids: unknown;
      session_status: string | null;
      session_locked_at: Date | null;
    }[]
  >`
    select li.id, li.item_date::text as item_date, li.starts_at, li.ends_at,
           li.planned_node_ids,
           s.status::text as session_status, s.locked_at as session_locked_at
    from learner_schedule_items li
    left join sessions s on s.id = li.session_id
    where li.organization_id = ${organizationId}
      and li.learner_id = ${learnerId}
  `;

  const completedNodeIds = new Set<string>();
  const existingItems: ScheduledItem[] = [];
  for (const row of existingRows) {
    const nodeIds = asStringArray(row.planned_node_ids);
    const completed = row.session_status === "completed";
    const locked = row.session_locked_at !== null;
    if (completed) for (const n of nodeIds) completedNodeIds.add(n);
    for (const nodeId of nodeIds) {
      existingItems.push({
        itemId: `${row.id}:${nodeId}`,
        nodeId,
        date: row.item_date,
        startTime: toHm(row.starts_at, timezone),
        endTime: toHm(row.ends_at, timezone),
        minutes: 60,
        locked,
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

  const overrides = overrideRows.map(toOverrideDelta);
  const rejoinNodeIds = new Set(
    overrideRows
      .map((r) => r.rejoin_node_id)
      .filter((v): v is string => v !== null),
  );

  const input: ScheduleEngineInput = {
    engineVersion: ENGINE_VERSION,
    seed: `${routeVersionId}:${learnerId}`,
    timezone,
    scope: { type: "learner", id: learnerId },
    cutoffDate: today,
    horizon: { from: today, to: base.ends_on },
    routeVersionId,
    nodes: engineNodes,
    overrides,
    lessonSlots,
    holidays: holidays.map((h) => ({ from: h.starts_on, to: h.ends_on })),
    busy,
    existingItems,
    completedNodeIds: [...completedNodeIds],
    maxMinutesPerDay: 120,
    inputVersions: { routeVersion: routeVersionId, overrides: overrides.length },
  };

  const result = calculateSchedule(input);

  /* ── 검증 게이트 — 배치 불가가 하나라도 있으면 학생 일정을 건드리지 않는다.
   * 실패한 중간 결과를 학생 일정으로 노출하지 않는다 (2H). ── */
  if (result.conflicts.length > 0) {
    const failedProposalId = uuidv7();
    await sql.begin(async (tx) => {
      await tx`
        insert into schedule_change_proposals (
          id, organization_id, scope_type, scope_id, trigger_type, status,
          input_snapshot, input_hash, engine_version, seed, cutoff_at,
          diff, reason_codes, conflicts, output_hash, failure_reason
        ) values (
          ${failedProposalId}, ${organizationId}, 'learner', ${learnerId},
          'manual', 'failed',
          ${tx.json({ summary: result.summary, itemCount: result.items.length } as never)},
          ${result.inputHash}, ${input.engineVersion}, ${input.seed}, ${new Date()},
          ${tx.json(result.diff as never)}, ${tx.json(result.reasonCodes as never)},
          ${tx.json(result.conflicts as never)}, ${result.outputHash},
          ${`배치 불가 ${result.conflicts.length}건 — 학생 일정 유지`}
        )
      `;
      await tx`
        insert into audit_events (
          id, organization_id, actor_type, actor_id, action, target_type, target_id,
          reason, after, rule_version
        ) values (
          ${uuidv7()}, ${organizationId},
          ${options.actorUserId ? "user" : "automation"}, ${options.actorUserId},
          'schedule.materialize-learner-rejected', 'learner', ${learnerId},
          '검증 실패 — 기존 학생 일정 유지', ${tx.json(result.conflicts as never)},
          ${ENGINE_VERSION}
        )
      `;
    });
    const first = result.conflicts[0]!;
    return {
      ...fail(
        `배치 불가 ${result.conflicts.length}건 — 학생 일정을 유지합니다. ${first.detail}`,
      ),
      conflicts: result.conflicts.length,
    };
  }

  /* ── 반 공통 수업과의 병합 준비 ──
   * 같은 날짜·시각의 반 수업을 찾아 잇고, 노드 집합이 같은지 비교한다. */
  const groupSessions = await sql<GroupSessionRow[]>`
    select id, session_date::text as session_date, starts_at, status,
           locked_at, planned_node_ids
    from sessions
    where organization_id = ${organizationId}
      and learning_group_id = ${learningGroupId}
      and session_date >= ${today}
  `;
  const sessionByKey = new Map<string, GroupSessionRow>();
  for (const s of groupSessions) {
    sessionByKey.set(`${s.session_date}T${toHm(s.starts_at, timezone)}`, s);
  }

  /* 날짜·슬롯별로 노드를 묶어 학생 차시를 구성.
   * 보존 항목은 재생성 대상이 아니다 — 이미 DB에 있고 DELETE 가드가 지키므로
   * 다시 넣으면 learner_schedule_items_no_overlap(학생 시간 배타)에 걸린다. */
  const itemsByKey = new Map<
    string,
    {
      date: IsoDate;
      startTime: string;
      endTime: string;
      nodeIds: string[];
      reasons: Set<string>;
    }
  >();
  for (const item of result.items) {
    if (item.reason === "PAST_PRESERVED" || item.reason === "LOCK_PRESERVED") {
      continue;
    }
    const key = `${item.date}T${item.startTime}`;
    const entry = itemsByKey.get(key) ?? {
      date: item.date,
      startTime: item.startTime,
      endTime: item.endTime,
      nodeIds: [],
      reasons: new Set<string>(),
    };
    entry.nodeIds.push(item.nodeId);
    entry.reasons.add(item.reason);
    itemsByKey.set(key, entry);
  }

  const rows = [...itemsByKey.values()]
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
    .map((entry) => {
      const session = sessionByKey.get(`${entry.date}T${entry.startTime}`);
      const groupNodeIds = session ? asStringArray(session.planned_node_ids) : null;
      return {
        ...entry,
        sessionId: session?.id ?? null,
        matchesGroup: groupNodeIds !== null && sameNodeSet(groupNodeIds, entry.nodeIds),
        isRejoin: entry.nodeIds.some((n) => rejoinNodeIds.has(n)),
      };
    });

  const rejoinDate = rows.find((r) => r.isRejoin)?.date ?? null;
  const divergingItems = rows.filter((r) => !r.matchesGroup).length;
  const preservedItems = result.items.filter(
    (i) => i.reason === "PAST_PRESERVED" || i.reason === "LOCK_PRESERVED",
  ).length;

  const proposalId = uuidv7();
  const revisionId = uuidv7();

  await sql.begin(async (tx) => {
    // 같은 학생의 동시 재계산 직렬화 (2H — 전역 잠금 금지, 스코프 단위)
    await tx`
      select pg_advisory_xact_lock(hashtext(${`schedule:learner:${learnerId}`}))
    `;
    await tx`
      insert into schedule_change_proposals (
        id, organization_id, scope_type, scope_id, trigger_type, status,
        input_snapshot, input_hash, engine_version, seed, cutoff_at,
        diff, reason_codes, conflicts, output_hash,
        approved_by, approved_at, applied_at, result_revision_id
      ) values (
        ${proposalId}, ${organizationId}, 'learner', ${learnerId},
        'manual', 'applied',
        ${tx.json({
          summary: result.summary,
          itemCount: result.items.length,
          skippedNodeIds: result.skippedNodeIds,
          baseRouteVersionId: routeVersionId,
          learningGroupId,
        } as never)},
        ${result.inputHash}, ${input.engineVersion}, ${input.seed}, ${new Date()},
        ${tx.json(result.diff as never)}, ${tx.json(result.reasonCodes as never)},
        ${tx.json(result.conflicts as never)}, ${result.outputHash},
        ${options.actorUserId}, now(), now(), ${revisionId}
      )
    `;
    await tx`
      insert into schedule_revisions (
        id, organization_id, scope_type, scope_id, revision_number,
        proposal_id, is_active, activated_at
      ) values (
        ${revisionId}, ${organizationId}, 'learner', ${learnerId},
        (select coalesce(max(revision_number), 0) + 1 from schedule_revisions
          where scope_type = 'learner' and scope_id = ${learnerId}),
        ${proposalId}, false, null
      )
    `;

    /* 과거 보존 가드 — 반 쪽 DELETE 가드와 같은 뜻이다.
     *   item_date >= today          : 과거는 다시 쓰지 않는다
     *   매인 반 수업이 planned·미잠금 : 완료·취소·잠긴 차시의 기록은 남긴다
     * session_id가 null인 미래 항목(반 일정 밖으로 밀린 항목)은 지킬 근거가
     * 없으므로 교체 대상이다. */
    await tx`
      delete from learner_schedule_items li
      where li.organization_id = ${organizationId}
        and li.learner_id = ${learnerId}
        and li.item_date >= ${today}
        and not exists (
          select 1 from sessions s
          where s.id = li.session_id
            and (s.status <> 'planned' or s.locked_at is not null)
        )
    `;

    for (const row of rows) {
      await tx`
        insert into learner_schedule_items (
          id, organization_id, learner_id, learning_group_id,
          schedule_revision_id, session_id, item_date, timezone,
          starts_at, ends_at, planned_node_ids, reason_codes,
          matches_group, is_rejoin
        ) values (
          ${uuidv7()}, ${organizationId}, ${learnerId}, ${learningGroupId},
          ${revisionId}, ${row.sessionId}, ${row.date}, ${timezone},
          ${zonedTimeToUtc(row.date, row.startTime, timezone)},
          ${zonedTimeToUtc(row.date, row.endTime, timezone)},
          ${tx.json(row.nodeIds as never)},
          ${tx.json([...row.reasons].sort() as never)},
          ${row.matchesGroup}, ${row.isRejoin}
        )
      `;
    }

    // 소비한 학생 불참·수업 불가 이벤트를 반영됨으로 전이
    const learnerEventIds = events
      .filter((e) => e.kind !== "group_cancelled")
      .map((e) => e.id);
    if (learnerEventIds.length > 0) {
      await tx`
        update learning_availability_events
        set status = 'applied', schedule_proposal_id = ${proposalId}, updated_at = now()
        where id = any(${learnerEventIds}::uuid[])
          and status = 'received'
      `;
    }

    // 활성 리비전 원자적 전환 (학습자 스코프)
    await tx`
      update schedule_revisions set is_active = false
      where scope_type = 'learner' and scope_id = ${learnerId} and is_active = true
    `;
    await tx`
      update schedule_revisions set is_active = true, activated_at = now()
      where id = ${revisionId}
    `;

    // Outbox — 같은 트랜잭션 (2D). 기존 이벤트 타입을 재사용한다:
    // ScheduleProposalApplied의 소비자는 알림뿐이라 재계산 루프가 없다.
    await tx`
      insert into outbox_events (
        id, organization_id, aggregate_type, aggregate_id, aggregate_version,
        event_type, occurred_at, payload
      ) values (
        ${uuidv7()}, ${organizationId}, 'schedule', ${learnerId}, 1,
        'ScheduleProposalApplied', now(),
        ${tx.json({
          proposalId,
          resultRevisionId: revisionId,
          scopeType: "learner",
          appliedBy: options.actorUserId,
        } as never)}
      )
    `;

    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id,
        reason, after, rule_version
      ) values (
        ${uuidv7()}, ${organizationId},
        ${options.actorUserId ? "user" : "automation"}, ${options.actorUserId},
        'schedule.materialize-learner', 'learner', ${learnerId},
        '학생 개별 경로 일정 생성', ${tx.json({
          ...result.summary,
          divergingItems,
          rejoinDate,
          skippedNodeIds: result.skippedNodeIds,
        } as never)}, ${ENGINE_VERSION}
      )
    `;
  });

  const dates = rows.map((r) => r.date);
  const stale = staleRow?.stale ?? 0;
  const staleNote =
    stale > 0
      ? ` (옛 루트 버전 기준 오버라이드 ${stale}건은 적용하지 않았습니다)`
      : "";
  return {
    ok: true,
    message:
      `${learner.display_name}의 개별 일정 ${rows.length}차시를 만들었습니다. ` +
      `반 공통과 다른 차시 ${divergingItems}건` +
      (rejoinDate ? `, 재합류 ${rejoinDate}` : "") +
      `. 반 공통 일정은 변경되지 않았습니다.${staleNote}`,
    createdItems: rows.length,
    preservedItems,
    divergingItems,
    rejoinDate,
    skippedNodes: result.skippedNodeIds.length,
    conflicts: 0,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}

/* ── 내부 ──────────────────────────────────────────────────── */

/**
 * student_route_overrides 행 → 엔진 입력.
 *
 * delta.insertBefore.nodes는 route_nodes 행이 아니라 오버라이드 안에만 있는
 * 보충 노드다(반 루트를 복사하지 않는다는 원칙 4의 귀결). 엔진은 노드 ID를
 * 요구하므로 오버라이드 ID + 순번으로 결정론적 합성 ID를 만든다.
 * uuid 모양이 아니어서 반 루트 노드 ID와 절대 섞이지 않는다.
 */
function toOverrideDelta(row: OverrideRow): OverrideDeltaInput {
  const delta = (row.delta ?? {}) as Record<string, unknown>;
  const skipNodeIds = asStringArray(delta.skipNodeIds);

  let insertBefore: OverrideDeltaInput["insertBefore"];
  const raw = delta.insertBefore as Record<string, unknown> | undefined;
  if (raw && Array.isArray(raw.nodes) && raw.nodes.length > 0) {
    insertBefore = {
      anchorNodeId:
        typeof raw.anchorNodeId === "string" ? raw.anchorNodeId : null,
      nodes: (raw.nodes as Record<string, unknown>[]).map((n, index) => ({
        nodeId: `override:${row.id}:${index}`,
        kind: typeof n.kind === "string" ? n.kind : "remediation",
        title: typeof n.title === "string" ? n.title : "보충",
        sortOrder: index,
        expectedMinutes:
          typeof n.expectedMinutes === "number" && n.expectedMinutes > 0
            ? n.expectedMinutes
            : 60,
      })),
    };
  }

  // exactOptionalPropertyTypes — 없는 값은 키 자체를 빼서 넘긴다
  return {
    overrideId: row.id,
    kind: row.kind,
    skipNodeIds,
    ...(insertBefore ? { insertBefore } : {}),
    ...(row.rejoin_node_id ? { rejoinNodeId: row.rejoin_node_id } : {}),
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** 순서와 무관하게 같은 노드 집합인가 — 반 공통 계획과의 일치 판정 */
function sameNodeSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

function fail(message: string): MaterializeLearnerResult {
  return {
    ok: false,
    message,
    createdItems: 0,
    preservedItems: 0,
    divergingItems: 0,
    rejoinDate: null,
    skippedNodes: 0,
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
