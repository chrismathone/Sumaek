import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { createSql } from "../src/client";

/* ─────────────────────────────────────────────────────────────
 * RLS 교차 테넌트 격리 (인수 27 · eywa 하네스 패턴).
 *
 * DATABASE_URL 사용자는 테이블 소유자라 RLS를 우회한다 — 트랜잭션 안에서
 * `set_config('request.jwt.claims', …)` + `set local role authenticated`로
 * 실제 RLS를 발동시켜야 false-green이 없다.
 * throwaway 테넌트 2개를 만들고 끝나면 정리한다.
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
const sql = createSql();

const orgA = uuidv7();
const orgB = uuidv7();
const userA = uuidv7();
const userB = uuidv7();
const studentUserA = uuidv7();
const learnerA = uuidv7();
const learnerB = uuidv7();
const rightB = uuidv7();
const questionB = uuidv7();

/** 특정 사용자로 가장해 RLS가 적용된 상태로 콜백 실행 */
async function asUser<T>(
  userId: string,
  fn: (tx: ReturnType<typeof createSql>) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`
      select set_config(
        'request.jwt.claims',
        ${JSON.stringify({ sub: userId, role: "authenticated" })},
        true
      )
    `;
    await tx`set local role authenticated`;
    const result = await fn(tx as unknown as ReturnType<typeof createSql>);
    await tx`reset role`;
    return result;
  }) as Promise<T>;
}

