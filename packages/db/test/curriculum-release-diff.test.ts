import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSql } from "../src/client";
import { diffCurriculumReleases } from "../src/domain/curriculum-release";

/* ─────────────────────────────────────────────────────────────
 * 릴리스 차이 계산 + 마이그레이션 초안 (인수 50) — 라이브 DB.
 *
 * core 엔진(단위 12건)이 DB 파이프라인에 연결된 것을 검증한다:
 * 스크래치 릴리스 2개(같은 버전의 1·2)를 만들어 수정·이동·분할·추가·
 * 삭제를 실제 행으로 재현하고, --write-draft가 **draft 매핑만** 만드는
 * 것(원칙 13 — 자동 재매핑 없음)과 멱등 재실행을 확인한다.
 *
 * 전역 참조 테이블은 purgeTestData가 다루지 않으므로 여기서 직접
 * 정리한다 (발행 게이트 테스트와 같은 관례).
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
let sql: ReturnType<typeof createSql>;

const P = "ffffffff-0000-7000-8000-0000005000"; // 인수 50 픽스처 접두
const VERSION = `${P}01`;
const RELEASE_FROM = `${P}02`;
const RELEASE_TO = `${P}03`;
const NODE_FROM_NUM = `${P}04`; // from: 수와 연산
const NODE_FROM_GEO = `${P}05`; // from: 도형과 측정
const NODE_TO_NUM = `${P}06`;
const NODE_TO_GEO = `${P}07`;
const CONCEPT_A = `${P}08`;
const CONCEPT_B = `${P}09`;
const REVIEWER = `${P}0a`;
const MAP_UNCHANGED = `${P}0b`;
const MAP_SPLIT = `${P}0c`;

/* from 릴리스: 동일 1 · 수정 1 · 이동 1 · 분할 1 · 삭제 1 */
const FROM_STANDARDS: Array<[string, string, string]> = [
  ["C수50-01", "소인수분해의 뜻을 알고 자연수를 소인수분해 할 수 있다.", NODE_FROM_NUM],
  ["C수50-02", "최대공약수를 구할 수 있다.", NODE_FROM_NUM],
  ["C수50-03", "평면도형의 성질을 이해한다.", NODE_FROM_NUM], // to에서 도형 영역으로 이동
  [
    "C수50-04",
    "미지수가 2개인 연립일차방정식을 풀 수 있고, 이를 활용하여 문제를 해결할 수 있다.",
    NODE_FROM_NUM,
  ],
  ["C수50-05", "히스토그램을 그리고 해석할 수 있다.", NODE_FROM_GEO],
];
const TO_STANDARDS: Array<[string, string, string]> = [
  ["C수50-01", "소인수분해의 뜻을 알고 자연수를 소인수분해 할 수 있다.", NODE_TO_NUM],
  ["C수50-02", "최대공약수와 최소공배수를 구하고 활용할 수 있다.", NODE_TO_NUM],
  ["C수50-03", "평면도형의 성질을 이해한다.", NODE_TO_GEO],
  ["C수50-06", "미지수가 2개인 연립일차방정식을 풀 수 있다.", NODE_TO_NUM],
  ["C수50-07", "연립일차방정식을 활용하여 문제를 해결할 수 있다.", NODE_TO_NUM],
  ["C수50-08", "산점도를 보고 두 변량의 상관관계를 말할 수 있다.", NODE_TO_GEO],
];

async function cleanup(): Promise<void> {
  await sql`
    delete from curriculum_mappings
    where official_id in (
      select id from achievement_standards
      where release_id in (${RELEASE_FROM}, ${RELEASE_TO})
    )
  `;
  await sql`delete from canonical_concepts where id in (${CONCEPT_A}, ${CONCEPT_B})`;
  await sql`delete from achievement_standards where release_id in (${RELEASE_FROM}, ${RELEASE_TO})`;
  await sql`delete from official_curriculum_nodes where release_id in (${RELEASE_FROM}, ${RELEASE_TO})`;
  await sql`delete from curriculum_releases where id in (${RELEASE_FROM}, ${RELEASE_TO})`;
  await sql`delete from curriculum_versions where id = ${VERSION}`;
  await sql`delete from users where id = ${REVIEWER}`;
}

