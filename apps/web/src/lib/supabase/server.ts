import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * 서버 클라이언트 — 요청당 1개 (cache).
 * Server Component에서는 쿠키 쓰기가 불가하므로 setAll은 조용히 무시된다
 * (세션 갱신은 proxy.ts의 updateSession이 담당 — eywa 패턴).
 */
export const createClient = cache(async () => {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Component에서 호출된 경우 — proxy가 세션을 갱신하므로 무시
          }
        },
      },
    },
  );
});
