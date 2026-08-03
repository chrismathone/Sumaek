import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSql } from "../src/client";
import {
  CurriculumProcedureError,
  publishCurriculumRelease,
  verifyAuthoritySource,
} from "../src/domain/curriculum-release";

/* ─────────────────────────────────────────────────────────────
 * 릴리스 발행 게이트 파이프라인 (인수 41 잔여 · 43) — 라이브 DB.
 *
 * core validateRelease(단위 11건)가 판정하는 게이트를 **실제 발행 전이**에
 * 연결한 파이프라인을 검증한다. 실릴리스(c1003)는 건드리지 않는다 —
 * 전용 스크래치 릴리스를 만들고 끝나면 지운다 (전역 참조 테이블은
 * purgeTestData가 다루지 않으므로 여기서 직접 정리한다).
 *
 * 사슬: verify-source(사람 대조 기록) → publish 게이트 8종 → 전이·리포트.
 * ───────────────────────────────────────────────────────────── */

const hasDb = Boolean(process.env.DATABASE_URL);
let sql: ReturnType<typeof createSql>;

const P = "ffffffff-0000-7000-8000-0000004300"; // 인수 43 픽스처 접두
const SOURCE = `${P}01`;
const VERSION = `${P}02`;
const RELEASE = `${P}03`;
const NODE_DOMAIN = `${P}04`;
const STD_A = `${P}05`; // 매핑 있음
const STD_B = `${P}06`; // 커버리지 실패 시나리오용
const CONCEPT_A = `${P}07`;
const CONCEPT_B = `${P}08`;
const MAP_A = `${P}09`;
const MAP_B = `${P}0a`;
const EDGE_AB = `${P}0b`;
const EDGE_BA = `${P}0c`; // 순환 시나리오용
const REVIEWER = `${P}0d`;
const KS_ROW = `${P}0e`;
const ALIGN_ROW = `${P}0f`;
const QUESTION = `${P}10`;
const ORG = `${P}11`;

const CHECKSUM = "ctest43" + "0".repeat(57); // 64자 유사 sha256

async function cleanup(): Promise<void> {
  // audit_events는 append-only(불변 15)라 지우지 않는다 — 플랫폼 스코프
  // (nil org)에 쌓이므로 어느 조직 화면에도 섞이지 않는다.
  await sql`delete from question_alignments where id = ${ALIGN_ROW}`;
  await sql`delete from questions where id = ${QUESTION}`;
  await sql`delete from organizations where id = ${ORG}`;
  await sql`delete from concept_edges where id in (${EDGE_AB}, ${EDGE_BA})`;
  await sql`delete from curriculum_mappings where id in (${MAP_A}, ${MAP_B})`;
  await sql`delete from canonical_concepts where id in (${CONCEPT_A}, ${CONCEPT_B})`;
  await sql`delete from achievement_standards where release_id = ${RELEASE}`;
  await sql`delete from official_curriculum_nodes where release_id = ${RELEASE}`;
  await sql`delete from curriculum_releases where id = ${RELEASE}`;
  await sql`delete from curriculum_versions where id = ${VERSION}`;
  await sql`delete from curriculum_authority_sources where id = ${SOURCE}`;
  await sql`delete from kill_switches where id = ${KS_ROW}`;
  await sql`delete from users where id = ${REVIEWER}`;
}

