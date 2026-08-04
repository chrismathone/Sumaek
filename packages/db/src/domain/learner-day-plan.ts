import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import type { Sql } from "postgres";
import {
  decideDayStatus,
  tallyRequired,
  type DayPlanItemKind,
  type DayPlanItemStatus,
  type DayPlanStatus,
  type RequiredTally,
} from "@su-maek/core/learning";
import type { IsoDate } from "@su-maek/core/shared";
import { appendOutboxEvent } from "../queue";

/* ─────────────────────────────────────────────────────────────
 * 학생 하루 실행 계획 저장소 (ADR-0018).
 *
 * 계획층(learner_schedule_items)을 **읽기만** 한다. 이 모듈은 sessions도
 * learner_schedule_items도 쓰지 않는다 — 그것이 3층 분리의 실무적 이득이고,
 * 롤백이 두 테이블 DROP으로 끝나는 이유다.
 *
 * 재투영은 **덮어쓰기가 아니라 병합**이다. 학생이 이미 손댄 항목을 살리는
 * 것이 이 파일의 거의 전부다 — 그러지 않으면 교사가 자료를 하나 고칠
 * 때마다 학생의 진행이 초기화된다.
 * ───────────────────────────────────────────────────────────── */

export type DayPlanSource = "learner_schedule" | "group_session" | "review_only";

export interface DayPlanItemSpec {
  /** 안정 키(`kind:refId` 꼴). 재투영 멱등의 기준 — 같은 항목은 항상 같은 키다. */
  key: string;
  kind: DayPlanItemKind;
  required: boolean;
  status: DayPlanItemStatus;
  titleSnapshot: string;
  ordinal: number;
  routeNodeId?: string | null;
  refType?: string | null;
  refId?: string | null;
  blockedReason?: string | null;
}

export interface ProjectDayPlanInput {
  organizationId: string;
  learnerId: string;
  planDate: IsoDate;
  timezone: string;
  learningGroupId?: string | null;
  source: DayPlanSource;
  sourceRefId?: string | null;
  items: readonly DayPlanItemSpec[];
}

export interface ProjectDayPlanResult {
  planId: string;
  /** 이번 호출이 계획 행을 만들었나 */
  created: boolean;
  /** 완료된 계획이라 손대지 않았나 (ADR-0018 §3) */
  skippedCompleted: boolean;
  /** 저장된 상태. **투영기는 절대 `completed`를 쓰지 않는다** — 아래 `completable` 참조 */
  status: string;
  /**
   * 필수 항목이 전부 충족돼 완료 전이가 가능한가.
   *
   * 투영기가 직접 `completed`로 넘기지 않는 이유: 완료는 `completed_at`
   * 설정과 `LearnerDayCompleted` outbox 발행을 **같은 트랜잭션**에서 해야
   * 하는 별도 명령(T4.1)이다. 투영기가 조용히 완료로 넘기면 이벤트가 영영
   * 발행되지 않고, 숙련도·일정 엔진은 그 하루를 못 본다.
   */
  completable: boolean;
  inserted: number;
  updated: number;
  preserved: number;
  exempted: number;
  removed: number;
}

export interface LearnerDayPlanRow {
  id: string;
  organizationId: string;
  learnerId: string;
  planDate: string;
  status: string;
  materializedAt: string;
  completedAt: string | null;
  reopenedAt: string | null;
  items: {
    key: string;
    kind: DayPlanItemKind;
    required: boolean;
    status: DayPlanItemStatus;
    titleSnapshot: string;
    ordinal: number;
    blockedReason: string | null;
    addedAfterMaterialization: boolean;
    routeNodeId: string | null;
    refType: string | null;
    refId: string | null;
  }[];
}

/**
 * 완료 상태면 완료 시각을 함께 준다.
 *
 * 투영기가 내는 항목은 이미 `completed`일 수 있다 — 학생이 어제 끝낸 자료,
 * 방금 제출한 시험처럼 다른 테이블이 진실을 갖고 있는 것들이다. 상태만
 * 넣고 시각을 비우면 `learner_day_plan_items_completed_pair` 체크 제약에
 * 걸린다. 「완료인데 언제인지 모른다」를 애초에 만들지 않겠다는 제약이라
 * 우회하지 않고 시각을 채운다.
 */
function completionStamp(status: DayPlanItemStatus): Date | null {
  return status === "completed" ? new Date() : null;
}

