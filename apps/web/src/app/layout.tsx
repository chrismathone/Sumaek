import type { Metadata, Viewport } from "next";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
// KaTeX CSS는 **루트에서 한 번** 로드한다. 이게 없으면 output:"htmlAndMathml"의
// .katex-mathml이 숨겨지지 않아 수식이 두 번 보인다 (x²+y=3 뒤에 x2 + y = 3).
// 이전에는 문항 상세·인쇄 레이아웃에만 있어서 학생 응시 화면이 깨져 있었다.
import "katex/dist/katex.min.css";
import "./globals.css";

const vercelHost =
  process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
const siteOrigin =
  process.env.NEXT_PUBLIC_SITE_URL ??
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
