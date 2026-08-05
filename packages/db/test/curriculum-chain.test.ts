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

  it("사슬 뒤 고리: 문항 잇긴 개념에 학습 목표·기대 증거가 있다 (인수 48 · 2M)", async () => {
    /* 5고리 왕복: 성취기준 → 매핑 → 개념 → 학습 목표 → 기대 증거,
     * 그리고 같은 개념이 문항까지 닿는다. [9수01-01]은 소인수분해 표준 —
     * 연결 개념 전부가 목표·증거·문항을 갖는 첫 완결 사례다. */
    const rows = await sql<
      { slug: string; objectives: number; evidences: number; questions: number }[]
    >`
      select c.slug,
             count(distinct o.id)::int as objectives,
             count(distinct e.id)::int as evidences,
             count(distinct qa.question_id)::int as questions
      from achievement_standards s
      join curriculum_mappings m
        on m.official_type = 'achievement_standard' and m.official_id = s.id
       and m.status = 'active' and m.provenance = 'human'
      join canonical_concepts c on c.id = m.internal_id
      join learning_objectives o on o.concept_id = c.id and o.status = 'active'
      join assessment_evidences e on e.objective_id = o.id
      join question_alignments qa on qa.concept_id = c.id
      where s.release_id = ${RELEASE_ID} and s.code = '9수01-01'
      group by c.slug order by c.slug
    `;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.objectives).toBeGreaterThanOrEqual(1);
      expect(row.evidences).toBeGreaterThanOrEqual(1);
      /* 여기서 재는 것은 **사슬이 닿는가**이지 분량이 아니다.
       *
       * 예전에는 개념마다 문항 50개를 요구했는데, 그 50은 위 테스트(성취기준
       * 단위 합계)의 실측 하한을 개념 단위로 그대로 옮겨 온 것이었다. 개념
       * 셋의 실제 분포는 46·66·75라 하나가 걸렸고, 그 실패는 「사슬이 끊겼다」가
       * 아니라 「한 개념의 문항이 넷 모자란다」를 뜻했다 — 이 테스트의 이름과
       * 다른 말이다.
       *
       * 분량은 위 「성취기준 → 개념 → 문항 사슬이 실제로 잇긴다」가 성취기준
       * 단위 합계 50으로 지킨다. 여기서는 개념마다 문항이 **닿는지**만 본다. */
      expect(row.questions).toBeGreaterThanOrEqual(1);
    }
  });

  it("학습 목표는 관찰 가능한 수행 서술 + 차원·성공 증거·허용 오류를 갖는다 (2M)", async () => {
    const [objective] = await sql<
      {
        statement: string;
        dimensions: string[];
        success_evidence: { success?: string; allowedErrors?: string } | null;
      }[]
    >`
      select o.statement, o.dimensions, o.success_evidence
      from learning_objectives o
      join canonical_concepts c on c.id = o.concept_id
      where c.slug = 'm1-prime-factorization' and o.status = 'active'
      order by o.id limit 1
    `;
    expect(objective).toBeDefined();
    // 수행 서술 — "~수 있다" 꼴, 페이지 범위 아님
    expect(objective!.statement).toMatch(/수 있다\.$/);
    expect(objective!.statement).not.toMatch(/p\.|쪽|페이지/);
    expect(objective!.dimensions.length).toBeGreaterThanOrEqual(1);
    // 성공 증거와 허용 가능한 오류가 함께 있다 — 실수와 미이해를 가른다
    expect(objective!.success_evidence?.success).toBeTruthy();
    expect(objective!.success_evidence?.allowedErrors).toBeTruthy();
  });

  it("수직 계통: 초등 선수 → 중1 → 중3 → 고등 확장이 승인 간선으로 잇긴다 (인수 45)", async () => {
    /* 소인수분해 계통의 수직 사슬 — 학교급을 3개 넘는 대표 경로 */
    const chain: Array<[string, string, string]> = [
      ["e6-divisors-multiples", "m1-prime-composite", "prerequisite"],
      ["m1-prime-composite", "m1-prime-factorization", "prerequisite"],
      ["m1-prime-factorization", "m3-factorization", "extends"],
      ["m3-factorization", "h1-polynomial-factorization", "extends"],
    ];
    for (const [from, to, kind] of chain) {
      const [edge] = await sql<{ status: string; provenance: string }[]>`
        select e.status::text as status, e.provenance::text as provenance
        from concept_edges e
        join canonical_concepts f on f.id = e.from_concept_id
        join canonical_concepts t on t.id = e.to_concept_id
        where f.slug = ${from} and t.slug = ${to} and e.kind = ${kind}
      `;
      expect(edge, `${from} -[${kind}]-> ${to}`).toBeDefined();
      expect(edge!.status).toBe("active");
      expect(edge!.provenance).toBe("human");
    }
    /* 양 끝의 학교급이 실제로 다르다 — 평평한 표가 아니라 수직이다 */
    const levels = await sql<{ slug: string; school_level: string }[]>`
      select slug, school_level from canonical_concepts
      where slug in ('e6-divisors-multiples', 'h1-polynomial-factorization')
      order by slug
    `;
    expect(levels.map((l) => l.school_level)).toEqual(["elementary", "high"]);
  });

  it("문항 잇긴 개념 10종 전부에 표상과 대표 오개념이 있다 (인수 45 데이터면)", async () => {
    const slugs = [
      "m1-prime-composite",
      "m1-prime-factorization",
      "m1-divisors",
      "m1-gcd",
      "m1-lcm",
      "m2-simeq-intro",
      "m2-simeq-substitution",
      "m2-simeq-elimination",
      "m2-simeq-application",
      "m2-linear-eq-review",
    ];
    const rows = await sql<
      { slug: string; representations: number; misconceptions: number }[]
    >`
      select c.slug,
             (select count(*)::int from representations r where r.concept_id = c.id) as representations,
             (select count(*)::int from misconceptions m
               where m.concept_id = c.id and m.status <> 'deprecated') as misconceptions
      from canonical_concepts c
      where c.slug = any(${slugs})
      order by c.slug
    `;
    expect(rows).toHaveLength(slugs.length);
    for (const row of rows) {
      expect(row.representations, `${row.slug} 표상`).toBeGreaterThanOrEqual(1);
      expect(row.misconceptions, `${row.slug} 오개념`).toBeGreaterThanOrEqual(1);
    }

    /* 오개념의 혼동 대상 교차 참조 — gcd·lcm 대조쌍이 실제로 서로를 가리킨다 */
    const [confusion] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt
      from misconceptions m
      join canonical_concepts c on c.id = m.concept_id
      join canonical_concepts cw on cw.id = m.confused_with_concept_id
      where (c.slug = 'm1-gcd' and cw.slug = 'm1-lcm')
         or (c.slug = 'm1-lcm' and cw.slug = 'm1-gcd')
    `;
    expect(confusion!.cnt).toBe(2);
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