describe.skipIf(!hasDb)("RLS 교차 테넌트 격리 (인수 27)", () => {
  beforeAll(async () => {
    await sql`insert into organizations (id, name, slug) values
      (${orgA}, 'RLS 테스트 A', ${`rls-a-${orgA.slice(0, 8)}`}),
      (${orgB}, 'RLS 테스트 B', ${`rls-b-${orgB.slice(0, 8)}`})`;
    await sql`insert into users (id, email, display_name) values
      (${userA}, ${`a-${userA.slice(0, 8)}@test.local`}, '교사A'),
      (${userB}, ${`b-${userB.slice(0, 8)}@test.local`}, '교사B'),
      (${studentUserA}, ${`s-${studentUserA.slice(0, 8)}@test.local`}, '학생A')`;
    await sql`insert into memberships (id, organization_id, user_id, role, status) values
      (${uuidv7()}, ${orgA}, ${userA}, 'teacher', 'active'),
      (${uuidv7()}, ${orgB}, ${userB}, 'teacher', 'active'),
      (${uuidv7()}, ${orgA}, ${studentUserA}, 'student', 'active')`;
    await sql`insert into learners (id, organization_id, display_name, user_id) values
      (${learnerA}, ${orgA}, '민감한 학생 A', ${studentUserA}),
      (${learnerB}, ${orgB}, '민감한 학생 B', null)`;
    await sql`insert into content_rights (id, organization_id, rights_holder, status)
      values (${rightB}, ${orgB}, 'B사', 'usable')`;
    await sql`insert into questions (id, organization_id, kind, review_status, content_right_id, is_auto_assignable)
      values (${questionB}, ${orgB}, 'short_answer', 'published', ${rightB}, true)`;
  });

  afterAll(async () => {
    await sql`delete from questions where id = ${questionB}`;
    await sql`delete from content_rights where id = ${rightB}`;
    await sql`delete from learners where id in (${learnerA}, ${learnerB})`;
    await sql`delete from memberships where organization_id in (${orgA}, ${orgB})`;
    await sql`delete from users where id in (${userA}, ${userB}, ${studentUserA})`;
    await sql`delete from organizations where id in (${orgA}, ${orgB})`;
    await sql.end({ timeout: 5 });
  });

  it("교사A는 자기 조직 학습자만 본다 — B 조직 데이터 존재조차 노출 안 됨", async () => {
    const rows = await asUser(userA, (tx) => tx`select id, display_name from learners`);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(learnerA);
    expect(ids).not.toContain(learnerB);
  });

  it("교사A는 B 조직 문항을 ID로 직접 조회해도 0건", async () => {
    const rows = await asUser(
      userA,
      (tx) => tx`select id from questions where id = ${questionB}`,
    );
    expect(rows).toHaveLength(0);
  });

  it("교사A는 B 조직으로 데이터를 삽입할 수 없다 (WITH CHECK)", async () => {
    await expect(
      asUser(
        userA,
        (tx) => tx`
          insert into learners (id, organization_id, display_name)
          values (${uuidv7()}, ${orgB}, '침투 시도')
        `,
      ),
    ).rejects.toThrow(/row-level security|violates/i);
  });

  it("학생 역할은 문항 원본·정답 테이블에 접근할 수 없다 (RESTRICTIVE)", async () => {
    const rows = await asUser(studentUserA, (tx) => tx`select id from questions`);
    expect(rows).toHaveLength(0);
    const versions = await asUser(
      studentUserA,
      (tx) => tx`select id from question_versions`,
    );
    expect(versions).toHaveLength(0);
  });

  it("학생은 조직 데이터 중 본인 응시 외 접근 불가 — 타 학습자 없음", async () => {
    // 같은 조직이라도 attempts는 본인 것만 (RESTRICTIVE attempts_student_own)
    const attempts = await asUser(
      studentUserA,
      (tx) => tx`select id from attempts where organization_id = ${orgA}`,
    );
    expect(attempts).toHaveLength(0); // 본인 응시 없음 — 타인 것도 안 보임
  });

  it("교사B는 A 조직 감사 로그를 볼 수 없다", async () => {
    await sql`
      insert into audit_events (id, organization_id, actor_type, action, target_type)
      values (${uuidv7()}, ${orgA}, 'system', 'rls-test', 'test')
    `;
    const rows = await asUser(
      userB,
      (tx) => tx`select id from audit_events where organization_id = ${orgA}`,
    );
    expect(rows).toHaveLength(0);
  });

  it("감사 로그는 소유자 권한으로도 수정·삭제할 수 없다 (불변 조건 15)", async () => {
    const [row] = await sql<{ id: string }[]>`
      select id from audit_events where organization_id = ${orgA} limit 1
    `;
    const auditId = row?.id as string;
    expect(auditId).toBeTruthy();
    await expect(
      sql`update audit_events set action = 'tampered' where id = ${auditId}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      sql`delete from audit_events where id = ${auditId}`,
    ).rejects.toThrow(/append-only/);
  });

  it("서버 전용 인프라 테이블(outbox·jobs)은 authenticated에게 완전 차단", async () => {
    const outbox = await asUser(userA, (tx) => tx`select id from outbox_events`);
    expect(outbox).toHaveLength(0);
    const jobs = await asUser(userA, (tx) => tx`select id from jobs`);
    expect(jobs).toHaveLength(0);
  });

  it("교사 시간 충돌은 DB가 차단한다 (EXCLUDE — 불변 조건 6)", async () => {
    const groupId = uuidv7();
    const periodId = uuidv7();
    await sql`insert into course_periods (id, organization_id, name, academic_year, starts_on, ends_on)
      values (${periodId}, ${orgA}, '테스트 기간', 2026, '2026-08-01', '2026-12-31')`;
    await sql`insert into learning_groups (id, organization_id, course_period_id, name)
      values (${groupId}, ${orgA}, ${periodId}, 'RLS 반')`;
    await sql`
      insert into sessions (id, organization_id, learning_group_id, teacher_user_id,
        session_date, timezone, starts_at, ends_at, status)
      values (${uuidv7()}, ${orgA}, ${groupId}, ${userA}, '2026-09-01', 'Asia/Seoul',
        '2026-09-01T07:00:00Z', '2026-09-01T09:00:00Z', 'planned')
    `;
    await expect(
      sql`
        insert into sessions (id, organization_id, learning_group_id, teacher_user_id,
          session_date, timezone, starts_at, ends_at, status)
        values (${uuidv7()}, ${orgA}, ${uuidv7()}, ${userA}, '2026-09-01', 'Asia/Seoul',
          '2026-09-01T08:00:00Z', '2026-09-01T10:00:00Z', 'planned')
      `,
    ).rejects.toThrow(/exclusion|sessions_teacher_no_overlap/i);
    await sql`delete from sessions where organization_id = ${orgA}`;
    await sql`delete from learning_groups where id = ${groupId}`;
    await sql`delete from course_periods where id = ${periodId}`;
  });
});
