import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { getSharedSql } from "@su-maek/db";
import { generateDailyTest } from "@su-maek/db/domain";

/* ─────────────────────────────────────────────────────────────
 * 일일테스트의 복습 버킷 — 망각곡선이 실제로 출제에 닿는가.
 *
 * 이 버킷은 **구조적으로 언제나 0건**이었다. 복습 항목은 "최근에 그 문항을
 * 틀려서" 생기므로 `lastUsedOn`이 반드시 무반복 창 안이고, 그 창이 모든
 * 버킷에 균일하게 걸려 있었다. 즉 "오답 복습 20%"는 정책 문서에만 있었다.
 *
 * 여기서 겨누는 것 둘:
 *   1. 최근에 쓴 문항이어도 **복습 버킷은 실제로 채워진다** (면제)
 *   2. 채워지는 순서가 **예측 기억률 오름차순** — 가장 많이 잊은 것부터
 *
 * 전용 조직을 만들어 돌린다. 데모 조직에 활성 정책을 하나 더 꽂으면 그
 * 조직의 모든 일일테스트가 이 테스트의 정책으로 생성된다 — E2E가 같은
 * 조직을 쓴다. 조직·정책은 **고정 id로 한 번만** 만든다(매 실행마다 새로
 * 만들면 조직 표가 테스트 쓰레기로 불어난다). 반·학습자·문항은 실행마다
 * 새로 만들어 멱등 검사(조직·반·날짜)에 걸리지 않게 한다.
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
/** 이 테스트 전용 조직·정책 — 실행마다 새로 만들지 않고 재사용한다 */
const FIXTURE_ORG_ID = "00000000-0000-7000-8000-0000000000f1";
const FIXTURE_POLICY_ID = "00000000-0000-7000-8000-0000000000f2";
/* 개념도 고정한다. canonical_concepts는 조직 스코프가 없어서 실행마다 새로
 * 만들면 데모 조직 교사의 개념 목록까지 오염된다. 문항 정렬이 걸려 있어
 * 정리 스크립트도 지우지 못한다. */
const FIXTURE_CONCEPT_IDS: Record<string, string> = {
  forgotten: "00000000-0000-7000-8000-0000000000f3",
  fading: "00000000-0000-7000-8000-0000000000f4",
  fresh: "00000000-0000-7000-8000-0000000000f5",
};
const TZ = "Asia/Seoul";
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: TZ });

