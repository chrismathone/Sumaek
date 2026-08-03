import { afterAll, describe, expect, it } from "vitest";
import { createSql } from "../src/client";

/* ─────────────────────────────────────────────────────────────
 * 교육과정 권위 사슬 (인수 41·42·48의 데이터면) — 라이브 DB.
 *
 * 전제: `pnpm curriculum:collect`가 한 번 실행된 DB (시드와 동급의 전제 —
 * 전역 참조 데이터는 멱등 적재로 유지된다).
 *
 * 검증하는 사슬: 원문(체크섬) → 성취기준 → 매핑 → 개념 → 문항.
 * 릴리스 발행 게이트(인수 43)는 별도 — 여기서는 발행 전(parsed) 상태와
 * 데이터 정합만 본다.
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
const RELEASE_ID = "00000000-0000-7000-8000-0000000c1003";

describe.skipIf(!hasDb)("교육과정 권위 사슬 (인수 41·48)", () => {
  const sql = createSql();

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("중학교 성취기준 60개가 4개 영역 아래에 있다", async () => {
    const [total] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt from achievement_standards
      where release_id = ${RELEASE_ID}
    `;
    expect(total!.cnt).toBe(60);

    const domains = await sql<{ official_name: string; cnt: number }[]>`
      select n.official_name, count(s.id)::int as cnt
      from achievement_standards s
      join official_curriculum_nodes n on n.id = s.official_node_id
      where s.release_id = ${RELEASE_ID}
      group by n.official_name
    `;
    expect(domains).toHaveLength(4);
    expect(domains.map((d) => d.official_name).sort()).toEqual([
      "도형과 측정",
      "변화와 관계",
      "수와 연산",
      "자료와 가능성",
    ]);
  });

  it("모든 성취기준이 체크섬 있는 원문 소스로 역추적된다 (불변 16의 데이터면)", async () => {
    const orphans = await sql<{ code: string }[]>`
      select s.code from achievement_standards s
      where s.release_id = ${RELEASE_ID}
        and not exists (
          select 1 from curriculum_authority_sources src
          where src.id = s.source_id and src.file_checksum is not null
        )
    `;
    expect(orphans).toEqual([]);
  });

  it("성취기준 문장은 공식 문구다 — 고시문 원문과 자구 일치 표본", async () => {
    const [standard] = await sql<{ statement: string }[]>`
      select statement from achievement_standards
      where release_id = ${RELEASE_ID} and code = '9수01-01'
    `;
    expect(standard!.statement).toBe(
      "소인수분해의 뜻을 알고, 자연수를 소인수분해 할 수 있다.",
    );
  });

  it("성취기준 60개 전부에 개념이 잇겨 있다 — 커버리지 공백 0 (사람 큐레이션 카탈로그)", async () => {
    const [coverage] = await sql<{ total: number; mapped: number; concepts: number }[]>`
      select count(*)::int as total,
             count(*) filter (where exists (
               select 1 from curriculum_mappings m
               where m.official_type = 'achievement_standard'
                 and m.official_id = s.id
                 and m.status = 'active' and m.provenance = 'human'
             ))::int as mapped,
             (select count(distinct m.internal_id)::int from curriculum_mappings m
               join achievement_standards s2 on s2.id = m.official_id
               where m.official_type = 'achievement_standard'
                 and m.status = 'active' and s2.release_id = ${RELEASE_ID}) as concepts
      from achievement_standards s
      where s.release_id = ${RELEASE_ID}
    `;
    expect(coverage!.mapped).toBe(coverage!.total);
    expect(coverage!.total).toBe(60);
    // 개념 ≠ 성취기준 1:1 등치 금지(2K) — 갈라지고 합쳐져 60과 다르다
    expect(coverage!.concepts).toBeGreaterThanOrEqual(65);
    expect(coverage!.concepts).not.toBe(60);
  });

  it("성취기준 → 개념 → 문항 사슬이 실제로 잇긴다 (인수 48 첫 두 고리)", async () => {
    const chain = await sql<{ code: string; concepts: number; questions: number }[]>`
      select s.code,
             count(distinct m.internal_id)::int as concepts,
             count(distinct qa.question_id)::int as questions
      from achievement_standards s
      join curriculum_mappings m
        on m.official_type = 'achievement_standard' and m.official_id = s.id
       and m.status = 'active' and m.provenance = 'human'
      join question_alignments qa on qa.concept_id = m.internal_id
      where s.release_id = ${RELEASE_ID} and s.code in ('9수01-01', '9수01-02')
      group by s.code order by s.code
    `;
    expect(chain).toHaveLength(2);
    for (const row of chain) {
      expect(row.concepts).toBeGreaterThanOrEqual(2);
      expect(row.questions).toBeGreaterThanOrEqual(50); // RPM 213문항의 실측 하한
    }
  });

  it("적용 규칙: 2026 중1·중2만 2022 개정 — 중3(2015)은 데이터가 없어 비워 둔다", async () => {
    const rows = await sql<{ grade_band: string; code: string }[]>`
      select a.grade_band, v.code
      from curriculum_applicabilities a
      join curriculum_versions v on v.id = a.curriculum_version_id
      where a.academic_year = 2026 and a.school_level = 'middle'
        and a.subject_code = 'math'
      order by a.grade_band
    `;
    expect(rows).toEqual([
      { grade_band: "middle-1", code: "KR-MATH-2022" },
      { grade_band: "middle-2", code: "KR-MATH-2022" },
    ]);
  });

  it("릴리스는 발행 전(parsed) — 발행 게이트를 거치지 않은 것을 발행이라 하지 않는다", async () => {
    const [release] = await sql<{ status: string }[]>`
      select status::text as status from curriculum_releases where id = ${RELEASE_ID}
    `;
    expect(release!.status).toBe("parsed");
  });
});
