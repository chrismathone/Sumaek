import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSql } from "../src/client";
import {
  getLearnerDayPlan,
  projectLearnerDayPlan,
  type DayPlanItemSpec,
} from "../src/domain/learner-day-plan";
import type { IsoDate } from "@su-maek/core/shared";

/* ─────────────────────────────────────────────────────────────
 * 학습자 하루 계획 저장소 (ADR-0018) — 라이브 DB 통합 테스트.
 *
 * 이 테이블은 **실행층(③)**이다. 계획층인 learner_schedule_items(②)를
 * 대체하지 않는다. ②는 일정이 바뀔 때마다 덮어써야 하고 ③은 완료 이력이
 * 역행하면 안 되므로, 한 테이블에 두면 재계산마다 「덮어써도 되는 행」과
 * 「건드리면 안 되는 행」을 런타임에 갈라야 한다. 그 판단이 틀리는 순간
 * 학생의 완료 기록이 사라진다.
 *
 * 검증하는 것:
 *  1. 한 학생·한 날짜 계획은 하나 (유일성)
 *  2. 같은 입력 재투영이 행을 늘리지 않는다 (멱등)
 *  3. 완료·진행 중 항목은 재투영이 보존한다
 *  4. 확정 후 새 항목은 선택으로 붙는다 (필수 분모가 늘지 않는다)
 *  5. 완료된 계획은 재투영 대상이 아니다
 *  6. completed_at은 일반 UPDATE로 지워지지 않는다 (I-22)
 *  7. 조직 격리 (RLS)
 *  8. 이 마이그레이션이 sessions·learner_schedule_items를 건드리지 않는다
 *
 * 조직은 고정 ID로 재사용한다 — 실행마다 새 조직을 만들면 지울 수 없는
 * 감사 행이 사라진 조직을 가리키며 쌓인다 (learner-scope-schedule.test.ts와
 * 같은 이유·같은 방식).
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
let sql: ReturnType<typeof createSql>;

const TZ = "Asia/Seoul";
const ORG = "ffffffff-0000-7000-8000-000000060001";
const OTHER_ORG = "ffffffff-0000-7000-8000-000000060002";

const PERIOD = uuidv7();
const GROUP = uuidv7();
const LEARNER = uuidv7();
const OTHER_LEARNER = uuidv7();

/* 테스트마다 다른 날짜를 쓴다 — 같은 (조직·학생·날짜)를 공유하면 앞 테스트가
 * 남긴 항목 상태가 뒤 테스트의 병합 결과를 바꾼다. 실제로 그렇게 얽혀서
 * 「제목이 갱신되는가」가 앞 테스트의 exempted 때문에 실패했다. */
let dayCounter = 0;
function nextDate(): IsoDate {
  dayCounter += 1;
  return `2026-08-${String(dayCounter).padStart(2, "0")}` as IsoDate;
}

const SEED_DATE = "2026-08-01" as IsoDate;

/** 각 테스트가 자기 날짜를 갖는다 — baseInput()이 이 값을 쓴다. */
let currentDate: IsoDate = SEED_DATE;
beforeEach(() => {
  currentDate = nextDate();
});

function itemSpec(over: Partial<DayPlanItemSpec> = {}): DayPlanItemSpec {
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

function baseInput(over: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    learnerId: LEARNER,
    planDate: currentDate,
    timezone: TZ,
    learningGroupId: GROUP,
    source: "group_session" as const,
    sourceRefId: null,
    items: [itemSpec({ key: "a" }), itemSpec({ key: "b" })],
    ...over,
  };
}

async function itemRows(planId: string) {
  return sql<
    {
      key: string;
      status: string;
      required: boolean;
      added_after_materialization: boolean;
      title_snapshot: string;
    }[]
  >`
    select item_key as key, status::text as status, required,
           added_after_materialization, title_snapshot
    from learner_day_plan_items
    where learner_day_plan_id = ${planId}
    order by ordinal, item_key
  `;
}

