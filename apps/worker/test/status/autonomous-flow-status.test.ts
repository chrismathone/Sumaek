import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { createSql } from "@su-maek/db";
import {
  collectAutonomousFlowStatus,
  type AutonomousFlowStatus,
} from "../../src/status/autonomous-flow";

/* ─────────────────────────────────────────────────────────────
 * 자율 하루가 지금 굴러가고 있는가 (T6.4).
 *
 * `pnpm --filter @su-maek/worker status`는 「워커가 살아 있는가」에 답한다.
 * 그것으로는 부족하다 — 워커가 멀쩡히 살아 있는데도 학생 화면에 시험이
 * 안 뜨는 경우가 있고, 그때 운영자가 보는 화면은 전부 초록이다.
 *
 * 여기서 답하는 질문은 다르다: **오늘 수업이 실제로 성립하는가.**
 *   ① 수업은 잡혀 있는데 평가가 아직 없다        (생성 누락)
 *   ② 학생 하루 계획에 「지금 할 수 없는」 항목이 있다 (차단)
 *   ③ 완료 이벤트가 배달되지 않고 쌓이고 있다       (적체)
 *   ④ 박동이 끊긴 워커가 있다                      (죽음)
 *
 * 넷은 서로 다른 사람이 서로 다른 시각에 고친다. 그래서 하나의 「이상 있음」
 * 으로 뭉치지 않고 각각을 따로 세고, 각각에 **다음에 할 일**을 붙인다.
 *
 * 판정은 조회 결과를 받는 순수 함수가 하고(`decideVerdict`), 질의는 그
 * 함수가 먹을 수치를 세는 일만 한다 — DB 없이도 판정을 검사할 수 있게.
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
const TZ = "Asia/Seoul";
const ORG = "ffffffff-0000-7000-8000-000000064001";

let sql: ReturnType<typeof createSql>;

const TEACHER = uuidv7();
const PERIOD = uuidv7();
const GROUP = uuidv7();
const LEARNER = uuidv7();
const NODE_LESSON = uuidv7();
const NODE_TEST = uuidv7();
const PLAN = uuidv7();
const VERSION = uuidv7();
const SESSION = uuidv7();

function isoAddDays(days: number): string {
  const base = new Date(
    new Date().toLocaleDateString("en-CA", { timeZone: TZ }) + "T00:00:00Z",
  );
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
const TODAY = isoAddDays(0);

async function cleanup(): Promise<void> {
  await sql`delete from assessment_instances where organization_id = ${ORG}`;
  await sql`delete from outbox_events where organization_id = ${ORG}`;
  await sql`alter table learner_day_plans disable trigger learner_day_plans_completion_immutable`;
  await sql`delete from learner_day_plan_items where learner_day_plan_id in (
    select id from learner_day_plans where organization_id = ${ORG})`;
  await sql`delete from learner_day_plans where organization_id = ${ORG}`;
  await sql`alter table learner_day_plans enable trigger learner_day_plans_completion_immutable`;
  await sql`delete from sessions where organization_id = ${ORG}`;
  await sql`delete from route_nodes where organization_id = ${ORG}`;
  await sql`delete from route_versions where organization_id = ${ORG}`;
  await sql`delete from route_plans where organization_id = ${ORG}`;
  await sql`delete from learning_group_memberships where organization_id = ${ORG}`;
  await sql`delete from learners where organization_id = ${ORG}`;
  await sql`delete from learning_groups where organization_id = ${ORG}`;
  await sql`delete from course_periods where organization_id = ${ORG}`;
  await sql`delete from memberships where organization_id = ${ORG}`;
  await sql`delete from users where default_organization_id = ${ORG}`;
}

beforeAll(async () => {
  if (!hasDb) return;
  sql = createSql();
  await sql`
    insert into organizations (id, name, slug, timezone)
    values (${ORG}, 'ITEST 자율 상태', 'itest-autonomous-status', ${TZ})
    on conflict (id) do nothing
  `;
  await cleanup();

  await sql`
    insert into users (id, email, display_name, default_organization_id)
    values (${TEACHER}, ${`t64-${TEACHER}@su-maek.test`}, 'ITEST 교사', ${ORG})
  `;
  await sql`
    insert into memberships (id, organization_id, user_id, role, status)
    values (${uuidv7()}, ${ORG}, ${TEACHER}, 'teacher', 'active')
  `;
  await sql`
    insert into course_periods
      (id, organization_id, name, academic_year, starts_on, ends_on, status)
    values (${PERIOD}, ${ORG}, 'ITEST 기간', 2026, ${isoAddDays(-10)},
            ${isoAddDays(60)}, 'active')
  `;
  await sql`
    insert into learning_groups (id, organization_id, course_period_id, name, status)
    values (${GROUP}, ${ORG}, ${PERIOD}, 'ITEST 상태반', 'operating')
  `;
  await sql`
    insert into learners (id, organization_id, display_name, status)
    values (${LEARNER}, ${ORG}, 'ITEST 상태 학생', 'active')
  `;
  await sql`
    insert into learning_group_memberships
      (id, organization_id, learning_group_id, learner_id, status, joined_on)
    values (${uuidv7()}, ${ORG}, ${GROUP}, ${LEARNER}, 'active', ${isoAddDays(-10)})
  `;
  await sql`
    insert into route_plans (
      id, organization_id, kind, name, learning_group_id, course_period_id,
      status, active_version_id)
    values (${PLAN}, ${ORG}, 'group_route', 'ITEST 루트', ${GROUP}, ${PERIOD},
            'published', ${VERSION})
  `;
  await sql`
    insert into route_versions (id, organization_id, route_plan_id, version_number, status)
    values (${VERSION}, ${ORG}, ${PLAN}, 1, 'published')
  `;
  await sql`
    insert into route_nodes (
      id, organization_id, route_version_id, kind, title, sort_order, concept_ids)
    values
      (${NODE_LESSON}, ${ORG}, ${VERSION}, 'concept_lesson', 'ITEST 개념 차시', 1, '[]'::jsonb),
      (${NODE_TEST}, ${ORG}, ${VERSION}, 'daily_test', 'ITEST 일일테스트', 2, '[]'::jsonb)
  `;
  /* 오늘 수업 — 평가 노드가 있는데 평가는 만들지 않는다. 그것이 ①이다. */
  await sql`
    insert into sessions (
      id, organization_id, learning_group_id, session_date, timezone,
      starts_at, ends_at, status, planned_node_ids)
    values (${SESSION}, ${ORG}, ${GROUP}, ${TODAY}::date, ${TZ},
            ${`${TODAY}T07:00:00Z`}, ${`${TODAY}T09:00:00Z`}, 'planned',
            ${sql.json([NODE_LESSON, NODE_TEST] as never)})
  `;
});