/** 학생이 이미 손댄 항목 — 재투영이 상태를 덮어쓰지 않는다. */
const PRESERVED: ReadonlySet<string> = new Set([
  "completed",
  "in_progress",
  "exempted",
]);

/**
 * 투영 결정론 해시. 같은 항목 집합이면 순서가 달라도 같은 값이다 —
 * 정렬 없는 조회 결과가 들어와도 해시가 흔들리지 않게 키로 정렬한다.
 */
function projectionHash(input: ProjectDayPlanInput): string {
  const normalized = [...input.items]
    .map((i) => ({
      key: i.key,
      kind: i.kind,
      required: i.required,
      ordinal: i.ordinal,
      refId: i.refId ?? null,
      routeNodeId: i.routeNodeId ?? null,
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  return createHash("sha256")
    .update(
      JSON.stringify({
        source: input.source,
        sourceRefId: input.sourceRefId ?? null,
        items: normalized,
      }),
    )
    .digest("hex");
}

interface ExistingItem {
  id: string;
  item_key: string;
  status: DayPlanItemStatus;
  required: boolean;
  added_after_materialization: boolean;
}

/**
 * 하루 계획을 투영한다 — 없으면 만들고, 있으면 병합한다.
 *
 * 완료된 계획은 손대지 않는다. 확정(`materialized_at`) 이후에 새로 생긴
 * 항목은 **선택**으로 붙는다 — 필수 분모가 늘면 학생이 방금 본 「완료」가
 * 취소되고, 학생은 자기가 뭘 잘못했는지 알 수 없다 (ADR-0017 §4).
 */
export async function projectLearnerDayPlan(
  sql: Sql,
  input: ProjectDayPlanInput,
): Promise<ProjectDayPlanResult> {
  const hash = projectionHash(input);

  return sql.begin(async (tx) => {
    const [existingPlan] = await tx<
      { id: string; status: string; completed_at: string | null }[]
    >`
      select id::text, status::text, completed_at::text
      from learner_day_plans
      where organization_id = ${input.organizationId}
        and learner_id = ${input.learnerId}
        and plan_date = ${input.planDate}
      for update
    `;

    /* 완료된 계획은 재투영 대상이 아니다. 여기서 막지 않으면 일정 재계산이
     * 학생의 완료 기록을 되돌린다. */
    if (existingPlan && existingPlan.status === "completed") {
      return {
        planId: existingPlan.id,
        created: false,
        skippedCompleted: true,
        status: "completed",
        completable: false,
        inserted: 0,
        updated: 0,
        preserved: 0,
        exempted: 0,
        removed: 0,
      };
    }

    let created = !existingPlan;
    let planId = existingPlan?.id ?? uuidv7();

    if (created) {
      /* `for update`는 **없는 행을 잠그지 못한다.**
       *
       * 그래서 첫 투영이 겹치면 둘 다 「없음」을 보고 둘 다 넣는다. 학생이
       * 「오늘 학습」을 처음 여는 순간이 정확히 그 지점이고, 탭 두 개·라우터
       * 프리페치·새로 고침 연타면 흔히 겹친다. 예전에는 뒤엣것이
       * learner_day_plans_uq에 걸려 예외가 그대로 화면까지 올라갔다 —
       * 학생은 「화면을 여는 중 오류가 났습니다」를 만났다. 유니크 인덱스는
       * 두 행이 생기는 것을 막으라고 둔 것이지 화면을 죽이라고 둔 것이
       * 아니다 (T6.2 자율 E2E에서 첫 로그인이 이 500을 만났다).
       *
       * 충돌하면 넣지 않고, 먼저 만든 쪽의 행을 그대로 쓴다. 이 statement는
       * 상대 트랜잭션이 끝날 때까지 기다렸다가 진행하므로, 아래 재조회는
       * 이미 커밋된 행을 본다. */
      const insertedRows = await tx<{ id: string }[]>`
        insert into learner_day_plans
          (id, organization_id, learner_id, plan_date, timezone, learning_group_id,
           source, source_ref_id, status, materialized_at, projection_hash)
        values (${planId}, ${input.organizationId}, ${input.learnerId}, ${input.planDate},
                ${input.timezone}, ${input.learningGroupId ?? null},
                ${input.source}, ${input.sourceRefId ?? null},
                'not_started', now(), ${hash})
        on conflict (organization_id, learner_id, plan_date) do nothing
        returning id::text
      `;
      if (insertedRows.length === 0) {
        const [raced] = await tx<
          { id: string; status: string; completed_at: string | null }[]
        >`
          select id::text, status::text, completed_at::text
          from learner_day_plans
          where organization_id = ${input.organizationId}
            and learner_id = ${input.learnerId}
            and plan_date = ${input.planDate}
          for update
        `;
        /* 충돌했는데 행이 없다 = 상대가 롤백했다. 그때는 우리가 만드는
         * 것이 맞다 — 조용히 계획 없는 하루를 돌려주면 학생 화면이 빈다. */
        if (!raced) throw new Error("PROJECTION_RACE_LOST_AND_GONE");
        /* 먼저 만든 쪽이 완료까지 굳혔다면 재투영 대상이 아니다 — 위쪽
         * 판정과 같은 규칙을 여기서도 지킨다. */
        if (raced.status === "completed") {
          return {
            planId: raced.id,
            created: false,
            skippedCompleted: true,
            status: "completed" as const,
            completable: false,
            inserted: 0,
            updated: 0,
            preserved: 0,
            exempted: 0,
            removed: 0,
          };
        }
        planId = raced.id;
        created = false;
      }
    }

    const existingItems = await tx<ExistingItem[]>`
      select id::text, item_key, status::text as status, required,
             added_after_materialization
      from learner_day_plan_items
      where learner_day_plan_id = ${planId}
    `;
    const byKey = new Map(existingItems.map((i) => [i.item_key, i]));
    const incomingKeys = new Set(input.items.map((i) => i.key));

    let inserted = 0;
    let updated = 0;
    let preserved = 0;

    for (const spec of input.items) {
      const prior = byKey.get(spec.key);

      if (!prior) {
        /* 확정 이후에 생긴 항목은 선택이다. 첫 투영(계획 생성과 같은 호출)의
         * 항목은 확정 「그때」의 것이므로 그대로 필수가 될 수 있다. */
        const afterMaterialization = !created;
        await tx`
          insert into learner_day_plan_items
            (id, organization_id, learner_day_plan_id, item_key, ordinal, kind,
             required, route_node_id, ref_type, ref_id, title_snapshot, status,
             blocked_reason, completed_at, added_after_materialization)
          values (${uuidv7()}, ${input.organizationId}, ${planId}, ${spec.key},
                  ${spec.ordinal}, ${spec.kind},
                  ${afterMaterialization ? false : spec.required},
                  ${spec.routeNodeId ?? null}, ${spec.refType ?? null},
                  ${spec.refId ?? null}, ${spec.titleSnapshot}, ${spec.status},
                  ${spec.blockedReason ?? null}, ${completionStamp(spec.status)},
                  ${afterMaterialization})
        `;
        inserted += 1;
        continue;
      }

      if (PRESERVED.has(prior.status)) {
        preserved += 1;
        continue;
      }

      /* 여기 오는 것은 pending·blocked뿐이다. 차단 해소(blocked → pending)와
       * 새 차단(pending → blocked)이 둘 다 이 경로로 흐른다.
       * required는 올리지 않는다 — 확정 후에 붙은 항목은 계속 선택이다. */
      await tx`
        update learner_day_plan_items
        set ordinal = ${spec.ordinal},
            title_snapshot = ${spec.titleSnapshot},
            status = ${spec.status},
            blocked_reason = ${spec.blockedReason ?? null},
            completed_at = ${completionStamp(spec.status)},
            required = ${prior.added_after_materialization ? false : spec.required},
            updated_at = now()
        where id = ${prior.id}
      `;
      updated += 1;
    }

    /* 새 투영에서 빠진 항목. 손대지 않은 것만 지우고, 학생이 이미 손댔거나
     * 차단으로 보였던 것은 면제로 남긴다 — 완료율이 역행하지 않으면서
     * 「있었다」는 사실은 지워지지 않는다. */
    let exempted = 0;
    let removed = 0;
    for (const prior of existingItems) {
      if (incomingKeys.has(prior.item_key)) continue;

      if (prior.status === "pending") {
        await tx`delete from learner_day_plan_items where id = ${prior.id}`;
        removed += 1;
      } else if (prior.status !== "exempted") {
        await tx`
          update learner_day_plan_items
          set status = 'exempted', blocked_reason = null, updated_at = now()
          where id = ${prior.id}
        `;
        exempted += 1;
      }
    }

    /* 상태는 core의 판정기가 정한다 — 화면·서버·워커가 같은 규칙을 쓴다. */
    const finalItems = await tx<{ required: boolean; status: DayPlanItemStatus }[]>`
      select required, status::text as status
      from learner_day_plan_items
      where learner_day_plan_id = ${planId}
    `;
    const derived = decideDayStatus(finalItems);
    const completable = derived === "completed";

    /* 투영기는 `completed`를 쓰지 않는다. 완료는 completed_at 설정과
     * LearnerDayCompleted 발행을 같은 트랜잭션에서 하는 별도 명령(T4.1)의
     * 몫이다. 여기서 조용히 넘기면 이벤트가 영영 발행되지 않고,
     * completed_at 없는 completed 행이 되어 체크 제약에도 걸린다. */
    const status =
      derived === "empty" ? "not_started" : completable ? "in_progress" : derived;

    await tx`
      update learner_day_plans
      set status = ${status}, projection_hash = ${hash}, updated_at = now()
      where id = ${planId}
    `;

    return {
      planId,
      created,
      skippedCompleted: false,
      status,
      completable,
      inserted,
      updated,
      preserved,
      exempted,
      removed,
    };
  }) as Promise<ProjectDayPlanResult>;
}

/** 하루 계획 한 건을 항목과 함께 읽는다. 조직 밖은 보이지 않는다. */
export async function getLearnerDayPlan(
  sql: Sql,
  key: { organizationId: string; learnerId: string; planDate: IsoDate },
): Promise<LearnerDayPlanRow | null> {
  const [plan] = await sql<
    {
      id: string;
      organization_id: string;
      learner_id: string;
      plan_date: string;
      status: string;
      materialized_at: string;
      completed_at: string | null;
      reopened_at: string | null;
    }[]
  >`
    select id::text, organization_id::text, learner_id::text,
           plan_date::text, status::text, materialized_at::text,
           completed_at::text, reopened_at::text
    from learner_day_plans
    where organization_id = ${key.organizationId}
      and learner_id = ${key.learnerId}
      and plan_date = ${key.planDate}
  `;
  if (!plan) return null;

  const items = await sql<
    {
      item_key: string;
      kind: DayPlanItemKind;
      required: boolean;
      status: DayPlanItemStatus;
      title_snapshot: string;
      ordinal: number;
      blocked_reason: string | null;
      added_after_materialization: boolean;
      route_node_id: string | null;
      ref_type: string | null;
      ref_id: string | null;
    }[]
  >`
    select item_key, kind::text as kind, required, status::text as status,
           title_snapshot, ordinal, blocked_reason, added_after_materialization,
           route_node_id::text, ref_type, ref_id::text
    from learner_day_plan_items
    where learner_day_plan_id = ${plan.id}
    order by ordinal, item_key
  `;

  return {
    id: plan.id,
    organizationId: plan.organization_id,
    learnerId: plan.learner_id,
    planDate: plan.plan_date,
    status: plan.status,
    materializedAt: plan.materialized_at,
    completedAt: plan.completed_at,
    reopenedAt: plan.reopened_at,
    items: items.map((i) => ({
      key: i.item_key,
      kind: i.kind,
      required: i.required,
      status: i.status,
      titleSnapshot: i.title_snapshot,
      ordinal: i.ordinal,
      blockedReason: i.blocked_reason,
      addedAfterMaterialization: i.added_after_materialization,
      routeNodeId: i.route_node_id,
      refType: i.ref_type,
      refId: i.ref_id,
    })),
  };
}

/**
 * 항목 하나를 완료로 표시한다.
 *
 * **현재 학생·현재 날짜의 항목만** 바꾼다. 항목 id가 아니라
 * (조직·학생·날짜·키)로 찾는 이유가 그것이다 — 화면이 넘긴 id를 그대로
 * 믿으면 남의 항목을 완료 처리할 수 있다. 학생 흐름에서 실제로 그런
 * 결손이 있었다(답안 저장에 learner 스코프가 없었다).
 *
 * 멱등이다: 이미 완료된 항목을 다시 불러도 완료 시각이 바뀌지 않는다.
 * 차단·면제 항목은 학생이 완료할 수 없다.
 */
export async function completeDayPlanItem(
  sql: Sql,
  input: {
    organizationId: string;
    learnerId: string;
    planDate: IsoDate;
    itemKey: string;
  },
): Promise<{ ok: boolean; message: string; alreadyDone: boolean }> {
  const rows = await sql<{ status: string }[]>`
    update learner_day_plan_items i
    set status = 'completed', completed_at = now(), updated_at = now()
    from learner_day_plans p
    where i.learner_day_plan_id = p.id
      and p.organization_id = ${input.organizationId}
      and p.learner_id = ${input.learnerId}
      and p.plan_date = ${input.planDate}
      and i.item_key = ${input.itemKey}
      and i.status in ('pending', 'in_progress')
    returning i.status::text as status
  `;
  if (rows.length > 0) {
    return { ok: true, message: "완료로 표시했습니다.", alreadyDone: false };
  }

  /* 0행이면 이유가 셋이다: 이미 끝냈거나, 할 수 없는 상태이거나, 내 것이
   * 아니거나. 셋을 같은 말로 뭉개면 학생은 왜 안 되는지 모른다. */
  const [existing] = await sql<{ status: string }[]>`
    select i.status::text as status
    from learner_day_plan_items i
    join learner_day_plans p on p.id = i.learner_day_plan_id
    where p.organization_id = ${input.organizationId}
      and p.learner_id = ${input.learnerId}
      and p.plan_date = ${input.planDate}
      and i.item_key = ${input.itemKey}
  `;
  if (!existing) {
    return { ok: false, message: "오늘 계획에 없는 항목입니다.", alreadyDone: false };
  }
  if (existing.status === "completed") {
    return { ok: true, message: "이미 완료했습니다.", alreadyDone: true };
  }
  if (existing.status === "blocked") {
    return {
      ok: false,
      message: "지금 할 수 없는 항목입니다 — 선생님께 알려 주세요.",
      alreadyDone: false,
    };
  }
  return { ok: false, message: "완료할 수 없는 항목입니다.", alreadyDone: false };
}

/* ─────────────────────────────────────────────────────────────
 * 하루 완료 명령 (T4.1 · E-16).
 *
 * 여기까지 「오늘 다 했다」는 화면의 계산이었다. 투영기는 필수가 전부
 * 충족돼도 `in_progress`에 멈춰 `completable: true`만 돌려주고(위 참조),
 * 완료를 기록하는 코드는 없었다 — 어제 하루를 끝냈는지 서버는 모른다(G-02).
 *
 * 왜 투영기가 아니라 별도 명령인가: 완료는 `completed_at` 설정과 이벤트
 * 발행이 **같은 트랜잭션**이어야 하는 사건이고, `completed_at`은 그 뒤로
 * 불변이다(I-22). 재투영은 하루에 수십 번 돌 수 있는 계산이다. 둘을 한
 * 함수에 두면 「계산」이 「불변 사실」을 만들게 되고, 그 경계가 흐려지는
 * 순간 되돌릴 수 없는 기록이 실수로 생긴다.
 * ───────────────────────────────────────────────────────────── */

export type DayCompletionOutcome =
  /** 이번 호출이 처음 완료로 넘겼다 — 이벤트 1건 */
  | "completed"
  /**
   * 재개방된 하루가 다시 충족돼 상태만 되돌렸다 — 이벤트는 내지 않는다.
   *
   * 되돌리지 않으면 그 하루는 학생이 무엇을 더 해도 영영 미완료로 남고
   * 교사에게도 닫을 방법이 없다. 재개방의 목적은 계획이 다시 갱신되게 하는
   * 것이지 하루를 영구히 여는 것이 아니다 (ADR-0017 §6의 「다시 완료돼도」).
   */
  | "recompleted"
  | "already"
  | "not_completable"
  | "not_found";

export interface CompleteLearnerDayResult {
  outcome: DayCompletionOutcome;
  planId: string | null;
  /** `already`도 함께 준다 — 「이미 했다」는 실패가 아니다. */
  completedAt: string | null;
  /** `not_completable`일 때 왜 안 되는지. core의 판정 그대로다. */
  derived: DayPlanStatus | null;
  /** 이번 호출이 발행한 이벤트. 발행하지 않았으면 null. */
  eventId: string | null;
  required: RequiredTally | null;
}

interface DayPlanHeadRow {
  id: string;
  status: string;
  completed_at: string | null;
  timezone: string;
  learning_group_id: string | null;
  source: string;
}

interface CompletionItemRow {
  required: boolean;
  status: DayPlanItemStatus;
  kind: DayPlanItemKind;
  route_node_id: string | null;
}

function noCompletion(
  outcome: DayCompletionOutcome,
  over: Partial<CompleteLearnerDayResult> = {},
): CompleteLearnerDayResult {
  return {
    outcome,
    planId: null,
    completedAt: null,
    derived: null,
    eventId: null,
    required: null,
    ...over,
  };
}

/**
 * 오늘 진도로 셈할 노드 — 복습 항목은 뺀다.
 *
 * 복습은 오늘 노드에서 나온 것이 아니라 과거에 틀린 개념에서 나온다.
 * 오늘 진도에 섞으면 학생이 오늘 배우지 않은 단원을 배운 것으로 읽히고,
 * 그 수치가 일정 엔진까지 흘러간다 (E-16 「복습 항목은 빠짐」).
 */
function progressNodeIds(items: readonly CompletionItemRow[]): string[] {
  const ids = new Set<string>();
  for (const i of items) {
    if (i.kind === "review") continue;
    if (i.route_node_id) ids.add(i.route_node_id);
  }
  return [...ids].sort();
}

/**
 * 하루를 완료로 확정하고 `LearnerDayCompleted`(E-16)를 발행한다.
 *
 * 계획 1건당 **최대 1회**다(I-22). 판정 기준은 `completed_at`이지 상태가
 * 아니다 — 교사가 완료를 취소하면 상태는 `completed`에서 벗어나지만
 * `completed_at`은 남는다(ADR-0017 §6). 상태로 판정하면 재개방된 하루가
 * 다시 완료될 때 이벤트가 한 번 더 나가고, 숙련도·일정 엔진은 같은 날을
 * 두 번 센다.
 *
 * 반 `sessions`를 건드리지 않는다(I-21). 반 마감은 교사의 별도 명령이고
 * `SessionCompleted`(E-02)가 나른다 — 한 학생의 완료가 반 30명의 미래
 * 일정을 잠그면 안 된다.
 */
export async function completeLearnerDay(
  sql: Sql,
  input: {
    organizationId: string;
    learnerId: string;
    planDate: IsoDate;
  },
): Promise<CompleteLearnerDayResult> {
  return sql.begin(async (tx) => {
    const [plan] = await tx<DayPlanHeadRow[]>`
      select id::text, status::text, completed_at::text, timezone,
             learning_group_id::text, source::text
      from learner_day_plans
      where organization_id = ${input.organizationId}
        and learner_id = ${input.learnerId}
        and plan_date = ${input.planDate}
      for update
    `;
    /* 계획을 만들어 주지 않는다. 여기서 만들면 완료 명령이 투영기가 되고,
     * 확정 시점(= 필수 분모의 기준)을 정하는 곳이 둘이 된다. */
    if (!plan) return noCompletion("not_found");

    /* 이미 완료 상태면 할 일이 없다. 재개방된 하루(완료 시각은 있는데 상태는
     * 아닌)는 아래에서 다시 판정한다. */
    if (plan.completed_at !== null && plan.status === "completed") {
      return noCompletion("already", {
        planId: plan.id,
        completedAt: plan.completed_at,
      });
    }

    const items = await tx<CompletionItemRow[]>`
      select required, status::text as status, kind::text as kind,
             route_node_id::text
      from learner_day_plan_items
      where learner_day_plan_id = ${plan.id}
    `;

    /* 완료 판정은 core 하나뿐이다 — 화면·서버·워커가 갈리지 않는다. */
    const derived = decideDayStatus(items);
    const required = tallyRequired(items);
    if (derived !== "completed") {
      return noCompletion("not_completable", {
        planId: plan.id,
        /* 재개방된 하루면 완료 시각은 여전히 사실이다 — 감추지 않는다 */
        completedAt: plan.completed_at,
        derived,
        required,
      });
    }

    /* 재개방된 하루의 재완료: 상태만 되돌리고 이벤트는 내지 않는다.
     * completed_at을 건드리지 않으므로 I-22의 「계획 1건당 최대 1회」가
     * 그대로 성립한다 — 그리고 DB 트리거도 그 변경만 허용한다. */
    if (plan.completed_at !== null) {
      await tx`
        update learner_day_plans
        set status = 'completed', updated_at = now()
        where id = ${plan.id}
      `;
      return noCompletion("recompleted", {
        planId: plan.id,
        completedAt: plan.completed_at,
        derived: "completed",
        required,
      });
    }

    /* 행 잠금이 이미 직렬화하지만 CAS 조건을 함께 둔다 — 잠금을 우회하는
     * 경로가 나중에 생기더라도 두 번째 완료가 이벤트를 만들지 못한다. */
    const [updated] = await tx<{ completed_at: string }[]>`
      update learner_day_plans
      set status = 'completed', completed_at = now(), updated_at = now()
      where id = ${plan.id} and completed_at is null
      returning completed_at::text
    `;
    if (!updated) {
      const [current] = await tx<{ completed_at: string | null }[]>`
        select completed_at::text from learner_day_plans where id = ${plan.id}
      `;
      return noCompletion("already", {
        planId: plan.id,
        completedAt: current?.completed_at ?? null,
      });
    }

    const eventId = uuidv7();
    await appendOutboxEvent(tx, {
      eventId,
      organizationId: input.organizationId,
      aggregateType: "learner_day_plan",
      aggregateId: plan.id,
      aggregateVersion: 1,
      eventType: "LearnerDayCompleted",
      occurredAt: new Date(),
      payload: {
        learnerDayPlanId: plan.id,
        learnerId: input.learnerId,
        learningGroupId: plan.learning_group_id,
        planDate: input.planDate,
        timezoneId: plan.timezone,
        completedAt: updated.completed_at,
        source: plan.source,
        /* 면제를 완료와 합치지 않는다. 합치면 자료를 안 올린 날이 학생이
         * 다 한 날과 같아 보이고, planning-engine은 그 둘을 구분해야 한다. */
        items: {
          requiredTotal: required.total,
          requiredCompleted: required.completed,
          requiredExempted: required.exempted,
          optionalCompleted: items.filter(
            (i) => !i.required && i.status === "completed",
          ).length,
        },
        routeNodeIds: progressNodeIds(items),
      },
    });

    return {
      outcome: "completed" as const,
      planId: plan.id,
      completedAt: updated.completed_at,
      derived: "completed" as const,
      eventId,
      required,
    };
  }) as Promise<CompleteLearnerDayResult>;
}

export interface ReopenLearnerDayResult {
  ok: boolean;
  message: string;
  planId: string | null;
  /** 되돌아간 상태 — 항목에서 다시 판정한 값 */
  status: DayPlanStatus | null;
}

/**
 * 교사의 「하루 완료 취소」 (ADR-0017 §6).
 *
 * `completed_at`을 **지우지 않는다.** 지우고 다시 채우는 설계는 소비자
 * (숙련도·일정 엔진)에게 같은 날을 두 번 흘려보낸다 — 그래서 DB 트리거도
 * 그 변경을 거부한다. 여기서 하는 일은 `reopened_at`을 더하고 상태를
 * 항목에서 다시 판정한 값으로 되돌리는 것뿐이다.
 *
 * **취소의 실제 효과는 재투영이 다시 도는 것이다.** 완료된 계획은 투영기가
 * 통째로 건너뛰므로(ADR-0018 §3), 잘못 완료된 하루는 원본 데이터를 고쳐도
 * 계획이 갱신되지 않는다. 재개방이 그 문을 다시 연다.
 *
 * 그래서 필수가 여전히 전부 충족돼 있으면 다음 재투영에서 곧바로 다시
 * 완료로 돌아간다(`completeLearnerDay`의 `recompleted`). 그것이 맞다 —
 * 계획이 「전부 했다」고 말하는데 화면만 아니라고 하면 그것이 거짓말이다.
 */
export async function reopenLearnerDay(
  sql: Sql,
  input: {
    organizationId: string;
    learnerId: string;
    planDate: IsoDate;
    actorUserId: string;
    reason: string;
  },
): Promise<ReopenLearnerDayResult> {
  /* 사유 없는 재개방은 나중에 아무도 설명할 수 없다. 완료 기록을 건드리는
   * 유일한 조작이라 그 한 줄이 유일한 근거가 된다. DB를 열기 전에 막는다. */
  const reason = input.reason.trim();
  if (reason.length === 0) {
    return {
      ok: false,
      message: "취소 사유를 적어 주세요 — 완료 기록을 되돌리는 유일한 근거입니다.",
      planId: null,
      status: null,
    };
  }

  return sql.begin(async (tx) => {
    const [plan] = await tx<{ id: string; completed_at: string | null }[]>`
      select id::text, completed_at::text
      from learner_day_plans
      where organization_id = ${input.organizationId}
        and learner_id = ${input.learnerId}
        and plan_date = ${input.planDate}
      for update
    `;
    if (!plan) {
      return {
        ok: false,
        message: "그 날짜의 하루 계획이 없습니다.",
        planId: null,
        status: null,
      };
    }
    if (plan.completed_at === null) {
      return {
        ok: false,
        message: "완료된 하루만 취소할 수 있습니다.",
        planId: plan.id,
        status: null,
      };
    }

    const items = await tx<{ required: boolean; status: DayPlanItemStatus }[]>`
      select required, status::text as status
      from learner_day_plan_items
      where learner_day_plan_id = ${plan.id}
    `;
    /* 투영기와 같은 규칙으로 상태를 정한다 — 충족돼 있어도 `completed`로
     * 쓰지 않는다. 그 전이는 완료 명령의 몫이고, 여기서 넘기면 취소가
     * 아무 일도 하지 않은 것이 된다. */
    const derived = decideDayStatus(items);
    const status: DayPlanStatus =
      derived === "empty"
        ? "not_started"
        : derived === "completed"
          ? "in_progress"
          : derived;

    await tx`
      update learner_day_plans
      set status = ${status}, reopened_at = now(), reopened_by = ${input.actorUserId},
          reopen_reason = ${reason}, updated_at = now()
      where id = ${plan.id}
    `;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action, target_type, target_id,
        reason, before, after
      ) values (
        ${uuidv7()}, ${input.organizationId}, 'user', ${input.actorUserId},
        'learner-day.reopen', 'learner_day_plan', ${plan.id}, ${reason},
        ${tx.json({ status: "completed", completedAt: plan.completed_at } as never)},
        ${tx.json({ status } as never)}
      )
    `;

    return {
      ok: true,
      message:
        "하루 완료를 취소했습니다. 완료 기록은 남고, 계획이 다시 갱신됩니다.",
      planId: plan.id,
      status,
    };
  }) as Promise<ReopenLearnerDayResult>;
}

export interface LearnerDayPlanSummary {
  planId: string;
  planDate: string;
  status: string;
  completedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  learningGroupId: string | null;
  requiredTotal: number;
  /** 완료 + 면제 — 완료 판정이 보는 값 */
  requiredSatisfied: number;
  requiredBlocked: number;
}

/**
 * 한 학생의 하루 실행 기록 — 교사 화면(학습자 상세)이 읽는다.
 *
 * 반·날짜로 가로지르는 현황판은 T4.4의 몫이고, 이것은 한 학생의 세로
 * 기록이다. 두 화면은 같은 표를 다르게 자르므로 질의도 따로 둔다.
 */
export async function listLearnerDayPlans(
  sql: Sql,
  input: { organizationId: string; learnerId: string; limit?: number },
): Promise<LearnerDayPlanSummary[]> {
  const rows = await sql<
    {
      id: string;
      plan_date: string;
      status: string;
      completed_at: string | null;
      reopened_at: string | null;
      reopen_reason: string | null;
      learning_group_id: string | null;
      required_total: number;
      required_satisfied: number;
      required_blocked: number;
    }[]
  >`
    select p.id::text, p.plan_date::text, p.status::text as status,
           p.completed_at::text, p.reopened_at::text, p.reopen_reason,
           p.learning_group_id::text,
           count(*) filter (where i.required)::int as required_total,
           count(*) filter (
             where i.required and i.status in ('completed', 'exempted')
           )::int as required_satisfied,
           count(*) filter (where i.required and i.status = 'blocked')::int
             as required_blocked
    from learner_day_plans p
    left join learner_day_plan_items i on i.learner_day_plan_id = p.id
    where p.organization_id = ${input.organizationId}
      and p.learner_id = ${input.learnerId}
    group by p.id
    order by p.plan_date desc
    limit ${input.limit ?? 30}
  `;

  return rows.map((r) => ({
    planId: r.id,
    planDate: r.plan_date,
    status: r.status,
    completedAt: r.completed_at,
    reopenedAt: r.reopened_at,
    reopenReason: r.reopen_reason,
    learningGroupId: r.learning_group_id,
    requiredTotal: r.required_total,
    requiredSatisfied: r.required_satisfied,
    requiredBlocked: r.required_blocked,
  }));
}
