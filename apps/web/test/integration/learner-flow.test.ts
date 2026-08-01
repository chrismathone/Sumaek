import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { getSharedSql } from "@su-maek/db";
import { saveResponse, startAttempt, submitAndGrade } from "@/lib/domain/attempt";
import {
  linkLearnerAccount,
  unlinkLearnerAccount,
} from "@/lib/domain/learner-account";

/* ─────────────────────────────────────────────────────────────
 * 학생 흐름 결손 수정의 통합 테스트 (라이브 DB).
 *
 * 검수에서 실제로 드러난 것만 겨눈다:
 *  1) 답안 저장에 learner 스코프가 없어 **남의 응시에 쓸 수 있었다**
 *  2) 응시일 게이트가 없어 **미래 테스트를 오늘 풀 수 있었다**(8/5 테스트를 8/2에 제출)
 *  3) review_items에 완료 경로가 없어 **복습 예정이 영원히 증가했다**
 *  4) learners.user_id를 채우는 제품 경로가 없어 **등록한 학생이 로그인할 수 없었다**
 *
 * 4)의 계정 발급(신규 생성)은 Supabase 관리자 API를 부르므로 여기서는
 * **기존 계정 연결·해제 경로만** 검증한다 — 테스트가 인증 계정을 만들면
 * 지울 수 없는 잔재가 남는다. 그 한계는 아래 테스트 이름에 적어 둔다.
 * ───────────────────────────────────────────────────────────── */

const ORG_ID = "00000000-0000-7000-8000-000000000001";
const TEACHER_ID = "00000000-0000-7000-8000-0000000000a1";
const hasDb = Boolean(process.env.DATABASE_URL);

function isoAddDays(days: number): string {
  const base = new Date(
    new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) +
      "T00:00:00Z",
  );
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
const TODAY = isoAddDays(0);

