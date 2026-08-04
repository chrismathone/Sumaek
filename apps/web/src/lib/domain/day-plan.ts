import "server-only";
import { getSharedSql } from "@su-maek/db";
import { projectLearnerDayPlan, type DayPlanItemSpec } from "@su-maek/db/domain";
import {
  buildDayPlan,
  type DayPlan,
  type DayPlanItem,
  type DayPlanItemInput,
} from "@su-maek/core/learning";
import { KST, type IsoDate } from "@su-maek/core/shared";
import { conceptIdsForNodes, listMaterials } from "@/lib/domain/learning-material";
import { nodeIdList } from "@/lib/learn/node-titles";

/* ─────────────────────────────────────────────────────────────
 * 오늘 계획 투영기 — 일정·자료·평가·복습을 하루 계획 항목으로 편다.
 *
 * 이 파일이 G-01을 고친다. 예전 오늘 화면은 배정을 훑을 때
 * `a.scheduled_date >= today - 90`으로 최근 90일을 통째로 긁어 왔고,
 * 두 달 전에 끝낸 테스트가 「끝남」으로 목록에 앉아 있으면 오늘 할 일이
 * 하나도 없는 날에도 화면이 완주한 것처럼 보였다.
 *
 * **상한 자체를 없애지는 않았다.** 없애면 학기가 지날수록 이 스캔이
 * 끝없이 자란다 — 원래 90일 창이 있던 이유가 그것이고, 그 우려는 지금도
 * 유효하다. 창의 기준을 「오늘」로 옮기고, 과거는 **미완료만** 남긴다.
 *
 * 층 구분(ADR-0018): 여기는 ②(learner_schedule_items)를 **읽기만** 하고
 * ③(learner_day_plans)에 쓴다. ②를 건드리지 않는다.
 * ───────────────────────────────────────────────────────────── */

/** 「응시가 끝났다」의 정의. 이 목록 하나만 본다 — 갈리면 두 화면이 다른 수를 말한다. */
const DONE_ATTEMPT_STATUSES = [
  "submitted",
  "auto_graded",
  "review_required",
  "finalized",
];

/**
 * 배정 스캔 창.
 *
 * 과거 쪽(`OVERDUE_LOOKBACK_DAYS`)은 **밀린 것**을 보여 주기 위한 것이고,
 * 미래 쪽(`UPCOMING_LOOKAHEAD_DAYS`)은 **예정**을 보여 주기 위한 것이다.
 * 둘 다 오늘 완료 판정에는 들어가지 않는다 (ADR-0017 §5).
 */
export const OVERDUE_LOOKBACK_DAYS = 30;
export const UPCOMING_LOOKAHEAD_DAYS = 14;

export type DayPlanSourceKind = "learner_schedule" | "group_session" | "review_only";

export interface LearnerRef {
  organizationId: string;
  learnerId: string;
}

export interface TodayScope {
  today: IsoDate;
  nodeIds: string[];
  conceptIds: string[];
  hasSession: boolean;
  source: DayPlanSourceKind;
  /** learner_schedule_items.id 또는 sessions.id — 어느 행에서 나왔는지 */
  sourceRefId: string | null;
  learningGroupId: string | null;
}

export interface TodayPlanView {
  scope: TodayScope;
  plan: DayPlan;
  source: DayPlanSourceKind;
  /** `persist: false`면 null — 미리보기는 계획 행을 만들지 않는다 */
  planId: string | null;
  /** 필수가 전부 충족돼 완료 전이가 가능한가 (전이 자체는 T4.1) */
  completable: boolean;
  /** 배정을 어느 날짜 범위에서 긁었는가 — 상한이 살아 있음을 밖에서 볼 수 있게 */
  assignmentWindow: { from: IsoDate; to: IsoDate };
  /**
   * 투영에 쓴 배정 행 그대로.
   *
   * 화면이 이것을 다시 질의하지 않게 하려고 함께 낸다 — 다시 질의하면
   * 날짜 규칙이 두 곳에 생기고, 그 둘이 갈리는 순간 화면과 계획이 서로
   * 다른 「오늘」을 말한다. 90일 창이 정확히 그렇게 살아남았다.
   */
  assignments: AssignmentRow[];
}

function addDays(iso: string, days: number): IsoDate {
  const base = new Date(`${iso}T00:00:00Z`);
  return new Date(base.getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10) as IsoDate;
}

/**
 * 오늘 범위 — 개별 일정을 먼저 보고 없을 때만 반 공통으로 물러선다.
 *
 * ②가 있으면 ①을 섞지 않는다: 보충·재합류로 반과 갈라진 학생에게 반 공통
 * 노드를 덧붙이면 그 학생이 건너뛰기로 뺀 노드가 되살아난다.
 */
