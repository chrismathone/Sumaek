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
import { id, organizationId, timestamps } from "./_shared";

/* ─────────────────────────────────────────────────────────────
 * 학습 지능 컨텍스트
 * 소유: 학습 증거, 개념 숙련도, 오답 복습, 재시험, 다음 학습 추천
 *
 * MasteryEvidence는 불변 원본. ConceptMastery는 정책 버전·cutoff로
 * 재현 가능한 파생 결과다 (20장·불변 조건 11).
 * ───────────────────────────────────────────────────────────── */

/**
 * 숙련도 정책 버전 — 임계값을 코드 상수로 두지 않는다 (20장).
 * 목적·학년군·개념별 정책. 정책이 바뀌어도 과거 결과를 다시 쓰지 않는다.
 */
export const masteryPolicyVersions = pgTable(
  "mastery_policy_versions",
  {
    id: id(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    /** 적용 범위: 학년군·개념·평가 목적 */
    appliesTo: jsonb("applies_to").notNull().default(sql`'{}'::jsonb`),
    /**
     * 정책 본문: 최소 증거 수, 서로 다른 학습일 수, 지연 확인 간격,
     * 필수 차원(이해·절차·적용·추론), 난이도 가중, 최근성 감쇠,
     * 상태 전이 조건, 교사 승인 조건
     */
    spec: jsonb("spec").notNull(),
    algorithmVersion: text("algorithm_version").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("mastery_policies_uq").on(
      t.organizationId,
      t.name,
      t.version,
    ),
  ],
);

/**
 * 학습 증거 — 불변 append-only. 일반 수정 API로 변경·삭제 불가 (불변 조건 15).
 * 최종 채점 한 건은 정확히 한 번 반영된다 (불변 조건 10 — grade_decision_id 고유).
 */
export const masteryEvidences = pgTable(
  "mastery_evidences",
  {
    id: id(),
    organizationId: organizationId(),
    learnerId: uuid("learner_id").notNull(),
    conceptId: uuid("concept_id").notNull(),
    /** 출처: 최종 채점 결정 (테스트 증거인 경우) */
    gradeDecisionId: uuid("grade_decision_id"),
    /** 출처: 교사 관찰·수동 판정 */
    kind: text("kind").notNull(), // graded_response | teacher_observation | diagnostic | transfer_check
    /** 증거 내용: 정오, 점수 비율, 난이도, 인지 요구, 표상, 힌트, 소요 시간, 맥락 */
    signal: jsonb("signal").notNull(),
    /** 문항 매핑 신뢰도 (증거 가중의 입력) */
    mappingConfidence: numeric("mapping_confidence", {
      precision: 4,
      scale: 3,
    }),
    /** 독립 학습일 판정용 — 워크스페이스 시간대 기준 날짜 */
    evidenceDate: date("evidence_date").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recordedBy: uuid("recorded_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("mastery_evidences_learner_concept_idx").on(
      t.organizationId,
      t.learnerId,
      t.conceptId,
      t.occurredAt,
    ),
    // 최종 채점 1건 = 개념당 증거 1건
    uniqueIndex("mastery_evidences_decision_uq")
      .on(t.gradeDecisionId, t.conceptId)
      .where(sql`grade_decision_id is not null`),
  ],
);

export const masteryState = pgEnum("mastery_state", [
  "no_evidence", // 근거 없음
  "exploring", // 탐색 중
  "partial", // 부분 이해
  "stable", // 안정적 수행
  "transfer_confirmed", // 전이 확인
  "recheck_needed", // 재점검 필요
]);

/**
 * 개념 숙련도 — 파생 결과 (재계산 가능). 원본 증거·cutoff·알고리즘 버전으로
 * 재현할 수 있어야 한다 (불변 조건 11). 자동 상태 변경의 원인과 증거를
 * 교사가 열람하고 되돌릴 수 있다.
 */
export const conceptMasteries = pgTable(
  "concept_masteries",
  {
    id: id(),
    organizationId: organizationId(),
    learnerId: uuid("learner_id").notNull(),
    conceptId: uuid("concept_id").notNull(),
    state: masteryState("state").notNull().default("no_evidence"),
    /** 점 추정치 0~1 */
    pointEstimate: numeric("point_estimate", { precision: 4, scale: 3 }),
    /** 불확실성 (표준오차 등) */
    uncertainty: numeric("uncertainty", { precision: 4, scale: 3 }),
    evidenceCount: integer("evidence_count").notNull().default(0),
    distinctDays: integer("distinct_days").notNull().default(0),
    lastEvidenceAt: timestamp("last_evidence_at", { withTimezone: true }),
    /** 차원별 상태: 이해·절차·적용·추론·표상 */
    dimensions: jsonb("dimensions"),
    /** 다음 확인 조건·예정일 (지연 확인) */
    nextCheck: jsonb("next_check"),
    /** 재현 입력: 정책 버전·증거 cutoff */
    policyVersionId: uuid("policy_version_id"),
    evidenceCutoffAt: timestamp("evidence_cutoff_at", { withTimezone: true }),
    /** 교사 수동 재판정 기록 */
    teacherOverride: jsonb("teacher_override"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("concept_masteries_uq").on(t.learnerId, t.conceptId),
    index("concept_masteries_org_state_idx").on(
      t.organizationId,
      t.state,
    ),
  ],
);

export const reviewItemStatus = pgEnum("review_item_status", [
  "scheduled",
  "presented",
  "completed",
  "skipped",
  "expired",
]);

/** 오답·간격 복습 항목 */
export const reviewItems = pgTable(
  "review_items",
  {
    id: id(),
    organizationId: organizationId(),
    learnerId: uuid("learner_id").notNull(),
    conceptId: uuid("concept_id").notNull(),
    /** 원인: 오답 응답 참조 또는 간격 반복 스케줄 */
    sourceKind: text("source_kind").notNull(), // wrong_answer | spaced_repetition | teacher_assigned
    sourceResponseId: uuid("source_response_id"),
    questionId: uuid("question_id"),
    dueOn: date("due_on").notNull(),
    intervalDays: integer("interval_days"),
    status: reviewItemStatus("status").notNull().default("scheduled"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    outcome: jsonb("outcome"),
    /* ── 망각곡선 (0010a) ──
     * 안정성은 여기 산다 — 복습 결과는 숙련도 증거가 아니므로
     * concept_masteries로 새면 안 된다 (불변 조건 10). */
    /** 안정성 S(일) — 지금 복습하면 목표 유지율까지 버티는 일수 */
    stabilityDays: numeric("stability_days", { precision: 6, scale: 2 }),
    /** 몇 번째 복습인가 (0 = 아직 한 번도 안 봄) */
    repetitionNo: integer("repetition_no").notNull().default(0),
    /** 놓친 누적 횟수 */
    lapseCount: integer("lapse_count").notNull().default(0),
    /** 마지막으로 실제 복습한 날 — 예측 기억률의 기준점 */
    lastReviewedOn: date("last_reviewed_on"),
    ...timestamps(),
  },
  (t) => [
    index("review_items_learner_due_idx").on(
      t.organizationId,
      t.learnerId,
      t.status,
      t.dueOn,
    ),
  ],
);

export const retryPlanStatus = pgEnum("retry_plan_status", [
  "planned",
  "in_progress",
  "passed",
  "failed",
  "cancelled",
]);

/**
 * 재시험 계획 — 확인테스트 미통과 후 보충 경로와 재시험.
 * 동일 문항 재노출이 아니라 같은 목표의 동등 문항으로 구성 (2N).
 */
export const retryPlans = pgTable(
  "retry_plans",
  {
    id: id(),
    organizationId: organizationId(),
    learnerId: uuid("learner_id").notNull(),
    /** 미통과 원 평가 */
    failedAssessmentId: uuid("failed_assessment_id").notNull(),
    failedAttemptId: uuid("failed_attempt_id"),
    /** 보충 오버라이드 (학습 경로 컨텍스트 참조) */
    remediationOverrideId: uuid("remediation_override_id"),
    /** 재시험 평가 (생성 후 연결) */
    retryAssessmentId: uuid("retry_assessment_id"),
    attemptNumber: integer("attempt_number").notNull().default(1),
    maxAttempts: integer("max_attempts"),
    scheduledOn: date("scheduled_on"),
    status: retryPlanStatus("status").notNull().default("planned"),
    /** 통과 후 해제할 다음 개념·루트 노드 */
    unlockTargets: jsonb("unlock_targets"),
    ...timestamps(),
  },
  (t) => [
    index("retry_plans_learner_idx").on(
      t.organizationId,
      t.learnerId,
      t.status,
    ),
  ],
);

/* ─────────────────────────────────────────────────────────────
 * 학습 자료 (개념 공부 · 인강 · 연습문제).
 *
 * 학생 화면이 오랫동안 "시험지"였던 이유는 **공부할 것이 DB에 없었기**
 * 때문이다. 개념 이름과 차시 제목만 있고 읽을 것·볼 것·풀어 볼 것이 없었다.
 * 이 두 테이블이 그 자리다.
 *
 * 설계 결정 셋:
 *  1. **개념에 붙인다** (차시나 루트 노드가 아니라). 같은 개념은 반·학년이
 *     달라도 같은 자료를 쓰고, 루트가 바뀌어도 자료가 따라 죽지 않는다.
 *  2. **연습문제는 문항을 복제하지 않는다.** questionIds로 문제은행을
 *     참조한다 — 복제하면 정답·검수 상태가 두 곳에서 갈라진다 (불변 조건 8의
 *     정신). 비워 두면 그 개념의 출제 가능 문항에서 자동으로 고른다.
 *  3. **진도는 학습자별로 따로 쌓는다.** 자료 자체는 조직 공유물이고,
 *     "누가 어디까지 봤는가"는 학습자 데이터다. 섞으면 자료를 고칠 때
 *     진도가 날아간다.
 *
 * 연습문제 결과는 **숙련도 증거가 아니다** — 증거는 채점된 평가에서만
 * 나온다 (불변 조건 10). 연습은 진도와 자기 확인용이다.
 * ───────────────────────────────────────────────────────────── */

export const learningMaterialKind = pgEnum("learning_material_kind", [
  /** 읽는 개념 설명 */
  "reading",
  /** 개념 인강 (외부 영상 링크) */
  "video",
  /** 연습문제 묶음 */
  "practice",
]);

export const learningMaterialStatus = pgEnum("learning_material_status", [
  "draft",
  "published",
  "archived",
]);

export const learningMaterials = pgTable(
  "learning_materials",
  {
    id: id(),
    organizationId: organizationId(),
    conceptId: uuid("concept_id").notNull(),
    kind: learningMaterialKind("kind").notNull(),
    title: text("title").notNull(),
    /** reading 본문 (문항 본문과 같은 블록 형식 — 수식 포함) */
    body: jsonb("body"),
    /** video 재생 주소. 외부 호스팅만 — 이 제품은 영상을 보관하지 않는다 */
    videoUrl: text("video_url"),
    /** 영상 길이(초) — 학생에게 "몇 분짜리인지" 미리 알려 주기 위한 것 */
    videoSeconds: integer("video_seconds"),
    /** practice에서 낼 문항. 비우면 개념의 출제 가능 문항에서 자동 선정 */
    questionIds: jsonb("question_ids").notNull().default(sql`'[]'::jsonb`),
    /**
     * AI 생성 고지 (0012a) — 학생 화면에 그대로 보여 준다.
     * 자료와 함께 저장하는 이유: 유튜브 설명란에만 적으면 임베드로 보는
     * 학생에게는 보이지 않고, 옮겨 적는 순간 빠질 수 있다.
     */
    disclosure: text("disclosure"),
    /** 이 자료를 만든 파이프라인 잡 ID (0012a) — 재생성·추적의 연결 고리 */
    sourceJobId: text("source_job_id"),
    /**
     * 출처 메타데이터 (0014a) — 교재에서 반입한 자료의 「어느 교재 몇 쪽
     * 어느 개념」. 교사용 여백 주석도 여기 담는다. 학생 화면에 노출 금지.
     */
    sourceRef: jsonb("source_ref"),
    /**
     * 정제 계보 (0015a) — 정제본이 가리키는 원본(추출본) 자료 id.
     * FK 없음: 원본이 보관·삭제돼도 정제본은 살아야 한다.
     */
    derivedFromMaterialId: uuid("derived_from_material_id"),
    /** 같은 개념 안의 표시 순서 (읽기 → 인강 → 연습 순서를 정하는 곳) */
    sortOrder: integer("sort_order").notNull().default(0),
    status: learningMaterialStatus("status").notNull().default("draft"),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    index("learning_materials_concept_idx").on(
      t.organizationId,
      t.conceptId,
      t.status,
      t.sortOrder,
    ),
    // 정제 잡의 멱등 판정·나란히 보기가 읽는다 (0015a)
    index("learning_materials_derived_idx")
      .on(t.organizationId, t.derivedFromMaterialId)
      .where(sql`derived_from_material_id is not null`),
  ],
);

export const materialProgressStatus = pgEnum("material_progress_status", [
  "in_progress",
  "completed",
]);

export const learnerMaterialProgress = pgTable(
  "learner_material_progress",
  {
    id: id(),
    organizationId: organizationId(),
    learnerId: uuid("learner_id").notNull(),
    materialId: uuid("material_id").notNull(),
    status: materialProgressStatus("status").notNull().default("in_progress"),
    /** practice 결과(맞은 수/전체) 등 자료 종류별 기록 */
    result: jsonb("result"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("learner_material_progress_uq").on(t.learnerId, t.materialId),
    index("learner_material_progress_learner_idx").on(
      t.organizationId,
      t.learnerId,
      t.status,
    ),
  ],
);

/* ─────────────────────────────────────────────────────────────
 * 개념 빈칸 (0016a) — 인강을 보고 넘어가는 것이 아니라 인출하게.
 *
 * 자료에서 파생하지 않고 따로 저장한다: 빈칸은 적은 수를 정확한 자리에
 * 놓아야 인출이 되고, 많으면 받아쓰기가 된다. 그 판단은 검수 대상이므로
 * 자료와 같은 draft → published 흐름을 탄다. 자세한 근거는 마이그레이션
 * 0016a_concept_blanks.sql의 머리글에 있다.
 * ───────────────────────────────────────────────────────────── */

export const conceptBlankStage = pgEnum("concept_blank_stage", [
  "one",
  "two",
  "full",
]);

export const conceptBlankStatus = pgEnum("concept_blank_status", [
  "draft",
  "published",
  "archived",
]);

export const conceptBlankSets = pgTable(
  "concept_blank_sets",
  {
    id: id(),
    organizationId: organizationId(),
    conceptId: uuid("concept_id").notNull(),
    stage: conceptBlankStage("stage").notNull(),
    /** 빈칸이 뚫린 본문 — 자리는 {{1}}·{{2}}. full 단계에는 없다 */
    templateText: text("template_text"),
    /** [{position, answer, hint, alternatives[]}] */
    blanks: jsonb("blanks").notNull().default([]),
    /** 어느 자료에서 왔는가 — 원본 변경을 검수에서 대조할 근거 */
    sourceMaterialId: uuid("source_material_id"),
    status: conceptBlankStatus("status").notNull().default("draft"),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("concept_blank_sets_uq").on(
      t.organizationId,
      t.conceptId,
      t.stage,
    ),
    index("concept_blank_sets_concept_idx").on(
      t.organizationId,
      t.conceptId,
      t.status,
    ),
  ],
);

export const learnerBlankProgress = pgTable(
  "learner_blank_progress",
  {
    id: id(),
    organizationId: organizationId(),
    learnerId: uuid("learner_id").notNull(),
    blankSetId: uuid("blank_set_id").notNull(),
    status: materialProgressStatus("status").notNull().default("in_progress"),
    /** 최고 기록 — 다시 풀어 더 틀려도 내려가지 않는다 */
    bestCorrect: integer("best_correct").notNull().default(0),
    totalCount: integer("total_count").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    result: jsonb("result"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("learner_blank_progress_uq").on(t.learnerId, t.blankSetId),
    index("learner_blank_progress_learner_idx").on(
      t.organizationId,
      t.learnerId,
      t.status,
    ),
  ],
);
