import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSql } from "../src/client";
import {
  completeLearnerDay,
  projectLearnerDayPlan,
  type DayPlanItemSpec,
} from "../src/domain/learner-day-plan";
import type { IsoDate } from "@su-maek/core/shared";

/* ─────────────────────────────────────────────────────────────
 * 학습자 하루 완료 명령 (T4.1 · E-16) — 라이브 DB.
 *
 * 지금까지 「오늘 다 했다」는 **화면의 계산**이었다. 투영기는 필수가 전부
 * 충족돼도 `in_progress`에 멈춰 `completable: true`만 돌려주고, 완료를
 * 기록하는 코드는 어디에도 없었다(G-02). 그래서 어제 하루를 끝냈는지
 * 서버는 모른다 — 응시·진도에서 역산하면 그건 추정치인데, 숙련도·일정
 * 엔진은 그것을 사실로 받는다.
 *
 * 이 명령이 그 한 칸을 채운다. 겨누는 것:
 *
 *   ① 완료는 **기록**이다 — status + completed_at + E-16이 한 트랜잭션.
 *   ② 계획 1건당 이벤트는 **최대 1회** (I-22). 중복 호출·경합·완료 취소 후
 *      재완료, 셋 다 두 번째 이벤트를 만들지 않는다.
 *   ③ 차단·미완료가 있으면 **거절**한다. 완료 판정은 core의 decideDayStatus
 *      하나뿐이라 화면·서버가 갈리지 않는다.
 *   ④ 한 학생의 완료가 반 sessions를 건드리지 않는다 (I-21).
 *
 * 조직은 고정 ID로 재사용한다 — 실행마다 새 조직을 만들면 지울 수 없는
 * 감사 행이 사라진 조직을 가리키며 쌓인다.
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
let sql: ReturnType<typeof createSql>;

const TZ = "Asia/Seoul";
const ORG = "ffffffff-0000-7000-8000-000000061001";
const OTHER_ORG = "ffffffff-0000-7000-8000-000000061002";

const PERIOD = uuidv7();
const GROUP = uuidv7();
const LEARNER = uuidv7();
const OTHER_PERIOD = uuidv7();
const OTHER_LEARNER = uuidv7();

/* 테스트마다 다른 날짜를 쓴다 — (조직·학생·날짜)가 계획의 유일 키라
 * 날짜를 공유하면 앞 테스트가 남긴 완료 기록이 뒤 테스트를 결정한다.
 * 그리고 완료 기록은 지울 수 없으므로 되돌릴 방법도 없다. */
let dayCounter = 0;
let currentDate: IsoDate = "2026-09-01" as IsoDate;
beforeEach(() => {
  dayCounter += 1;
  currentDate = `2026-09-${String(dayCounter).padStart(2, "0")}` as IsoDate;
});

function item(over: Partial<DayPlanItemSpec> = {}): DayPlanItemSpec {
  return {
    key: over.key ?? `reading:${uuidv7()}`,
    kind: "reading",
    required: true,
    status: "pending",
    titleSnapshot: "읽기 자료",
    ordinal: 0,
    ...over,
  };
}

/** 하루 계획 하나를 만든다. 테스트마다 날짜가 다르므로 항상 첫 투영이다. */
async function makePlan(
  items: DayPlanItemSpec[],
  over: Record<string, unknown> = {},
): Promise<string> {
  const result = await projectLearnerDayPlan(sql, {
    organizationId: ORG,
    learnerId: LEARNER,
    planDate: currentDate,
    timezone: TZ,
    learningGroupId: GROUP,
    source: "group_session",
    sourceRefId: null,
    items,
    ...over,
  });
  return result.planId;
}

function complete(over: Record<string, unknown> = {}) {
  return completeLearnerDay(sql, {
    organizationId: ORG,
    learnerId: LEARNER,
    planDate: currentDate,
    ...over,
  });
}

async function completionEvents(planId: string) {
  return sql<{ id: string; payload: Record<string, unknown> }[]>`
    select id::text, payload
    from outbox_events
    where event_type = 'LearnerDayCompleted' and aggregate_id = ${planId}
  `;
}

async function planRow(planId: string) {
  const [row] = await sql<
    { status: string; completed_at: string | null; reopened_at: string | null }[]
  >`
    select status::text as status, completed_at::text, reopened_at::text
    from learner_day_plans where id = ${planId}
  `;
  return row!;
}

