import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { getSharedSql } from "@su-maek/db";
import { listPracticeQuestions } from "@/lib/domain/learning-material";

/* ─────────────────────────────────────────────────────────────
 * 정렬 신뢰 등급 — ai_suggested(미검수 AI 제안)는 학생 경로에 서지 않는다.
 *
 * suggest-alignments CLI는 제안을 provenance='ai_suggested'로 넣고,
 * review-alignments 승인이 'human'으로 바꾼다. 이 경계가 소비 쿼리에서
 * 실제로 지켜지는지를 본다 — 필터 `provenance <> 'ai_suggested'` 한 줄을
 * 지워도 다른 테스트는 전부 통과한다 (틀린 정렬은 화면 어디에도 안 보인
 * 채 출제·숙련도만 틀어지는 부류의 결함이다).
 * ───────────────────────────────────────────────────────────── */

const ORG_ID = "00000000-0000-7000-8000-000000000001";
const TEACHER_ID = "00000000-0000-7000-8000-0000000000a1";
/** 개념은 고정 id로 재사용한다 — 실행마다 새로 만들면 영영 쌓인다 */
const FIXTURE_CONCEPT_ID = "00000000-0000-7000-8000-0000000000fd";
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("정렬 provenance 게이트 (라이브 DB)", () => {
  let sql: ReturnType<typeof getSharedSql>;
  const rightId = uuidv7();
  const materialId = uuidv7();
  const human = { id: uuidv7(), versionId: uuidv7() };
  const suggested = { id: uuidv7(), versionId: uuidv7() };
  const suggestedAlignmentId = uuidv7();

  beforeAll(async () => {
    sql = getSharedSql();
    await sql`
      insert into canonical_concepts (id, slug, name, status, evidence)
      values (${FIXTURE_CONCEPT_ID}, 'itest-alignment-provenance', '통합테스트 개념 (정렬 신뢰 등급)', 'active', '[]'::jsonb)
      on conflict (id) do nothing
    `;
    await sql`
      insert into content_rights (id, organization_id, rights_holder, status)
      values (${rightId}, ${ORG_ID}, '통합테스트', 'usable')
    `;
    for (const [i, q] of [human, suggested].entries()) {
      await sql`
        insert into questions (id, organization_id, kind, review_status, content_right_id, is_auto_assignable, current_version_id)
        values (${q.id}, ${ORG_ID}, 'short_answer', 'published', ${rightId}, true, ${q.versionId})
      `;
      await sql`
        insert into question_versions (
          id, organization_id, question_id, version_number, body, answer, points, difficulty, content_checksum
        ) values (
          ${q.versionId}, ${ORG_ID}, ${q.id}, 1,
          ${sql.json([{ type: "text", text: `문항 ${i + 1}` }] as never)},
          ${sql.json({ kind: "short_answer", accepted: [{ value: "1", form: "number" }] } as never)},
          '10', ${sql.json({ band: "mid" } as never)}, ${`itest-ap-${i}`}
        )
      `;
    }
    /* 사람 정렬 — load.ts의 기본값과 같은 provenance='human' */
    await sql`
      insert into question_alignments (id, organization_id, question_id, concept_id, weight)
      values (${uuidv7()}, ${ORG_ID}, ${human.id}, ${FIXTURE_CONCEPT_ID}, 1)
    `;
    /* AI 제안 — suggest-alignments CLI가 넣는 것과 같은 꼴 (미검수) */
    await sql`
      insert into question_alignments (id, organization_id, question_id, concept_id, weight, confidence, provenance)
      values (${suggestedAlignmentId}, ${ORG_ID}, ${suggested.id}, ${FIXTURE_CONCEPT_ID}, 1, 0.850, 'ai_suggested')
    `;
    await sql`
      insert into learning_materials (
        id, organization_id, concept_id, kind, title, question_ids,
        sort_order, status, created_by
      ) values (
        ${materialId}, ${ORG_ID}, ${FIXTURE_CONCEPT_ID}, 'practice',
        '자동 선정 (provenance 게이트)', '[]'::jsonb, 1, 'published', ${TEACHER_ID}
      )
    `;
  });

  afterAll(async () => {
    await sql`delete from learning_materials where id = ${materialId}`;
    await sql`delete from question_alignments where concept_id = ${FIXTURE_CONCEPT_ID}`;
    await sql`delete from question_versions where question_id in (${human.id}, ${suggested.id})`;
    await sql`delete from questions where id in (${human.id}, ${suggested.id})`;
    await sql`delete from content_rights where id = ${rightId}`;
  });

  it("자동 선정은 미검수 제안을 내지 않는다 — human 정렬 문항만", async () => {
    const got = await listPracticeQuestions({
      organizationId: ORG_ID,
      materialId,
    });
    const ids = got.map((q) => q.questionId);
    expect(ids).toContain(human.id);
    expect(ids).not.toContain(suggested.id);
  });

  it("승인(human 전환) 순간부터 학생 경로에 선다 — confidence는 기록으로 남는다", async () => {
    /* review-alignments --approve와 같은 문장 */
    await sql`
      update question_alignments
      set provenance = 'human', reviewed_by = ${TEACHER_ID}, updated_at = now()
      where id = ${suggestedAlignmentId}
        and provenance = 'ai_suggested' and reviewed_by is null
    `;
    const got = await listPracticeQuestions({
      organizationId: ORG_ID,
      materialId,
    });
    expect(got.map((q) => q.questionId)).toContain(suggested.id);

    const [row] = await sql<{ confidence: string | null; reviewed_by: string | null }[]>`
      select confidence::text, reviewed_by::text from question_alignments
      where id = ${suggestedAlignmentId}
    `;
    /* 원래 AI가 얼마나 확신했는지는 승인 뒤에도 남아야 한다 — 지우면
     * 「이 정렬 어디서 왔지」를 감사 이벤트까지 가서야 답하게 된다 */
    expect(row!.confidence).toBe("0.850");
    expect(row!.reviewed_by).toBe(TEACHER_ID);
  });
});
