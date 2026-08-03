import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/** Next.js 16 프록시 (구 middleware) — 세션 갱신 + 보호 경로 게이트 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // 정적 자산·API·SEO 파일 제외 — 요청마다 함수를 깨우지 않는다 (eywa 실측)
  matcher: [
    "/((?!api|_next|fonts|favicon.ico|robots.txt|sitemap.xml|manifest.json|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|webmanifest|woff2?|ttf|css|js|map|pdf)$).*)",
  ],
};
