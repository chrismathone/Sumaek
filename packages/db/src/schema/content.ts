import { sql } from "drizzle-orm";
import {
  boolean,
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
import { id, organizationId, timestamps } from "./_shared";

/* ─────────────────────────────────────────────────────────────
 * 콘텐츠 컨텍스트 — 교재·문항·출처 권한 (업로드 워크스페이스 소유)
 * + 수학 표현·출력 컨텍스트 — 구조화 블록, 수식 정규화, 렌더 산출물
 *
 * 원칙: 출처·사용 권한 미확인 문항은 자동 출제 금지 (원칙 9).
 * 수식이 깨진 문항은 게시할 수 없다 (원칙 12).
 * ───────────────────────────────────────────────────────────── */

export const publishers = pgTable(
  "publishers",
  {
    id: id(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("publishers_org_name_uq").on(t.organizationId, t.name)],
);

export const books = pgTable(
  "books",
  {
    id: id(),
    organizationId: organizationId(),
    publisherId: uuid("publisher_id"),
    title: text("title").notNull(),
    schoolLevel: text("school_level"),
    gradeBand: text("grade_band"),
    curriculumVersionId: uuid("curriculum_version_id"),
    ...timestamps(),
  },
  (t) => [index("books_org_idx").on(t.organizationId)],
);

/** 판본·쇄 — 페이지 번호와 문항 번호의 기준 */
export const bookEditions = pgTable(
  "book_editions",
  {
    id: id(),
    organizationId: organizationId(),
    bookId: uuid("book_id").notNull(),
    isbn: text("isbn"),
    editionLabel: text("edition_label").notNull(), // 예: 2026년 개정판 3쇄
    publishedYear: integer("published_year"),
    ...timestamps(),
  },
  (t) => [index("book_editions_book_idx").on(t.bookId)],
);

export const contentRightStatus = pgEnum("content_right_status", [
  "draft", // 초안
  "under_review", // 확인 중
  "usable", // 사용 가능 — 이 상태만 자동 출제 풀 진입
  "restricted", // 제한적 사용
  "expired", // 만료
  "blocked", // 차단
]);

/**
 * 콘텐츠 사용 권한 (27장). 시스템이 권리 확보를 보증한다고 표현하지 않는다 —
 * 근거·증빙의 기록과 집행만 담당한다.
 */
export const contentRights = pgTable(
  "content_rights",
  {
    id: id(),
    organizationId: organizationId(),
    bookEditionId: uuid("book_edition_id"),
    /** 권리자·계약 증빙 요약 (계약서 파일은 객체 스토리지 참조) */
    rightsHolder: text("rights_holder"),
    evidenceRef: text("evidence_ref"),
    /** 허용 용도: 변형·AI 처리·인쇄·온라인 제공 여부 */
    allowedUses: jsonb("allowed_uses").notNull().default(sql`'{}'::jsonb`),
    allowedScope: text("allowed_scope"), // 조직·지역 제한
    expiresOn: timestamp("expires_on", { withTimezone: true }),
    status: contentRightStatus("status").notNull().default("draft"),
    statusChangedBy: uuid("status_changed_by"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("content_rights_org_status_idx").on(t.organizationId, t.status),
    index("content_rights_edition_idx").on(t.bookEditionId),
  ],
);

export const ingestionStatus = pgEnum("ingestion_status", [
  "uploaded",
  "extracting",
  "review_required",
  "approved",
  "rejected",
  "quarantined",
  "published",
]);

/** 원본 파일 — 객체 스토리지에 체크섬과 함께 보존 (불변) */
export const sourceFiles = pgTable(
  "source_files",
  {
    id: id(),
    organizationId: organizationId(),
    bookEditionId: uuid("book_edition_id"),
    /** 객체 스토리지 경로: {organization_id}/sources/{id}/... */
    storagePath: text("storage_path").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    /** sha256 — 멱등성 키의 구성 요소 */
    checksum: text("checksum").notNull(),
    pageCount: integer("page_count"),
    status: ingestionStatus("status").notNull().default("uploaded"),
    uploadedBy: uuid("uploaded_by").notNull(),
    /** 악성코드 검사·MIME 서명 검증 결과 */
    scanResult: jsonb("scan_result"),
    ...timestamps(),
  },
  (t) => [
    index("source_files_org_idx").on(t.organizationId, t.status),
    uniqueIndex("source_files_org_checksum_uq").on(
      t.organizationId,
      t.checksum,
    ),
  ],
);

export const sourcePages = pgTable(
  "source_pages",
  {
    id: id(),
    organizationId: organizationId(),
    sourceFileId: uuid("source_file_id").notNull(),
    pageNumber: integer("page_number").notNull(),
    /** 렌더된 페이지 이미지의 스토리지 경로·체크섬 */
    imagePath: text("image_path"),
    imageChecksum: text("image_checksum"),
    /** 회전 보정·전처리 기록 */
    preprocessing: jsonb("preprocessing"),
    ocrStatus: text("ocr_status").notNull().default("pending"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("source_pages_uq").on(t.sourceFileId, t.pageNumber),
  ],
);

export const questionKind = pgEnum("question_kind", [
  "multiple_choice",
  "short_answer",
  "multi_blank",
  "essay", // 서술형
]);

export const questionReviewStatus = pgEnum("question_review_status", [
  "draft",
  "extracting",
  "review_required",
  "formula_review_required", // 수식 게이트 실패 격리
  "layout_review_required",
  "approved",
  "rejected",
  "quarantined", // 오류 신고·권한 철회 격리
  "published",
]);

/** 문항 — 버전의 컨테이너. 게시된 버전은 불변이다 (불변 조건 2). */
export const questions = pgTable(
  "questions",
  {
    id: id(),
    organizationId: organizationId(),
    /** 현재 활성 버전 포인터 — 원자적 전환 */
    currentVersionId: uuid("current_version_id"),
    kind: questionKind("kind").notNull(),
    reviewStatus: questionReviewStatus("review_status")
      .notNull()
      .default("draft"),
    /** 출처 */
    sourceFileId: uuid("source_file_id"),
    sourcePageId: uuid("source_page_id"),
    bookEditionId: uuid("book_edition_id"),
    printedNumber: text("printed_number"), // 인쇄 문항 번호
    contentRightId: uuid("content_right_id"),
    /** 원본 페이지 내 좌표 (crop bbox) */
    sourceCoords: jsonb("source_coords"),
    /** 자동 출제 가능 여부 — 검수·권한·수식 게이트의 종합 (강한 일관성 전환) */
    isAutoAssignable: boolean("is_auto_assignable").notNull().default(false),
    /** 오류 신고로 격리된 경우의 사유 */
    quarantineReason: text("quarantine_reason"),
    ...timestamps(),
  },
  (t) => [
    index("questions_org_status_idx").on(t.organizationId, t.reviewStatus),
    index("questions_org_assignable_idx").on(
      t.organizationId,
      t.isAutoAssignable,
    ),
    index("questions_source_idx").on(t.sourceFileId),
  ],
);

/**
 * 문항 버전 — 게시 후 수정 불가. 정정은 새 버전 + 명시적 재채점 이벤트 (2I).
 * 본문은 구조화 블록으로 저장하며 LaTeX 문자열이 유일한 진실이 아니다 (2O).
 */
export const questionVersions = pgTable(
  "question_versions",
  {
    id: id(),
    organizationId: organizationId(),
    questionId: uuid("question_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    /** 구조화 블록 배열 (contracts의 StructuredContentBlock 스키마 준수) */
    body: jsonb("body").notNull(),
    /** 선택지 — 표시 문자가 아니라 불변 선택지 ID와 순서 (2P) */
    choices: jsonb("choices"),
    /** 정답 (구조화: 수치·분수·동치식·단위·조건 분리) */
    answer: jsonb("answer"),
    /** 해설 — 구조화 블록 */
    explanation: jsonb("explanation"),
    /** 서술형 채점 루브릭 */
    rubric: jsonb("rubric"),
    points: numeric("points", { precision: 6, scale: 2 }),
    expectedSeconds: integer("expected_seconds"),
    /** 난이도 4분리: 교육과정 내용 수준 / 인지 요구 / 경험 난이도 / 라벨 근거 (2N) */
    difficulty: jsonb("difficulty"),
    questionTypeTags: jsonb("question_type_tags").notNull().default(sql`'[]'::jsonb`),
    /** 렌더링 payload 체크섬 — 평가 스냅샷 고정에 사용 */
    contentChecksum: text("content_checksum").notNull(),
    /** OCR·AI 관여 기록: 모델·프롬프트·파서 버전·신뢰도 */
    extraction: jsonb("extraction"),
    createdBy: uuid("created_by"),
    /** 정정 사유 (버전 2 이상) */
    changeReason: text("change_reason"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("question_versions_uq").on(t.questionId, t.versionNumber),
    index("question_versions_org_idx").on(t.organizationId),
  ],
);

/** 문항 ↔ 개념·성취기준 연결 (정렬 사슬의 한 고리) */
export const questionAlignments = pgTable(
  "question_alignments",
  {
    id: id(),
    organizationId: organizationId(),
    questionId: uuid("question_id").notNull(),
    conceptId: uuid("concept_id").notNull(),
    /** 개념별 기여 가중치 (숙련도 증거 배분) */
    weight: numeric("weight", { precision: 4, scale: 3 }).notNull().default("1"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    provenance: text("provenance").notNull().default("human"), // human | ai_suggested
    reviewedBy: uuid("reviewed_by"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("question_alignments_uq").on(t.questionId, t.conceptId),
    index("question_alignments_concept_idx").on(
      t.organizationId,
      t.conceptId,
    ),
  ],
);

/* ── 수학 표현·출력 ──────────────────────────────────────────── */

export const mathParseStatus = pgEnum("math_parse_status", [
  "pending",
  "parsed",
  "normalized",
  "render_validated",
  "review_required",
  "corrected",
  "rejected",
]);

/**
 * 수식 표현 (2O). raw_source는 불변 — 렌더 HTML은 재생성 가능한 캐시다.
 * 같은 expression_id가 웹·PDF·HWP 산출물에서 유지된다 (인수 54).
 */
export const mathExpressions = pgTable(
  "math_expressions",
  {
    id: id(),
    organizationId: organizationId(),
    questionVersionId: uuid("question_version_id"),
    /** 블록 내 위치 참조 */
    blockRef: text("block_ref"),
    /** OCR·AI·편집기가 처음 만든 원문 — 덮어쓰기 금지 */
    rawSource: text("raw_source").notNull(),
    /** 승인된 정규화 결과 */
    normalizedLatex: text("normalized_latex"),
    displayMode: text("display_mode").notNull().default("inline"), // inline | display
    /** 의미 보존 비교용 정규화 지문 */
    semanticFingerprint: text("semantic_fingerprint"),
    parseStatus: mathParseStatus("parse_status").notNull().default("pending"),
    parseErrors: jsonb("parse_errors"),
    unsupportedCommands: jsonb("unsupported_commands"),
    /** 적용된 무손실 보정 규칙 ID·전후 diff */
    repairActions: jsonb("repair_actions").notNull().default(sql`'[]'::jsonb`),
    normalizerVersion: text("normalizer_version"),
    katexVersion: text("katex_version"),
    macroPolicyVersion: text("macro_policy_version"),
    renderHash: text("render_hash"),
    visualBaselineId: uuid("visual_baseline_id"),
    reviewStatus: text("review_status"),
    reviewer: uuid("reviewer"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("math_expressions_qv_idx").on(t.questionVersionId),
    index("math_expressions_status_idx").on(
      t.organizationId,
      t.parseStatus,
    ),
  ],
);

/** 정규화 실행 기록 — 멱등성·결정성 검증과 규칙별 사용 통계의 근거 */
export const mathNormalizationRuns = pgTable(
  "math_normalization_runs",
  {
    id: id(),
    organizationId: organizationId(),
    expressionId: uuid("expression_id").notNull(),
    normalizerVersion: text("normalizer_version").notNull(),
    inputHash: text("input_hash").notNull(),
    outputHash: text("output_hash").notNull(),
    appliedRules: jsonb("applied_rules").notNull().default(sql`'[]'::jsonb`),
    /** 의미 변경 가능 보정이 감지되면 true — 게시 파이프라인에서는 실패 처리 */
    semanticRisk: boolean("semantic_risk").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("math_norm_runs_expr_idx").on(t.expressionId)],
);

export const renderTarget = pgEnum("render_target", [
  "web",
  "mobile",
  "print_css",
  "pdf",
  "hwpx",
]);

export const renderArtifactStatus = pgEnum("render_artifact_status", [
  "queued",
  "rendering",
  "format_validation",
  "ready",
  "review_required",
  "failed",
]);

/** 렌더 산출물 (문서 출력 상태 머신 2F). 필수 산출물 누락 시 게시 불가 (불변 18). */
export const mathRenderArtifacts = pgTable(
  "math_render_artifacts",
  {
    id: id(),
    organizationId: organizationId(),
    /** 대상: question_version | assessment_instance | report */
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    target: renderTarget("target").notNull(),
    status: renderArtifactStatus("status").notNull().default("queued"),
    /** 객체 스토리지 경로 + 체크섬 */
    storagePath: text("storage_path"),
    checksum: text("checksum"),
    rendererVersion: text("renderer_version"),
    /** 형식 검증 결과: 클리핑·겹침·폭0·기준선·페이지 수 */
    validationReport: jsonb("validation_report"),
    failureReason: text("failure_reason"),
    ...timestamps(),
  },
  (t) => [
    index("render_artifacts_subject_idx").on(
      t.subjectType,
      t.subjectId,
      t.target,
    ),
    index("render_artifacts_status_idx").on(t.organizationId, t.status),
  ],
);

/** 수식 검수 항목 — 게이트 실패 격리함 */
export const formulaReviews = pgTable(
  "formula_reviews",
  {
    id: id(),
    organizationId: organizationId(),
    expressionId: uuid("expression_id").notNull(),
    questionId: uuid("question_id"),
    /** 오류 위치·원인·화면 캡처·추천 수정안 */
    diagnosis: jsonb("diagnosis").notNull(),
    resolution: text("resolution"), // approve_rule | manual_fix | re_ocr | use_crop | quarantine
    resolvedBy: uuid("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    status: text("status").notNull().default("open"), // open | assigned | resolved
    assignedTo: uuid("assigned_to"),
    ...timestamps(),
  },
  (t) => [
    index("formula_reviews_org_status_idx").on(t.organizationId, t.status),
  ],
);

/** 도형 자산 — 구조화 매개변수 + 결정적 SVG + 원본 크롭 보존 (2P) */
export const diagramAssets = pgTable(
  "diagram_assets",
  {
    id: id(),
    organizationId: organizationId(),
    questionVersionId: uuid("question_version_id"),
    /** 좌표계·점·선·각·곡선·라벨 구조화 매개변수 */
    structure: jsonb("structure"),
    /** 정제된 SVG 스토리지 경로 (허용 목록 통과본만) */
    svgPath: text("svg_path"),
    svgChecksum: text("svg_checksum"),
    /** 원본 크롭 이미지 경로 — 벡터 재구성 불확실 시 폴백 */
    originalCropPath: text("original_crop_path"),
    altText: text("alt_text"),
    viewBox: text("view_box"),
    /** 자동 기하 보정 diff — 검수 전 게시 금지 */
    modifications: jsonb("modifications").notNull().default(sql`'[]'::jsonb`),
    sanitizeReport: jsonb("sanitize_report"),
    reviewStatus: text("review_status").notNull().default("pending"),
    ...timestamps(),
  },
  (t) => [index("diagram_assets_qv_idx").on(t.questionVersionId)],
);

/** 기타 문항 자산 (이미지 크롭 등) */
export const questionAssets = pgTable(
  "question_assets",
  {
    id: id(),
    organizationId: organizationId(),
    questionVersionId: uuid("question_version_id").notNull(),
    kind: text("kind").notNull(), // image_crop | table_image | audio …
    storagePath: text("storage_path").notNull(),
    checksum: text("checksum").notNull(),
    altText: text("alt_text"),
    meta: jsonb("meta"),
    ...timestamps(),
  },
  (t) => [index("question_assets_qv_idx").on(t.questionVersionId)],
);

export const duplicateKind = pgEnum("duplicate_kind", [
  "exact_file", // 동일 이미지·파일 해시
  "exact_text", // 정규화 본문·수식 정확 중복
  "numeric_variant", // 숫자만 다른 유사
  "semantic_similar", // 의미상 유사
  "same_source_rescan", // 동일 원본 다른 스캔
]);

/** 중복 그룹 — 자동 병합하지 않고 검수자가 원본·파생·별도를 결정 (15장) */
export const duplicateGroups = pgTable(
  "duplicate_groups",
  {
    id: id(),
    organizationId: organizationId(),
    kind: duplicateKind("kind").notNull(),
    /** 멤버 문항 ID 배열과 유사도 점수 */
    members: jsonb("members").notNull(),
    resolution: jsonb("resolution"),
    resolvedBy: uuid("resolved_by"),
    status: text("status").notNull().default("open"), // open | resolved
    ...timestamps(),
  },
  (t) => [index("duplicate_groups_org_idx").on(t.organizationId, t.status)],
);

/** 콘텐츠 검수 기록 */
export const contentReviews = pgTable(
  "content_reviews",
  {
    id: id(),
    organizationId: organizationId(),
    subjectType: text("subject_type").notNull(), // question | source_file | diagram | mapping
    subjectId: uuid("subject_id").notNull(),
    reviewerId: uuid("reviewer_id"),
    decision: text("decision"), // approve | reject | quarantine | needs_fix
    notes: text("notes"),
    checklist: jsonb("checklist"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    status: text("status").notNull().default("open"),
    ...timestamps(),
  },
  (t) => [
    index("content_reviews_subject_idx").on(t.subjectType, t.subjectId),
    index("content_reviews_org_status_idx").on(t.organizationId, t.status),
  ],
);

/** 문서 출력 (시험지·답안지·리포트의 PDF·HWPX) */
export const documentExports = pgTable(
  "document_exports",
  {
    id: id(),
    organizationId: organizationId(),
    subjectType: text("subject_type").notNull(), // assessment | report | route_plan
    subjectId: uuid("subject_id").notNull(),
    format: renderTarget("format").notNull(),
    /** 용지 규격·여백·머리말 옵션 */
    layoutOptions: jsonb("layout_options"),
    status: renderArtifactStatus("status").notNull().default("queued"),
    storagePath: text("storage_path"),
    checksum: text("checksum"),
    rendererVersion: text("renderer_version"),
    validationReport: jsonb("validation_report"),
    failureReason: text("failure_reason"),
    requestedBy: uuid("requested_by"),
    ...timestamps(),
  },
  (t) => [
    index("document_exports_subject_idx").on(t.subjectType, t.subjectId),
    index("document_exports_org_status_idx").on(t.organizationId, t.status),
  ],
);
