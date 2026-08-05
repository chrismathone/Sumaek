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
/* 연결은 beforeAll에서 만든다 — 모듈 최상단에서 createSql()을 부르면
 * DATABASE_URL이 없을 때 skipIf 판정 전에 던져 수집 단계가 통째로 깨진다
 * (skip이 아니라 FAIL로 보고된다). */
let sql: ReturnType<typeof createSql>;
/** 플랫폼 조직 id — 마이그레이션 0019b가 만든다 */
let platformOrg: string | null = null;

const orgA = uuidv7();
const orgB = uuidv7();
const userA = uuidv7();
const userB = uuidv7();
const studentUserA = uuidv7();
const learnerA = uuidv7();
const learnerB = uuidv7();
const rightB = uuidv7();
const questionB = uuidv7();
/** 플랫폼(공용) 콘텐츠 — 교사는 봐야 하고 학생은 보면 안 된다 (ADR-0020 V-3) */
const platformRight = uuidv7();
const platformQuestion = uuidv7();
const platformVersion = uuidv7();

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
    sql = createSql();
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

    /* 플랫폼 콘텐츠 한 벌 — 어느 조직에도 속하지 않는 공용 문항이다.
     * 조직 소유 문항(questionB)으로는 V-3을 잴 수 없다: 학생은 그 조직의
     * 멤버가 아니라 조직 격리에서 이미 걸리므로, 학생 차단이 실제로 도는지
     * 알 수 없다(false-green). 공용 문항은 **읽기가 열려 있는** 행이라
     * 학생 차단만이 유일한 방어다. */
    const [platform] = await sql<{ id: string }[]>`
      select platform_org_id()::text as id
    `;
    platformOrg = platform?.id ?? null;
    if (platformOrg) {
      await sql`insert into content_rights (id, organization_id, rights_holder, status)
        values (${platformRight}, ${platformOrg}, 'RLS 공용 테스트', 'usable')`;
      await sql`insert into questions (id, organization_id, kind, review_status, content_right_id, is_auto_assignable)
        values (${platformQuestion}, ${platformOrg}, 'short_answer', 'published',
                ${platformRight}, true)`;
      await sql`
        insert into question_versions (
          id, organization_id, question_id, version_number, body, answer,
          content_checksum
        ) values (
          ${platformVersion}, ${platformOrg}, ${platformQuestion}, 1,
          ${sql.json([{ type: "text", text: "공용 문항 본문" }] as never)},
          ${sql.json({ accepted: [{ value: "42", form: "number" }] } as never)},
          ${`rls-platform-${platformQuestion.slice(0, 8)}`}
        )`;
    }
  });

  afterAll(async () => {
    await sql`delete from question_versions where id = ${platformVersion}`;
    await sql`delete from questions where id in (${questionB}, ${platformQuestion})`;
    await sql`delete from content_rights where id in (${rightB}, ${platformRight})`;
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

  /* ── ADR-0020 V-3 — 콘텐츠를 플랫폼으로 옮겨도 학생은 원본을 못 읽는다 ──
   *
   * 옮기기 전에는 조직 격리가 겸사겸사 막아 주었다. 옮긴 뒤에는 **읽기가
   * 일부러 열려 있는** 행이라(공용 콘텐츠는 모든 학원이 봐야 한다) 학생
   * 차단만이 유일한 방어다. 실제로 이 자리에서 984건이 열렸었다 —
   * `*_staff_only`가 「그 행의 조직에서의 내 역할」을 묻는데 학생은 플랫폼
   * 조직의 멤버가 아니라 역할이 null이라 통과했다. `is_student_only()`가
   * 사람 기준으로 막는다. 그 함수를 되돌리면 이 테스트가 먼저 깨진다. */
  it("V-3 학생은 **플랫폼** 문항 원본·정답도 못 읽는다", async () => {
    if (!platformOrg) return; // 플랫폼 조직이 없는 DB에서는 잴 것이 없다
    const rows = await asUser(
      studentUserA,
      (tx) => tx`select id from questions where id = ${platformQuestion}`,
    );
    expect(rows).toHaveLength(0);
    const versions = await asUser(
      studentUserA,
      (tx) => tx`select id from question_versions where id = ${platformVersion}`,
    );
    expect(versions).toHaveLength(0);
    const rights = await asUser(
      studentUserA,
      (tx) => tx`select id from content_rights where id = ${platformRight}`,
    );
    expect(rights).toHaveLength(0);
  });

  /* 같은 행을 교사는 **봐야 한다.** 안 보이면 콘텐츠를 플랫폼으로 옮긴
   * 것이 곧 「아무도 못 쓰는 콘텐츠」가 된다 — 막는 쪽만 재고 여는 쪽을
   * 안 재면 그 상태를 초록으로 보고하게 된다. */
  it("교사는 플랫폼 문항을 본다 — 공용 읽기는 열려 있다", async () => {
    if (!platformOrg) return;
    const rows = await asUser(
      userA,
      (tx) => tx`select id from questions where id = ${platformQuestion}`,
    );
    expect(rows.map((r) => r.id)).toContain(platformQuestion);
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
