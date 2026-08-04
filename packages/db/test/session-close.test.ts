import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";

/* ─────────────────────────────────────────────────────────────
 * 반 수업 마감 (T4.2 · E-02) — 라이브 DB.
 *
 * `SessionCompleted` 계약은 0단계부터 있었고 소비자(schedule.recalculate ·
 * readmodel.refresh)까지 배선돼 있었지만, **발행하는 곳이 없었다**(G-03).
 * 그래서 수업은 영원히 `planned`에 머문다 — 실측으로 과거 `planned` 수업이
 * 83건 쌓여 있었고, 그중 하나가 R-05 검사에 걸려 드러났다.
 *
 * 마감은 학생의 하루 완료(E-16)와 **다른 사건**이다 (I-21 · ADR-0017 §1):
 *   학생 완료 = 그 학생이 자기 몫을 끝냈다
 *   반 마감   = 교사가 이 차시에서 실제로 어디까지 나갔다고 확인했다
 * 한 명이 다 했다고 반이 끝나지 않고, 반이 끝났다고 학생 하루가 끝나지 않는다.
 *
 * 겨누는 것:
 *   1) 실제 진행이 planned 노드 집합과 대조된다 — 계획에 없는 노드는 못 적는다
 *   2) progress_events와 SessionCompleted가 같은 트랜잭션이다 (I-21)
 *   3) 완료된 수업은 재마감되지 않는다 — 이벤트도 하나
 *   4) 반 마감이 학생 하루를 완료시키지 않는다
 * ───────────────────────────────────────────────────────────── */

import { createSql } from "../src/client";
import {
  closeSession,
  listSessionsAwaitingClose,
} from "../src/domain/session-execution";

const hasDb = Boolean(process.env.DATABASE_URL);
const ORG = "ffffffff-0000-7000-8000-000000042000";
const OTHER_ORG = "ffffffff-0000-7000-8000-000000042001";
const TZ = "Asia/Seoul";

let sql: ReturnType<typeof createSql>;
const TEACHER_USER = uuidv7();
const LEARNER = uuidv7();
const PERIOD = uuidv7();
const GROUP = uuidv7();
const OTHER_PERIOD = uuidv7();
const OTHER_GROUP = uuidv7();
const NODE_A = uuidv7();
const NODE_B = uuidv7();

/** 어제 수업(마감 대상) · 오늘 수업 · 내일 수업(대상 아님) · 이미 마감 · 남의 조직 */
const S_YESTERDAY = uuidv7();
const S_TODAY = uuidv7();
const S_TOMORROW = uuidv7();
const S_CLOSED = uuidv7();
const S_CANCELLED = uuidv7();
const S_FOREIGN = uuidv7();

