import { z } from "zod";

/* ─────────────────────────────────────────────────────────────
 * API 공통 계약 (골프롬프트 2G)
 * - 조회: 커서 페이지네이션
 * - 모든 응답에 trace_id와 주요 데이터 버전
 * - 모든 쓰기에 Idempotency-Key
 * - 편집 명령은 aggregate version + If-Match 낙관적 잠금
 * - 안정된 오류 코드 + 사용자 해결 방법 + 재시도 가능 여부
 * ───────────────────────────────────────────────────────────── */

/** 커서: base64url(JSON{k: 정렬키 값, id: 타이브레이커 UUID}) */
export const cursorQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const pageMeta = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export const apiErrorCode = z.enum([
  // 요청
  "VALIDATION_FAILED",
  "IDEMPOTENCY_KEY_CONFLICT", // 같은 키 + 다른 payload
  "IDEMPOTENCY_IN_PROGRESS",
  "VERSION_CONFLICT", // If-Match 불일치 — 낙관적 잠금
  "STALE_PREVIEW", // 원본 버전 변경 후 apply 시도
  // 권한
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "SCOPE_DENIED", // 역할은 있으나 대상 범위 밖
  "REAUTH_REQUIRED", // 위험 작업 재인증 필요
  // 도메인
  "INVALID_STATE_TRANSITION",
  "HARD_CONSTRAINT_VIOLATION", // 휴일·충돌·학습량 상한
  "QUESTION_POOL_INSUFFICIENT",
  "CONTENT_NOT_ASSIGNABLE", // 검수·권한 미통과 문항
  "FORMULA_GATE_FAILED",
  "CURRICULUM_VERSION_MISMATCH",
  "LOCKED_RESOURCE",
  "ALREADY_SUBMITTED",
  "SEQUENCE_CONFLICT", // 답안 저장 시퀀스 역행
  // 시스템
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "KILL_SWITCH_ACTIVE",
  "INTERNAL",
]);

export type ApiErrorCode = z.infer<typeof apiErrorCode>;

export const apiError = z.object({
  code: apiErrorCode,
  /** 무엇이 실패했고 어떻게 다시 진행하는지 (26장 문구 원칙) */
  message: z.string(),
  resolution: z.string().optional(),
  retryable: z.boolean(),
  traceId: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ApiError = z.infer<typeof apiError>;

export const apiMeta = z.object({
  traceId: z.string(),
  /** 응답이 기준으로 삼은 주요 데이터 버전 */
  dataVersions: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  /** 파생 데이터의 마지막 반영 시각 (최종 일관성 화면 표기용) */
  freshAsOf: z.iso.datetime().optional(),
});

/** 장시간 작업 접수 응답 (2G — 작업 ID 즉시 반환) */
export const jobAccepted = z.object({
  jobId: z.uuid(),
  status: z.enum(["queued", "running"]),
  statusUrl: z.string(),
  /** SSE 진행률 스트림 경로 */
  progressUrl: z.string().optional(),
});

export type JobAccepted = z.infer<typeof jobAccepted>;

/** preview → apply 계약 (2H·2G): 입력 버전 + 결과 해시가 일치할 때만 적용 */
export const previewApplyRequest = z.object({
  previewId: z.uuid(),
  inputHash: z.string(),
  outputHash: z.string(),
});
