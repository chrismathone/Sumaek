import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import type { Sql } from "postgres";
import {
  decideDayStatus,
  type DayPlanItemKind,
  type DayPlanItemStatus,
} from "@su-maek/core/learning";
import type { IsoDate } from "@su-maek/core/shared";

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

    const created = !existingPlan;
    const planId = existingPlan?.id ?? uuidv7();

    if (created) {
      await tx`
        insert into learner_day_plans
          (id, organization_id, learner_id, plan_date, timezone, learning_group_id,
           source, source_ref_id, status, materialized_at, projection_hash)
        values (${planId}, ${input.organizationId}, ${input.learnerId}, ${input.planDate},
                ${input.timezone}, ${input.learningGroupId ?? null},
                ${input.source}, ${input.sourceRefId ?? null},
                'not_started', now(), ${hash})
      `;
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
