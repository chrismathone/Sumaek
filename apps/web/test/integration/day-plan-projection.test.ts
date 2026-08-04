import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSharedSql } from "@su-maek/db";
import { projectToday } from "@/lib/domain/day-plan";

/* ─────────────────────────────────────────────────────────────
 * 오늘 계획 투영기 (T1.3) — 라이브 DB 통합 테스트.
 *
 * G-01의 수정을 못 박는 자리다. 예전 오늘 화면은 배정을 훑을 때
 * `a.scheduled_date >= today - 90`으로 최근 90일을 통째로 긁어 왔다.
 * 두 달 전에 끝낸 테스트가 오늘 목록에 「끝남」으로 앉으면, 오늘 할 일이
 * 하나도 없는 날에도 화면이 완주한 것처럼 보인다.
 *
 * 겨누는 것:
 *  1. 과거의 끝난 평가는 오늘 계획에 아예 들어오지 않는다
 *  2. 91일 전과 89일 전이 똑같이 무관하다 — 90일은 경계가 아니다
 *  3. 미래 평가는 「예정」으로만 보이고 필수 분모에 들지 않는다
 *  4. 개별 일정이 있으면 반 공통 노드가 섞이지 않는다
 *  5. 같은 날짜 재조회가 결정론적이다
 *  6. 배정 스캔에 오늘 기준 상한이 남아 있다 (무제한 스캔이 아니다)
 *
 * 시드된 데모 조직의 개념·자료를 읽기만 하고, 쓰는 것(학습자·반·일정·
 * 평가)은 전부 이 스펙이 만들고 지운다.
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
const ORG = "00000000-0000-7000-8000-000000000001";
const TZ = "Asia/Seoul";

/** 시드 루트 노드 — 각각 다른 개념을 가리킨다 (개별 vs 반 공통 구분용) */
const NODE_INDIVIDUAL = "00000000-0000-7000-8000-000000000401";
const NODE_GROUP = "00000000-0000-7000-8000-000000000400";
/** NODE_INDIVIDUAL이 가리키는 개념 — 자료·복습을 여기에 붙인다 */
const CONCEPT_INDIVIDUAL = "019fb7c5-8f3d-774a-988f-ae61e82181e1";

const LEARNER = uuidv7();
const PERIOD = uuidv7();
const GROUP = uuidv7();