/** 통과 가능한 기준 픽스처 — 각 테스트가 한 조각씩 망가뜨린다 */
async function seedFixture(): Promise<void> {
  await cleanup();
  await sql`
    insert into users (id, email, display_name)
    values (${REVIEWER}, 'ctest-curator@su-maek.test', 'CTEST 큐레이터')
    on conflict (id) do nothing
  `;
  await sql`
    insert into curriculum_authority_sources (
      id, document_name, publisher_name, original_url, file_checksum,
      acquired_at, review_status
    ) values (
      ${SOURCE}, 'CTEST 고시문', 'CTEST 발행처', 'https://example.test/notice',
      ${CHECKSUM}, now(), 'verified'
    )
  `;
  await sql`
    insert into curriculum_versions (id, code, name, status, primary_source_id)
    values (${VERSION}, 'CTEST-MATH-43', 'CTEST 발행 게이트 버전', 'draft', ${SOURCE})
  `;
  await sql`
    insert into curriculum_releases (id, curriculum_version_id, release_number, status)
    values (${RELEASE}, ${VERSION}, 1, 'parsed')
  `;
  await sql`
    insert into official_curriculum_nodes (
      id, curriculum_version_id, release_id, kind, official_name, source_id
    ) values (${NODE_DOMAIN}, ${VERSION}, ${RELEASE}, 'domain', 'CTEST 영역', ${SOURCE})
  `;
  for (const [id, code] of [
    [STD_A, "C수43-01"],
    [STD_B, "C수43-02"],
  ] as const) {
    await sql`
      insert into achievement_standards (
        id, curriculum_version_id, release_id, official_node_id, code,
        statement, source_id
      ) values (
        ${id}, ${VERSION}, ${RELEASE}, ${NODE_DOMAIN}, ${code},
        'CTEST 성취기준 문장이다.', ${SOURCE}
      )
    `;
  }
  for (const [id, slug] of [
    [CONCEPT_A, "ctest43-concept-a"],
    [CONCEPT_B, "ctest43-concept-b"],
  ] as const) {
    await sql`
      insert into canonical_concepts (id, slug, name, status, evidence)
      values (
        ${id}, ${slug}, ${slug}, 'active',
        ${sql.json([{ kind: "document", source: "CTEST" }] as never)}
      )
    `;
  }
  for (const [id, stdId, conceptId] of [
    [MAP_A, STD_A, CONCEPT_A],
    [MAP_B, STD_B, CONCEPT_B],
  ] as const) {
    await sql`
      insert into curriculum_mappings (
        id, official_type, official_id, internal_type, internal_id,
        relation_type, provenance, status
      ) values (
        ${id}, 'achievement_standard', ${stdId}, 'canonical_concept',
        ${conceptId}, 'covers', 'human', 'active'
      )
    `;
  }
  await sql`
    insert into concept_edges (
      id, from_concept_id, to_concept_id, kind, provenance, status
    ) values (${EDGE_AB}, ${CONCEPT_A}, ${CONCEPT_B}, 'prerequisite', 'human', 'active')
  `;
}

async function releaseStatus(): Promise<string> {
  const [row] = await sql<{ status: string }[]>`
    select status::text as status from curriculum_releases where id = ${RELEASE}
  `;
  return row!.status;
}