function isoAddDays(days: number): string {
  const base = new Date(
    new Date().toLocaleDateString("en-CA", { timeZone: TZ }) + "T00:00:00Z",
  );
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
const TODAY = isoAddDays(0);
const YESTERDAY = isoAddDays(-1);
const TOMORROW = isoAddDays(1);

async function makeSession(
  id: string,
  date: string,
  hourUtc: number,
  status: string,
  nodes: string[],
  org = ORG,
  group = GROUP,
): Promise<void> {
  /* starts_at을 시간 단위로 벌린다 — sessions_group_no_overlap이 같은 반의
   * 겹치는 수업을 막는다(취소는 예외). */
  await sql`
    insert into sessions (
      id, organization_id, learning_group_id, session_date, timezone,
      starts_at, ends_at, status, planned_node_ids)
    values (${id}, ${org}, ${group}, ${date}::date, ${TZ},
            ${`${date}T${String(hourUtc).padStart(2, "0")}:00:00Z`},
            ${`${date}T${String(hourUtc).padStart(2, "0")}:50:00Z`},
            ${status}::session_status, ${sql.json(nodes)})
  `;
}

async function sessionRow(id: string) {
  const [row] = await sql<{ status: string; updated_at: string }[]>`
    select status::text as status, updated_at::text from sessions where id = ${id}
  `;
  return row!;
}

async function completionEvents(sessionId: string) {
  return sql<{ payload: Record<string, unknown> }[]>`
    select payload from outbox_events
    where event_type = 'SessionCompleted' and aggregate_id = ${sessionId}
  `;
}

async function progressRows(sessionId: string) {
  return sql<{ kind: string; route_node_id: string | null }[]>`
    select kind, route_node_id::text from progress_events
    where session_id = ${sessionId} order by kind, route_node_id
  `;
}

beforeAll(async () => {
  if (!hasDb) return;
  sql = createSql();

  for (const [org, name, slug] of [
    [ORG, "ITEST 마감", "itest-close"],
    [OTHER_ORG, "ITEST 마감 이웃", "itest-close-other"],
  ] as const) {
    await sql`
      insert into organizations (id, name, slug, timezone)
      values (${org}, ${name}, ${slug}, ${TZ})
      on conflict (id) do nothing
    `;
  }
  for (const [user, name, role] of [
    [TEACHER_USER, "마감 테스트 교사", "teacher"],
  ] as const) {
    await sql`
      insert into users (id, email, display_name, default_organization_id)
      values (${user}, ${`c-${user}@su-maek.test`}, ${name}, ${ORG})
    `;
    await sql`
      insert into memberships (id, organization_id, user_id, role, status)
      values (${uuidv7()}, ${ORG}, ${user}, ${role}, 'active')
    `;
  }
  await sql`
    insert into learners (id, organization_id, display_name, status)
    values (${LEARNER}, ${ORG}, '마감 테스트 학생', 'active')
  `;
  for (const [p, g, org, name] of [
    [PERIOD, GROUP, ORG, "마감 테스트반"],
    [OTHER_PERIOD, OTHER_GROUP, OTHER_ORG, "이웃 반"],
  ] as const) {
    await sql`
      insert into course_periods
        (id, organization_id, name, academic_year, starts_on, ends_on, status)
      values (${p}, ${org}, '마감 테스트 기간', 2026, ${isoAddDays(-30)},
              ${isoAddDays(30)}, 'active')
    `;
    await sql`
      insert into learning_groups (id, organization_id, course_period_id, name, status)
      values (${g}, ${org}, ${p}, ${name}, 'operating')
    `;
  }
  await sql`
    insert into learning_group_memberships
      (id, organization_id, learning_group_id, learner_id, status, joined_on)
    values (${uuidv7()}, ${ORG}, ${GROUP}, ${LEARNER}, 'active', ${isoAddDays(-30)})
  `;

  await makeSession(S_YESTERDAY, YESTERDAY, 7, "planned", [NODE_A, NODE_B]);
  await makeSession(S_TODAY, TODAY, 9, "confirmed", [NODE_A]);
  await makeSession(S_TOMORROW, TOMORROW, 7, "planned", [NODE_A]);
  await makeSession(S_CLOSED, YESTERDAY, 11, "completed", [NODE_A]);
  await makeSession(S_CANCELLED, YESTERDAY, 13, "cancelled", [NODE_A]);
  await makeSession(S_FOREIGN, YESTERDAY, 7, "planned", [NODE_A], OTHER_ORG, OTHER_GROUP);
});

afterAll(async () => {
  if (!hasDb) return;
  const ids = [S_YESTERDAY, S_TODAY, S_TOMORROW, S_CLOSED, S_CANCELLED, S_FOREIGN];
  await sql`delete from outbox_events where aggregate_id = any(${ids}::uuid[])`;
  /* progress_events는 append-only라 DB가 삭제를 막는다 — 그것도 검증 대상이라
   * 테스트 조직 정리에서만 명시적으로 내린다. */
  await sql`alter table progress_events disable trigger progress_events_immutable`;
  await sql`delete from progress_events where learning_group_id in (${GROUP}, ${OTHER_GROUP})`;
  await sql`alter table progress_events enable trigger progress_events_immutable`;
  await sql`delete from sessions where learning_group_id in (${GROUP}, ${OTHER_GROUP})`;
  await sql`delete from learning_group_memberships where learner_id = ${LEARNER}`;
  await sql`delete from learners where id = ${LEARNER}`;
  await sql`delete from learning_groups where id in (${GROUP}, ${OTHER_GROUP})`;
  await sql`delete from course_periods where id in (${PERIOD}, ${OTHER_PERIOD})`;
  await sql`delete from memberships where user_id = ${TEACHER_USER}`;
  await sql`delete from users where id = ${TEACHER_USER}`;
  await sql.end();
});

describe.skipIf(!hasDb)("마감할 수업 목록", () => {
  it("오늘까지의 미마감 수업만 오른다 — 아직 하지 않은 수업은 마감할 것이 없다", async () => {
    const list = await listSessionsAwaitingClose(sql, {
      organizationId: ORG,
      learningGroupId: GROUP,
      today: TODAY,
    });
    const ids = list.map((s) => s.sessionId);

    expect(ids).toContain(S_YESTERDAY);
    expect(ids).toContain(S_TODAY);
    /* 내일 수업을 여기 띄우면 교사가 하지도 않은 수업을 마감한다 */
    expect(ids).not.toContain(S_TOMORROW);
  });

  it("이미 마감했거나 취소된 수업은 목록에서 빠진다", async () => {
    const list = await listSessionsAwaitingClose(sql, {
      organizationId: ORG,
      learningGroupId: GROUP,
      today: TODAY,
    });
    const ids = list.map((s) => s.sessionId);
    expect(ids).not.toContain(S_CLOSED);
    expect(ids).not.toContain(S_CANCELLED);
  });

  it("계획된 노드를 함께 낸다 — 교사가 무엇을 확인할지 알아야 한다", async () => {
    const list = await listSessionsAwaitingClose(sql, {
      organizationId: ORG,
      learningGroupId: GROUP,
      today: TODAY,
    });
    const target = list.find((s) => s.sessionId === S_YESTERDAY)!;
    expect([...target.plannedNodeIds].sort()).toEqual([NODE_A, NODE_B].sort());
  });

  it("남의 조직 수업은 보이지 않는다", async () => {
    const list = await listSessionsAwaitingClose(sql, {
      organizationId: ORG,
      today: TODAY,
    });
    expect(list.map((s) => s.sessionId)).not.toContain(S_FOREIGN);
  });
});

describe.skipIf(!hasDb)("마감 기록 (E-02 · I-21)", () => {
  it("전부 진행했으면 coverage가 full이고 한 트랜잭션에 기록된다", async () => {
    const result = await closeSession(sql, {
      organizationId: ORG,
      sessionId: S_YESTERDAY,
      actorUserId: TEACHER_USER,
      nodeProgress: { [NODE_A]: "completed", [NODE_B]: "completed" },
      note: null,
    });

    expect(result.ok).toBe(true);
    expect(result.coverage).toBe("full");
    expect((await sessionRow(S_YESTERDAY)).status).toBe("completed");

    /* I-21: 교사 마감 기록 없이 완료된 수업은 없다. 이벤트만 나가고
     * progress_events가 없으면 「학생 완료가 넘어온 것」과 구분되지 않는다. */
    const rows = await progressRows(S_YESTERDAY);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.route_node_id === NODE_A)).toBe(true);
    expect(await completionEvents(S_YESTERDAY)).toHaveLength(1);
  });

  it("payload가 계획 노드와 실제 진행을 함께 담는다", async () => {
    const [event] = await completionEvents(S_YESTERDAY);
    const p = event!.payload as Record<string, unknown>;
    expect(p.sessionId).toBe(S_YESTERDAY);
    expect(p.learningGroupId).toBe(GROUP);
    expect(p.sessionDate).toBe(YESTERDAY);
    expect(p.closedBy).toBe(TEACHER_USER);
    expect(p.coverage).toBe("full");
    const summary = p.progressSummary as Record<string, string[]>;
    expect([...summary.completedNodeIds!].sort()).toEqual([NODE_A, NODE_B].sort());
    expect(summary.partialNodeIds).toEqual([]);
    expect(summary.skippedNodeIds).toEqual([]);
  });

  it("일부만 진행했으면 partial이고 노드별로 남는다", async () => {
    const result = await closeSession(sql, {
      organizationId: ORG,
      sessionId: S_TODAY,
      actorUserId: TEACHER_USER,
      nodeProgress: { [NODE_A]: "partial" },
      note: "예제 15번까지만",
    });

    expect(result.ok).toBe(true);
    expect(result.coverage).toBe("partial");
    const [event] = await completionEvents(S_TODAY);
    const summary = (event!.payload as { progressSummary: Record<string, string[]> })
      .progressSummary;
    expect(summary.partialNodeIds).toEqual([NODE_A]);
    expect(summary.completedNodeIds).toEqual([]);
  });

  it("계획에 없는 노드는 적을 수 없다", async () => {
    /* 실제 진행은 planned 노드 집합과 대조돼야 한다. 대조하지 않으면
     * 진도 기록이 루트와 무관해지고, 그것을 먹는 일정 엔진도 함께 어긋난다. */
    const stray = uuidv7();
    const result = await closeSession(sql, {
      organizationId: ORG,
      sessionId: S_TOMORROW,
      actorUserId: TEACHER_USER,
      nodeProgress: { [NODE_A]: "completed", [stray]: "completed" },
    });

    expect(result.ok).toBe(false);
    expect((await sessionRow(S_TOMORROW)).status).toBe("planned");
    expect(await completionEvents(S_TOMORROW)).toHaveLength(0);
  });

  it("계획된 노드를 빠뜨리면 거부한다 — 조용히 건너뜀으로 만들지 않는다", async () => {
    const extra = uuidv7();
    await makeSession(extra, TOMORROW, 9, "planned", [NODE_A, NODE_B]);
    const result = await closeSession(sql, {
      organizationId: ORG,
      sessionId: extra,
      actorUserId: TEACHER_USER,
      nodeProgress: { [NODE_A]: "completed" },
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("노드");
    await sql`delete from sessions where id = ${extra}`;
  });
});

describe.skipIf(!hasDb)("재마감과 격리", () => {
  it("이미 마감한 수업은 다시 마감되지 않는다 — 이벤트도 하나다", async () => {
    const before = await sessionRow(S_YESTERDAY);
    const result = await closeSession(sql, {
      organizationId: ORG,
      sessionId: S_YESTERDAY,
      actorUserId: TEACHER_USER,
      nodeProgress: { [NODE_A]: "skipped", [NODE_B]: "skipped" },
    });

    expect(result.ok).toBe(false);
    /* 두 번째 마감이 진도를 덮어쓰면 실제로 나간 곳이 사라진다 */
    expect((await sessionRow(S_YESTERDAY)).updated_at).toBe(before.updated_at);
    expect(await completionEvents(S_YESTERDAY)).toHaveLength(1);
  });

  it("취소된 수업은 마감 대상이 아니다", async () => {
    const result = await closeSession(sql, {
      organizationId: ORG,
      sessionId: S_CANCELLED,
      actorUserId: TEACHER_USER,
      nodeProgress: { [NODE_A]: "completed" },
    });
    expect(result.ok).toBe(false);
    expect((await sessionRow(S_CANCELLED)).status).toBe("cancelled");
  });

  it("남의 조직 수업은 마감되지 않는다", async () => {
    const result = await closeSession(sql, {
      organizationId: ORG,
      sessionId: S_FOREIGN,
      actorUserId: TEACHER_USER,
      nodeProgress: { [NODE_A]: "completed" },
    });
    expect(result.ok).toBe(false);
    expect((await sessionRow(S_FOREIGN)).status).toBe("planned");
  });

  it("진도 기록은 수정·삭제되지 않는다", async () => {
    const [row] = await sql<{ id: string }[]>`
      select id::text from progress_events where session_id = ${S_YESTERDAY} limit 1
    `;
    await expect(
      sql`update progress_events set kind = 'tampered' where id = ${row!.id}`,
    ).rejects.toThrow();
    await expect(
      sql`delete from progress_events where id = ${row!.id}`,
    ).rejects.toThrow();
  });

  it("마감이 감사에 남는다", async () => {
    const rows = await sql<{ actor_id: string }[]>`
      select actor_id::text as actor_id from audit_events
      where organization_id = ${ORG} and action = 'session.close'
        and target_id = ${S_YESTERDAY}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_id).toBe(TEACHER_USER);
  });
});

describe.skipIf(!hasDb)("반 마감과 학생 하루는 다른 사건이다 (I-21)", () => {
  it("반을 마감해도 학생 하루 계획은 완료되지 않는다", async () => {
    /* 반대 방향(학생 완료가 반을 마감하지 않는다)은 T4.1이 지킨다.
     * 둘을 이으면 한 사람의 클릭이 다른 스물아홉 명의 기록을 만든다. */
    const [row] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from learner_day_plans
      where learner_id = ${LEARNER} and status = 'completed'
    `;
    expect(row!.cnt).toBe(0);
  });

});
