import { createBrowserClient } from "@supabase/ssr";

/** 브라우저 클라이언트 — 컴포넌트에서 인증 상태 구독·로그인 흐름에만 사용 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
