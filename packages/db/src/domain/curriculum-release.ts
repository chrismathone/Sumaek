import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import {
  validateRelease,
  type GraphEdge,
  type GraphNode,
  type ReleaseGateReport,
} from "@su-maek/core/curriculum";
import { isFeatureEnabled } from "../kill-switch";

/* ─────────────────────────────────────────────────────────────
 * 교육과정 릴리스 발행 파이프라인 (인수 41 잔여 + 43).
 *
 * 두 절차를 담는다:
 *   1. verifyAuthoritySource — 사람이 원문 대조를 마쳤음을 기록
 *      (registered → verified). 체크섬 앞자리를 직접 입력하게 해
 *      "저장된 실물을 확인했다"는 최소한의 증거를 요구한다.
 *   2. publishCurriculumRelease — 발행 게이트를 전부 통과해야
 *      parsed → published 전이. 하나라도 실패하면 상태를 바꾸지 않고
 *      실패 리포트만 릴리스 행(validation_report)에 남긴다.
 *
 * 게이트 판정은 core의 validateRelease 한 곳이다(인수 43의 검증 대상) —
 * 이 모듈은 DB에서 입력을 조립하고 전이·기록만 담당한다. DB 쪽 선행
 * 조건(원문 verified·매핑 커버리지·kill switch)은 그래프와 무관하므로
 * 여기서 따로 판정해 리포트에 합친다.
 *
 * 그래프 범위: **이 릴리스가 내보내는 그래프**만 본다 — 릴리스의
 * 성취기준에 활성 매핑으로 잇긴 개념 + 그 개념이 닿는 간선. 전역
 * canonical_concepts에는 테스트 잔재·다른 릴리스의 개념이 섞여 있어
 * 전량을 게이트에 넣으면 이 릴리스와 무관한 결함이 발행을 막는다.
 * 간선이 범위 밖 개념을 가리키면 그 개념도 노드로 합류시킨다(존재하면) —
 * 존재하지 않는 대상을 가리키는 간선만 고아다.
 * ───────────────────────────────────────────────────────────── */

/** 전역(플랫폼) 사건의 감사 스코프 — kill-switch CLI와 같은 관례 */
export const PLATFORM_SCOPE_ORG = "00000000-0000-0000-0000-000000000000";

/** 발행 전이가 허용되는 출발 상태 (2F 상태 머신) */
const PUBLISHABLE_FROM = new Set([
  "parsed",
  "mapped",
  "expert_review",
  "validated",
]);

/* ── 1. 원문 대조 승격 ──────────────────────────────────────── */

export interface VerifySourceInput {
  sourceId: string;
  /** 사람이 실물과 대조한 sha256 앞자리 — 12자 이상 */
  checksumConfirmation: string;
  /** users.id — 대조를 수행한 사람 */
  reviewerId: string | null;
  /** 감사 기록용 원문 라벨 (이메일 등) */
  reviewerLabel: string;
}

export interface VerifySourceResult {
  alreadyVerified: boolean;
  documentName: string;
  fileChecksum: string;
}

export class CurriculumProcedureError extends Error {}