beforeAll(async () => {
  if (!hasDb) return;
  sql = createSql();
  for (const [org, learner, period, slug] of [
    [ORG, LEARNER, PERIOD, "day-complete"],
    [OTHER_ORG, OTHER_LEARNER, OTHER_PERIOD, "day-complete-other"],
  ] as const) {
    await sql`
      insert into organizations (id, name, slug, status)
      values (${org}, ${"하루완료 테스트"}, ${`${slug}-${org.slice(-6)}`}, 'active')
      on conflict (id) do nothing
    `;
    await sql`
      insert into course_periods (id, organization_id, name, academic_year, starts_on, ends_on, status)
      values (${period}, ${org}, '테스트 기간', 2026, '2026-09-01', '2026-12-31', 'active')
      on conflict (id) do nothing
    `;
    await sql`
      insert into learners (id, organization_id, display_name, status)
      values (${learner}, ${org}, ${"테스트 학생"}, 'active')
      on conflict (id) do nothing
    `;
  }
  await sql`
    insert into learning_groups (id, organization_id, course_period_id, name, status)
    values (${GROUP}, ${ORG}, ${PERIOD}, '완료 테스트반', 'operating')
    on conflict (id) do nothing
  `;
});

afterAll(async () => {
  if (!hasDb) return;
  await sql`delete from outbox_events where organization_id in (${ORG}, ${OTHER_ORG})`;
  await sql`delete from sessions where organization_id = ${ORG}`;
  /* 완료 기록은 트리거가 삭제를 막는다 — 그 트리거도 검증 대상이므로
   * 테스트 조직 정리에서만 명시적으로 내린다 (learner-day-plan.test.ts와 동일). */
  await sql`alter table learner_day_plans disable trigger learner_day_plans_completion_immutable`;
  await sql`delete from learner_day_plans where organization_id in (${ORG}, ${OTHER_ORG})`;
  await sql`alter table learner_day_plans enable trigger learner_day_plans_completion_immutable`;
  await sql.end();
});

describe.skipIf(!hasDb)("하루 완료 전이 (E-16)", () => {
  it("필수를 전부 마치면 완료로 넘어가고 완료 시각이 남는다", async () => {
    const planId = await makePlan([
      item({ key: "a", status: "completed" }),
      item({ key: "b", status: "completed" }),
    ]);

    const result = await complete();

    expect(result.outcome).toBe("completed");
    expect(result.planId).toBe(planId);
    expect(result.completedAt).not.toBeNull();

    const row = await planRow(planId);
    expect(row.status).toBe("completed");
    /* 상태만 바꾸고 시각을 비우면 체크 제약에 걸린다. 「완료인데 언제인지
     * 모른다」를 만들지 않겠다는 제약이라 우회하지 않는다. */
    expect(row.completed_at).not.toBeNull();
  });

  it("이벤트가 정확히 1건 발행된다", async () => {
    const planId = await makePlan([item({ key: "a", status: "completed" })]);
    await complete();

    const events = await completionEvents(planId);
    expect(events).toHaveLength(1);
  });

  it("payload가 면제와 완료를 구분한다 — 면제는 「했다」가 아니다", async () => {
    /* planning-engine은 required_completed < required_total인 완료(면제가
     * 섞인 날)를 진도 계산에서 구분한다. 합쳐서 세면 자료를 안 올린 날이
     * 학생이 다 한 날과 같아 보인다. */
    const planId = await makePlan([
      item({ key: "a", status: "completed" }),
      item({ key: "b", status: "completed" }),
      item({ key: "c", status: "exempted" }),
      item({ key: "opt1", required: false, status: "completed" }),
      item({ key: "opt2", required: false, status: "pending" }),
    ]);
    await complete();

    const [event] = await completionEvents(planId);
    const p = event!.payload as Record<string, unknown>;
    expect(p.learnerDayPlanId).toBe(planId);
    expect(p.learnerId).toBe(LEARNER);
    expect(p.learningGroupId).toBe(GROUP);
    expect(p.planDate).toBe(currentDate);
    expect(p.timezoneId).toBe(TZ);
    expect(p.source).toBe("group_session");
    expect(p.completedAt).toBeTruthy();
    expect(p.items).toEqual({
      requiredTotal: 3,
      requiredCompleted: 2,
      requiredExempted: 1,
      optionalCompleted: 1,
    });
  });

  it("복습 항목의 노드는 routeNodeIds에 들어가지 않는다", async () => {
    /* 복습은 오늘 노드에서 나온 것이 아니라 과거에 틀린 개념에서 나온다.
     * 오늘 진도로 세면 학생이 오늘 배우지 않은 단원을 배운 것으로 읽는다. */
    const lessonNode = uuidv7();
    const reviewNode = uuidv7();
    const planId = await makePlan([
      item({ key: "a", status: "completed", routeNodeId: lessonNode }),
      item({
        key: "review:due",
        kind: "review",
        status: "completed",
        routeNodeId: reviewNode,
      }),
    ]);
    await complete();

    const [event] = await completionEvents(planId);
    const nodeIds = (event!.payload as { routeNodeIds: string[] }).routeNodeIds;
    expect(nodeIds).toEqual([lessonNode]);
  });
});

