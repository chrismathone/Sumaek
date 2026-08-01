import { config } from "dotenv";
import type { NextConfig } from "next";

// 워크스페이스 루트의 .env를 로드 (test/setup.ts·packages/db와 동일 규약).
// Next.js는 apps/web 기준으로만 .env를 찾으므로 명시적으로 연결한다.
config({ path: ["../../.env", ".env"] });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@su-maek/core", "@su-maek/contracts", "@su-maek/db"],
};

export default nextConfig;