export async function getTodayScope(
  learner: LearnerRef,
  today: IsoDate,
): Promise<TodayScope> {
  const sql = getSharedSql();

  const individual = await sql<
    { id: string; planned_node_ids: unknown; learning_group_id: string | null }[]
  >`
    select li.id::text, li.planned_node_ids, li.learning_group_id::text
    from learner_schedule_items li
    where li.organization_id = ${learner.organizationId}
      and li.learner_id = ${learner.learnerId}
      and li.item_date = ${today}::date
    order by li.starts_at
  `;

  const group =
    individual.length > 0
      ? []
      : await sql<
          { id: string; planned_node_ids: unknown; learning_group_id: string | null }[]
        >`
          select s.id::text, s.planned_node_ids, s.learning_group_id::text
          from sessions s
          join learning_group_memberships m
            on m.learning_group_id = s.learning_group_id
           and m.learner_id = ${learner.learnerId}
           and m.status = 'active'
          where s.organization_id = ${learner.organizationId}
            and s.session_date = ${today}::date
            and s.status <> 'cancelled'
          order by s.starts_at
        `;

  const rows = individual.length > 0 ? individual : group;
  const source: DayPlanSourceKind =
    individual.length > 0
      ? "learner_schedule"
      : group.length > 0
        ? "group_session"
        : "review_only";

  const nodeIds = rows.flatMap((r) => nodeIdList(r.planned_node_ids));

  return {
    today,
    nodeIds,
    conceptIds: await conceptIdsForNodes(nodeIds),
    hasSession: rows.length > 0,
    source,
    sourceRefId: rows[0]?.id ?? null,
    learningGroupId: rows[0]?.learning_group_id ?? null,
  };
}

/** 오늘 화면이 그대로 그리는 배정 행 — 판정에 필요한 것과 표시에 필요한 것을 함께 낸다. */
export interface AssignmentRow {
  id: string;
  title: string;
  scheduled_date: string | null;
  time_limit_minutes: number | null;
  question_count: number;
  attempt_id: string | null;
  attempt_status: string | null;
  total_score: string | null;
  max_score: string | null;
  route_node_id: string | null;
}

/**
 * 오늘 화면이 쓸 배정.
 *
 * 두 겹의 필터가 있다.
 *   ① 창: 오늘 기준 [−30일, +14일]. 상한이 없으면 학기가 지날수록 자란다.
 *   ② 과거는 **미완료만**. 끝난 과거 평가는 오늘과 무관하고, 지난 기록은
 *      /learn/records가 따로 낸다. 이 한 줄이 90일 창의 대체다.
 */
async function listAssignments(
  learner: LearnerRef,
  window: { from: IsoDate; to: IsoDate },
  today: IsoDate,
): Promise<AssignmentRow[]> {
  const sql = getSharedSql();
  return sql<AssignmentRow[]>`
    select a.id::text, a.title, a.scheduled_date::text as scheduled_date,
           a.time_limit_minutes,
           (select count(*)::int from assessment_questions q
             where q.assessment_id = a.id) as question_count,
           t.id as attempt_id, t.status as attempt_status,
           t.total_score, t.max_score,
           a.route_node_id::text as route_node_id
    from assignments s
    join assessment_instances a on a.id = s.assessment_id
    /* 재응시가 생기면 한 평가에 attempts 행이 여럿이다 — 최신 응시 한 건만
     * 붙인다. 그냥 join하면 같은 테스트가 목록에 두 줄로 나온다. */
    left join lateral (
      select at.id::text as id, at.status::text as status,
             at.total_score::text as total_score,
             at.max_score::text as max_score
      from attempts at
      where at.assessment_id = a.id and at.learner_id = s.learner_id
      order by at.attempt_no desc
      limit 1
    ) t on true
    where s.organization_id = ${learner.organizationId}
      and s.learner_id = ${learner.learnerId}
      and s.status <> 'cancelled'
      and a.status in ('published', 'open', 'closed', 'grading', 'finalized')
      and (
        a.scheduled_date is null
        or a.scheduled_date between ${window.from}::date and ${window.to}::date
      )
      and (
        a.scheduled_date is null
        or a.scheduled_date >= ${today}::date
        or t.status is null
        or not (t.status = any(${DONE_ATTEMPT_STATUSES}))
      )
    order by a.scheduled_date nulls last, a.title
  `;
}

/** 자료 진도 → 항목 상태. 진도가 없으면 아직 시작하지 않은 것이다. */
function materialStatus(progress: "none" | "in_progress" | "completed") {
  return progress === "none" ? ("pending" as const) : progress;
}

/**
 * 하루 계획을 만든다.
 *
 * `persist: false`는 교사 미리보기(T5.4)용이다 — 계산은 같지만 `learner_day_plans`
 * 행을 만들지 않는다. 교사가 미리 본 것 때문에 학생의 `materialized_at`이
 * 앞당겨지면 ADR-0017 §4의 스냅샷 시점이 무너진다.
 */
