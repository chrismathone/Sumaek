import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";

/* ─────────────────────────────────────────────────────────────
 * 반별 오늘 진행 읽기 모델 (T4.4) — 라이브 DB.
 *
 * 순수 판정은 `test/ui/teacher-day-progress.test.ts`가 본다. 여기서 보는
 * 것은 **질의가 그 판정에 맞는 행을 만드는가**이다.
 *
 * 가장 중요한 한 줄: 질의는 `learning_group_memberships`에서 시작한다.
 * `learner_day_plans`에서 시작하면 **오늘 화면을 한 번도 열지 않은 학생이
 * 목록에서 통째로 빠진다** — 그 학생이야말로 교사가 먼저 봐야 할 사람이다.
 * ───────────────────────────────────────────────────────────── */

const { getSharedSql } = await import("@su-maek/db");
const { listGroupDayProgress } = await import("@/lib/domain/day-progress");

const hasDb = Boolean(process.env.DATABASE_URL);
const ORG = "00000000-0000-7000-8000-000000000001";
const TZ = "Asia/Seoul";

let sql: ReturnType<typeof getSharedSql>;
const PERIOD = uuidv7();
const GROUP = uuidv7();
/** 하루를 마친 학생 · 막힌 학생 · 오늘 화면을 안 연 학생 */
const DONE = uuidv7();
const BLOCKED = uuidv7();
const SILENT = uuidv7();
const SESSION = uuidv7();