function isoAddDays(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe.skipIf(!hasDb)("일일테스트 복습 버킷 (라이브 DB)", () => {
  let sql: ReturnType<typeof getSharedSql>;
  const ids = {
    org: FIXTURE_ORG_ID,
    policy: FIXTURE_POLICY_ID,
    teacher: uuidv7(),
    group: uuidv7(),
    learner: uuidv7(),
    right: uuidv7(),
    priorAssessment: uuidv7(),
  };
  /* 셋 다 오늘 이미 쓴 문항이다(무반복 창 안). 기대 기억률:
   *   forgotten 0.9^10 ≈ 0.35 · fading 0.9 · fresh 0.9^(1/30) ≈ 0.997
   * 그 오름차순이 곧 기대하는 출제 순서다.
   *
   * `fading`은 일부러 **한 번도 복습한 적 없는** 항목으로 둔다(간격 10일,
   * 오늘 기한). 경과일의 기준점을 `due_on`으로 잡으면 이런 항목이 전부
   * 경과 0일 → R=1이 되어 맨 뒤로 밀린다 — 이 케이스가 그 실수를 잡는다. */
  const items = [
    { key: "forgotten", stability: 1, interval: 1, reviewedDaysAgo: 10 },
    { key: "fading", stability: 10, interval: 10, reviewedDaysAgo: null },
    { key: "fresh", stability: 30, interval: 30, reviewedDaysAgo: 1 },
  ].map((i) => ({
    ...i,
    question: uuidv7(),
    version: uuidv7(),
    concept: FIXTURE_CONCEPT_IDS[i.key]!,
  }));

  let generatedAssessmentId: string | null = null;

  beforeAll(async () => {
    sql = getSharedSql();
    await sql`
      insert into organizations (id, name, slug, timezone)
      values (${ids.org}, '복습출제 통합테스트', 'itest-review-selection', ${TZ})
      on conflict (id) do nothing
    `;
    /* 복습만 내는 정책 — 오늘 개념·약점 버킷을 0으로 눌러 복습 버킷만 남긴다.
     * 무반복 14일은 데모 조직과 같은 값이다(그 창이 이 버킷을 죽여 왔다). */
    await sql`
      insert into assessment_policies (
        id, organization_id, name, purpose, version, pool_weights,
        question_count, constraints, is_active
      ) values (
        ${ids.policy}, ${ids.org}, '복습 전용(테스트)', 'formative', 1,
        ${sql.json({ today_concept: 0, weakness: 0, review: 100 } as never)},
        4, ${sql.json({ noRepeatWithinDays: 14 } as never)}, true
      )
      on conflict (id) do nothing
    `;
    await sql`
      insert into learning_groups (id, organization_id, course_period_id, name, status)
      values (${ids.group}, ${ids.org}, ${uuidv7()}, '복습출제 테스트반', 'operating')
    `;
    await sql`
      insert into learners (id, organization_id, display_name, grade_level)
      values (${ids.learner}, ${ids.org}, '복습출제 학습자', 'middle-2')
    `;
    await sql`
      insert into learning_group_memberships (
        id, organization_id, learning_group_id, learner_id, status, joined_on
      ) values (
        ${uuidv7()}, ${ids.org}, ${ids.group}, ${ids.learner}, 'active', ${TODAY}::date
      )
    `;
    /* 오늘 수업 — 계획 노드는 비운다. 오늘 개념 버킷이 0이라 필요 없고,
     * 이 테스트가 보려는 것은 복습 버킷뿐이다. */
    await sql`
      insert into sessions (
        id, organization_id, learning_group_id, session_date, timezone,
        starts_at, ends_at, status
      ) values (
        ${uuidv7()}, ${ids.org}, ${ids.group}, ${TODAY}::date, ${TZ},
        ${`${TODAY}T09:00:00+09:00`}, ${`${TODAY}T10:00:00+09:00`}, 'planned'
      )
    `;
    await sql`
      insert into content_rights (id, organization_id, rights_holder, status)
      values (${ids.right}, ${ids.org}, '통합테스트', 'usable')
    `;
    /* 이미 오늘 쓴 적이 있는 문항으로 만든다 — 무반복 창 안에 확실히 넣는다 */
    await sql`
      insert into assessment_instances (
        id, organization_id, purpose, title, learner_id, status, scheduled_date, published_at
      ) values (
        ${ids.priorAssessment}, ${ids.org}, 'diagnostic', '이전 사용 기록', ${ids.learner},
        'published', ${TODAY}::date, now()
      )
    `;

    for (const [i, item] of items.entries()) {
      await sql`
        insert into canonical_concepts (id, slug, name, status, evidence)
        values (${item.concept}, ${`itest-review-selection-${item.key}`},
                ${`복습출제 개념 ${item.key}`}, 'active', '[]'::jsonb)
        on conflict (id) do nothing
      `;
      await sql`
        insert into questions (id, organization_id, kind, review_status, content_right_id, is_auto_assignable, current_version_id)
        values (${item.question}, ${ids.org}, 'short_answer', 'published', ${ids.right}, true, ${item.version})
      `;
      await sql`
        insert into question_versions (
          id, organization_id, question_id, version_number, body, answer, points, difficulty, content_checksum
        ) values (
          ${item.version}, ${ids.org}, ${item.question}, 1,
          ${sql.json([{ type: "text", text: `${item.key} 문항` }] as never)},
          ${sql.json({ kind: "short_answer", accepted: [{ value: "7", form: "number" }] } as never)},
          '10', ${sql.json({ band: "mid" } as never)}, ${`itest-rs-${item.key}`}
        )
      `;
      await sql`
        insert into question_alignments (id, organization_id, question_id, concept_id, weight)
        values (${uuidv7()}, ${ids.org}, ${item.question}, ${item.concept}, 1)
      `;
      await sql`
        insert into assessment_questions (
          id, organization_id, assessment_id, question_id, question_version_id,
          content_checksum, sort_order, points, answer_snapshot, concept_weights, selection_reason
        ) values (
          ${uuidv7()}, ${ids.org}, ${ids.priorAssessment}, ${item.question}, ${item.version},
          ${`itest-rs-${item.key}`}, ${i + 1}, '10', ${sql.json({} as never)},
          ${sql.json({ [item.concept]: 1 } as never)}, 'today_concept'
        )
      `;
      /* 기한이 온 복습 항목 — 안정성과 마지막 복습일이 기억률을 가른다 */
      await sql`
        insert into review_items (
          id, organization_id, learner_id, concept_id, question_id, source_kind,
          due_on, interval_days, stability_days, last_reviewed_on, repetition_no, status
        ) values (
          ${uuidv7()}, ${ids.org}, ${ids.learner}, ${item.concept}, ${item.question},
          'wrong_answer', ${TODAY}::date, ${item.interval}, ${item.stability},
          ${item.reviewedDaysAgo === null ? null : isoAddDays(TODAY, -item.reviewedDaysAgo)}::date,
          ${item.reviewedDaysAgo === null ? 0 : 1}, 'scheduled'
        )
      `;
    }
  });

  afterAll(async () => {
    /* 감사 계열은 불변이라 두고, 큐에 남으면 곤란한 것만 지운다 */
    if (generatedAssessmentId) {
      await sql`
        delete from outbox_events
        where organization_id = ${ids.org} and aggregate_id = ${generatedAssessmentId}
      `;
    }
  });

  it("최근에 쓴 문항이어도 복습 버킷이 채워진다 — 예전에는 언제나 0건이었다", async () => {
    /* 셋 다 오늘 쓴 문항이라는 사실을 먼저 못박는다. 이게 아니면 이 테스트는
     * 아무것도 증명하지 않는다. */
    const used = await sql<{ n: number }[]>`
      select count(*)::int as n from assessment_questions
      where assessment_id = ${ids.priorAssessment}
    `;
    expect(used[0]!.n).toBe(3);

    const result = await generateDailyTest({
      organizationId: ids.org,
      learningGroupId: ids.group,
      targetDate: TODAY as never,
      actorUserId: ids.teacher,
    });
    expect(result.ok).toBe(true);
    generatedAssessmentId = result.assessmentId;
    expect(result.questionCount).toBe(3);

    const rows = await sql<{ selection_reason: string }[]>`
      select selection_reason from assessment_questions
      where assessment_id = ${result.assessmentId}
    `;
    expect(rows.every((r) => r.selection_reason === "wrong_answer_review")).toBe(true);
  });

  it("가장 많이 잊은 것부터 나온다 — 예측 기억률 오름차순", async () => {
    const rows = await sql<{ question_id: string; sort_order: number }[]>`
      select question_id::text as question_id, sort_order
      from assessment_questions
      where assessment_id = ${generatedAssessmentId}
      order by sort_order
    `;
    const byId = new Map(items.map((i) => [i.question, i.key]));
    expect(rows.map((r) => byId.get(r.question_id))).toEqual([
      "forgotten",
      "fading",
      "fresh",
    ]);
  });

  it("모자란 몫은 조용히 메우지 않고 shortfall로 남는다", async () => {
    const [row] = await sql<{ ctx: { shortfalls: unknown[] } }[]>`
      select generation_context as ctx from assessment_instances
      where id = ${generatedAssessmentId}
    `;
    // 4문항을 요청했는데 후보가 3개뿐이다
    expect(row!.ctx.shortfalls).toHaveLength(1);
  });
});