describe.skipIf(!hasDb)("완료를 거절하는 경우", () => {
  it("필수가 남아 있으면 거절한다", async () => {
    const planId = await makePlan([
      item({ key: "a", status: "completed" }),
      item({ key: "b", status: "pending" }),
    ]);

    const result = await complete();

    expect(result.outcome).toBe("not_completable");
    expect(result.derived).toBe("in_progress");
    expect(await completionEvents(planId)).toHaveLength(0);
    expect((await planRow(planId)).completed_at).toBeNull();
  });

  it("필수 하나가 막혀 있으면 나머지를 다 해도 거절한다", async () => {
    /* 차단이 완료보다 먼저 걸린다 (ADR-0017 §3). 자료를 안 올린 사고를
     * 완주로 읽으면 그 사고가 영영 드러나지 않는다. */
    const planId = await makePlan([
      item({ key: "a", status: "completed" }),
      item({
        key: "b",
        status: "blocked",
        blockedReason: "no_questions",
      }),
    ]);

    const result = await complete();

    expect(result.outcome).toBe("not_completable");
    expect(result.derived).toBe("blocked");
    expect(await completionEvents(planId)).toHaveLength(0);
  });

  it("필수가 하나도 없는 날은 완료되지 않는다", async () => {
    /* 아무것도 안 해도 완주로 읽히면 완료 표시의 뜻이 사라진다. */
    const planId = await makePlan([
      item({ key: "opt1", required: false, status: "completed" }),
      item({ key: "opt2", required: false, status: "completed" }),
    ]);

    const result = await complete();

    expect(result.outcome).toBe("not_completable");
    expect(await completionEvents(planId)).toHaveLength(0);
  });

  it("계획이 없는 날은 not_found다 — 계획을 만들어 주지 않는다", async () => {
    /* 여기서 계획을 만들면 완료 명령이 투영기가 된다. 그 순간 어느 쪽이
     * 확정 시점을 정하는지 두 곳이 되고, 확정 시점은 필수 분모의 기준이다. */
    const result = await complete();
    expect(result.outcome).toBe("not_found");
    expect(result.planId).toBeNull();
  });

  it("남의 조직 계획은 완료되지 않는다", async () => {
    const planId = await makePlan([item({ key: "a", status: "completed" })], {
      organizationId: OTHER_ORG,
      learnerId: OTHER_LEARNER,
      learningGroupId: null,
      source: "review_only",
    });

    const result = await complete({ learnerId: OTHER_LEARNER });

    expect(result.outcome).toBe("not_found");
    expect((await planRow(planId)).completed_at).toBeNull();
  });
});

