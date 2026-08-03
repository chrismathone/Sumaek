import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";

/* ─────────────────────────────────────────────────────────────
 * 자료 수정의 낙관적 동시성 — 라이브 DB 통합 테스트.
 *
 * 두 교사가 같은 자료 상세를 열면 나중에 저장하는 쪽의 낡은 폼이
 * concept_id·title·question_ids를 전부 덮었다. 실증 시나리오 그대로 겨눈다:
 * A가 연습문제 문항 5개를 지정·저장 → 폼이 낡은 B(hidden questionIds="")가
 * 제목만 고쳐 저장 → question_ids가 '[]'로 리셋되어 자동 선정으로 되돌아가고,
 * 감사에는 questionCount만 남아 지워진 목록을 복구할 수 없었다.
 *
 * 붙잡는 것 넷:
 *   1) 낡은 토큰의 저장은 거부되고 A의 지정 5개가 그대로 남는다
 *   2) 거부된 저장은 감사에 한 줄도 남지 않는다
 *   3) 새로 고친 폼(현재 토큰)은 저장된다 — 연속 저장이 막히지 않는다
 *   4) 토큰 없이 폼을 우회해도 조용히 덮지 못한다
 *
 * Supabase 인증과 Next 캐시만 대역이고 나머지(권한·DB·토큰 대조)는 진짜다.
 * 조직·사용자·개념은 고정 ID다 — 저장이 남기는 감사 행은 지울 수 없어서
 * (before delete 트리거) 실행마다 새로 만들면 영영 쌓인다.
 * ───────────────────────────────────────────────────────────── */

const claims: { sub: string | null } = { sub: null };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({
        data: claims.sub ? { claims: { sub: claims.sub } } : null,
      }),
    },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { getSharedSql } = await import("@su-maek/db");
const { updateMaterialAction } = await import("@/app/app/content/materials/actions");

const hasDb = Boolean(process.env.DATABASE_URL);

const ORG = "ffffffff-0000-7000-8000-000000230001";
const TEACHER_A = "ffffffff-0000-7000-8000-000000230002";
const TEACHER_B = "ffffffff-0000-7000-8000-000000230003";
const CONCEPT = "ffffffff-0000-7000-8000-0000002300cc";

