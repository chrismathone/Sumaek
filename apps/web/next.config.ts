import { config } from "dotenv";
import type { NextConfig } from "next";

// 워크스페이스 루트의 .env를 로드 (test/setup.ts·packages/db와 동일 규약).
// Next.js는 apps/web 기준으로만 .env를 찾으므로 명시적으로 연결한다.
config({ path: ["../../.env", ".env"] });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@su-maek/core", "@su-maek/contracts", "@su-maek/db"],
  /* 개발 전용 — 교사·학생 세션을 한 브라우저에서 나란히 띄우기 위한 것.
   * 쿠키는 포트로 격리되지 않으므로(RFC 6265) dev 서버를 두 개 띄워도
   * 세션이 서로 덮인다. 호스트명을 달리하면(localhost / 127.0.0.1) 쿠키가
   * host-only라 통이 갈린다. 다만 Next dev는 기본적으로 localhost 외의
   * 오리진에서 /_next/* 요청을 막아 **하이드레이션이 통째로 죽는다** —
   * 화면은 그려지지만 버튼·입력이 아무 반응을 하지 않는다.
   * 프로덕션 빌드에는 영향이 없다 (dev 서버 전용 설정). */
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