async function seedOrg(orgId: string, learnerId: string) {
  await sql`
    insert into organizations (id, name, slug, status)
    values (${orgId}, ${"하루계획 테스트"}, ${`day-plan-${orgId.slice(-6)}`}, 'active')
    on conflict (id) do nothing
  `;
  await sql`
    insert into course_periods (id, organization_id, name, academic_year, starts_on, ends_on, status)
    values (${PERIOD}, ${orgId}, '테스트 기간', 2026, ${SEED_DATE}, ${"2026-12-31"}, 'active')
    on conflict (id) do nothing
  `;
  await sql`
    insert into learners (id, organization_id, display_name, status)
    values (${learnerId}, ${orgId}, ${"테스트 학생"}, 'active')
    on conflict (id) do nothing
  `;
}

beforeAll(async () => {
  if (!hasDb) return;
  sql = createSql();
  await seedOrg(ORG, LEARNER);
  await sql`
    insert into learning_groups (id, organization_id, course_period_id, name, status)
    values (${GROUP}, ${ORG}, ${PERIOD}, '테스트 반', 'operating')
    on conflict (id) do nothing
  `;
});

afterAll(async () => {
  if (!hasDb) return;
  /* 하루 계획은 완료 이력이지만 테스트 조직 것은 지운다 — purge-test-data와
   * 같은 방침. 트리거가 막으면 그것도 검증 대상이므로 명시적으로 내린다. */
  await sql`alter table learner_day_plans disable trigger learner_day_plans_completion_immutable`;
  await sql`delete from learner_day_plans where organization_id in (${ORG}, ${OTHER_ORG})`;
  await sql`alter table learner_day_plans enable trigger learner_day_plans_completion_immutable`;
  await sql.end();
});

