import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";

/* ─────────────────────────────────────────────────────────────
 * 교육과정 컨텍스트 (2K·2L)
 *
 * 설계 결정(ADR-0011): 교육과정 권위 소스·공식 계층·canonical concept는
 * 특정 워크스페이스의 소유가 아닌 **플랫폼 공유 참조 데이터**다.
 * organization_id가 없으며, RLS는 전체 읽기 허용 + 쓰기는 플랫폼 큐레이터만.
 * 워크스페이스 고유 해석은 organization_id가 있는 매핑·별칭으로만 표현한다.
 *
 * 원칙: 공식 데이터와 내부 해석을 구분한다. AI 제안은 승인 전 자동 계획에
 * 사용하지 않는다. 적용 시기는 코드 상수가 아니라 Applicability 규칙이다.
 * ───────────────────────────────────────────────────────────── */

export const authoritySourceReview = pgEnum("authority_source_review", [
  "registered",
  "verified", // 사람이 원문 대조 완료
  "superseded",
]);

/** 권위 문서 등록부 — 교육부 고시, NCIC 원문 등. 원문 교체 시에도 이전 체크섬 보존. */
export const curriculumAuthoritySources = pgTable(
  "curriculum_authority_sources",
  {
    id: id(),
    documentName: text("document_name").notNull(),
    publisherName: text("publisher_name").notNull(), // 발행 기관 (교육부, NCIC…)
    noticeNumber: text("notice_number"), // 고시 번호 (예: 교육부 고시 제2022-33호)
    originalUrl: text("original_url").notNull(),
    /** 취득한 원본 파일의 sha256 — 역추적의 근거 (불변 조건 16) */
    fileChecksum: text("file_checksum"),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    /** 적용 대상 요약 (학교급·과목) */
    appliesTo: text("applies_to"),
    reviewStatus: authoritySourceReview("review_status")
      .notNull()
      .default("registered"),
    reviewedBy: uuid("reviewed_by"),
    ...timestamps(),
  },
  (t) => [index("authority_sources_review_idx").on(t.reviewStatus)],
);

export const curriculumVersionStatus = pgEnum("curriculum_version_status", [
  "draft",
  "active",
  "superseded",
]);

