import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * 세션 갱신 (eywa 검증 패턴 이식 — docs/phase0/survey/eywa-allinone.md).
 * - getClaims()로 만료 임박 토큰을 refresh시키고, setAll에서 요청·응답
 *   쿠키를 동시에 갱신한 뒤 변경된 request를 통째로 forward한다.
 * - 인증 게이트는 검증 결과가 아니라 **쿠키 존재 여부**로만 판정한다 —
 *   미들웨어 검증 실패를 로그아웃으로 만들면 로그인 무한루프가 된다
 *   (실사고). 진짜 검증은 레이아웃의 getCurrentUser가 한다.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // refresh 트리거 — 결과는 게이트에 사용하지 않는다
  await supabase.auth.getClaims();

  const { pathname } = request.nextUrl;
  const needsAuth =
    pathname.startsWith("/app") || pathname.startsWith("/learn");
  if (needsAuth) {
    const hasSession = request.cookies
      .getAll()
      .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
    if (!hasSession) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  return response;
}