describe.skipIf(!hasDb)("학생 흐름 결손 수정", () => {
  let sql: ReturnType<typeof getSharedSql>;
  /** 계정 연결 테스트가 잠시 빌려 쓰는 데모 계정 — afterAll에서 무조건 돌려준다 */
  let borrowedDemo: { userId: string; originalLearnerId: string } | null = null;
  const ids = {
    learner: uuidv7(),
    other: uuidv7(),
    concept: uuidv7(),
    right: uuidv7(),
    question: uuidv7(),
    version: uuidv7(),
    todayAssessment: uuidv7(),
    futureAssessment: uuidv7(),
    aqToday: uuidv7(),
    aqFuture: uuidv7(),
  };

  beforeAll(async () => {
    sql = getSharedSql();
    for (const [id, name] of [
      [ids.learner, "통합테스트 학습자"],
      [ids.other, "통합테스트 학습자"],
    ] as const) {
      await sql`
        insert into learners (id, organization_id, display_name, grade_level)
        values (${id}, ${ORG_ID}, ${name}, 'middle-2')
      `;
    }
    await sql`
      insert into canonical_concepts (id, slug, name, status, evidence)
      values (${ids.concept}, ${`itest-flow-${ids.concept}`}, '통합테스트 개념', 'active', '[]'::jsonb)
    `;
    await sql`
      insert into content_rights (id, organization_id, rights_holder, status)
      values (${ids.right}, ${ORG_ID}, '통합테스트', 'usable')
    `;
    await sql`
      insert into questions (id, organization_id, kind, review_status, content_right_id, is_auto_assignable, current_version_id)
      values (${ids.question}, ${ORG_ID}, 'short_answer', 'published', ${ids.right}, true, ${ids.version})
    `;
    const answer = {
      kind: "short_answer",
      accepted: [{ value: "7", form: "number", allowEquivalence: true }],
    };
    await sql`
      insert into question_versions (id, organization_id, question_id, version_number, body, answer, points, difficulty, content_checksum)
      values (
        ${ids.version}, ${ORG_ID}, ${ids.question}, 1,
        ${sql.json([{ type: "text", text: "3 + 4 는?" }] as never)},
        ${sql.json(answer as never)}, '10',
        ${sql.json({ band: "mid" } as never)}, 'itest'
      )
    `;
    // 오늘 날짜 평가 / 사흘 뒤 평가 — 응시일 게이트 대조
    for (const [aid, aqid, date, learnerId] of [
      [ids.todayAssessment, ids.aqToday, TODAY, ids.learner],
      [ids.futureAssessment, ids.aqFuture, isoAddDays(3), ids.learner],
    ] as const) {
      await sql`
        insert into assessment_instances (id, organization_id, purpose, title, learner_id, status, scheduled_date, published_at)
        values (${aid}, ${ORG_ID}, 'formative', '통합테스트 평가', ${learnerId}, 'published', ${date}::date, now())
      `;
      await sql`
        insert into assessment_questions (
          id, organization_id, assessment_id, question_id, question_version_id,
          content_checksum, sort_order, points, answer_snapshot, concept_weights, selection_reason
        ) values (
          ${aqid}, ${ORG_ID}, ${aid}, ${ids.question}, ${ids.version},
          'itest', 1, '10', ${sql.json(answer as never)},
          ${sql.json({ [ids.concept]: 1 } as never)}, 'today_concept'
        )
      `;
      await sql`
        insert into assignments (id, organization_id, assessment_id, learner_id, mode, assigned_by)
        values (${uuidv7()}, ${ORG_ID}, ${aid}, ${learnerId}, 'online', ${TEACHER_ID})
      `;
    }
  });

  afterAll(async () => {
    /* 증거 계열은 불변이라 지우지 않는다 (grading-exception.test.ts와 같은 이유).
     * 매 실행 무작위 ID라 다른 스펙과 간섭하지 않는다.
     *
     * **데모 계정 원복은 여기서 무조건 한다.** 테스트 본문 끝에 두었더니,
     * 본문이 중간에 실패한 실행이 데모 학생 계정을 떼어 낸 채로 끝났고
     * 그 뒤로는 복구 조건 자체가 성립하지 않아 E2E(full-loop)가 로그인부터
     * 깨졌다 — 실제로 한 번 겪었다. 빌린 것은 성공·실패와 무관하게 돌려준다. */
    if (!sql || !borrowedDemo) return;
    await sql`
      update learners set user_id = null, updated_at = now()
      where organization_id = ${ORG_ID} and user_id = ${borrowedDemo.userId}
    `;
    await sql`
      update learners set user_id = ${borrowedDemo.userId}, updated_at = now()
      where id = ${borrowedDemo.originalLearnerId} and organization_id = ${ORG_ID}
    `;
    await sql`
      update memberships set status = 'active', updated_at = now()
      where organization_id = ${ORG_ID} and user_id = ${borrowedDemo.userId}
    `;
  });

  /* ── 1) 답안 저장의 학습자 스코프 ── */

  it("남의 응시에는 답안을 쓸 수 없다 (조직만 맞아서는 안 된다)", async () => {
    const started = await startAttempt({
      organizationId: ORG_ID,
      assessmentId: ids.todayAssessment,
      learnerId: ids.learner,
      today: TODAY,
    });
    expect("attemptId" in started).toBe(true);
    if (!("attemptId" in started)) return;

    // 같은 조직의 **다른 학습자**로 저장 시도 — 거부되어야 한다
    const stolen = await saveResponse({
      organizationId: ORG_ID,
      learnerId: ids.other,
      attemptId: started.attemptId,
      assessmentQuestionId: ids.aqToday,
      answer: { kind: "short_answer", rawText: "999" },
      clientSequence: 1,
    });
    expect(stolen.ok).toBe(false);
    expect(stolen.message).toContain("찾을 수 없습니다");

    // 한 줄도 쓰이지 않았다
    const rows = await sql`
      select id from responses where attempt_id = ${started.attemptId}
    `;
    expect(rows.length).toBe(0);

    // 본인은 정상 저장된다 (대조군)
    const mine = await saveResponse({
      organizationId: ORG_ID,
      learnerId: ids.learner,
      attemptId: started.attemptId,
      assessmentQuestionId: ids.aqToday,
      answer: { kind: "short_answer", rawText: "7" },
      clientSequence: 1,
    });
    expect(mine.ok).toBe(true);
  });

  /* ── 2) 응시일 게이트 ── */

  it("수업 날짜가 오지 않은 테스트는 시작되지 않는다", async () => {
    const started = await startAttempt({
      organizationId: ORG_ID,
      assessmentId: ids.futureAssessment,
      learnerId: ids.learner,
      today: TODAY,
    });
    expect("error" in started).toBe(true);
    if ("error" in started) {
      expect(started.error).toContain("그날부터");
    }
    // 응시 행 자체가 생기지 않는다 — 시작을 막는 것이지 사후에 되돌리는 게 아니다
    const rows = await sql`
      select id from attempts where assessment_id = ${ids.futureAssessment}
    `;
    expect(rows.length).toBe(0);
  });

  it("그날이 되면 같은 테스트가 열린다 (게이트가 영구 차단이 아니다)", async () => {
    const started = await startAttempt({
      organizationId: ORG_ID,
      assessmentId: ids.futureAssessment,
      learnerId: ids.learner,
      today: isoAddDays(3),
    });
    expect("attemptId" in started).toBe(true);
  });

  it("날짜가 없는 평가(수시)는 게이트에 걸리지 않는다", async () => {
    const adhoc = uuidv7();
    const aq = uuidv7();
    await sql`
      insert into assessment_instances (id, organization_id, purpose, title, learner_id, status, published_at)
      values (${adhoc}, ${ORG_ID}, 'formative', '통합테스트 수시', ${ids.other}, 'published', now())
    `;
    await sql`
      insert into assessment_questions (
        id, organization_id, assessment_id, question_id, question_version_id,
        content_checksum, sort_order, points, answer_snapshot, concept_weights, selection_reason
      ) values (
        ${aq}, ${ORG_ID}, ${adhoc}, ${ids.question}, ${ids.version}, 'itest', 1, '10',
        ${sql.json({ kind: "short_answer", accepted: [{ value: "7", form: "number" }] } as never)},
        ${sql.json({ [ids.concept]: 1 } as never)}, 'today_concept'
      )
    `;
    await sql`
      insert into assignments (id, organization_id, assessment_id, learner_id, mode, assigned_by)
      values (${uuidv7()}, ${ORG_ID}, ${adhoc}, ${ids.other}, 'online', ${TEACHER_ID})
    `;
    const started = await startAttempt({
      organizationId: ORG_ID,
      assessmentId: adhoc,
      learnerId: ids.other,
      today: TODAY,
    });
    expect("attemptId" in started).toBe(true);
  });

  /* ── 3) 복습 완료 경로 ── */

  it("오답이 복습을 만들고, 나중에 맞히면 그 복습이 닫힌다", async () => {
    // 오답 제출 → 복습 생성
    const wrongAssessment = uuidv7();
    const wrongAq = uuidv7();
    const answer = {
      kind: "short_answer",
      accepted: [{ value: "7", form: "number", allowEquivalence: true }],
    };
    await sql`
      insert into assessment_instances (id, organization_id, purpose, title, learner_id, status, scheduled_date, published_at)
      values (${wrongAssessment}, ${ORG_ID}, 'formative', '통합테스트 오답', ${ids.other}, 'published', ${TODAY}::date, now())
    `;
    await sql`
      insert into assessment_questions (
        id, organization_id, assessment_id, question_id, question_version_id,
        content_checksum, sort_order, points, answer_snapshot, concept_weights, selection_reason
      ) values (
        ${wrongAq}, ${ORG_ID}, ${wrongAssessment}, ${ids.question}, ${ids.version},
        'itest', 1, '10', ${sql.json(answer as never)},
        ${sql.json({ [ids.concept]: 1 } as never)}, 'today_concept'
      )
    `;
    await sql`
      insert into assignments (id, organization_id, assessment_id, learner_id, mode, assigned_by)
      values (${uuidv7()}, ${ORG_ID}, ${wrongAssessment}, ${ids.other}, 'online', ${TEACHER_ID})
    `;
    const first = await startAttempt({
      organizationId: ORG_ID,
      assessmentId: wrongAssessment,
      learnerId: ids.other,
      today: TODAY,
    });
    if (!("attemptId" in first)) throw new Error("응시 시작 실패");
    await saveResponse({
      organizationId: ORG_ID,
      learnerId: ids.other,
      attemptId: first.attemptId,
      assessmentQuestionId: wrongAq,
      answer: { kind: "short_answer", rawText: "999" },
      clientSequence: 1,
    });
    await submitAndGrade({
      organizationId: ORG_ID,
      attemptId: first.attemptId,
      learnerId: ids.other,
      timezone: "Asia/Seoul",
    });

    const scheduled = await sql<{ id: string; due_on: string }[]>`
      select id, due_on::text as due_on from review_items
      where learner_id = ${ids.other} and concept_id = ${ids.concept}
        and status = 'scheduled'
    `;
    expect(scheduled.length).toBeGreaterThan(0);

    /* 기한을 오늘로 당긴다 — 기본 복습 간격이 며칠 뒤라 그대로 두면
     * "기한이 온 복습을 닫는다"는 조건 자체가 성립하지 않는다. */
    await sql`
      update review_items set due_on = ${TODAY}::date
      where id = any(${scheduled.map((r) => r.id)}::uuid[])
    `;

    // 같은 개념을 맞힌다 (2)의 수시 평가를 쓴다)
    const second = await sql<{ id: string }[]>`
      select id::text from attempts
      where learner_id = ${ids.other} and status = 'in_progress'
      order by created_at desc limit 1
    `;
    const adhocAttemptId = second[0]!.id;
    const [adhocAq] = await sql<{ id: string }[]>`
      select aq.id::text from assessment_questions aq
      join attempts t on t.assessment_id = aq.assessment_id
      where t.id = ${adhocAttemptId}
    `;
    await saveResponse({
      organizationId: ORG_ID,
      learnerId: ids.other,
      attemptId: adhocAttemptId,
      assessmentQuestionId: adhocAq!.id,
      answer: { kind: "short_answer", rawText: "7" },
      clientSequence: 1,
    });
    await submitAndGrade({
      organizationId: ORG_ID,
      attemptId: adhocAttemptId,
      learnerId: ids.other,
      timezone: "Asia/Seoul",
    });

    const stillOpen = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from review_items
      where id = any(${scheduled.map((r) => r.id)}::uuid[]) and status = 'scheduled'
    `;
    expect(stillOpen[0]!.cnt).toBe(0);

    const closed = await sql<{ status: string; completed_at: Date | null }[]>`
      select status::text, completed_at from review_items
      where id = any(${scheduled.map((r) => r.id)}::uuid[])
    `;
    expect(closed.every((r) => r.status === "completed")).toBe(true);
    expect(closed.every((r) => r.completed_at !== null)).toBe(true);
  });

  /* ── 4) 학습자 ↔ 계정 연결 ── */

  it("등록만 된 학습자는 계정이 비어 있다 (결손의 출발점)", async () => {
    const [row] = await sql<{ user_id: string | null }[]>`
      select user_id::text as user_id from learners where id = ${ids.learner}
    `;
    expect(row!.user_id).toBeNull();
  });

  it("기존 계정을 학습자에 연결하고 해제할 수 있다", async () => {
    // 데모 학생 계정을 빌려 쓴다 — 이 테스트는 인증 계정을 만들지 않는다
    const [demo] = await sql<{ id: string; email: string }[]>`
      select id::text, email from users where lower(email) = 'demo-student@su-maek.app'
    `;
    if (!demo) return; // 시드가 없는 환경에서는 판정하지 않는다

    // 데모 계정은 박서윤에 붙어 있으므로 먼저 떼어 낸 상태를 만든다.
    // **빌린 사실을 먼저 기록**한다 — 아래에서 실패해도 afterAll이 돌려준다.
    const [holder] = await sql<{ id: string }[]>`
      select id::text from learners
      where organization_id = ${ORG_ID} and user_id = ${demo.id}
    `;
    if (!holder) return; // 이미 누가 떼어 놓은 상태면 판정하지 않는다
    borrowedDemo = { userId: demo.id, originalLearnerId: holder.id };
    await unlinkLearnerAccount({
      organizationId: ORG_ID,
      learnerId: holder.id,
      actorUserId: TEACHER_ID,
    });

    const linked = await linkLearnerAccount({
      organizationId: ORG_ID,
      learnerId: ids.learner,
      email: demo.email,
      actorUserId: TEACHER_ID,
    });
    expect(linked.ok).toBe(true);
    // 기존 계정이므로 비밀번호를 새로 만들지 않는다
    expect(linked.temporaryPassword).toBeUndefined();

    const [after] = await sql<{ user_id: string | null }[]>`
      select user_id::text as user_id from learners where id = ${ids.learner}
    `;
    expect(after!.user_id).toBe(demo.id);

    // 학생 멤버십이 활성으로 보장된다 — 없으면 로그인해도 역할이 없다
    const [m] = await sql<{ role: string; status: string }[]>`
      select role::text, status::text from memberships
      where organization_id = ${ORG_ID} and user_id = ${demo.id}
    `;
    expect(m!.role).toBe("student");
    expect(m!.status).toBe("active");

    // 이미 연결된 학습자에는 다시 붙지 않는다
    const twice = await linkLearnerAccount({
      organizationId: ORG_ID,
      learnerId: ids.learner,
      email: demo.email,
      actorUserId: TEACHER_ID,
    });
    expect(twice.ok).toBe(false);

    // 다른 학습자가 같은 계정을 가로채지 못한다
    const steal = await linkLearnerAccount({
      organizationId: ORG_ID,
      learnerId: ids.other,
      email: demo.email,
      actorUserId: TEACHER_ID,
    });
    expect(steal.ok).toBe(false);
    expect(steal.message).toContain("이미");

    // 해제하면 끊기고, 인증 계정(users 행)은 남는다
    const un = await unlinkLearnerAccount({
      organizationId: ORG_ID,
      learnerId: ids.learner,
      actorUserId: TEACHER_ID,
    });
    expect(un.ok).toBe(true);
    const [cleared] = await sql<{ user_id: string | null }[]>`
      select user_id::text as user_id from learners where id = ${ids.learner}
    `;
    expect(cleared!.user_id).toBeNull();
    const [stillThere] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from users where id = ${demo.id}
    `;
    expect(stillThere!.cnt).toBe(1);
    // 원복은 afterAll이 무조건 한다 — 여기서 하면 위 단언이 실패했을 때 안 돈다
  });

  it("교직원 계정은 학생으로 연결하지 않는다", async () => {
    const [teacher] = await sql<{ email: string }[]>`
      select u.email from memberships m join users u on u.id = m.user_id
      where m.organization_id = ${ORG_ID} and m.role <> 'student' and m.status = 'active'
      limit 1
    `;
    if (!teacher) return;
    const result = await linkLearnerAccount({
      organizationId: ORG_ID,
      learnerId: ids.learner,
      email: teacher.email,
      actorUserId: TEACHER_ID,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("교직원");
  });

  it("이메일 형식이 아니면 계정을 만들지 않는다", async () => {
    const result = await linkLearnerAccount({
      organizationId: ORG_ID,
      learnerId: ids.learner,
      email: "not-an-email",
      actorUserId: TEACHER_ID,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("이메일 형식");
  });
});
