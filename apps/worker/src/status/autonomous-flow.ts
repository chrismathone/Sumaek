import {
  isHeartbeatLost,
  readHeartbeats,
  heartbeatTableExists,
  type Sql,
} from "@su-maek/db";
import { todayInKst } from "@su-maek/core/shared";

/* ─────────────────────────────────────────────────────────────
 * 자율 하루가 지금 굴러가고 있는가 (T6.4 · RB-16).
 *
 * `pnpm --filter @su-maek/worker status`는 「워커가 살아 있는가」에 답한다.
 * 그것으로는 부족하다. 워커가 멀쩡히 살아 있는데도 학생 화면에 시험이 안
 * 뜨는 경우가 있고 — 정책이 없거나, 문항이 모자라거나, 루트에 일정이 없거나 —
 * 그때 운영자가 보는 화면은 전부 초록이다. 「이상 없음」과 「수업이 성립한다」는
 * 다른 말이다.
 *
 * 여기서 답하는 질문은 하나다: **오늘 수업이 실제로 성립하는가.**
 * 넷을 따로 센다. 서로 다른 사람이 서로 다른 시각에 고치기 때문이다.
 *
 *   ① 평가 누락  수업은 잡혀 있는데 그날 평가가 없다      → 교사·콘텐츠
 *   ② 학생 차단  하루 계획에 지금 할 수 없는 항목이 있다   → 교사
 *   ③ 적체       이벤트가 배달되지 않고 쌓인다             → 운영
 *   ④ 워커 죽음  박동이 끊겼다                            → 운영 (먼저)
 *
 * 넷을 「이상 있음」 하나로 뭉치지 않는다. 뭉치면 화면은 붉어지는데 누가
 * 무엇을 해야 하는지는 여전히 아무도 모른다.
 *
 * 판정과 질의를 나눠 둔다: `decideVerdict`는 수치만 받는 순수 함수라 DB
 * 없이 검사할 수 있고, 아래 수집기는 그 함수가 먹을 값을 세는 일만 한다.
 * ───────────────────────────────────────────────────────────── */

/** 적체를 「쌓였다」고 부르기 시작하는 나이 — 폴링 2초·재시도 백오프의 몇 배 */
export const OUTBOX_BACKLOG_MINUTES = 15;

export type FlowSeverity = "ok" | "attention" | "down";

export interface FlowFinding {
  /** 화면·알림·이 문서가 같은 값을 본다 — 한국어 문구로 분기하지 않는다 */
  code:
    | "worker_down"
    | "assessment_missing"
    | "learners_blocked"
    | "outbox_backlog";
  severity: Exclude<FlowSeverity, "ok">;
  /** 무엇이 일어났나 — 수치를 담아 사람이 읽는 한 줄 */
  what: string;
  /** 다음에 할 일. 「이상 있음」으로 끝내면 아무도 아무것도 못 한다 */
  action: string;
}

export interface MissingAssessment {
  learningGroupId: string;
  learningGroupName: string;
  planDate: string;
  purpose: "formative" | "confirmation";
  routeNodeTitle: string;
  /** 수업 시작까지 남은 분. 음수면 이미 시작했다 */
  minutesUntilStart: number;
}

export interface AutonomousFlowStatus {
  organizationId: string | null;
  date: string;
  workers: { alive: number; lost: number; tableMissing: boolean };
  /** 오늘 수업에 걸린 평가 노드인데 평가가 없는 것 */
  missingAssessments: MissingAssessment[];
  /** 오늘 하루 계획에 차단 항목이 있는 학생 수 */
  blockedLearners: number;
  /** 사유별 학생 수 — 사유마다 고치러 가는 화면이 다르다 */
  blockedByReason: Array<{ code: string; learners: number }>;
  outbox: { pending: number; oldestPendingMinutes: number };
  /** 가장 심각한 것부터 */
  findings: FlowFinding[];
  verdict: FlowSeverity;
}

export interface FlowCounts {
  workersAlive: number;
  workersLost: number;
  missingAssessments: number;
  /** 이미 시작한 수업인데 평가가 없는 것 — 지금 학생이 겪고 있다 */
  missingAssessmentsStarted: number;
  blockedLearners: number;
  outboxPending: number;
  outboxOldestMinutes: number;
}