describe.skipIf(!hasDb)("유일성과 멱등 재투영", () => {
  it("한 학생·한 날짜 계획은 하나다", async () => {
    const first = await projectLearnerDayPlan(sql, baseInput());
    const second = await projectLearnerDayPlan(sql, baseInput());

    expect(second.planId).toBe(first.planId);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);

    const [row] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from learner_day_plans
      where organization_id = ${ORG} and learner_id = ${LEARNER} and plan_date = ${currentDate}
    `;
    expect(row!.cnt).toBe(1);
  });

  it("같은 입력을 세 번 투영해도 항목이 늘지 않는다", async () => {
    const r = await projectLearnerDayPlan(sql, baseInput());
    await projectLearnerDayPlan(sql, baseInput());
    await projectLearnerDayPlan(sql, baseInput());

    expect(await itemRows(r.planId)).toHaveLength(2);
  });

  it("직접 INSERT로 같은 (조직·학생·날짜)를 넣으면 DB가 거부한다", async () => {
    await projectLearnerDayPlan(sql, baseInput());
    await expect(
      sql`
        insert into learner_day_plans
          (id, organization_id, learner_id, plan_date, timezone, source, status,
           materialized_at, projection_hash)
        values (${uuidv7()}, ${ORG}, ${LEARNER}, ${currentDate}, ${TZ}, 'group_session',
                'not_started', now(), 'x')
      `,
    ).rejects.toThrow();
  });
});

describe.skipIf(!hasDb)("재투영 병합 규칙 (ADR-0018 §3)", () => {
  it("완료·진행 중 항목은 재투영이 보존한다", async () => {
    const r = await projectLearnerDayPlan(sql, baseInput());
    await sql`
      update learner_day_plan_items set status = 'completed', completed_at = now()
      where learner_day_plan_id = ${r.planId} and item_key = 'a'
    `;

    await projectLearnerDayPlan(sql, baseInput());

    const rows = await itemRows(r.planId);
    expect(rows.find((x) => x.key === "a")!.status).toBe("completed");
    expect(rows.find((x) => x.key === "b")!.status).toBe("pending");
  });

  it("확정 후 새로 생긴 항목은 선택으로 붙는다 — 필수 분모가 늘지 않는다", async () => {
    /* ADR-0017 §4. 늘면 학생이 방금 본 「3/3 완료」가 「3/4」로 되돌아간다. */
    const r = await projectLearnerDayPlan(sql, baseInput());

    await projectLearnerDayPlan(
      sql,
      baseInput({
        items: [itemSpec({ key: "a" }), itemSpec({ key: "b" }), itemSpec({ key: "c" })],
      }),
    );

    const rows = await itemRows(r.planId);
    const added = rows.find((x) => x.key === "c")!;
    expect(added.required).toBe(false);
    expect(added.added_after_materialization).toBe(true);

    const original = rows.find((x) => x.key === "a")!;
    expect(original.required).toBe(true);
    expect(original.added_after_materialization).toBe(false);
  });

  it("사라진 pending 항목은 지우고, 손댄 항목은 면제로 남긴다", async () => {
    const r = await projectLearnerDayPlan(sql, baseInput());
    await sql`
      update learner_day_plan_items set status = 'in_progress'
      where learner_day_plan_id = ${r.planId} and item_key = 'b'
    `;

    /* a(pending)와 b(in_progress)가 둘 다 새 투영에서 빠진다 */
    await projectLearnerDayPlan(sql, baseInput({ items: [itemSpec({ key: "z" })] }));

    const rows = await itemRows(r.planId);
    expect(rows.find((x) => x.key === "a")).toBeUndefined();
    expect(rows.find((x) => x.key === "b")!.status).toBe("exempted");
    expect(rows.find((x) => x.key === "z")).toBeDefined();
  });

  it("pending 항목의 제목·차단 사유는 재투영이 갱신한다", async () => {
    const r = await projectLearnerDayPlan(sql, baseInput());

    await projectLearnerDayPlan(
      sql,
      baseInput({
        items: [
          itemSpec({ key: "a", titleSnapshot: "바뀐 제목" }),
          itemSpec({ key: "b", status: "blocked", blockedReason: "no_questions" }),
        ],
      }),
    );

    const rows = await itemRows(r.planId);
    expect(rows.find((x) => x.key === "a")!.title_snapshot).toBe("바뀐 제목");
    expect(rows.find((x) => x.key === "b")!.status).toBe("blocked");
  });

  it("완료된 계획은 재투영 대상이 아니다", async () => {
    const r = await projectLearnerDayPlan(sql, baseInput());
    await sql`
      update learner_day_plan_items set status = 'completed', completed_at = now()
      where learner_day_plan_id = ${r.planId}
    `;
    await sql`
      update learner_day_plans set status = 'completed', completed_at = now()
      where id = ${r.planId}
    `;

    const again = await projectLearnerDayPlan(
      sql,
      baseInput({ items: [itemSpec({ key: "새항목" })] }),
    );

    expect(again.skippedCompleted).toBe(true);
    const rows = await itemRows(r.planId);
    expect(rows.find((x) => x.key === "새항목")).toBeUndefined();
    expect(rows.every((x) => x.status === "completed")).toBe(true);
  });
});

describe.skipIf(!hasDb)("읽기 — 화면이 쓰는 모양 그대로", () => {
  it("계획과 항목을 ordinal 순으로 되돌려준다", async () => {
    await projectLearnerDayPlan(
      sql,
      baseInput({
        items: [
          itemSpec({ key: "b", ordinal: 2, titleSnapshot: "둘째" }),
          itemSpec({ key: "a", ordinal: 1, titleSnapshot: "첫째", kind: "video" }),
          itemSpec({
            key: "c",
            ordinal: 3,
            required: false,
            status: "blocked",
            blockedReason: "no_questions",
            titleSnapshot: "셋째",
          }),
        ],
      }),
    );

    const plan = await getLearnerDayPlan(sql, {
      organizationId: ORG,
      learnerId: LEARNER,
      planDate: currentDate,
    });

    expect(plan).not.toBeNull();
    /* c가 차단이지만 **선택**이라 하루는 막히지 않는다 (ADR-0017 §3) —
     * 학생에게 알리되 완주는 할 수 있다. */
    expect(plan!.status).toBe("not_started");
    expect(plan!.completedAt).toBeNull();
    expect(plan!.reopenedAt).toBeNull();
    expect(plan!.items.map((i) => i.key)).toEqual(["a", "b", "c"]);
    expect(plan!.items[0]!.kind).toBe("video");
    expect(plan!.items[0]!.titleSnapshot).toBe("첫째");
    expect(plan!.items[2]!.required).toBe(false);
    expect(plan!.items[2]!.blockedReason).toBe("no_questions");
    expect(plan!.items[2]!.addedAfterMaterialization).toBe(false);
  });

  it("필수 항목이 차단되면 하루가 blocked다", async () => {
    /* 선택 항목의 차단(위 테스트)과 갈라지는 지점. 필수 하나가 막히면
     * 나머지를 다 해도 완주가 아니다 — 판정 순서가 곧 우선순위다. */
    await projectLearnerDayPlan(
      sql,
      baseInput({
        items: [
          itemSpec({ key: "done", status: "pending" }),
          itemSpec({
            key: "stuck",
            required: true,
            status: "blocked",
            blockedReason: "material_missing",
          }),
        ],
      }),
    );

    const plan = await getLearnerDayPlan(sql, {
      organizationId: ORG,
      learnerId: LEARNER,
      planDate: currentDate,
    });

    expect(plan!.status).toBe("blocked");
    expect(plan!.items.find((i) => i.key === "stuck")!.blockedReason).toBe(
      "material_missing",
    );
  });
});

describe.skipIf(!hasDb)("투영기는 완료로 넘기지 않는다", () => {
  it("필수가 전부 충족돼도 status는 completed가 되지 않고 completable만 선다", async () => {
    /* 완료는 completed_at 설정과 LearnerDayCompleted 발행을 같은 트랜잭션에서
     * 하는 별도 명령(T4.1)의 몫이다. 투영기가 조용히 넘기면 이벤트가 영영
     * 발행되지 않고, 숙련도·일정 엔진은 그 하루를 못 본다.
     *
     * 이 규칙이 없을 때 실제로 completed_at 없는 completed 행을 만들려다
     * learner_day_plans_completed_pair 체크 제약에 걸렸다. */
    const r = await projectLearnerDayPlan(sql, baseInput());
    await sql`
      update learner_day_plan_items set status = 'completed', completed_at = now()
      where learner_day_plan_id = ${r.planId}
    `;

    const again = await projectLearnerDayPlan(sql, baseInput());

    expect(again.completable).toBe(true);
    expect(again.status).toBe("in_progress");
    expect(again.status).not.toBe("completed");

    const [row] = await sql<{ status: string; completed_at: string | null }[]>`
      select status::text, completed_at::text from learner_day_plans where id = ${r.planId}
    `;
    expect(row!.status).toBe("in_progress");
    expect(row!.completed_at).toBeNull();
  });

  it("필수가 남아 있으면 completable이 서지 않는다", async () => {
    const r = await projectLearnerDayPlan(sql, baseInput());
    expect(r.completable).toBe(false);
  });
});

describe.skipIf(!hasDb)("완료 불변 (I-22)", () => {
  it("completed_at은 일반 UPDATE로 지워지지 않는다", async () => {
    const r = await projectLearnerDayPlan(sql, baseInput());
    await sql`
      update learner_day_plans set status = 'completed', completed_at = now() where id = ${r.planId}
    `;

    await expect(
      sql`update learner_day_plans set completed_at = null where id = ${r.planId}`,
    ).rejects.toThrow();
    await expect(
      sql`update learner_day_plans set status = 'in_progress' where id = ${r.planId}`,
    ).rejects.toThrow();
  });

  it("완료 계획을 지울 수 없다", async () => {
    const r = await projectLearnerDayPlan(sql, baseInput());
    await sql`
      update learner_day_plans set status = 'completed', completed_at = now() where id = ${r.planId}
    `;

    await expect(
      sql`delete from learner_day_plans where id = ${r.planId}`,
    ).rejects.toThrow();
  });

  it("완료 취소는 reopened_at을 더할 뿐 completed_at을 남긴다", async () => {
    const r = await projectLearnerDayPlan(sql, baseInput());
    await sql`
      update learner_day_plans set status = 'completed', completed_at = now() where id = ${r.planId}
    `;

    await sql`
      update learner_day_plans
      set status = 'in_progress', reopened_at = now(), reopen_reason = '오조작'
      where id = ${r.planId}
    `;

    const [row] = await sql<{ completed_at: string | null; reopened_at: string | null }[]>`
      select completed_at::text, reopened_at::text from learner_day_plans where id = ${r.planId}
    `;
    expect(row!.completed_at).not.toBeNull();
    expect(row!.reopened_at).not.toBeNull();
  });
});

describe.skipIf(!hasDb)("조직 격리", () => {
  it("다른 조직의 같은 학생·날짜는 별개 계획이다", async () => {
    await seedOrg(OTHER_ORG, OTHER_LEARNER);
    const mine = await projectLearnerDayPlan(sql, baseInput());
    const theirs = await projectLearnerDayPlan(
      sql,
      baseInput({ organizationId: OTHER_ORG, learnerId: OTHER_LEARNER, learningGroupId: null }),
    );

    expect(theirs.planId).not.toBe(mine.planId);
  });

  it("조회는 조직 밖으로 넘어가지 않는다", async () => {
    await projectLearnerDayPlan(sql, baseInput());

    const found = await getLearnerDayPlan(sql, {
      organizationId: OTHER_ORG,
      learnerId: LEARNER,
      planDate: currentDate,
    });
    expect(found).toBeNull();
  });

  it("RLS가 켜져 있다", async () => {
    const rows = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      select relname, relrowsecurity from pg_class
      where relname in ('learner_day_plans', 'learner_day_plan_items')
    `;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });
});

