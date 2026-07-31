import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * 공통 컬럼 헬퍼.
 * - ID는 UUIDv7(앱에서 생성, uuid v11)이 기본이며 DB 기본값은 gen_random_uuid() 폴백.
 * - 모든 시간은 UTC(timestamptz). 수업 날짜 계산에 쓴 시간대 ID는 각 도메인이 별도 보존.
 */

export const id = () =>
  uuid("id").primaryKey().default(sql`gen_random_uuid()`);

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** 테넌트 스코프 — 모든 테넌트 데이터 테이블에 필수. RLS 정책의 기준 컬럼. */
export const organizationId = () => uuid("organization_id").notNull();

export const timestamps = () => ({
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