describe.skipIf(!hasDb)("계획 1건당 최대 1회 (I-22)", () => {
  it("두 번 불러도 이벤트는 하나다", async () => {
    const planId = await makePlan([item({ key: "a", status: "completed" })]);

    const first = await complete();
    const second = await complete();

    expect(first.outcome).toBe("completed");
    expect(second.outcome).toBe("already");
    /* 두 번째도 완료 시각을 돌려준다 — 「이미 했다」는 실패가 아니다 */
    expect(second.completedAt).toBe(first.completedAt);
    expect(await completionEvents(planId)).toHaveLength(1);
  });

  it("동시에 두 번 불러도 이벤트는 하나다", async () => {
    /* 학생이 마지막 항목을 끝내고 탭 두 개에서 오늘 화면을 새로 고치면
     * 두 요청이 겹친다. 이벤트가 둘이면 숙련도 엔진은 같은 날을 두 번 센다. */
    const planId = await makePlan([item({ key: "a", status: "completed" })]);

    const results = await Promise.all([complete(), complete()]);

    expect(results.filter((r) => r.outcome === "completed")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "already")).toHaveLength(1);
    expect(await completionEvents(planId)).toHaveLength(1);
  });

  it("완료 취소 후 다시 완료돼도 재발행하지 않는다 (ADR-0017 §6)", async () => {
    const planId = await makePlan([item({ key: "a", status: "completed" })]);
    await complete();

    /* 교사의 오조작 복구 — completed_at은 **지우지 않고** reopened_at을 더한다.
     * 지우고 다시 채우는 설계는 소비자에게 같은 날을 두 번 흘려보낸다. */
    await sql`
      update learner_day_plans
      set status = 'in_progress', reopened_at = now(), reopen_reason = 'ITEST 오조작 복구'
      where id = ${planId}
    `;

    const again = await complete();

    expect(again.outcome).toBe("already");
    expect(await completionEvents(planId)).toHaveLength(1);
    /* 재완료가 상태를 되돌리지도 않는다 — 재개방은 교사의 판단이고,
     * 자동 완료가 그것을 조용히 취소하면 교사는 자기 조치가 먹혔는지 모른다. */
    const row = await planRow(planId);
    expect(row.status).toBe("in_progress");
    expect(row.reopened_at).not.toBeNull();
  });

  it("완료 시각은 재개방 뒤에도 지워지지 않는다 — DB가 막는다", async () => {
    const planId = await makePlan([item({ key: "a", status: "completed" })]);
    await complete();

    await expect(
      sql`update learner_day_plans set completed_at = null where id = ${planId}`,
    ).rejects.toThrow();
  });
});

describe.skipIf(!hasDb)("완료 이력의 불변", () => {
  it("완료된 계획은 재투영이 건드리지 않는다", async () => {
    const planId = await makePlan([item({ key: "a", status: "completed" })]);
    const done = await complete();

    /* 일정 재계산이 그날 노드를 바꿔도 완료 기록은 남는다. 여기서 막지
     * 않으면 재계산이 학생의 완료를 되돌린다. */
    const again = await projectLearnerDayPlan(sql, {
      organizationId: ORG,
      learnerId: LEARNER,
      planDate: currentDate,
      timezone: TZ,
      learningGroupId: GROUP,
      source: "group_session",
      sourceRefId: null,
      items: [item({ key: "a" }), item({ key: "z" })],
    });

    expect(again.skippedCompleted).toBe(true);
    const row = await planRow(planId);
    expect(row.status).toBe("completed");
    expect(row.completed_at).toBe(done.completedAt);
  });

  it("완료된 계획은 삭제되지 않는다", async () => {
    const planId = await makePlan([item({ key: "a", status: "completed" })]);
    await complete();

    await expect(
      sql`delete from learner_day_plans where id = ${planId}`,
    ).rejects.toThrow();
  });
});

describe.skipIf(!hasDb)("한 학생의 완료는 반을 마감하지 않는다 (I-21)", () => {
  it("학생 하루 완료가 sessions를 건드리지 않는다", async () => {
    /* 한 학생의 클릭이 반 30명의 미래 일정을 잠그는 일을 막는다. 반 마감은
     * 교사의 별도 명령이고 SessionCompleted(E-02)가 나른다 — T4.2. */
    const sessionId = uuidv7();
    await sql`
      insert into sessions (
        id, organization_id, learning_group_id, session_date, timezone,
        starts_at, ends_at, status)
      values (${sessionId}, ${ORG}, ${GROUP}, ${currentDate}::date, ${TZ},
              ${`${currentDate}T07:00:00Z`}, ${`${currentDate}T09:00:00Z`}, 'planned')
    `;
    const planId = await makePlan([item({ key: "a", status: "completed" })], {
      sourceRefId: sessionId,
    });

    await complete();

    const [session] = await sql<{ status: string }[]>`
      select status::text as status from sessions where id = ${sessionId}
    `;
    expect(session!.status).toBe("planned");
    /* 반 마감 이벤트도 나가지 않는다 */
    const [count] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from outbox_events
      where organization_id = ${ORG} and event_type = 'SessionCompleted'
    `;
    expect(count!.cnt).toBe(0);
    expect(await completionEvents(planId)).toHaveLength(1);
  });
});