describe.skipIf(!hasDb)("계획층(②)을 건드리지 않는다", () => {
  it("하루 계획 투영이 sessions·learner_schedule_items 행 수를 바꾸지 않는다", async () => {
    const count = async (table: string) => {
      const [row] = await sql<{ cnt: number }[]>`
        select count(*)::int as cnt from ${sql(table)} where organization_id = ${ORG}
      `;
      return row!.cnt;
    };

    const before = [await count("sessions"), await count("learner_schedule_items")];
    await projectLearnerDayPlan(sql, baseInput());
    const after = [await count("sessions"), await count("learner_schedule_items")];

    expect(after).toEqual(before);
  });
});

describe.skipIf(!hasDb)("첫 투영이 겹쳐도 학생 화면이 죽지 않는다", () => {
  it("같은 학생·같은 날짜를 동시에 처음 투영해도 한 계획만 생긴다", async () => {
    /* 학생이 「오늘 학습」을 여는 순간이 그 하루의 **첫 투영**이다. 그 요청이
     * 둘 겹치는 일은 드물지 않다 — 탭 두 개, 라우터 프리페치, 새로 고침 연타.
     *
     * 예전 구현은 `select … for update`로 기존 계획을 찾고 없으면 insert
     * 했는데, **없는 행에는 잠글 것이 없다.** 둘 다 「없음」을 보고 둘 다
     * 넣으면 learner_day_plans_uq가 뒤엣것을 막고, 그 예외가 그대로 올라가
     * 학생은 「화면을 여는 중 오류가 났습니다」를 만난다. 유니크 인덱스는
     * 두 행이 생기는 것을 막으려고 둔 것이지 화면을 죽이라고 둔 것이 아니다.
     * (T6.2 자율 E2E에서 학생의 첫 로그인이 실제로 이 500을 만났다.) */
    /* 넷을 겹친다. 둘로는 앞엣것이 먼저 커밋해 버려 경합이 안 나는 실행이
     * 섞인다 — 재현되지 않는 회귀 테스트는 없는 것과 같다. */
    const input = baseInput();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => projectLearnerDayPlan(sql, input)),
    );

    // 전부 성공하고, 같은 계획을 가리킨다
    expect(new Set(results.map((r) => r.planId)).size).toBe(1);
    // 「내가 만들었다」고 말하는 쪽은 하나뿐이다
    expect(results.filter((r) => r.created)).toHaveLength(1);

    const rows = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from learner_day_plans
      where organization_id = ${ORG} and learner_id = ${LEARNER}
        and plan_date = ${input.planDate}
    `;
    expect(rows[0]!.cnt).toBe(1);

    // 항목도 한 벌만 — 두 투영이 같은 키를 두 번 넣지 않는다
    const items = await itemRows(results[0]!.planId);
    expect(items.map((i) => i.key).sort()).toEqual(["a", "b"]);
  });
});