afterAll(async () => {
  if (!hasDb) return;
  await cleanup();
  await sql.end({ timeout: 5 });
});

describe.skipIf(!hasDb)("자율 흐름 상태 — 평가 생성 누락", () => {
  let status: AutonomousFlowStatus;

  beforeAll(async () => {
    status = await collectAutonomousFlowStatus(sql, { organizationId: ORG });
  });

  it("평가 노드가 있는 오늘 수업에 평가가 없으면 잡아낸다", () => {
    /* 이것이 「워커는 살아 있는데 학생 화면에 시험이 없다」의 정체다.
     * 워커 생존만 보는 화면에서는 전부 초록으로 보인다. */
    expect(status.missingAssessments.length).toBe(1);
    const [missing] = status.missingAssessments;
    expect(missing!.learningGroupName).toBe("ITEST 상태반");
    expect(missing!.planDate).toBe(TODAY);
    expect(missing!.purpose).toBe("formative");
  });

  it("무엇을 하면 되는지가 함께 온다", () => {
    /* 「누락 1건」만으로는 아무것도 못 한다. 다음 행동이 붙어야 화면이 된다. */
    expect(status.findings.map((f) => f.code)).toContain("assessment_missing");
    const finding = status.findings.find((f) => f.code === "assessment_missing")!;
    expect(finding.action.length).toBeGreaterThan(10);
    expect(finding.severity).toBe("attention");
  });

  it("평가가 생기면 누락이 사라진다", async () => {
    await sql`
      insert into assessment_instances (
        id, organization_id, learning_group_id, purpose, title,
        scheduled_date, route_node_id, status, published_at)
      values (${uuidv7()}, ${ORG}, ${GROUP}, 'formative', 'ITEST 생성됨',
              ${TODAY}::date, ${NODE_TEST}, 'published', now())
    `;
    const after = await collectAutonomousFlowStatus(sql, { organizationId: ORG });
    expect(after.missingAssessments).toEqual([]);
    expect(after.findings.map((f) => f.code)).not.toContain("assessment_missing");
  });
});