/** 공식 교육과정 버전 (예: 2015 개정, 2022 개정) — 전환기 동시 운영 지원 */
export const curriculumVersions = pgTable(
  "curriculum_versions",
  {
    id: id(),
    code: text("code").notNull(), // 예: KR-MATH-2022
    name: text("name").notNull(), // 예: 2022 개정 수학과 교육과정
    status: curriculumVersionStatus("status").notNull().default("draft"),
    primarySourceId: uuid("primary_source_id"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("curriculum_versions_code_uq").on(t.code)],
);

/**
 * 적용 규칙 — 학년도·학교급·학년군·과목별로 어느 버전이 적용되는지.
 * 코드 상수로 박지 않는다 (2K 규칙 5).
 */
export const curriculumApplicabilities = pgTable(
  "curriculum_applicabilities",
  {
    id: id(),
    curriculumVersionId: uuid("curriculum_version_id").notNull(),
    academicYear: integer("academic_year").notNull(),
    schoolLevel: text("school_level").notNull(), // elementary | middle | high
    gradeBand: text("grade_band").notNull(), // 예: middle-1, middle-2
    subjectCode: text("subject_code").notNull().default("math"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("curriculum_applicability_uq").on(
      t.academicYear,
      t.schoolLevel,
      t.gradeBand,
      t.subjectCode,
    ),
  ],
);

export const curriculumReleaseStatus = pgEnum("curriculum_release_status", [
  "imported",
  "parsed",
  "mapped",
  "expert_review",
  "validated",
  "published",
  "superseded",
]);

/**
 * 원자적 발행 묶음 (2F 상태 머신). 발행 전 품질 게이트:
 * 성취기준 중복·누락 0, 강한 선수 순환 0, 고아 매핑 0.
 * 게시된 루트·평가는 새 릴리스로 자동 재매핑하지 않는다 (원칙 13).
 */
export const curriculumReleases = pgTable(
  "curriculum_releases",
  {
    id: id(),
    curriculumVersionId: uuid("curriculum_version_id").notNull(),
    releaseNumber: integer("release_number").notNull(),
    status: curriculumReleaseStatus("status").notNull().default("imported"),
    /** 게이트 검사 결과 (순환·고아·커버리지 리포트) */
    validationReport: jsonb("validation_report"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: uuid("published_by"),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("curriculum_releases_uq").on(
      t.curriculumVersionId,
      t.releaseNumber,
    ),
  ],
);

export const officialNodeKind = pgEnum("official_node_kind", [
  "school_level", // 학교급
  "grade_band", // 학년군·학년
  "subject", // 과목
  "domain", // 영역 (예: 수와 연산)
  "content_element", // 내용 요소
]);

/**
 * 공식 계층의 불변 노드. 릴리스에 속하며 발행 후 수정 불가 —
 * 수정은 다음 릴리스의 새 노드다.
 */
export const officialCurriculumNodes = pgTable(
  "official_curriculum_nodes",
  {
    id: id(),
    curriculumVersionId: uuid("curriculum_version_id").notNull(),
    releaseId: uuid("release_id").notNull(),
    parentId: uuid("parent_id"),
    kind: officialNodeKind("kind").notNull(),
    /** 원문의 공식 명칭 — 임의 변경 금지 */
    officialName: text("official_name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    /** 원문 근거: source_id + 페이지·조항 위치 */
    sourceId: uuid("source_id"),
    sourceLocation: text("source_location"),
    ...timestamps(),
  },
  (t) => [
    index("official_nodes_release_idx").on(t.releaseId, t.parentId),
    index("official_nodes_version_idx").on(t.curriculumVersionId, t.kind),
  ],
);

/** 성취기준 — 코드·공식 문구는 원문에 추적 가능해야 한다 (불변 조건 16) */
export const achievementStandards = pgTable(
  "achievement_standards",
  {
    id: id(),
    curriculumVersionId: uuid("curriculum_version_id").notNull(),
    releaseId: uuid("release_id").notNull(),
    officialNodeId: uuid("official_node_id").notNull(),
    /** 공식 코드 (예: 9수01-01) */
    code: text("code").notNull(),
    /** 공식 문구 원문 */
    statement: text("statement").notNull(),
    /** 성취기준 해설 (있는 경우) */
    commentary: text("commentary"),
    sourceId: uuid("source_id"),
    sourceLocation: text("source_location"),
    ...timestamps(),
  },
  (t) => [
    // 릴리스 내 코드 중복 0건 게이트의 DB 강제
    uniqueIndex("achievement_standards_release_code_uq").on(
      t.releaseId,
      t.code,
    ),
    index("achievement_standards_node_idx").on(t.officialNodeId),
  ],
);

/** 해당 버전이 정의한 교과 역량 */
export const competencyDefinitions = pgTable(
  "competency_definitions",
  {
    id: id(),
    curriculumVersionId: uuid("curriculum_version_id").notNull(),
    releaseId: uuid("release_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    sourceId: uuid("source_id"),
    ...timestamps(),
  },
  (t) => [index("competency_defs_release_idx").on(t.releaseId)],
);

export const conceptStatus = pgEnum("concept_status", [
  "draft",
  "reviewed",
  "active",
  "deprecated",
]);

/**
 * 내부 canonical 개념 — 수업·문항·숙련도 계산의 기준축 (원칙 1).
 * 성취기준과 1:1이 아니다 (2K — 등치 금지).
 * 공식 성취기준처럼 표시하지 않는다.
 */
export const canonicalConcepts = pgTable(
  "canonical_concepts",
  {
    id: id(),
    /** 안정 슬러그 (예: linear-equation-solving) */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** 주 적용 교육과정 버전 (다른 버전 재등장은 alignment로 표현) */
    curriculumVersionId: uuid("curriculum_version_id"),
    schoolLevel: text("school_level"),
    gradeBand: text("grade_band"),
    domainName: text("domain_name"),
    status: conceptStatus("status").notNull().default("draft"),
    /** 근거 요약 — 최소 1개 근거와 검토 상태 보유 게이트 (2L) */
    evidence: jsonb("evidence").notNull().default(sql`'[]'::jsonb`),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("canonical_concepts_slug_uq").on(t.slug),
    index("canonical_concepts_band_idx").on(t.gradeBand, t.status),
  ],
);

/**
 * 기존 프로젝트의 문자열 목차·topic을 canonical concept에 연결하는 별칭.
 * 초벌 매핑 후보일 뿐 승인 전에는 자동 계획에 사용하지 않는다.
 */
export const sourceAliases = pgTable(
  "source_aliases",
  {
    id: id(),
    /** 워크스페이스 고유 별칭이면 org, 전역 별칭이면 null */
    organizationId: uuid("organization_id"),
    sourceSystem: text("source_system").notNull(), // mathg-gen | edutrix | math_test | csv-import …
    aliasText: text("alias_text").notNull(),
    conceptId: uuid("concept_id").notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("source_aliases_uq").on(
      t.organizationId,
      t.sourceSystem,
      t.aliasText,
    ),
    index("source_aliases_concept_idx").on(t.conceptId),
  ],
);

/** 관찰 가능한 학습 목표 — 한 차시 또는 짧은 평가에서 확인 가능 (2M) */
export const learningObjectives = pgTable(
  "learning_objectives",
  {
    id: id(),
    conceptId: uuid("concept_id").notNull(),
    /** 학생이 보여줄 수학적 수행으로 서술 — 페이지 범위 금지 */
    statement: text("statement").notNull(),
    /** 개념 이해·절차 유창성·문제 해결·추론·의사소통·표상 전환 차원 */
    dimensions: jsonb("dimensions").notNull().default(sql`'[]'::jsonb`),
    /** 성공 증거와 허용 가능한 오류 */
    successEvidence: jsonb("success_evidence"),
    allowedTools: jsonb("allowed_tools"),
    expectedMinutes: integer("expected_minutes"),
    status: conceptStatus("status").notNull().default("draft"),
    ...timestamps(),
  },
  (t) => [index("learning_objectives_concept_idx").on(t.conceptId)],
);

export const conceptEdgeKind = pgEnum("concept_edge_kind", [
  "part_of",
  "prerequisite", // 강한 선수 — DAG 강제, 발행 전 순환 차단
  "soft_prerequisite",
  "extends",
  "special_case_of",
  "equivalent_to",
  "contrasts_with",
  "represented_by",
  "misconception_of",
  "assessed_by",
  "transfer_to",
]);

export const edgeProvenance = pgEnum("edge_provenance", [
  "human", // 사람 작성
  "ai_suggested", // AI 제안 — 승인 전 자동 계획 사용 금지
  "imported",
]);

/** 개념 간 관계 (2L). AI 제안이 사람 승인 관계로 가장되지 않게 provenance 분리. */
export const conceptEdges = pgTable(
  "concept_edges",
  {
    id: id(),
    fromConceptId: uuid("from_concept_id").notNull(),
    toConceptId: uuid("to_concept_id").notNull(),
    kind: conceptEdgeKind("kind").notNull(),
    /** 왜 필요한가, 필요한 선행 숙련 깊이, 동시 학습 가능 여부 */
    rationale: text("rationale"),
    requiredDepth: text("required_depth"),
    canTeachConcurrently: boolean("can_teach_concurrently"),
    appliesTo: jsonb("applies_to"), // 학교급·과목·교육과정 버전 제한
    provenance: edgeProvenance("provenance").notNull().default("human"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    evidence: jsonb("evidence").notNull().default(sql`'[]'::jsonb`),
    consensusLevel: text("consensus_level"),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    status: conceptStatus("status").notNull().default("draft"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("concept_edges_uq").on(
      t.fromConceptId,
      t.toConceptId,
      t.kind,
    ),
    index("concept_edges_to_idx").on(t.toConceptId, t.kind),
  ],
);

/** 표상 — 언어, 기호, 식, 표, 그래프, 수직선, 도형, 조작물, 상황 */
export const representations = pgTable(
  "representations",
  {
    id: id(),
    conceptId: uuid("concept_id").notNull(),
    kind: text("kind").notNull(), // verbal | symbolic | equation | table | graph | number_line | figure | manipulative | context
    description: text("description").notNull(),
    example: jsonb("example"),
    ...timestamps(),
  },
  (t) => [index("representations_concept_idx").on(t.conceptId)],
);

/** 오개념 — 관찰 가능한 오류 패턴, 탐지 증거, 교정 전략 */
export const misconceptions = pgTable(
  "misconceptions",
  {
    id: id(),
    conceptId: uuid("concept_id").notNull(),
    name: text("name").notNull(),
    /** 관찰 가능한 오류 패턴 (예: (a+b)² = a²+b²) */
    errorPattern: text("error_pattern").notNull(),
    /** 혼동 대상 개념 */
    confusedWithConceptId: uuid("confused_with_concept_id"),
    detectionEvidence: jsonb("detection_evidence"),
    remediationStrategy: jsonb("remediation_strategy"),
    appliesTo: jsonb("applies_to"),
    sourceNote: text("source_note"),
    status: conceptStatus("status").notNull().default("draft"),
    ...timestamps(),
  },
  (t) => [index("misconceptions_concept_idx").on(t.conceptId)],
);

/** 교수 전략 프로필 — 개념별 권장 수업 시퀀스·예/비예·점진적 책임 이양 */
export const instructionalProfiles = pgTable(
  "instructional_profiles",
  {
    id: id(),
    conceptId: uuid("concept_id").notNull(),
    /** 수직적 학습 진행 단계 (2L — 개념별 필요한 단계만) */
    progressionStages: jsonb("progression_stages").notNull().default(sql`'[]'::jsonb`),
    teachingPatterns: jsonb("teaching_patterns").notNull().default(sql`'[]'::jsonb`),
    examples: jsonb("examples"),
    nonExamples: jsonb("non_examples"),
    toolGuidance: jsonb("tool_guidance"),
    status: conceptStatus("status").notNull().default("draft"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("instructional_profiles_concept_uq").on(t.conceptId)],
);

/** 평가 증거 정의 — 목표 달성을 보여주는 관찰 가능한 수행 */
export const assessmentEvidences = pgTable(
  "assessment_evidences",
  {
    id: id(),
    objectiveId: uuid("objective_id").notNull(),
    description: text("description").notNull(),
    /** 어떤 문항·수행으로 관찰하는가 */
    observableVia: jsonb("observable_via"),
    ...timestamps(),
  },
  (t) => [index("assessment_evidences_objective_idx").on(t.objectiveId)],
);

export const mappingRelationType = pgEnum("mapping_relation_type", [
  "covers", // 개념이 성취기준을 커버
  "partially_covers",
  "extends_beyond", // 성취기준 범위 초과 (선행·심화)
  "aligned_content", // 교재·문항 정렬
]);

/**
 * 공식 노드·성취기준 ↔ 내부 개념·교재·문항의 버전된 연결 (2K).
 * 모든 매핑에 relation_type, confidence, evidence, 검토자, 유효 기간, 버전.
 */
export const curriculumMappings = pgTable(
  "curriculum_mappings",
  {
    id: id(),
    /** 워크스페이스 고유 매핑이면 org, 전역 매핑이면 null */
    organizationId: uuid("organization_id"),
    /** 공식 측: achievement_standard 또는 official_node */
    officialType: text("official_type").notNull(),
    officialId: uuid("official_id").notNull(),
    /** 내부 측: canonical_concept | book_section | question */
    internalType: text("internal_type").notNull(),
    internalId: uuid("internal_id").notNull(),
    relationType: mappingRelationType("relation_type").notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    evidence: jsonb("evidence").notNull().default(sql`'[]'::jsonb`),
    sourceId: uuid("source_id"),
    provenance: edgeProvenance("provenance").notNull().default("human"),
    createdBy: uuid("created_by"),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    version: integer("version").notNull().default(1),
    status: conceptStatus("status").notNull().default("draft"),
    ...timestamps(),
  },
  (t) => [
    index("curriculum_mappings_official_idx").on(t.officialType, t.officialId),
    index("curriculum_mappings_internal_idx").on(t.internalType, t.internalId),
    index("curriculum_mappings_org_idx").on(t.organizationId, t.status),
  ],
);