describe.skipIf(!hasDb)("자료 수정 낙관적 동시성 (라이브 DB)", () => {
  // 연결은 beforeAll에서 — skip된 describe의 콜백도 수집 단계에서 실행된다
  let sql: ReturnType<typeof getSharedSql>;

  const rightId = uuidv7();
  const materialId = uuidv7();
  const questions = Array.from({ length: 5 }, () => ({
    id: uuidv7(),
    versionId: uuidv7(),
  }));
  const pickedIds = questions.map((q) => q.id);

  /** A와 B가 상세를 "연 시점"의 토큰 — 첫 저장 전에 함께 읽는다 */
  let tokenAtOpen: string;

  /** 폼이 싣는 것과 같은 텍스트 원문 — 액션의 select와 같은 ::text */
  const token = async (): Promise<string> => {
    const [row] = await sql<{ token: string }[]>`
      select updated_at::text as token from learning_materials
      where id = ${materialId}
    `;
    return row!.token;
  };

  const saved = async (): Promise<{ title: string; question_ids: unknown }> => {
    const [row] = await sql<{ title: string; question_ids: unknown }[]>`
      select title, question_ids from learning_materials
      where id = ${materialId}
    `;
    return row!;
  };

  const auditCount = async (): Promise<number> => {
    const [row] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from audit_events
      where organization_id = ${ORG}
        and action = 'material.update' and target_id = ${materialId}
    `;
    return row!.cnt;
  };

  const form = (entries: Record<string, string>): FormData => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.set(k, v);
    return fd;
  };

  beforeAll(async () => {
    sql = getSharedSql();
    await sql`
      insert into organizations (id, name, slug, timezone)
      values (${ORG}, 'ITEST 자료 동시성', 'itest-material-conflict', 'Asia/Seoul')
      on conflict (id) do nothing
    `;
    await sql`
      insert into users (id, email, display_name)
      values (${TEACHER_A}, 'itest-material-a@example.test', 'ITEST 교사 A'),
             (${TEACHER_B}, 'itest-material-b@example.test', 'ITEST 교사 B')
      on conflict (id) do nothing
    `;
    await sql`
      insert into memberships (id, organization_id, user_id, role, status)
      values (${uuidv7()}, ${ORG}, ${TEACHER_A}, 'teacher', 'active'),
             (${uuidv7()}, ${ORG}, ${TEACHER_B}, 'teacher', 'active')
      on conflict (organization_id, user_id) do nothing
    `;
    await sql`
      insert into canonical_concepts (id, slug, name, status, evidence)
      values (${CONCEPT}, 'itest-material-conflict', '통합테스트 개념 (자료 동시성)', 'active', '[]'::jsonb)
      on conflict (id) do nothing
    `;
    await sql`
      insert into content_rights (id, organization_id, rights_holder, status)
      values (${rightId}, ${ORG}, '통합테스트', 'usable')
    `;
    for (const [i, q] of questions.entries()) {
      await sql`
        insert into questions (id, organization_id, kind, review_status, content_right_id, is_auto_assignable, current_version_id)
        values (${q.id}, ${ORG}, 'short_answer', 'published', ${rightId}, true, ${q.versionId})
      `;
      await sql`
        insert into question_versions (
          id, organization_id, question_id, version_number, body, answer, points, difficulty, content_checksum
        ) values (
          ${q.versionId}, ${ORG}, ${q.id}, 1,
          ${sql.json([{ type: "text", text: `문항 ${i + 1}` }] as never)},
          ${sql.json({ kind: "short_answer", accepted: [{ value: "1", form: "number" }] } as never)},
          '10', ${sql.json({ band: "mid" } as never)}, ${`itest-mc-${i}`}
        )
      `;
      await sql`
        insert into question_alignments (id, organization_id, question_id, concept_id, weight)
        values (${uuidv7()}, ${ORG}, ${q.id}, ${CONCEPT}, 1)
      `;
    }
    await sql`
      insert into learning_materials (
        id, organization_id, concept_id, kind, title, question_ids,
        sort_order, status, created_by
      ) values (
        ${materialId}, ${ORG}, ${CONCEPT}, 'practice', '연습 묶음',
        '[]'::jsonb, 1, 'draft', ${TEACHER_A}
      )
    `;
    claims.sub = TEACHER_A;
  });

  afterAll(async () => {
    await sql`delete from learning_materials where id = ${materialId}`;
    await sql`delete from question_alignments where concept_id = ${CONCEPT}`;
    await sql`delete from question_versions where question_id = any(${pickedIds}::uuid[])`;
    await sql`delete from questions where id = any(${pickedIds}::uuid[])`;
    await sql`delete from content_rights where id = ${rightId}`;
    claims.sub = null;
  });

  it("전제: A가 연 시점의 토큰으로 문항 5개를 지정해 저장한다", async () => {
    tokenAtOpen = await token();
    const result = await updateMaterialAction(
      null,
      form({
        materialId,
        conceptId: CONCEPT,
        title: "연습 묶음",
        questionIds: pickedIds.join(","),
        updatedAt: tokenAtOpen,
      }),
    );
    expect(result.ok).toBe(true);
    expect((await saved()).question_ids).toEqual(pickedIds);
  });

  it("낡은 폼의 저장은 거부한다 — A의 지정 5개가 지워지지 않는다", async () => {
    /* B의 폼은 A가 저장하기 전에 열렸다 — hidden questionIds=""와 낡은 토큰을
     * 함께 싣고 온다. 예전에는 이 저장이 question_ids를 '[]'로 리셋했다. */
    claims.sub = TEACHER_B;
    const result = await updateMaterialAction(
      null,
      form({
        materialId,
        conceptId: CONCEPT,
        title: "연습 묶움 → 연습 묶음 (오탈자)",
        questionIds: "",
        updatedAt: tokenAtOpen,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("먼저 고쳤습니다");
    expect(result.message).toContain("새로 고쳐");

    const row = await saved();
    expect(row.title).toBe("연습 묶음");
    expect(row.question_ids).toEqual(pickedIds);
  });

  it("거부된 저장은 감사에 남지 않는다 — 성공한 A의 한 건뿐이다", async () => {
    expect(await auditCount()).toBe(1);
  });

  it("새로 고친 폼은 저장된다 — B의 제목 수정과 A의 문항 지정이 공존한다", async () => {
    /* 새로 고침 = 현재 토큰과 현재 지정 목록을 다시 받는 것. 그 위의 수정은
     * A의 작업을 알고 하는 수정이므로 통과해야 한다 — 연속 저장을 막으면
     * 동시성 제어가 아니라 자물쇠다. */
    const result = await updateMaterialAction(
      null,
      form({
        materialId,
        conceptId: CONCEPT,
        title: "연습 묶음 (고침)",
        questionIds: pickedIds.join(","),
        updatedAt: await token(),
      }),
    );
    expect(result.ok).toBe(true);

    const row = await saved();
    expect(row.title).toBe("연습 묶음 (고침)");
    expect(row.question_ids).toEqual(pickedIds);
    expect(await auditCount()).toBe(2);
  });

  it("토큰 없이 온 요청은 거부한다 — 폼 우회도 조용히 덮지 못한다", async () => {
    const before = await saved();
    const result = await updateMaterialAction(
      null,
      form({
        materialId,
        conceptId: CONCEPT,
        title: "우회 저장",
        questionIds: "",
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("새로 고친 뒤 다시");
    expect(await saved()).toEqual(before);
  });
});