describe.skipIf(!hasDb)("릴리스 발행 게이트 파이프라인 (인수 43)", () => {
  beforeAll(async () => {
    sql = createSql();
  });
  beforeEach(async () => {
    await seedFixture();
  });
  afterAll(async () => {
    await cleanup();
    await sql.end({ timeout: 5 });
  });

  it("게이트를 전부 통과하면 parsed → published 전이 + 리포트·감사 기록", async () => {
    const outcome = await publishCurriculumRelease(sql, {
      releaseId: RELEASE,
      publishedBy: REVIEWER,
      actorLabel: "ctest-curator@su-maek.test",
      dryRun: false,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.transitioned).toBe(true);
    expect(await releaseStatus()).toBe("published");

    const [row] = await sql<
      { published_by: string | null; validation_report: { findings: { ok: boolean } } | null }[]
    >`
      select published_by, validation_report
      from curriculum_releases where id = ${RELEASE}
    `;
    expect(row!.published_by).toBe(REVIEWER);
    expect(row!.validation_report?.findings.ok).toBe(true);

    const audits = await sql<{ action: string }[]>`
      select action from audit_events
      where target_type = 'curriculum_release' and target_id = ${RELEASE}
        and action = 'curriculum.release_publish'
    `;
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("dry-run은 게이트 통과에도 전이하지 않고 리포트만 남긴다", async () => {
    const outcome = await publishCurriculumRelease(sql, {
      releaseId: RELEASE,
      publishedBy: REVIEWER,
      actorLabel: "ctest",
      dryRun: true,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.transitioned).toBe(false);
    expect(await releaseStatus()).toBe("parsed");
    const [row] = await sql<{ validation_report: { dryRun: boolean } | null }[]>`
      select validation_report from curriculum_releases where id = ${RELEASE}
    `;
    expect(row!.validation_report?.dryRun).toBe(true);
  });

  it("원문 소스가 verified가 아니면 차단한다 (불변 16의 사람 절차 연결)", async () => {
    await sql`
      update curriculum_authority_sources
      set review_status = 'registered' where id = ${SOURCE}
    `;
    const outcome = await publishCurriculumRelease(sql, {
      releaseId: RELEASE,
      publishedBy: REVIEWER,
      actorLabel: "ctest",
      dryRun: false,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.findings.sourcesNotVerified).toHaveLength(1);
    expect(outcome.findings.sourcesNotVerified[0]!.reviewStatus).toBe("registered");
    expect(await releaseStatus()).toBe("parsed");
  });

  it("매핑 없는 성취기준이 있으면 차단한다 (커버리지 게이트)", async () => {
    await sql`delete from curriculum_mappings where id = ${MAP_B}`;
    const outcome = await publishCurriculumRelease(sql, {
      releaseId: RELEASE,
      publishedBy: REVIEWER,
      actorLabel: "ctest",
      dryRun: false,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.findings.unmappedStandardCodes).toEqual(["C수43-02"]);
    expect(await releaseStatus()).toBe("parsed");
  });

  it("선수 순환이 있으면 차단한다 (인수 43 — 게이트 함수가 파이프라인에 연결됨)", async () => {
    await sql`
      insert into concept_edges (
        id, from_concept_id, to_concept_id, kind, provenance, status
      ) values (${EDGE_BA}, ${CONCEPT_B}, ${CONCEPT_A}, 'prerequisite', 'human', 'active')
    `;
    const outcome = await publishCurriculumRelease(sql, {
      releaseId: RELEASE,
      publishedBy: REVIEWER,
      actorLabel: "ctest",
      dryRun: false,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.findings.prerequisiteCycles.length).toBeGreaterThanOrEqual(1);
    expect(await releaseStatus()).toBe("parsed");
  });

  it("AI 제안 간선이 active로 위장하면 차단한다", async () => {
    await sql`
      update concept_edges set provenance = 'ai_suggested' where id = ${EDGE_AB}
    `;
    const outcome = await publishCurriculumRelease(sql, {
      releaseId: RELEASE,
      publishedBy: REVIEWER,
      actorLabel: "ctest",
      dryRun: false,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.findings.aiEdgesMasqueradingAsActive).toHaveLength(1);
    expect(await releaseStatus()).toBe("parsed");
  });

  it("근거 없는 개념이 있으면 차단한다 (2L 최소 근거 게이트)", async () => {
    await sql`
      update canonical_concepts set evidence = '[]'::jsonb where id = ${CONCEPT_B}
    `;
    const outcome = await publishCurriculumRelease(sql, {
      releaseId: RELEASE,
      publishedBy: REVIEWER,
      actorLabel: "ctest",
      dryRun: false,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.findings.conceptsWithoutEvidence).toEqual([CONCEPT_B]);
    expect(await releaseStatus()).toBe("parsed");
  });

  it("사용 중인 폐기 개념이 있으면 차단한다 (문항 정렬이 참조)", async () => {
    await sql`
      update canonical_concepts set status = 'deprecated' where id = ${CONCEPT_B}
    `;
    // 실사용 근거: 실문항 1건에 정렬 (question_alignments가 questions FK를 강제)
    await sql`
      insert into organizations (id, name, slug, timezone)
      values (${ORG}, 'CTEST 발행 게이트', 'ctest-release-publish', 'Asia/Seoul')
      on conflict (id) do nothing
    `;
    await sql`
      insert into questions (id, organization_id, kind)
      values (${QUESTION}, ${ORG}, 'short_answer')
    `;
    await sql`
      insert into question_alignments (id, organization_id, question_id, concept_id)
      values (${ALIGN_ROW}, ${ORG}, ${QUESTION}, ${CONCEPT_B})
    `;
    const outcome = await publishCurriculumRelease(sql, {
      releaseId: RELEASE,
      publishedBy: REVIEWER,
      actorLabel: "ctest",
      dryRun: false,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.findings.deprecatedConceptsInUse).toContain(CONCEPT_B);
    expect(await releaseStatus()).toBe("parsed");
  });

  it("kill switch curriculum_release가 중지 중이면 차단한다 (직접 집행 지점)", async () => {
    await sql`
      insert into kill_switches (id, organization_id, key, enabled, reason)
      values (${KS_ROW}, null, 'curriculum_release', false, 'CTEST 발행 중지')
    `;
    const outcome = await publishCurriculumRelease(sql, {
      releaseId: RELEASE,
      publishedBy: REVIEWER,
      actorLabel: "ctest",
      dryRun: false,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.findings.killSwitchBlocked).toBe(true);
    expect(await releaseStatus()).toBe("parsed");
  });

  it("이미 발행된 릴리스는 재발행을 거부한다", async () => {
    await publishCurriculumRelease(sql, {
      releaseId: RELEASE,
      publishedBy: REVIEWER,
      actorLabel: "ctest",
      dryRun: false,
    });
    await expect(
      publishCurriculumRelease(sql, {
        releaseId: RELEASE,
        publishedBy: REVIEWER,
        actorLabel: "ctest",
        dryRun: false,
      }),
    ).rejects.toThrow(CurriculumProcedureError);
    expect(await releaseStatus()).toBe("published");
  });

  it("verify-source: 체크섬 앞자리가 일치해야 verified로 승격한다", async () => {
    await sql`
      update curriculum_authority_sources
      set review_status = 'registered', reviewed_by = null where id = ${SOURCE}
    `;
    // 12자 미만 거부
    await expect(
      verifyAuthoritySource(sql, {
        sourceId: SOURCE,
        checksumConfirmation: CHECKSUM.slice(0, 8),
        reviewerId: REVIEWER,
        reviewerLabel: "ctest",
      }),
    ).rejects.toThrow(/12자/);
    // 불일치 거부
    await expect(
      verifyAuthoritySource(sql, {
        sourceId: SOURCE,
        checksumConfirmation: "deadbeefdead",
        reviewerId: REVIEWER,
        reviewerLabel: "ctest",
      }),
    ).rejects.toThrow(/일치하지 않습니다/);
    const [still] = await sql<{ review_status: string }[]>`
      select review_status::text as review_status
      from curriculum_authority_sources where id = ${SOURCE}
    `;
    expect(still!.review_status).toBe("registered");

    // 일치 → 승격 + 검증자 기록
    const result = await verifyAuthoritySource(sql, {
      sourceId: SOURCE,
      checksumConfirmation: CHECKSUM.slice(0, 12),
      reviewerId: REVIEWER,
      reviewerLabel: "ctest-curator@su-maek.test",
    });
    expect(result.alreadyVerified).toBe(false);
    const [after] = await sql<
      { review_status: string; reviewed_by: string | null }[]
    >`
      select review_status::text as review_status, reviewed_by
      from curriculum_authority_sources where id = ${SOURCE}
    `;
    expect(after!.review_status).toBe("verified");
    expect(after!.reviewed_by).toBe(REVIEWER);

    // 재실행은 변경 없이 이미-완료 보고 (멱등)
    const again = await verifyAuthoritySource(sql, {
      sourceId: SOURCE,
      checksumConfirmation: CHECKSUM.slice(0, 12),
      reviewerId: REVIEWER,
      reviewerLabel: "ctest",
    });
    expect(again.alreadyVerified).toBe(true);
  });

  it("verify-source 후 publish — 사람 절차와 게이트가 한 사슬로 잇긴다", async () => {
    await sql`
      update curriculum_authority_sources
      set review_status = 'registered', reviewed_by = null where id = ${SOURCE}
    `;
    const blocked = await publishCurriculumRelease(sql, {
      releaseId: RELEASE,
      publishedBy: REVIEWER,
      actorLabel: "ctest",
      dryRun: false,
    });
    expect(blocked.ok).toBe(false);

    await verifyAuthoritySource(sql, {
      sourceId: SOURCE,
      checksumConfirmation: CHECKSUM.slice(0, 16),
      reviewerId: REVIEWER,
      reviewerLabel: "ctest",
    });
    const published = await publishCurriculumRelease(sql, {
      releaseId: RELEASE,
      publishedBy: REVIEWER,
      actorLabel: "ctest",
      dryRun: false,
    });
    expect(published.transitioned).toBe(true);
    expect(await releaseStatus()).toBe("published");
  });
});
