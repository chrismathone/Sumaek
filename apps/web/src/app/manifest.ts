import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "수맥 — 수학 수업 운영 시스템",
    short_name: "수맥",
    description:
      "진도, 일일테스트, 확인테스트와 오답 회수 루트를 수업 전에 설계하는 수학 교사용 운영 시스템",
    lang: "ko-KR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F5F1E8",
    theme_color: "#142238",
    categories: ["education", "productivity"],
    icons: [
      {
        src: "/brand/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
