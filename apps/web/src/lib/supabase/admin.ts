import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * service_role 관리자 클라이언트 — RLS 우회. 서버 전용.
 * 계정 생성·초대 수락 등 관리 작업에만 사용하고, 일반 데이터 접근은
 * 서버 데이터 계층(createSql)과 권한 검사를 거친다.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.");
  }
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
