import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { getSharedSql } from "@su-maek/db";
import { listDueReviewConcepts, listDueReviews } from "@/lib/domain/review";

/* ─────────────────────────────────────────────────────────────
 * 기한이 온 복습의 개념별 묶음 — 라이브 DB 통합.
 *
 * 오늘 화면(/learn/today)의 복습 단계는 예전에 **자기만의 집계 질의**를
 * 들고 있었다. 개념 이름이 필요해지면서 그 집계를 이 함수로 합쳤는데,
 * 합치는 순간 새 위험이 생긴다: 묶음 질의가 조인을 하나 더 타므로
 * 복습 화면(listDueReviews)과 조건이 갈리면 **오늘 화면은 5건이라 하고
 * 복습 화면에는 4건만 나오는** 어긋남이 조용히 생긴다. 둘 다 성공으로
 * 보이고, 어느 쪽도 오류를 내지 않는다.
 *
 * 그래서 이 파일의 중심 단언은 「묶음의 합 === 복습 화면이 내는 목록의 길이」다.
 *
 * 개념은 **고정 id**로 재사용한다 — 실행마다 새로 만들면 canonical_concepts에
 * 영영 쌓인다(다른 통합 테스트의 주석과 같은 이유). 학습자는 실행마다 새로
 * 만든다: 조회가 학습자로 좁혀지므로 재실행이 서로를 밟지 않는다.
 * ───────────────────────────────────────────────────────────── */

const ORG_ID = "00000000-0000-7000-8000-000000000001";
const hasDb = Boolean(process.env.DATABASE_URL);
const TZ = "Asia/Seoul";
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: TZ });

/* 「먼저 기한이 온 개념」과 「나중」 — 이름이 아니라 기한으로 정렬되는지
 * 보려면 이름 순서와 기한 순서가 **어긋나야** 한다. 이름은 ㄴ이 ㄱ보다
 * 뒤이므로, 기한이 이른 쪽에 뒤 글자를 준다. */
const CONCEPT_EARLY = "00000000-0000-7000-8000-0000000000f8";
const CONCEPT_LATE = "00000000-0000-7000-8000-0000000000f9";

function isoAddDays(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe.skipIf(!hasDb)("기한이 온 복습의 개념 묶음 (라이브 DB)", () => {
  let sql: ReturnType<typeof getSharedSql>;
  const learnerId = uuidv7();

  beforeAll(async () => {
    sql = getSharedSql();
    await sql`
      insert into learners (id, organization_id, display_name, grade_level)
      values (${learnerId}, ${ORG_ID}, '복습묶음 테스트 학습자', 'middle-1')
    `;
    await sql`
      insert into canonical_concepts (id, slug, name, status, evidence)
      values
        (${CONCEPT_EARLY}, 'itest-due-early', '통합테스트 개념 ㄴ (기한 이름)', 'active', '[]'::jsonb),
        (${CONCEPT_LATE},  'itest-due-late',  '통합테스트 개념 ㄱ (기한 늦음)', 'active', '[]'::jsonb)
      on conflict (id) do nothing
    `;

    /* 기한이 지난 것 2건 + 오늘 것 1건 + 아직 안 온 것 1건.
     * question_id는 비워 둔다 — 묶음 질의는 문항을 보지 않아야 한다
     * (문항이 회수된 복습도 「기다리는 복습」으로는 세어야 한다). */
    const rows = [
      { concept: CONCEPT_EARLY, due: isoAddDays(TODAY, -3) },
      { concept: CONCEPT_EARLY, due: isoAddDays(TODAY, -1) },
      { concept: CONCEPT_LATE, due: TODAY },
      { concept: CONCEPT_LATE, due: isoAddDays(TODAY, 5) }, // 아직 안 왔다
    ];
    for (const r of rows) {
      await sql`
        insert into review_items
          (id, organization_id, learner_id, concept_id, source_kind, due_on, status)
        values
          (${uuidv7()}, ${ORG_ID}, ${learnerId}, ${r.concept},
           'wrong_answer', ${r.due}::date, 'scheduled')
      `;
    }
  });

  afterAll(async () => {
    /* 복습 항목은 불변 증거 사슬에 걸리지 않으므로 지워도 된다.
     * 학습자도 같이 지운다 — 개념은 고정 id라 남긴다(위 주석). */
    await sql`delete from review_items where learner_id = ${learnerId}`;
    await sql`delete from learners where id = ${learnerId}`;
  });

  it("개념별로 묶고, 기한이 안 온 것은 세지 않는다", async () => {
    const groups = await listDueReviewConcepts({
      organizationId: ORG_ID,
      learnerId,
      today: TODAY,
    });
    expect(groups).toHaveLength(2);
    const early = groups.find((g) => g.conceptId === CONCEPT_EARLY);
    const late = groups.find((g) => g.conceptId === CONCEPT_LATE);
    expect(early?.count).toBe(2);
    expect(late?.count).toBe(1); // 5일 뒤 것은 빠진다
  });

  it("기한이 지난 수를 따로 센다 — 오늘 것은 지난 것이 아니다", async () => {
    const groups = await listDueReviewConcepts({
      organizationId: ORG_ID,
      learnerId,
      today: TODAY,
    });
    expect(groups.find((g) => g.conceptId === CONCEPT_EARLY)?.overdueCount).toBe(2);
    // 경계: due_on === today는 「기한 지남」이 아니다
    expect(groups.find((g) => g.conceptId === CONCEPT_LATE)?.overdueCount).toBe(0);
  });

  it("이름이 아니라 기한 순으로 낸다 — 오늘 화면의 첫 개념이 복습의 첫 개념이어야 한다", async () => {
    const groups = await listDueReviewConcepts({
      organizationId: ORG_ID,
      learnerId,
      today: TODAY,
    });
    expect(groups[0]?.conceptId).toBe(CONCEPT_EARLY);
    // 이름순이었다면 「ㄱ」이 앞에 왔을 것이다
    expect(groups[0]?.conceptName).toContain("ㄴ");
  });

  /* 이 파일의 존재 이유. */
  it("묶음의 합이 복습 화면의 목록과 같다 — 두 화면이 다른 수를 말하지 않는다", async () => {
    const groups = await listDueReviewConcepts({
      organizationId: ORG_ID,
      learnerId,
      today: TODAY,
    });
    const due = await listDueReviews({
      organizationId: ORG_ID,
      learnerId,
      today: TODAY,
      limit: 100,
    });
    const total = groups.reduce((a, g) => a + g.count, 0);
    expect(total).toBe(due.length);
    expect(total).toBe(3);
  });
});