function isoAddDays(days: number): string {
  const base = new Date(
    new Date().toLocaleDateString("en-CA", { timeZone: TZ }) + "T00:00:00Z",
  );
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
const TODAY = isoAddDays(0);

async function makePlan(
  learnerId: string,
  status: string,
  items: Array<{ key: string; status: string; reason?: string }>,
): Promise<void> {
  const planId = uuidv7();
  await sql`
    insert into learner_day_plans
      (id, organization_id, learner_id, plan_date, timezone, learning_group_id,
       source, status, materialized_at, projection_hash,
       completed_at)
    values (${planId}, ${ORG}, ${learnerId}, ${TODAY}::date, ${TZ}, ${GROUP},
            'group_session', ${status}::learner_day_plan_status, now(), 'itest',
            ${status === "completed" ? new Date() : null})
  `;
  for (const [i, it] of items.entries()) {
    await sql`
      insert into learner_day_plan_items
        (id, organization_id, learner_day_plan_id, item_key, ordinal, kind,
         required, title_snapshot, status, blocked_reason, completed_at)
      values (${uuidv7()}, ${ORG}, ${planId}, ${it.key}, ${i}, 'reading', true,
              ${it.key}, ${it.status}::learner_day_plan_item_status,
              ${it.reason ?? null},
              ${it.status === "completed" ? new Date() : null})
    `;
  }
}

async function group() {
  const list = await listGroupDayProgress({
    organizationId: ORG,
    date: TODAY,
    learningGroupId: GROUP,
  });
  return list[0]!;
}

beforeAll(async () => {
  if (!hasDb) return;
  sql = getSharedSql();
  await sql`
    insert into course_periods
      (id, organization_id, name, academic_year, starts_on, ends_on, status)
    values (${PERIOD}, ${ORG}, '현황판 기간', 2026, ${isoAddDays(-30)},
            ${isoAddDays(30)}, 'active')
  `;
  await sql`
    insert into learning_groups (id, organization_id, course_period_id, name, status)
    values (${GROUP}, ${ORG}, ${PERIOD}, '현황판 테스트반', 'operating')
  `;
  for (const [id, name] of [
    [DONE, "가완주"],
    [BLOCKED, "나막힘"],
    [SILENT, "다무기록"],
  ] as const) {
    await sql`
      insert into learners (id, organization_id, display_name, status)
      values (${id}, ${ORG}, ${name}, 'active')
    `;
    await sql`
      insert into learning_group_memberships
        (id, organization_id, learning_group_id, learner_id, status, joined_on)
      values (${uuidv7()}, ${ORG}, ${GROUP}, ${id}, 'active', ${isoAddDays(-30)})
    `;
  }

  await makePlan(DONE, "completed", [{ key: "a", status: "completed" }]);
  await makePlan(BLOCKED, "blocked", [
    { key: "a", status: "completed" },
    { key: "b", status: "blocked", reason: "no_questions" },
    { key: "c", status: "blocked", reason: "no_questions" },
  ]);
  /* SILENT은 계획 자체가 없다 — 오늘 화면을 열지 않았다 */

  await sql`
    insert into sessions (
      id, organization_id, learning_group_id, session_date, timezone,
      starts_at, ends_at, status, planned_node_ids)
    values (${SESSION}, ${ORG}, ${GROUP}, ${TODAY}::date, ${TZ},
            ${`${TODAY}T07:00:00Z`}, ${`${TODAY}T09:00:00Z`}, 'planned',
            ${sql.json([])})
  `;
});

afterAll(async () => {
  if (!hasDb) return;
  const learners = [DONE, BLOCKED, SILENT];
  await sql`alter table learner_day_plans disable trigger learner_day_plans_completion_immutable`;
  await sql`delete from learner_day_plans where learner_id = any(${learners}::uuid[])`;
  await sql`alter table learner_day_plans enable trigger learner_day_plans_completion_immutable`;
  await sql`delete from sessions where id = ${SESSION}`;
  await sql`delete from learning_group_memberships where learner_id = any(${learners}::uuid[])`;
  await sql`delete from learners where id = any(${learners}::uuid[])`;
  await sql`delete from learning_groups where id = ${GROUP}`;
  await sql`delete from course_periods where id = ${PERIOD}`;
});

describe.skipIf(!hasDb)("반별 오늘 진행 읽기 모델", () => {
  it("오늘 화면을 안 연 학생도 목록에 있다 — 기록 없음으로", async () => {
    /* 계획 테이블에서 시작했다면 이 학생은 통째로 빠진다. 그리고 그 학생은
     * 화면에 없으므로 아무도 그가 로그인하지 못했다는 것을 모른다. */
    const g = await group();
    const silent = g.learners.find((l) => l.learnerId === SILENT);

    expect(silent).toBeDefined();
    expect(silent!.status).toBe("no_record");
    expect(g.summary.counts.no_record).toBe(1);
    expect(g.summary.counts.not_started).toBe(0);
  });

  it("막힘 사유를 학생 수로 센다 — 항목 수가 아니라", async () => {
    /* 나막힘은 같은 사유로 두 항목이 막혀 있다. 두 명으로 세면 반 인원(3명)
     * 보다 막힌 사람이 많아지는 날이 온다. */
    const g = await group();
    expect(g.summary.blocked).toEqual([
      { code: "no_questions", category: "question", learners: 1 },
    ]);
  });

  it("완료 기록이 상태와 함께 온다", async () => {
    const g = await group();
    const done = g.learners.find((l) => l.learnerId === DONE)!;
    expect(done.status).toBe("completed");
    expect(done.completedAt).not.toBeNull();
    expect(done.requiredSatisfied).toBe(1);
  });

  it("반 수업 마감은 학생 완료와 다른 칸이다 (I-21)", async () => {
    /* 한 명이 하루를 마쳤어도 반 수업은 planned 그대로다. 두 사실을 한 칸에
     * 넣으면 교사가 마감하지 않은 반이 마감된 것처럼 보인다. */
    const g = await group();
    expect(g.session?.status).toBe("planned");
    expect(g.session?.closedAt).toBeNull();
    expect(g.summary.counts.completed).toBe(1);
  });

  it("먼저 볼 학생만 편다 — 완주한 학생은 오지 않는다", async () => {
    const g = await group();
    const ids = g.summary.attention.map((r) => r.learnerId);
    expect(ids).toEqual([BLOCKED, SILENT]);
    expect(ids).not.toContain(DONE);
  });
});
