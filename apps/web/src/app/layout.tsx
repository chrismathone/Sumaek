import type { Metadata } from "next";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "수맥 — 수학 선생님을 위한 수업 운영 시스템",
    template: "%s | 수맥",
  },
  description:
    "수업 계획은 한 번. 오늘의 진도와 테스트는 자동으로. 반 공통 진도부터 학생별 분기, 자동 출제·채점, 일정 재계산까지.",
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