export async function projectToday(input: {
  learner: LearnerRef;
  today: IsoDate;
  persist?: boolean;
}): Promise<TodayPlanView> {
  const { learner, today } = input;
  const persist = input.persist ?? true;
  const sql = getSharedSql();

  const scope = await getTodayScope(learner, today);
  const window = {
    from: addDays(today, -OVERDUE_LOOKBACK_DAYS),
    to: addDays(today, UPCOMING_LOOKAHEAD_DAYS),
  };

  const [materials, assignments, reviewCounts] = await Promise.all([
    listMaterials({
      organizationId: learner.organizationId,
      learnerId: learner.learnerId,
      conceptIds: scope.conceptIds,
    }),
    listAssignments(learner, window, today),
    sql<{ due_cnt: number; done_today_cnt: number }[]>`
      select
        count(*) filter (
          where status = 'scheduled' and due_on <= ${today}::date
        )::int as due_cnt,
        count(*) filter (where last_reviewed_on = ${today}::date)::int as done_today_cnt
      from review_items
      where organization_id = ${learner.organizationId}
        and learner_id = ${learner.learnerId}
    `,
  ]);

  const items: DayPlanItemInput[] = [];
  let ordinal = 0;

  /* 1) 개념 자료 — 읽기·인강·연습. 오늘 범위의 개념에 붙은 게시 자료만. */
  for (const m of materials) {
    items.push({
      key: `${m.kind}:${m.id}`,
      kind: m.kind,
      required: true,
      status: materialStatus(m.progress),
      titleSnapshot: m.title,
      ordinal: ordinal++,
      refType: "learning_material",
      refId: m.id,
      // 문항 0개 연습 자료는 학생이 영원히 대기한다 — 차단으로 낸다 (G-06).
      ...(m.kind === "practice" && m.questionIds.length === 0
        ? { status: "blocked" as const, blockedReason: "no_questions" }
        : {}),
    });
  }

  /* 2) 평가 — 날짜는 core가 오늘·예정·밀림으로 가른다. */
  for (const a of assignments) {
    const done =
      a.attempt_status !== null && DONE_ATTEMPT_STATUSES.includes(a.attempt_status);
    const blocked = a.question_count === 0;
    items.push({
      key: `assessment:${a.id}`,
      kind: "assessment",
      required: true,
      status: blocked
        ? "blocked"
        : done
          ? "completed"
          : a.attempt_status === "in_progress"
            ? "in_progress"
            : "pending",
      blockedReason: blocked ? "no_questions" : null,
      scheduledDate: (a.scheduled_date as IsoDate | null) ?? null,
      titleSnapshot: a.title,
      ordinal: ordinal++,
      routeNodeId: a.route_node_id,
      refType: "assessment_instance",
      refId: a.id,
    });
  }

  /* 3) 복습 — 하루 한 덩어리. 기한이 지난 복습은 오늘 필수에 든다
   *    (ADR-0017 §5의 유일한 예외 — 밀린 것이 곧 지금 할 것이다).
   *    오늘 다 끝냈으면 항목을 없애지 않고 완료로 남긴다. 없애면 재투영이
   *    pending으로 보고 지워, 「복습을 했다」는 기록이 사라진다. */
  const due = reviewCounts[0]?.due_cnt ?? 0;
  const doneToday = reviewCounts[0]?.done_today_cnt ?? 0;
  if (due > 0 || doneToday > 0) {
    items.push({
      key: "review:due",
      kind: "review",
      required: true,
      status: due > 0 ? "pending" : "completed",
      titleSnapshot: due > 0 ? `복습 ${due}건` : `복습 ${doneToday}건 완료`,
      ordinal: ordinal++,
      refType: "review_batch",
    });
  }

  const plan = buildDayPlan({ planDate: today, items });

  let planId: string | null = null;
  let completable = false;

  if (persist) {
    const result = await projectLearnerDayPlan(sql, {
      organizationId: learner.organizationId,
      learnerId: learner.learnerId,
      planDate: today,
      timezone: KST,
      learningGroupId: scope.learningGroupId,
      source: scope.source,
      sourceRefId: scope.sourceRefId,
      items: plan.items.map(toSpec),
    });
    planId = result.planId;
    completable = result.completable;
  } else {
    completable = plan.status === "completed";
  }

  return {
    scope,
    plan,
    source: scope.source,
    planId,
    completable,
    assignmentWindow: window,
    assignments,
  };
}

/** core 항목 → 저장소 항목. 같은 필드를 그대로 옮긴다. */
function toSpec(item: DayPlanItem): DayPlanItemSpec {
  return {
    key: item.key,
    kind: item.kind,
    required: item.required,
    status: item.status,
    titleSnapshot: item.titleSnapshot ?? item.key,
    ordinal: item.ordinal ?? 0,
    routeNodeId: item.routeNodeId,
    refType: item.refType,
    refId: item.refId,
    blockedReason: item.blockedReason,
  };
}
