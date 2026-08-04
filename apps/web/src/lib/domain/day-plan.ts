import "server-only";
import { getSharedSql } from "@su-maek/db";
import {
  getLearnerDayPlan,
  projectLearnerDayPlan,
  type DayPlanItemSpec,
} from "@su-maek/db/domain";
import {
  buildDayPlan,
  executeNodes,
  type DayPlan,
  type DayPlanItem,
  type DayPlanItemInput,
  type ExecutableNode,
  type NodeMaterial,
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

/** 오늘 노드의 실행 입력 — 실행기가 보는 모양 그대로 읽는다 */
interface TodayNode extends ExecutableNode {
  conceptIds: string[];
}

/** 노드 id → 그 노드가 다루는 개념 (자료를 노드별로 가르기 위해) */
const nodeConcepts = new Map<string, string[]>();

async function listTodayNodes(
  learner: LearnerRef,
  nodeIds: readonly string[],
): Promise<TodayNode[]> {
  /* `override:` 접두 id는 학생 오버라이드가 jsonb 안에 끼워 넣은 노드라
   * route_nodes에 행이 없다. 실행기에 넘길 payload도 없으므로 여기서 뺀다. */
  const real = nodeIds.filter((n) => !n.startsWith("override:"));
  nodeConcepts.clear();
  if (real.length === 0) return [];

  const sql = getSharedSql();
  const rows = await sql<
    {
      id: string;
      kind: string;
      title: string;
      concept_ids: unknown;
      book_edition_id: string | null;
      page_range: unknown;
      homework: unknown;
      blueprint_id: string | null;
    }[]
  >`
    select id::text, kind::text, title, concept_ids,
           book_edition_id::text, page_range, homework, blueprint_id::text
    from route_nodes
    where organization_id = ${learner.organizationId}
      and id = any(${real}::uuid[])
    order by sort_order
  `;

  return rows.map((r) => {
    const conceptIds = Array.isArray(r.concept_ids)
      ? (r.concept_ids as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
    nodeConcepts.set(r.id, conceptIds);
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      conceptIds,
      bookEditionId: r.book_edition_id,
      pageRange: (r.page_range as TodayNode["pageRange"]) ?? null,
      homework: (r.homework as TodayNode["homework"]) ?? null,
      blueprintId: r.blueprint_id,
    };
  });
}

async function lookupBookTitles(
  learner: LearnerRef,
  editionIds: readonly string[],
): Promise<Map<string, string>> {
  if (editionIds.length === 0) return new Map();
  const sql = getSharedSql();
  /* 학생에게 「교재」라고만 하면 어느 책인지 모른다. 판본 이름까지 붙여야
   * 책상에 놓인 책과 화면이 이어진다. */
  const rows = await sql<{ id: string; label: string }[]>`
    select e.id::text,
           coalesce(b.title, '교재') || ' ' || e.edition_label as label
    from book_editions e
    left join books b on b.id = e.book_id
    where e.organization_id = ${learner.organizationId}
      and e.id = any(${[...editionIds]}::uuid[])
  `;
  return new Map(rows.map((r) => [r.id, r.label]));
}

/** 최신 응시 상태 → 항목 상태 */
function attemptStatusOf(a: AssignmentRow) {
  if (a.attempt_status && DONE_ATTEMPT_STATUSES.includes(a.attempt_status)) {
    return "completed" as const;
  }
  return a.attempt_status === "in_progress"
    ? ("in_progress" as const)
    : ("pending" as const);
}

/** 막힌 노드를 어떤 항목 종류로 낼지 — 화면이 알맞은 정거장에 놓게 */
function blockedItemKind(nodeKind: string) {
  if (nodeKind === "book_range") return "book_range" as const;
  if (nodeKind === "homework") return "homework" as const;
  if (nodeKind === "daily_test" || nodeKind === "confirmation_test") {
    return "assessment" as const;
  }
  return "reading" as const;
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

  /* 오늘 노드를 실행기로 편다 (T2.2).
   *
   * 예전에는 이 파일이 자료·평가·복습을 직접 늘어놓았고, 그래서 교재
   * 범위·숙제 노드는 아무 데도 나타나지 않았다. 어떤 노드가 무엇으로
   * 펼쳐지는지는 core가 정한다 — 여기서 다시 정하면 규칙이 둘이 된다. */
  const nodes = await listTodayNodes(learner, scope.nodeIds);
  const bookTitles = await lookupBookTitles(
    learner,
    nodes.map((n) => n.bookEditionId).filter((v): v is string => Boolean(v)),
  );
  const byConcept = new Map<string, NodeMaterial[]>();
  for (const m of materials) {
    const list = byConcept.get(m.conceptId) ?? [];
    list.push({
      id: m.id,
      kind: m.kind,
      title: m.title,
      questionCount: m.questionIds.length,
      progress: m.progress,
    });
    byConcept.set(m.conceptId, list);
  }
  const assessmentByNode = new Map(
    assignments.filter((a) => a.route_node_id).map((a) => [a.route_node_id!, a]),
  );
  const dueReviewCount = reviewCounts[0]?.due_cnt ?? 0;

  const executed = executeNodes(nodes, (node, ordinalFrom) => {
    const mine = nodeConcepts.get(node.id) ?? [];
    /* 연습 숙제가 가리키는 자료는 노드의 개념 밖일 수 있다 — 실행기가
     * questionCount를 보려면 그것도 함께 넘겨야 한다. */
    const extra = node.homework?.practiceMaterialId
      ? materials
          .filter((m) => m.id === node.homework!.practiceMaterialId)
          .map((m) => ({
            id: m.id,
            kind: m.kind,
            title: m.title,
            questionCount: m.questionIds.length,
            progress: m.progress,
          }))
      : [];
    const a = assessmentByNode.get(node.id);
    return {
      materials: [...mine.flatMap((c) => byConcept.get(c) ?? []), ...extra],
      assessment: a
        ? {
            id: a.id,
            title: a.title,
            scheduledDate: (a.scheduled_date as IsoDate | null) ?? null,
            questionCount: a.question_count,
            status: attemptStatusOf(a),
          }
        : null,
      bookTitle: node.bookEditionId ? (bookTitles.get(node.bookEditionId) ?? null) : null,
      dueReviewCount,
      ordinalFrom,
    };
  });

  const items: DayPlanItemInput[] = [...executed.items];
  let ordinal = items.length;

  /* 막힌 노드는 버리지 않고 **차단 항목으로 낸다.** 목록에서 빼면 그 노드는
   * 학생 화면에서도 교사 준비도에서도 사라지고, 하루는 「할 일 없음」으로
   * 완주 처리된다 — 실행기를 만든 이유가 바로 그것이다. */
  for (const b of executed.blocked) {
    items.push({
      key: `node:${b.nodeId}`,
      kind: blockedItemKind(b.kind),
      required: true,
      status: "blocked",
      blockedReason: b.reason,
      titleSnapshot: b.title,
      ordinal: ordinal++,
      routeNodeId: b.nodeId,
      refType: "route_node",
    });
  }

  /* 노드에 매이지 않은 배정 — 교사가 직접 만든 평가, 그리고 오늘 노드 밖의
   * 날짜(예정·밀림)를 가진 평가. 날짜 판정은 core가 한다. */
  for (const a of assignments) {
    if (a.route_node_id && assessmentByNode.has(a.route_node_id)) {
      if (nodes.some((n) => n.id === a.route_node_id)) continue;
    }
    const blocked = a.question_count === 0;
    items.push({
      key: `assessment:${a.id}`,
      kind: "assessment",
      required: true,
      status: blocked ? "blocked" : attemptStatusOf(a),
      blockedReason: blocked ? "no_questions" : null,
      scheduledDate: (a.scheduled_date as IsoDate | null) ?? null,
      titleSnapshot: a.title,
      ordinal: ordinal++,
      routeNodeId: a.route_node_id,
      refType: "assessment_instance",
      refId: a.id,
    });
  }

  /* 복습 — 복습 노드가 없는 날에도 기한이 온 것은 오늘 필수다 (ADR-0017 §5).
   *  노드가 이미 낸 경우에는 같은 key라 중복되지 않는다. */
  const doneToday = reviewCounts[0]?.done_today_cnt ?? 0;
  if (
    (dueReviewCount > 0 || doneToday > 0) &&
    !items.some((i) => i.key === "review:due")
  ) {
    items.push({
      key: "review:due",
      kind: "review",
      required: true,
      status: dueReviewCount > 0 ? "pending" : "completed",
      titleSnapshot:
        dueReviewCount > 0 ? `복습 ${dueReviewCount}건` : `복습 ${doneToday}건 완료`,
      ordinal: ordinal++,
      refType: "review_batch",
    });
  }

  const computed = buildDayPlan({ planDate: today, items });
  const deferredItems = computed.deferred;
  const overdueItems = computed.overdue;
  let plan = computed;

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

    /* 화면이 보는 것은 **병합된 결과**여야 한다.
     *
     * 방금 계산한 항목은 병합 이전이다. 자료·평가는 다른 테이블이 진실을
     * 갖고 있어 다시 계산해도 완료가 살아나지만, 숙제·교재 범위는 계획
     * 자체가 유일한 진실이다 — 계산 결과를 그대로 그리면 학생이 방금
     * 「확인했습니다」를 눌러도 화면은 영영 「할 차례」라고 말한다.
     * 재투영이 보존한 상태를 읽어 와야 그 거짓말이 사라진다. */
    const persisted = await getLearnerDayPlan(sql, {
      organizationId: learner.organizationId,
      learnerId: learner.learnerId,
      planDate: today,
    });
    if (persisted) {
      plan = buildDayPlan({
        planDate: today,
        items: persisted.items.map((i) => ({
          key: i.key,
          kind: i.kind,
          required: i.required,
          status: i.status,
          blockedReason: i.blockedReason,
          titleSnapshot: i.titleSnapshot,
          ordinal: i.ordinal,
          routeNodeId: i.routeNodeId,
          refType: i.refType,
          refId: i.refId,
          /* 날짜는 저장하지 않는다 — 저장된 항목은 이미 「오늘 것」으로
           * 걸러진 결과다. 예정·밀림은 계산 결과에서 그대로 이어받는다. */
        })),
      });
      plan = { ...plan, deferred: deferredItems, overdue: overdueItems };
    }
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
