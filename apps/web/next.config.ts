import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@su-maek/core", "@su-maek/contracts", "@su-maek/db"],
};

export default nextConfig;