describe.skipIf(!hasDb)("자율 흐름 상태 — 차단된 학생 하루", () => {
  it("차단 항목이 있는 계획을 사유별로 센다", async () => {
    const planId = uuidv7();
    await sql`
      insert into learner_day_plans (
        id, organization_id, learner_id, plan_date, timezone,
        learning_group_id, source, status, materialized_at, projection_hash)
      values (${planId}, ${ORG}, ${LEARNER}, ${TODAY}::date, ${TZ},
              ${GROUP}, 'group_session', 'blocked', now(), 'itest-hash')
    `;
    await sql`
      insert into learner_day_plan_items (
        id, learner_day_plan_id, organization_id, item_key, kind, required,
        status, blocked_reason, title_snapshot, ordinal)
      values (${uuidv7()}, ${planId}, ${ORG}, 'node:x', 'assessment', true,
              'blocked', 'assessment_not_generated', 'ITEST 막힌 항목', 0)
    `;

    const status = await collectAutonomousFlowStatus(sql, { organizationId: ORG });
    expect(status.blockedLearners).toBe(1);
    /* 사유를 뭉치지 않는다 — 고치러 가는 화면이 사유마다 다르다 */
    expect(status.blockedByReason).toEqual([
      { code: "assessment_not_generated", learners: 1 },
    ]);
    expect(status.findings.map((f) => f.code)).toContain("learners_blocked");
  });
});

describe.skipIf(!hasDb)("자율 흐름 상태 — 완료 이벤트 적체", () => {
  it("배달되지 않은 이벤트의 수와 최고령을 함께 낸다", async () => {
    /* 수만 보면 「10건 쌓였다」가 정상인지 사고인지 모른다. 나이가 붙어야
     * 「방금 생긴 10건」과 「두 시간 묵은 10건」이 갈린다. */
    await sql`
      insert into outbox_events (
        id, organization_id, aggregate_type, aggregate_id, aggregate_version,
        event_type, occurred_at, status)
      values (${uuidv7()}, ${ORG}, 'learner_day_plan', ${uuidv7()}, 1,
              'LearnerDayCompleted', now() - interval '31 minutes', 'pending')
    `;
    const status = await collectAutonomousFlowStatus(sql, { organizationId: ORG });
    expect(status.outbox.pending).toBeGreaterThanOrEqual(1);
    expect(status.outbox.oldestPendingMinutes).toBeGreaterThanOrEqual(30);
    expect(status.findings.map((f) => f.code)).toContain("outbox_backlog");
  });
});

describe.skipIf(!hasDb)("자율 흐름 상태 — 워커 생존", () => {
  it("살아 있는 워커가 없으면 가장 높은 심각도로 말한다", async () => {
    /* 워커가 없으면 위 셋이 전부 따라 무너진다 — 그러니 원인 하나를 먼저
     * 크게 말해야 한다. 증상 셋을 나란히 늘어놓으면 무엇부터 볼지 모른다. */
    const status = await collectAutonomousFlowStatus(sql, { organizationId: ORG });
    if (status.workers.alive === 0) {
      expect(status.verdict).toBe("down");
      expect(status.findings[0]!.code).toBe("worker_down");
    } else {
      /* 워커가 떠 있는 개발기에서 돌 수도 있다 — 그때는 죽음을 말하지 않는다 */
      expect(status.findings.map((f) => f.code)).not.toContain("worker_down");
    }
  });
});