function isoAddDays(days: number): string {
  const base = new Date(
    new Date().toLocaleDateString("en-CA", { timeZone: TZ }) + "T00:00:00Z",
  );
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
const TODAY = isoAddDays(0);

let sql: ReturnType<typeof getSharedSql>;
const assessmentIds: string[] = [];
/** 시드 문항 하나 — 문항 수를 0이 아니게 만들 때만 쓴다 (내용은 보지 않는다) */
let seedQuestion: { id: string; versionId: string; checksum: string } | null = null;

/** 평가 1건 + 배정 1건. `attemptStatus`를 주면 응시까지 만든다. */
async function makeAssessment(input: {
  scheduledDate: string;
  title: string;
  attemptStatus?: "in_progress" | "finalized";
  /** 문항을 한 개 붙인다 — 없으면 문항 0개라 차단으로 나온다 */
  withQuestion?: boolean;
}): Promise<string> {
  const id = uuidv7();
  assessmentIds.push(id);
  await sql`
    insert into assessment_instances
      (id, organization_id, purpose, title, learning_group_id, scheduled_date, status, published_at)
    values (${id}, ${ORG}, 'formative', ${input.title}, ${GROUP},
            ${input.scheduledDate}, 'published', now())
  `;
  await sql`
    insert into assignments (id, organization_id, assessment_id, learner_id, status)
    values (${uuidv7()}, ${ORG}, ${id}, ${LEARNER}, 'assigned')
  `;
  if (input.withQuestion && seedQuestion) {
    await sql`
      insert into assessment_questions
        (id, organization_id, assessment_id, question_id, question_version_id,
         content_checksum, sort_order, points, answer_snapshot, concept_weights,
         selection_reason)
      values (${uuidv7()}, ${ORG}, ${id}, ${seedQuestion.id}, ${seedQuestion.versionId},
              ${seedQuestion.checksum}, 1, 10, '{}'::jsonb, '{}'::jsonb, 'test-fixture')
    `;
  }
  if (input.attemptStatus) {
    await sql`
      insert into attempts
        (id, organization_id, assessment_id, learner_id, attempt_no, status,
         started_at, submitted_at)
      values (${uuidv7()}, ${ORG}, ${id}, ${LEARNER}, 1, ${input.attemptStatus},
              now(), ${input.attemptStatus === "finalized" ? sql`now()` : null})
    `;
  }
  return id;
}

beforeAll(async () => {
  if (!hasDb) return;
  sql = getSharedSql();

  const [q] = await sql<{ id: string; version_id: string; checksum: string }[]>`
    select qv.question_id::text as id, qv.id::text as version_id,
           coalesce(qv.content_checksum, 'seed') as checksum
    from question_versions qv
    where qv.organization_id = ${ORG}
    limit 1
  `;
  seedQuestion = q
    ? { id: q.id, versionId: q.version_id, checksum: q.checksum }
    : null;

  await sql`
    insert into learners (id, organization_id, display_name, status)
    values (${LEARNER}, ${ORG}, ${"투영 테스트 학생"}, 'active')
  `;
  await sql`
    insert into course_periods
      (id, organization_id, name, academic_year, starts_on, ends_on, status)
    values (${PERIOD}, ${ORG}, '투영 테스트 기간', 2026, ${isoAddDays(-120)},
            ${isoAddDays(120)}, 'active')
  `;
  await sql`
    insert into learning_groups (id, organization_id, course_period_id, name, status)
    values (${GROUP}, ${ORG}, ${PERIOD}, '투영 테스트 반', 'operating')
  `;
  await sql`
    insert into learning_group_memberships
      (id, organization_id, learning_group_id, learner_id, joined_on, status)
    values (${uuidv7()}, ${ORG}, ${GROUP}, ${LEARNER}, ${isoAddDays(-30)}, 'active')
  `;

  /* 반 공통 수업 — 개별 일정이 있을 때 섞이면 안 되는 쪽 */
  await sql`
    insert into sessions
      (id, organization_id, learning_group_id, session_date, timezone,
       starts_at, ends_at, status, planned_node_ids)
    values (${uuidv7()}, ${ORG}, ${GROUP}, ${TODAY}, ${TZ},
            ${`${TODAY}T13:00:00Z`}, ${`${TODAY}T14:00:00Z`}, 'planned',
            ${sql.json([NODE_GROUP])})
  `;

  await makeAssessment({ scheduledDate: isoAddDays(-91), title: "91일 전 끝낸 시험", attemptStatus: "finalized" });
  await makeAssessment({ scheduledDate: isoAddDays(-89), title: "89일 전 끝낸 시험", attemptStatus: "finalized" });
  await makeAssessment({ scheduledDate: TODAY, title: "오늘 시험" });
  await makeAssessment({ scheduledDate: isoAddDays(3), title: "사흘 뒤 시험" });
});

afterAll(async () => {
  if (!hasDb) return;
  await sql`alter table learner_day_plans disable trigger learner_day_plans_completion_immutable`;
  await sql`delete from learner_day_plans where learner_id = ${LEARNER}`;
  await sql`alter table learner_day_plans enable trigger learner_day_plans_completion_immutable`;
  await sql`delete from attempts where learner_id = ${LEARNER}`;
  await sql`delete from assignments where learner_id = ${LEARNER}`;
  await sql`delete from assessment_instances where id = any(${assessmentIds}::uuid[])`;
  await sql`delete from learner_schedule_items where learner_id = ${LEARNER}`;
  await sql`delete from sessions where learning_group_id = ${GROUP}`;
  await sql`delete from learning_group_memberships where learner_id = ${LEARNER}`;
  await sql`delete from learning_groups where id = ${GROUP}`;
  await sql`delete from course_periods where id = ${PERIOD}`;
  await sql`delete from learners where id = ${LEARNER}`;
});

/**
 * 개별 일정을 오늘 하나 만든다 (반 공통보다 우선해야 한다).
 *
 * 멱등이다 — learner_schedule_items에는 학습자 시간 충돌 EXCLUDE 제약이
 * 있어서(0007a) 같은 시간대에 두 번 넣으면 거부된다.
 */
async function giveIndividualSchedule() {
  const [existing] = await sql<{ id: string }[]>`
    select id::text from learner_schedule_items
    where learner_id = ${LEARNER} and item_date = ${TODAY}::date
  `;
  if (existing) return;
  await sql`
    insert into learner_schedule_items
      (id, organization_id, learner_id, learning_group_id, item_date, timezone,
       starts_at, ends_at, planned_node_ids, matches_group)
    values (${uuidv7()}, ${ORG}, ${LEARNER}, ${GROUP}, ${TODAY}, ${TZ},
            ${`${TODAY}T13:00:00Z`}, ${`${TODAY}T14:00:00Z`},
            ${sql.json([NODE_INDIVIDUAL])}, false)
  `;
}

const learnerRef = { organizationId: ORG, learnerId: LEARNER };

describe.skipIf(!hasDb)("날짜 경계 — 90일은 경계가 아니다", () => {
  it("과거의 끝난 평가는 오늘 계획에 들어오지 않는다", async () => {
    const view = await projectToday({ learner: learnerRef, today: TODAY });

    const titles = view.plan.items.map((i) => i.titleSnapshot ?? "");
    expect(titles.join(" ")).not.toContain("91일 전");
    expect(titles.join(" ")).not.toContain("89일 전");
  });

  it("91일 전과 89일 전이 똑같이 취급된다", async () => {
    const view = await projectToday({ learner: learnerRef, today: TODAY });
    const all = [...view.plan.items, ...view.plan.deferred, ...view.plan.overdue];
    const past = all.filter((i) => (i.titleSnapshot ?? "").includes("일 전"));

    expect(past).toHaveLength(0);
  });

  it("오늘 평가는 필수 항목으로 들어온다", async () => {
    const view = await projectToday({ learner: learnerRef, today: TODAY });
    const todayTest = view.plan.items.find(
      (i) => i.kind === "assessment" && (i.titleSnapshot ?? "").includes("오늘 시험"),
    );

    expect(todayTest).toBeDefined();
    expect(todayTest!.required).toBe(true);
    /* 이 fixture의 평가에는 문항이 없다 — 문항 0개 평가는 차단으로 나와야
     * 한다. 게시됐는데 풀 것이 없으면 학생은 눌러도 아무것도 못 하고,
     * 그 사실이 교사에게 닿아야 한다 (G-06과 같은 성질). */
    expect(todayTest!.status).toBe("blocked");
    expect(todayTest!.blockedReason).toBe("no_questions");
  });

  it("응시 중인 평가는 진행으로 나온다", async () => {
    const id = await makeAssessment({
      scheduledDate: TODAY,
      title: "풀던 시험",
      attemptStatus: "in_progress",
      withQuestion: true,
    });
    try {
      const view = await projectToday({ learner: learnerRef, today: TODAY });
      const item = view.plan.items.find((i) => i.refId === id);

      expect(item!.status).toBe("in_progress");
      expect(item!.blockedReason).toBeNull();
    } finally {
      await sql`delete from attempts where assessment_id = ${id}`;
      await sql`delete from assignments where assessment_id = ${id}`;
      await sql`delete from assessment_questions where assessment_id = ${id}`;
      await sql`delete from assessment_instances where id = ${id}`;
    }
  });

  it("오늘 끝낸 평가는 완료로 남는다 — 사라지지 않는다", async () => {
    /* 과거의 끝난 평가는 떨구지만 **오늘** 끝낸 것은 남아야 한다.
     * 없애면 방금 시험을 마친 학생의 화면에서 그 칸이 통째로 사라진다. */
    const id = await makeAssessment({
      scheduledDate: TODAY,
      title: "오늘 끝낸 시험",
      attemptStatus: "finalized",
      withQuestion: true,
    });
    try {
      const view = await projectToday({ learner: learnerRef, today: TODAY });
      const item = view.plan.items.find((i) => i.refId === id);

      expect(item).toBeDefined();
      expect(item!.status).toBe("completed");
    } finally {
      await sql`delete from attempts where assessment_id = ${id}`;
      await sql`delete from assignments where assessment_id = ${id}`;
      await sql`delete from assessment_questions where assessment_id = ${id}`;
      await sql`delete from assessment_instances where id = ${id}`;
    }
  });

  it("미래 평가는 예정으로만 보이고 필수 분모에 들지 않는다", async () => {
    const view = await projectToday({ learner: learnerRef, today: TODAY });

    const upcoming = view.plan.deferred.find((i) => i.kind === "assessment");
    expect(upcoming!.titleSnapshot).toContain("사흘 뒤");
    expect(view.plan.items.some((i) => (i.titleSnapshot ?? "").includes("사흘 뒤"))).toBe(false);
  });

  it("배정 질의에 오늘 기준 상한이 남아 있다 — 무제한 스캔이 아니다", async () => {
    /* 90일 창을 없애면서 상한 자체를 지우면 학기가 지날수록 이 스캔이
     * 끝없이 자란다. 창의 기준이 오늘로 바뀌었을 뿐 상한은 규격이다. */
    const view = await projectToday({ learner: learnerRef, today: TODAY });
    expect(view.assignmentWindow.from <= TODAY).toBe(true);
    expect(view.assignmentWindow.to >= TODAY).toBe(true);
  });
});

describe.skipIf(!hasDb)("일정 우선순위", () => {
  it("개별 일정이 없으면 반 공통으로 물러선다", async () => {
    const view = await projectToday({ learner: learnerRef, today: TODAY });

    expect(view.source).toBe("group_session");
    expect(view.scope.nodeIds).toEqual([NODE_GROUP]);
  });

  it("개별 일정이 있으면 반 공통 노드가 섞이지 않는다", async () => {
    await giveIndividualSchedule();
    const view = await projectToday({ learner: learnerRef, today: TODAY });

    expect(view.source).toBe("learner_schedule");
    expect(view.scope.nodeIds).toEqual([NODE_INDIVIDUAL]);
    expect(view.scope.nodeIds).not.toContain(NODE_GROUP);
  });
});

describe.skipIf(!hasDb)("차단과 복습", () => {
  it("문항 0개 연습 자료는 차단으로 나온다 — 학생이 영원히 대기하지 않게", async () => {
    /* G-06. 자료는 게시돼 있는데 문항이 하나도 없으면 학생 화면에서는
     * 「할 차례」로 보이고 눌러도 아무것도 없다. 차단으로 내야 교사에게
     * 닿는다. */
    const material = uuidv7();
    await sql`
      insert into learning_materials
        (id, organization_id, concept_id, kind, title, question_ids, status)
      values (${material}, ${ORG}, ${CONCEPT_INDIVIDUAL}, 'practice',
              ${"빈 연습 자료"}, '[]'::jsonb, 'published')
    `;
    try {
      await giveIndividualSchedule();
      const view = await projectToday({ learner: learnerRef, today: TODAY });
      const empty = view.plan.items.find((i) => i.refId === material);

      expect(empty).toBeDefined();
      expect(empty!.status).toBe("blocked");
      expect(empty!.blockedReason).toBe("no_questions");
      expect(view.plan.status).toBe("blocked");
      expect(view.plan.blockedReasons).toContain("no_questions");
    } finally {
      await sql`delete from learning_materials where id = ${material}`;
    }
  });

  it("기한이 지난 복습은 오늘 필수에 든다", async () => {
    /* ADR-0017 §5의 유일한 예외 — 복습은 밀린 것이 곧 지금 할 것이다. */
    const review = uuidv7();
    await sql`
      insert into review_items
        (id, organization_id, learner_id, concept_id, source_kind, due_on, status)
      values (${review}, ${ORG}, ${LEARNER}, ${CONCEPT_INDIVIDUAL},
              'spaced_repetition', ${isoAddDays(-5)}, 'scheduled')
    `;
    try {
      const view = await projectToday({ learner: learnerRef, today: TODAY });
      const item = view.plan.items.find((i) => i.kind === "review");

      expect(item).toBeDefined();
      expect(item!.required).toBe(true);
      expect(item!.status).toBe("pending");
      expect(view.plan.overdue.some((i) => i.kind === "review")).toBe(false);
    } finally {
      await sql`delete from review_items where id = ${review}`;
    }
  });
});

describe.skipIf(!hasDb)("영속화와 결정론", () => {
  it("계획이 서버에 남고 같은 날짜 재조회가 같은 결과를 낸다", async () => {
    const first = await projectToday({ learner: learnerRef, today: TODAY });
    const second = await projectToday({ learner: learnerRef, today: TODAY });

    expect(first.planId).not.toBeNull();
    expect(second.planId).toBe(first.planId);
    expect(second.plan.items.map((i) => i.key)).toEqual(
      first.plan.items.map((i) => i.key),
    );
    expect(second.plan.required.total).toBe(first.plan.required.total);

    const [row] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from learner_day_plans
      where learner_id = ${LEARNER} and plan_date = ${TODAY}
    `;
    expect(row!.cnt).toBe(1);
  });

  it("읽기 전용 미리보기는 계획 행을 만들지 않는다", async () => {
    /* 교사 미리보기(T5.4)가 학생의 materialized_at을 앞당기면 ADR-0017 §4의
     * 스냅샷 시점이 무너진다. */
    const other = uuidv7();
    await sql`
      insert into learners (id, organization_id, display_name, status)
      values (${other}, ${ORG}, ${"미리보기 대상"}, 'active')
    `;

    const view = await projectToday({
      learner: { organizationId: ORG, learnerId: other },
      today: TODAY,
      persist: false,
    });

    expect(view.planId).toBeNull();
    const [row] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from learner_day_plans where learner_id = ${other}
    `;
    expect(row!.cnt).toBe(0);

    await sql`delete from learners where id = ${other}`;
  });
});
