/**
 * Drizzle 스키마 — 도메인 컨텍스트별 파일로 분리.
 *
 * 금지 도메인(수납·상담·전자출결·차량·급여·CRM)의 엔터티는 이 스키마에 둘 수 없다.
 * `scripts/boundary-check.mjs`가 CI·빌드에서 이를 강제한다.
 *
 * FK·RLS·EXCLUDE 제약·파티션은 drizzle이 표현하지 못하는 부분을 포함해
 * `migrations/NNNNa_*.sql` 수기 마이그레이션에서 관리한다 (2갈래 규약).
 */
export * from "./workspace";
export * from "./infra";
export * from "./instruction";
export * from "./curriculum";
export * from "./content";
export * from "./route";
export * from "./assessment";
export * from "./learning";
export * from "./support";
