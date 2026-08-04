import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSql } from "../src/client";

/* ─────────────────────────────────────────────────────────────
 * 평가 생성의 DB 멱등 (G-15) — 라이브 DB.
 *
 * `assessments_idempotent_uq`는 (조직·반·학습자·날짜·목적)에 걸려 있는데
 * `learning_group_id`와 `learner_id`가 **둘 다 nullable**이다. PostgreSQL은
 * 유니크 인덱스에서 NULL을 서로 다른 값으로 보므로, 반 공통 일일테스트
 * (`learner_id IS NULL`)는 같은 조합으로 몇 개든 들어간다. 그 인덱스는 정작
 * 자동 생성이 가장 많이 만들 평가에 아무 일도 하지 않는다.
 *
 * 지금 사고로 안 보이는 이유는 생성 코드가 INSERT 전에 SELECT로 먼저
 * 확인하기 때문이다. 그러나 그것은 SELECT-then-INSERT 경합이다. 교사 버튼
 * 하나일 때는 좀처럼 겹치지 않지만, 워커에 재시도와 재시작이 붙는 순간
 * (T3.2) 정확히 그 경로가 동시에 두 번 돈다.
 *
 * 그래서 워커를 붙이기 **전에** DB가 직접 막게 한다 — 응용 코드가 무엇을
 * 하든 평가는 하나여야 한다.
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
let sql: ReturnType<typeof createSql>;

const ORG = "00000000-0000-7000-8000-000000000001";
const PERIOD = uuidv7();
const GROUP = uuidv7();
const LEARNER = uuidv7();
const DATE = "2026-08-20";
const made: string[] = [];

async function insertAssessment(over: {
  learnerId?: string | null;
  groupId?: string | null;
  date?: string;
  purpose?: string;
  status?: string;
}): Promise<string> {
  const id = uuidv7();
  made.push(id);
  await sql`
    insert into assessment_instances
      (id, organization_id, purpose, title, learning_group_id, learner_id,
       scheduled_date, status)
    values (${id}, ${ORG}, ${over.purpose ?? "formative"}, ${"멱등 테스트"},
            ${over.groupId === undefined ? GROUP : over.groupId},
            ${over.learnerId ?? null}, ${over.date ?? DATE},
            ${over.status ?? "published"})
  `;
  return id;
}

beforeAll(async () => {
  if (!hasDb) return;
  sql = createSql();
  await sql`
    insert into course_periods
      (id, organization_id, name, academic_year, starts_on, ends_on, status)
    values (${PERIOD}, ${ORG}, '멱등 기간', 2026, '2026-01-01', '2026-12-31', 'active')
  `;
  await sql`
    insert into learning_groups (id, organization_id, course_period_id, name, status)
    values (${GROUP}, ${ORG}, ${PERIOD}, '멱등 반', 'operating')
  `;
  await sql`
    insert into learners (id, organization_id, display_name, status)
    values (${LEARNER}, ${ORG}, ${"멱등 학생"}, 'active')
  `;
});

afterAll(async () => {
  if (!hasDb) return;
  await sql`delete from assessment_instances where id = any(${made}::uuid[])`;
  await sql`delete from learners where id = ${LEARNER}`;
  await sql`delete from learning_groups where id = ${GROUP}`;
  await sql`delete from course_periods where id = ${PERIOD}`;
  await sql.end();
});

describe.skipIf(!hasDb)("반 공통 평가의 중복을 DB가 막는다", () => {
  it("같은 (조직·반·날짜·목적)의 반 공통 평가는 하나뿐이다", async () => {
    /* 이것이 G-15의 핵심이다. 수리 전에는 두 번째 INSERT가 그냥 통과했다. */
    await insertAssessment({ learnerId: null });
    await expect(insertAssessment({ learnerId: null })).rejects.toThrow();
  });

  it("학생 개별 평가는 반 공통과 같은 날 공존할 수 있다", async () => {
    /* 확인테스트 미통과 보충처럼 한 학생만 보는 평가가 있다. 반 공통과
     * 같은 날 같은 반이라도 서로 막지 않아야 한다. */
    await expect(
      insertAssessment({ learnerId: LEARNER, date: "2026-08-21" }),
    ).resolves.toBeTruthy();
    await expect(
      insertAssessment({ learnerId: null, date: "2026-08-21" }),
    ).resolves.toBeTruthy();
  });

  it("반이 지정된 학생 평가는 기존 인덱스가 여전히 막는다", async () => {
    await insertAssessment({ learnerId: LEARNER, date: "2026-08-22" });
    await expect(
      insertAssessment({ learnerId: LEARNER, date: "2026-08-22" }),
    ).rejects.toThrow();
  });

  it("반 없는 학생 평가는 같은 날 여럿이 정당하다", async () => {
    /* 보충·재시험은 학생 단위로 여러 개가 나온다. 처음에는 NULL을 접어
     * 인덱스 하나로 덮으려 했는데, 실측으로 그런 행이 40건 있었고 결손이
     * 아니라 정당한 사용이었다. 막아야 할 것은 반 공통 중복뿐이다. */
    await insertAssessment({ learnerId: LEARNER, groupId: null, date: "2026-08-25" });
    await expect(
      insertAssessment({ learnerId: LEARNER, groupId: null, date: "2026-08-25" }),
    ).resolves.toBeTruthy();
  });

  it("목적이 다르면 같은 날에 공존한다", async () => {
    await insertAssessment({ learnerId: null, date: "2026-08-23", purpose: "formative" });
    await expect(
      insertAssessment({ learnerId: null, date: "2026-08-23", purpose: "confirmation" }),
    ).resolves.toBeTruthy();
  });

  it("취소된 평가는 자리를 막지 않는다", async () => {
    /* 부분 유니크(status <> 'cancelled')의 뜻 — 잘못 만든 것을 취소하고
     * 다시 만들 수 있어야 한다. */
    await insertAssessment({ learnerId: null, date: "2026-08-24", status: "cancelled" });
    await expect(
      insertAssessment({ learnerId: null, date: "2026-08-24" }),
    ).resolves.toBeTruthy();
  });

  it("날짜가 없는 평가는 이 유니크의 대상이 아니다", async () => {
    /* 날짜 미정 평가는 자동 생성이 만드는 것이 아니다 — 교사가 손으로
     * 여러 개 만들 수 있어야 한다. */
    const a = await sql`
      insert into assessment_instances
        (id, organization_id, purpose, title, learning_group_id, status)
      values (${uuidv7()}, ${ORG}, 'formative', ${"날짜 없음"}, ${GROUP}, 'draft')
      returning id::text
    `;
    made.push((a[0] as { id: string }).id);
    const b = await sql`
      insert into assessment_instances
        (id, organization_id, purpose, title, learning_group_id, status)
      values (${uuidv7()}, ${ORG}, 'formative', ${"날짜 없음2"}, ${GROUP}, 'draft')
      returning id::text
    `;
    made.push((b[0] as { id: string }).id);
    expect(b.length).toBe(1);
  });
});
