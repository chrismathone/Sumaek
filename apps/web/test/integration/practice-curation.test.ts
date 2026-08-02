import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { getSharedSql } from "@su-maek/db";
import { listPracticeQuestions } from "@/lib/domain/learning-material";

/* ─────────────────────────────────────────────────────────────
 * 연습문제 문항 지정 — 교사가 만든 묶음이 학생에게 그대로 가는가.
 *
 * 이 로직의 안전망이 **E2E 하나뿐이었다**. 지정 순서를 복원하는 블록을
 * `const ordered = rows;` 로 지워도 단위 테스트 98건이 전부 통과했다
 * (뮤테이션 실측). E2E는 느리고 시드·다른 스펙의 상태에 얽혀 있어서,
 * 이 규약을 지키는 그물로 삼기엔 성기다.
 *
 * 겨누는 것 셋:
 *   1) 지정 순서를 지킨다 — 생성순으로 뒤집히지 않는다
 *   2) 지정 개수를 지킨다 — 자동 선정의 limit 5가 뒤쪽을 자르지 않는다
 *   3) 지정이 없으면 종전대로 자동 선정으로 돌아간다
 *
 * 낼 수 없게 된 문항(검수 취소·권한 만료)이 조용히 빠지는 것도 함께 본다 —
 * 순서를 맞추자고 낼 수 없는 문항을 낼 수는 없다.
 * ───────────────────────────────────────────────────────────── */

const ORG_ID = "00000000-0000-7000-8000-000000000001";
const TEACHER_ID = "00000000-0000-7000-8000-0000000000a1";
/** 개념은 고정 id로 재사용한다 — 실행마다 새로 만들면 영영 쌓인다 */
const FIXTURE_CONCEPT_ID = "00000000-0000-7000-8000-0000000000fb";
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("연습문제 지정 문항 (라이브 DB)", () => {
  let sql: ReturnType<typeof getSharedSql>;
  const rightId = uuidv7();
  const materialCurated = uuidv7();
  const materialAuto = uuidv7();
  /** 6개 — 자동 선정 상한(5)보다 많아야 "지정이 잘리는가"를 볼 수 있다 */
  const questions = Array.from({ length: 6 }, () => ({
    id: uuidv7(),
    versionId: uuidv7(),
  }));

  beforeAll(async () => {
    sql = getSharedSql();
    await sql`
      insert into canonical_concepts (id, slug, name, status, evidence)
      values (${FIXTURE_CONCEPT_ID}, 'itest-practice-curation', '통합테스트 개념 (문항 지정)', 'active', '[]'::jsonb)
      on conflict (id) do nothing
    `;
    await sql`
      insert into content_rights (id, organization_id, rights_holder, status)
      values (${rightId}, ${ORG_ID}, '통합테스트', 'usable')
    `;
    // 생성 순서 = questions 배열 순서. 지정은 일부러 이것을 뒤집는다.
    for (const [i, q] of questions.entries()) {
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
          '10', ${sql.json({ band: "mid" } as never)}, ${`itest-pc-${i}`}
        )
      `;
      await sql`
        insert into question_alignments (id, organization_id, question_id, concept_id, weight)
        values (${uuidv7()}, ${ORG_ID}, ${q.id}, ${FIXTURE_CONCEPT_ID}, 1)
      `;
    }
    /* 지정 자료 — 생성순의 **역순**으로 6개 전부 지정한다 */
    await sql`
      insert into learning_materials (
        id, organization_id, concept_id, kind, title, question_ids,
        sort_order, status, created_by
      ) values (
        ${materialCurated}, ${ORG_ID}, ${FIXTURE_CONCEPT_ID}, 'practice',
        '지정 6문항',
        ${sql.json(questions.map((q) => q.id).reverse() as never)},
        1, 'published', ${TEACHER_ID}
      )
    `;
    /* 자동 자료 — 지정 없음 */
    await sql`
      insert into learning_materials (
        id, organization_id, concept_id, kind, title, question_ids,
        sort_order, status, created_by
      ) values (
        ${materialAuto}, ${ORG_ID}, ${FIXTURE_CONCEPT_ID}, 'practice',
        '자동 선정', '[]'::jsonb, 2, 'published', ${TEACHER_ID}
      )
    `;
  });

  afterAll(async () => {
    await sql`delete from learning_materials where id in (${materialCurated}, ${materialAuto})`;
    await sql`delete from question_alignments where concept_id = ${FIXTURE_CONCEPT_ID}`;
    await sql`delete from question_versions where question_id = any(${questions.map((q) => q.id)}::uuid[])`;
    await sql`delete from questions where id = any(${questions.map((q) => q.id)}::uuid[])`;
    await sql`delete from content_rights where id = ${rightId}`;
  });

  it("지정한 순서 그대로 낸다 — 생성순으로 뒤집히지 않는다", async () => {
    const got = await listPracticeQuestions({
      organizationId: ORG_ID,
      materialId: materialCurated,
    });
    expect(got.map((q) => q.questionId)).toEqual(
      questions.map((q) => q.id).reverse(),
    );
  });

  it("지정 개수를 지킨다 — 자동 선정의 상한 5가 뒤쪽을 자르지 않는다", async () => {
    const got = await listPracticeQuestions({
      organizationId: ORG_ID,
      materialId: materialCurated,
    });
    // 교사가 만든 묶음과 학생이 받는 묶음이 달라지면 안 된다
    expect(got).toHaveLength(6);
  });

  it("지정이 없으면 자동 선정으로 돌아간다 (상한 5)", async () => {
    const got = await listPracticeQuestions({
      organizationId: ORG_ID,
      materialId: materialAuto,
    });
    expect(got).toHaveLength(5);
    const ids = new Set(questions.map((q) => q.id));
    expect(got.every((q) => ids.has(q.questionId))).toBe(true);
  });

  it("낼 수 없게 된 지정 문항은 조용히 빠진다 — 순서 맞추자고 낼 수는 없다", async () => {
    const dropped = questions[0]!.id; // 역순 지정에서 마지막
    await sql`update questions set review_status = 'draft' where id = ${dropped}`;
    try {
      const got = await listPracticeQuestions({
        organizationId: ORG_ID,
        materialId: materialCurated,
      });
      expect(got.map((q) => q.questionId)).not.toContain(dropped);
      expect(got).toHaveLength(5);
      // 남은 것들의 상대 순서는 그대로다
      expect(got.map((q) => q.questionId)).toEqual(
        questions
          .map((q) => q.id)
          .reverse()
          .filter((id) => id !== dropped),
      );
    } finally {
      await sql`update questions set review_status = 'published' where id = ${dropped}`;
    }
  });
});
