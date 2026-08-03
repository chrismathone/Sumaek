import type { Metadata, Viewport } from "next";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
// KaTeX CSS는 **루트에서 한 번** 로드한다. 이게 없으면 output:"htmlAndMathml"의
// .katex-mathml이 숨겨지지 않아 수식이 두 번 보인다 (x²+y=3 뒤에 x2 + y = 3).
// 이전에는 문항 상세·인쇄 레이아웃에만 있어서 학생 응시 화면이 깨져 있었다.
import "katex/dist/katex.min.css";
import "./globals.css";

/* 빈 문자열은 「값이 없다」로 본다.
 *
 * `??`는 undefined·null만 거르고 `""`는 그대로 통과시킨다. 그러면
 * `new URL("")`이 TypeError를 던지고, 루트 레이아웃의 metadata 평가에서
 * 터지므로 **전 페이지가 죽는다.** 그런데 `.env.example`은 바로 그것을
 * 시킨다 — 「Vercel에서는 비워 두면 VERCEL_PROJECT_PRODUCTION_URL을 자동
 * 사용한다」. 키만 남기고 값을 지우는 것이 문서가 안내하는 사용법이다.
 * (`pnpm env:sync`는 빈 값을 건너뛰므로 이 경로로는 안 들어오지만,
 * 로컬 .env와 Vercel 대시보드 직접 입력은 막을 것이 없다.) */
const envValue = (raw: string | undefined) => {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
};

const vercelHost =
  envValue(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
  envValue(process.env.VERCEL_URL);
const siteOrigin =
  envValue(process.env.NEXT_PUBLIC_SITE_URL) ??
  (vercelHost ? `https://${vercelHost}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  applicationName: "수맥",
  title: {
    default: "수맥 — 수학 선생님을 위한 수업 운영 시스템",
    template: "%s | 수맥",
  },
  description:
    "수업 계획은 한 번. 오늘의 진도와 테스트는 자동으로. 반 공통 진도부터 학생별 분기, 자동 출제·채점, 일정 재계산까지.",
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "수맥",
    title: "수맥 — 수학의 맥락을 오늘의 수업으로",
    description:
      "진도, 일일테스트, 확인테스트와 오답 회수 루트를 수업 전에 설계합니다.",
  },
  twitter: {
    card: "summary_large_image",
    title: "수맥 — 수학의 맥락을 오늘의 수업으로",
    description:
      "진도, 일일테스트, 확인테스트와 오답 회수 루트를 수업 전에 설계합니다.",
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#142238",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="min-h-dvh bg-paper text-ink antialiased">{children}</body>
    </html>
  );
}