export async function verifyAuthoritySource(
  sql: postgres.Sql,
  input: VerifySourceInput,
): Promise<VerifySourceResult> {
  const confirmation = input.checksumConfirmation.trim().toLowerCase();
  if (confirmation.length < 12) {
    throw new CurriculumProcedureError(
      "체크섬 확인은 12자 이상이어야 합니다 — 화면의 sha256 앞자리를 실물과 대조한 뒤 그대로 입력하세요.",
    );
  }

  return sql.begin(async (tx) => {
    const [source] = await tx<
      {
        id: string;
        document_name: string;
        file_checksum: string | null;
        review_status: string;
      }[]
    >`
      select id, document_name, file_checksum, review_status
      from curriculum_authority_sources
      where id = ${input.sourceId}
      for update
    `;
    if (!source) {
      throw new CurriculumProcedureError(
        `권위 소스를 찾을 수 없습니다: ${input.sourceId}`,
      );
    }
    if (!source.file_checksum) {
      throw new CurriculumProcedureError(
        "이 소스에는 체크섬이 없습니다 — 실물을 취득(curriculum:collect)한 뒤에 대조할 수 있습니다.",
      );
    }
    if (source.review_status === "superseded") {
      throw new CurriculumProcedureError(
        "대체(superseded)된 소스는 verified로 되돌릴 수 없습니다.",
      );
    }
    if (!source.file_checksum.toLowerCase().startsWith(confirmation)) {
      throw new CurriculumProcedureError(
        "체크섬이 일치하지 않습니다 — 저장된 실물의 sha256과 다른 값을 확인했습니다. 대조를 다시 하세요.",
      );
    }
    if (source.review_status === "verified") {
      return {
        alreadyVerified: true,
        documentName: source.document_name,
        fileChecksum: source.file_checksum,
      };
    }

    await tx`
      update curriculum_authority_sources
      set review_status = 'verified', reviewed_by = ${input.reviewerId},
          updated_at = now()
      where id = ${source.id}
    `;
    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action,
        target_type, target_id, reason, before, after
      ) values (
        ${uuidv7()}, ${PLATFORM_SCOPE_ORG}, 'user', ${input.reviewerId},
        'curriculum.source_verify', 'curriculum_authority_source', ${source.id},
        '사람 원문 대조 완료',
        ${tx.json({ reviewStatus: source.review_status } as never)},
        ${tx.json({
          reviewStatus: "verified",
          reviewer: input.reviewerLabel,
          checksumConfirmed: confirmation,
        } as never)}
      )
    `;
    return {
      alreadyVerified: false,
      documentName: source.document_name,
      fileChecksum: source.file_checksum,
    };
  });
}

/* ── 2. 발행 게이트 ─────────────────────────────────────────── */

export interface UnverifiedSource {
  id: string;
  documentName: string;
  reviewStatus: string;
}

/** core 게이트 리포트 + DB 쪽 선행 조건 판정 */
export interface PublishGateFindings extends ReleaseGateReport {
  /** verified가 아닌 원문 소스 — 불변 16의 사람 절차 */
  sourcesNotVerified: UnverifiedSource[];
  /** 활성 매핑이 하나도 없는 성취기준 코드 */
  unmappedStandardCodes: string[];
  /** curriculum_release kill switch가 발행을 중지 중 */
  killSwitchBlocked: boolean;
  /** 게이트에 넣은 그래프 크기 (리포트 읽는 사람의 맥락) */
  scope: { standards: number; concepts: number; edges: number };
}

export interface PublishOutcome {
  ok: boolean;
  /** 실제로 published로 전이했는가 (dry-run이면 항상 false) */
  transitioned: boolean;
  statusBefore: string;
  statusAfter: string;
  findings: PublishGateFindings;
}

export interface PublishInput {
  releaseId: string;
  /** users.id — 발행을 수행한 사람 */
  publishedBy: string | null;
  /** 감사 기록용 원문 라벨 */
  actorLabel: string;
  /** true면 게이트만 돌리고 전이하지 않는다 (리포트는 저장) */
  dryRun: boolean;
}

export async function publishCurriculumRelease(
  sql: postgres.Sql,
  input: PublishInput,
): Promise<PublishOutcome> {
  return sql.begin(async (tx) => {
    const [release] = await tx<
      { id: string; status: string; curriculum_version_id: string }[]
    >`
      select id, status::text as status, curriculum_version_id
      from curriculum_releases where id = ${input.releaseId}
      for update
    `;
    if (!release) {
      throw new CurriculumProcedureError(
        `릴리스를 찾을 수 없습니다: ${input.releaseId}`,
      );
    }
    if (release.status === "published") {
      throw new CurriculumProcedureError(
        "이미 발행된 릴리스입니다 — 재발행은 없습니다. 변경은 다음 릴리스로 내세요.",
      );
    }
    if (!PUBLISHABLE_FROM.has(release.status)) {
      throw new CurriculumProcedureError(
        `상태 ${release.status}에서는 발행할 수 없습니다 (허용: ${[...PUBLISHABLE_FROM].join(", ")}).`,
      );
    }

    /* 선행 1 — kill switch (직접 집행 지점: KILL_SWITCH_DIRECT_ENFORCEMENT) */
    const killSwitchBlocked = !(await isFeatureEnabled(
      tx,
      "curriculum_release",
      null,
    ));

    /* 선행 2 — 릴리스가 참조하는 원문 소스 전부 verified */
    const sourcesNotVerified = await tx<
      { id: string; document_name: string; review_status: string }[]
    >`
      select distinct src.id, src.document_name, src.review_status::text as review_status
      from curriculum_authority_sources src
      where src.review_status <> 'verified'
        and src.id in (
          select s.source_id from achievement_standards s
          where s.release_id = ${release.id} and s.source_id is not null
          union
          select n.source_id from official_curriculum_nodes n
          where n.release_id = ${release.id} and n.source_id is not null
        )
    `;

    /* 선행 3 — 매핑 커버리지: 성취기준 전부에 활성 매핑 */
    const standards = await tx<{ id: string; code: string }[]>`
      select id, code from achievement_standards
      where release_id = ${release.id} order by code
    `;
    const unmapped = await tx<{ code: string }[]>`
      select s.code from achievement_standards s
      where s.release_id = ${release.id}
        and not exists (
          select 1 from curriculum_mappings m
          where m.official_type = 'achievement_standard'
            and m.official_id = s.id and m.status = 'active'
        )
      order by s.code
    `;

    /* 그래프 조립 — 릴리스 범위 개념 + 간선이 닿는 실존 개념 */
    const mappedConcepts = await tx<
      { id: string; status: string; evidence_count: number }[]
    >`
      select c.id, c.status::text as status,
             coalesce(jsonb_array_length(c.evidence), 0)::int as evidence_count
      from canonical_concepts c
      where c.id in (
        select m.internal_id from curriculum_mappings m
        join achievement_standards s on s.id = m.official_id
        where m.official_type = 'achievement_standard'
          and m.internal_type = 'canonical_concept'
          and m.status = 'active' and s.release_id = ${release.id}
      )
    `;
    const mappedIds = mappedConcepts.map((c) => c.id);

    const edges = mappedIds.length
      ? await tx<
          {
            from_concept_id: string;
            to_concept_id: string;
            kind: string;
            provenance: string;
            status: string;
          }[]
        >`
          select from_concept_id, to_concept_id, kind::text as kind,
                 provenance::text as provenance, status::text as status
          from concept_edges
          where from_concept_id = any(${mappedIds}::uuid[])
             or to_concept_id = any(${mappedIds}::uuid[])
        `
      : [];

    /* 간선이 범위 밖을 가리키면: 실존하면 노드로 합류, 아니면 고아로 남긴다 */
    const outsideIds = [
      ...new Set(
        edges
          .flatMap((e) => [e.from_concept_id, e.to_concept_id])
          .filter((cid) => !mappedIds.includes(cid)),
      ),
    ];
    const outsideConcepts = outsideIds.length
      ? await tx<{ id: string; status: string; evidence_count: number }[]>`
          select c.id, c.status::text as status,
                 coalesce(jsonb_array_length(c.evidence), 0)::int as evidence_count
          from canonical_concepts c
          where c.id = any(${outsideIds}::uuid[])
        `
      : [];

    const nodes: GraphNode[] = [...mappedConcepts, ...outsideConcepts].map(
      (c) => ({
        conceptId: c.id,
        status: c.status as GraphNode["status"],
        evidenceCount: c.evidence_count,
      }),
    );
    const graphEdges: GraphEdge[] = edges.map((e) => ({
      fromConceptId: e.from_concept_id,
      toConceptId: e.to_concept_id,
      kind: e.kind as GraphEdge["kind"],
      provenance: e.provenance as GraphEdge["provenance"],
      status: e.status as GraphEdge["status"],
    }));

    /* 폐기 영향 — 활성 루트·문항이 실제로 쓰는 개념 */
    const inUseRows = await tx<{ concept_id: string }[]>`
      select distinct concept_id from question_alignments
      union
      select distinct (jsonb_array_elements_text(concept_ids))::uuid as concept_id
      from route_nodes
    `;

    const gate = validateRelease({
      nodes,
      edges: graphEdges,
      standardCodes: standards.map((s) => s.code),
      conceptsInUse: inUseRows.map((r) => r.concept_id),
    });

    const findings: PublishGateFindings = {
      ...gate,
      sourcesNotVerified: sourcesNotVerified.map((s) => ({
        id: s.id,
        documentName: s.document_name,
        reviewStatus: s.review_status,
      })),
      unmappedStandardCodes: unmapped.map((u) => u.code),
      killSwitchBlocked,
      scope: {
        standards: standards.length,
        concepts: nodes.length,
        edges: graphEdges.length,
      },
      ok:
        gate.ok &&
        sourcesNotVerified.length === 0 &&
        unmapped.length === 0 &&
        !killSwitchBlocked &&
        standards.length > 0,
    };

    const transitioned = findings.ok && !input.dryRun;

    /* 리포트는 성패와 무관하게 릴리스 행에 남긴다 — 화면·다음 시도의 근거 */
    const report = {
      checkedAt: new Date().toISOString(),
      actor: input.actorLabel,
      dryRun: input.dryRun,
      findings,
    };
    if (transitioned) {
      await tx`
        update curriculum_releases
        set status = 'published', published_at = now(),
            published_by = ${input.publishedBy},
            validation_report = ${tx.json(report as never)}, updated_at = now()
        where id = ${release.id}
      `;
    } else {
      await tx`
        update curriculum_releases
        set validation_report = ${tx.json(report as never)}, updated_at = now()
        where id = ${release.id}
      `;
    }

    await tx`
      insert into audit_events (
        id, organization_id, actor_type, actor_id, action,
        target_type, target_id, reason, before, after
      ) values (
        ${uuidv7()}, ${PLATFORM_SCOPE_ORG}, 'user', ${input.publishedBy},
        'curriculum.release_publish', 'curriculum_release', ${release.id},
        ${input.dryRun ? "발행 게이트 예행 (dry-run)" : "발행 시도"},
        ${tx.json({ status: release.status } as never)},
        ${tx.json({
          status: transitioned ? "published" : release.status,
          ok: findings.ok,
          dryRun: input.dryRun,
          actor: input.actorLabel,
          blockers: {
            sourcesNotVerified: findings.sourcesNotVerified.length,
            unmappedStandards: findings.unmappedStandardCodes.length,
            duplicateStandardCodes: findings.duplicateStandardCodes.length,
            prerequisiteCycles: findings.prerequisiteCycles.length,
            orphanEdges: findings.orphanEdges.length,
            conceptsWithoutEvidence: findings.conceptsWithoutEvidence.length,
            aiEdgesMasqueradingAsActive:
              findings.aiEdgesMasqueradingAsActive.length,
            deprecatedConceptsInUse: findings.deprecatedConceptsInUse.length,
            killSwitchBlocked,
          },
        } as never)}
      )
    `;

    return {
      ok: findings.ok,
      transitioned,
      statusBefore: release.status,
      statusAfter: transitioned ? "published" : release.status,
      findings,
    };
  });
}