describe.skipIf(!hasDb)("릴리스 차이 계산 파이프라인 (인수 50)", () => {
  beforeAll(async () => {
    sql = createSql();
    await cleanup();
    await sql`
      insert into users (id, email, display_name)
      values (${REVIEWER}, 'ctest-diff@su-maek.test', 'CTEST 디프')
      on conflict (id) do nothing
    `;
    await sql`
      insert into curriculum_versions (id, code, name, status)
      values (${VERSION}, 'CTEST-MATH-50', 'CTEST 차이 계산 버전', 'draft')
    `;
    for (const [releaseId, releaseNumber] of [
      [RELEASE_FROM, 1],
      [RELEASE_TO, 2],
    ] as const) {
      await sql`
        insert into curriculum_releases (id, curriculum_version_id, release_number, status)
        values (${releaseId}, ${VERSION}, ${releaseNumber}, 'parsed')
      `;
    }
    for (const [nodeId, releaseId, name] of [
      [NODE_FROM_NUM, RELEASE_FROM, "수와 연산"],
      [NODE_FROM_GEO, RELEASE_FROM, "자료와 가능성"],
      [NODE_TO_NUM, RELEASE_TO, "수와 연산"],
      [NODE_TO_GEO, RELEASE_TO, "도형과 측정"],
    ] as const) {
      await sql`
        insert into official_curriculum_nodes (
          id, curriculum_version_id, release_id, kind, official_name
        ) values (${nodeId}, ${VERSION}, ${releaseId}, 'domain', ${name})
      `;
    }
    const insertStandards = async (
      releaseId: string,
      standards: Array<[string, string, string]>,
    ) => {
      for (const [code, statement, nodeId] of standards) {
        await sql`
          insert into achievement_standards (
            id, curriculum_version_id, release_id, official_node_id, code, statement
          ) values (
            gen_random_uuid(), ${VERSION}, ${releaseId}, ${nodeId}, ${code}, ${statement}
          )
        `;
      }
    };
    await insertStandards(RELEASE_FROM, FROM_STANDARDS);
    await insertStandards(RELEASE_TO, TO_STANDARDS);

    for (const [conceptId, slug] of [
      [CONCEPT_A, "ctest50-concept-a"],
      [CONCEPT_B, "ctest50-concept-b"],
    ] as const) {
      await sql`
        insert into canonical_concepts (id, slug, name, status, evidence)
        values (${conceptId}, ${slug}, ${slug}, 'active',
                ${sql.json([{ kind: "document", source: "CTEST" }] as never)})
      `;
    }
    /* from 릴리스의 활성 매핑: 동일 기준(50-01)·분할 기준(50-04) */
    for (const [mappingId, code, conceptId] of [
      [MAP_UNCHANGED, "C수50-01", CONCEPT_A],
      [MAP_SPLIT, "C수50-04", CONCEPT_B],
    ] as const) {
      await sql`
        insert into curriculum_mappings (
          id, official_type, official_id, internal_type, internal_id,
          relation_type, provenance, status
        )
        select ${mappingId}, 'achievement_standard', s.id, 'canonical_concept',
               ${conceptId}, 'covers', 'human', 'active'
        from achievement_standards s
        where s.release_id = ${RELEASE_FROM} and s.code = ${code}
      `;
    }
  });

  afterAll(async () => {
    await cleanup();
    await sql.end({ timeout: 5 });
  });

  it("수정·이동·분할·추가·삭제를 실데이터에서 판정한다", async () => {
    const { diff } = await diffCurriculumReleases(sql, {
      fromReleaseId: RELEASE_FROM,
      toReleaseId: RELEASE_TO,
      writeDraft: false,
      actorId: null,
      actorLabel: "ctest",
    });
    expect(diff.unchanged.map((c) => c.code)).toEqual(["C수50-01"]);
    expect(diff.modified.map((c) => c.code)).toEqual(["C수50-02"]);
    expect(diff.moved.map((c) => c.code)).toEqual(["C수50-03"]);
    expect(diff.split).toHaveLength(1);
    expect(diff.split[0]!.fromCode).toBe("C수50-04");
    expect(diff.split[0]!.toCodes.sort()).toEqual(["C수50-06", "C수50-07"]);
    expect(diff.removed).toEqual(["C수50-05"]);
    expect(diff.added).toEqual(["C수50-08"]);
  });

  it("초안 저장은 draft 매핑만 만든다 — 활성 매핑 0건 (원칙 13)", async () => {
    const outcome = await diffCurriculumReleases(sql, {
      fromReleaseId: RELEASE_FROM,
      toReleaseId: RELEASE_TO,
      writeDraft: true,
      actorId: REVIEWER,
      actorLabel: "ctest-diff@su-maek.test",
    });
    /* carry 1 (50-01) + 분할 파생 2 (50-06·50-07) = 3행 */
    expect(outcome.draftWritten).toBe(3);

    const rows = await sql<
      { code: string; status: string; provenance: string; internal_id: string }[]
    >`
      select s.code, m.status::text as status, m.provenance::text as provenance,
             m.internal_id
      from curriculum_mappings m
      join achievement_standards s on s.id = m.official_id
      where s.release_id = ${RELEASE_TO}
      order by s.code
    `;
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === "draft")).toBe(true);
    expect(rows.every((r) => r.provenance === "imported")).toBe(true);
    expect(rows.map((r) => r.code)).toEqual(["C수50-01", "C수50-06", "C수50-07"]);
    // 분할 파생 두 기준이 같은 개념을 물려받았다
    expect(
      rows.filter((r) => r.internal_id === CONCEPT_B).map((r) => r.code),
    ).toEqual(["C수50-06", "C수50-07"]);

    /* 새 릴리스의 발행 게이트 커버리지는 초안을 세지 않는다 — active만 */
    const [activeCount] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt
      from curriculum_mappings m
      join achievement_standards s on s.id = m.official_id
      where s.release_id = ${RELEASE_TO} and m.status = 'active'
    `;
    expect(activeCount!.cnt).toBe(0);
  });

  it("재실행은 같은 행을 갱신한다 — 초안이 불어나지 않는다 (멱등)", async () => {
    const again = await diffCurriculumReleases(sql, {
      fromReleaseId: RELEASE_FROM,
      toReleaseId: RELEASE_TO,
      writeDraft: true,
      actorId: REVIEWER,
      actorLabel: "ctest",
    });
    expect(again.draftWritten).toBe(3);
    const [total] = await sql<{ cnt: number }[]>`
      select count(*)::int as cnt
      from curriculum_mappings m
      join achievement_standards s on s.id = m.official_id
      where s.release_id = ${RELEASE_TO}
    `;
    expect(total!.cnt).toBe(3);
  });

  it("사람이 승격한 매핑은 초안 재실행이 건드리지 못한다", async () => {
    /* 사람 검토를 재현: 파생 기준 하나를 active로 승격하고 근거를 손본다 */
    await sql`
      update curriculum_mappings m
      set status = 'active', provenance = 'human',
          evidence = ${sql.json([{ kind: "human_review", note: "검토 완료 표식" }] as never)}
      from achievement_standards s
      where s.id = m.official_id and s.release_id = ${RELEASE_TO}
        and s.code = 'C수50-06'
    `;
    await diffCurriculumReleases(sql, {
      fromReleaseId: RELEASE_FROM,
      toReleaseId: RELEASE_TO,
      writeDraft: true,
      actorId: REVIEWER,
      actorLabel: "ctest",
    });
    const [promoted] = await sql<
      {
        status: string;
        provenance: string;
        evidence: Array<{ kind: string }>;
      }[]
    >`
      select m.status::text as status, m.provenance::text as provenance, m.evidence
      from curriculum_mappings m
      join achievement_standards s on s.id = m.official_id
      where s.release_id = ${RELEASE_TO} and s.code = 'C수50-06'
    `;
    expect(promoted!.status).toBe("active");
    expect(promoted!.provenance).toBe("human");
    /* 재실행이 검토자의 근거를 초안 근거로 덮어쓰면 안 된다 —
     * on conflict의 status='draft' 가드가 지키는 지점 */
    expect(promoted!.evidence).toEqual([
      { kind: "human_review", note: "검토 완료 표식" },
    ]);
  });

  it("마이그레이션 초안이 폐기 검토·새 큐레이션 목록을 보고한다", async () => {
    const { draft } = await diffCurriculumReleases(sql, {
      fromReleaseId: RELEASE_FROM,
      toReleaseId: RELEASE_TO,
      writeDraft: false,
      actorId: null,
      actorLabel: "ctest",
    });
    const retire = draft.filter((d) => d.action === "retire_review");
    // C수50-05(삭제)는 매핑이 없어 폐기 검토 행도 없다 — 있는 것만 말한다
    expect(retire).toEqual([]);
    const curate = draft.filter((d) => d.action === "curate_new");
    expect(curate.map((d) => d.toCode)).toEqual(["C수50-08"]);
  });
});