/**
 * 수치 → 판정. 순수 함수다.
 *
 * 워커 죽음을 **맨 앞에** 둔다. 워커가 없으면 나머지 셋이 따라 무너지므로,
 * 증상 셋을 나란히 늘어놓으면 무엇부터 볼지 모르게 된다. 원인 하나를 먼저
 * 크게 말하고 나머지는 그 아래에 둔다.
 */
export function decideVerdict(counts: FlowCounts): {
  findings: FlowFinding[];
  verdict: FlowSeverity;
} {
  const findings: FlowFinding[] = [];

  if (counts.workersAlive === 0) {
    findings.push({
      code: "worker_down",
      severity: "down",
      what:
        counts.workersLost > 0
          ? `살아 있는 워커가 없습니다 (박동 끊김 ${counts.workersLost}대).`
          : "살아 있는 워커가 없습니다.",
      action:
        "워커를 띄우세요 — README「워커 운영」 / RB-04 5.2. 띄우면 밀린 작업부터 처리합니다(유실 없음).",
    });
  }

  if (counts.missingAssessments > 0) {
    findings.push({
      code: "assessment_missing",
      severity: "attention",
      what:
        `오늘 평가 노드 ${counts.missingAssessments}건에 시험이 없습니다` +
        (counts.missingAssessmentsStarted > 0
          ? ` (그중 ${counts.missingAssessmentsStarted}건은 수업이 이미 시작했습니다).`
          : "."),
      action:
        "생성이 실패했는지 먼저 봅니다: `pnpm queue:status`의 assessment.generate 실패·DLQ. " +
        "실패 사유는 교사 업무함(/app/inbox)에도 갑니다 — 정책 없음·문항 부족은 사람이 고쳐야 낫습니다.",
    });
  }

  if (counts.blockedLearners > 0) {
    findings.push({
      code: "learners_blocked",
      severity: "attention",
      what: `오늘 하루에 지금 할 수 없는 항목이 있는 학생 ${counts.blockedLearners}명.`,
      action:
        "사유별로 갈립니다 — /app/readiness에서 그날을 열면 학생별 사유와 고치러 갈 화면이 함께 나옵니다.",
    });
  }

  if (
    counts.outboxPending > 0 &&
    counts.outboxOldestMinutes >= OUTBOX_BACKLOG_MINUTES
  ) {
    findings.push({
      code: "outbox_backlog",
      severity: "attention",
      what: `배달되지 않은 이벤트 ${counts.outboxPending}건, 최고령 ${counts.outboxOldestMinutes}분.`,
      action:
        "워커 생존을 먼저 봅니다(`pnpm --filter @su-maek/worker status`). 살아 있는데도 쌓이면 RB-04 4-1·4-3.",
    });
  }

  /* 심각도 순 — 같은 심각도 안에서는 넣은 순서를 지킨다(원인 → 증상) */
  const rank = { down: 0, attention: 1, ok: 2 } as const;
  findings.sort((a, b) => rank[a.severity] - rank[b.severity]);

  const verdict: FlowSeverity =
    findings.length === 0
      ? "ok"
      : findings.some((f) => f.severity === "down")
        ? "down"
        : "attention";
  return { findings, verdict };
}

/**
 * 지금 상태를 모은다.
 *
 * @param options.organizationId 한 학원으로 한정 — 기본은 전역(운영자 시점)
 * @param options.date 볼 날짜(KST 기준). 기본은 오늘
 */
export async function collectAutonomousFlowStatus(
  sql: Sql,
  options: { organizationId?: string | null; date?: string } = {},
): Promise<AutonomousFlowStatus> {
  const organizationId = options.organizationId ?? null;
  const date = options.date ?? todayInKst();

  /* ── ④ 워커 ── */
  let alive = 0;
  let lost = 0;
  const tableMissing = !(await heartbeatTableExists(sql));
  if (!tableMissing) {
    const now = new Date();
    for (const row of await readHeartbeats(sql)) {
      if (row.stopped_at) continue;
      if (isHeartbeatLost(row, now)) lost += 1;
      else alive += 1;
    }
  }

  /* ── ① 평가 누락 ──
   *
   * 「그날 평가 노드가 있는 수업」과 「그 반·그날·그 목적의 평가」를 맞춰
   * 본다. 생성기가 보는 조건(assessment-schedule.ts)과 같은 짝이라야
   * 여기서 「없다」고 한 것이 거기서 만들어질 것과 같은 것을 가리킨다. */
  const missingRows = await sql<
    {
      learning_group_id: string;
      learning_group_name: string;
      plan_date: string;
      purpose: string;
      node_title: string;
      minutes_until_start: number;
    }[]
  >`
    select s.learning_group_id::text,
           g.name as learning_group_name,
           s.session_date::text as plan_date,
           case n.kind::text when 'daily_test' then 'formative' else 'confirmation' end as purpose,
           n.title as node_title,
           round(extract(epoch from (s.starts_at - now())) / 60)::int as minutes_until_start
    from sessions s
    join learning_groups g on g.id = s.learning_group_id
    join lateral jsonb_array_elements_text(s.planned_node_ids) as pn(node_id) on true
    join route_nodes n
      on n.id = pn.node_id::uuid
     and n.kind in ('daily_test', 'confirmation_test')
    where s.session_date = ${date}::date
      and s.status in ('planned', 'confirmed')
      and pn.node_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      and (${organizationId}::uuid is null or s.organization_id = ${organizationId}::uuid)
      and not exists (
        select 1 from assessment_instances a
        where a.organization_id = s.organization_id
          and a.learning_group_id = s.learning_group_id
          and a.scheduled_date = s.session_date
          and a.purpose::text = case n.kind::text
                                  when 'daily_test' then 'formative'
                                  else 'confirmation' end
          and a.learner_id is null
          and a.status <> 'cancelled'
      )
    order by s.starts_at, n.sort_order
  `;

  /* ── ② 차단된 학생 ──
   *
   * 계획 상태가 아니라 **항목의 차단 사유**를 센다. 상태는 하나뿐이라
   * 「막힘 3명」밖에 못 말하지만, 사유는 고치러 갈 화면을 가리킨다. */
  const blockedRows = await sql<{ code: string; learners: number }[]>`
    select i.blocked_reason as code,
           count(distinct p.learner_id)::int as learners
    from learner_day_plan_items i
    join learner_day_plans p on p.id = i.learner_day_plan_id
    where p.plan_date = ${date}::date
      and i.status = 'blocked'
      and i.blocked_reason is not null
      and (${organizationId}::uuid is null or p.organization_id = ${organizationId}::uuid)
    group by i.blocked_reason
    order by learners desc, code
  `;
  const [blockedTotal] = await sql<{ n: number }[]>`
    select count(distinct p.learner_id)::int as n
    from learner_day_plan_items i
    join learner_day_plans p on p.id = i.learner_day_plan_id
    where p.plan_date = ${date}::date
      and i.status = 'blocked'
      and (${organizationId}::uuid is null or p.organization_id = ${organizationId}::uuid)
  `;

  /* ── ③ 적체 ── */
  const [backlog] = await sql<{ pending: number; oldest_minutes: number }[]>`
    select count(*)::int as pending,
           coalesce(
             round(extract(epoch from (now() - min(occurred_at))) / 60)::int, 0
           ) as oldest_minutes
    from outbox_events
    where status = 'pending'
      and (${organizationId}::uuid is null or organization_id = ${organizationId}::uuid)
  `;

  const missingAssessments: MissingAssessment[] = missingRows.map((r) => ({
    learningGroupId: r.learning_group_id,
    learningGroupName: r.learning_group_name,
    planDate: r.plan_date,
    purpose: r.purpose as MissingAssessment["purpose"],
    routeNodeTitle: r.node_title,
    minutesUntilStart: Number(r.minutes_until_start),
  }));

  const { findings, verdict } = decideVerdict({
    workersAlive: alive,
    workersLost: lost,
    missingAssessments: missingAssessments.length,
    missingAssessmentsStarted: missingAssessments.filter(
      (m) => m.minutesUntilStart < 0,
    ).length,
    blockedLearners: blockedTotal?.n ?? 0,
    outboxPending: backlog?.pending ?? 0,
    outboxOldestMinutes: backlog?.oldest_minutes ?? 0,
  });

  return {
    organizationId,
    date,
    workers: { alive, lost, tableMissing },
    missingAssessments,
    blockedLearners: blockedTotal?.n ?? 0,
    blockedByReason: blockedRows.map((r) => ({
      code: r.code,
      learners: r.learners,
    })),
    outbox: {
      pending: backlog?.pending ?? 0,
      oldestPendingMinutes: backlog?.oldest_minutes ?? 0,
    },
    findings,
    verdict,
  };
}
