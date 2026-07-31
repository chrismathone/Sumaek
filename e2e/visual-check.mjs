#!/usr/bin/env node
/**
 * 시각 검증 캡처 (골프롬프트 29장 시각 검증).
 * 핵심 페이지를 데스크톱·태블릿·모바일 폭으로 캡처하고
 * katex-error·원시 LaTeX 노출·가로 스크롤을 검사한다.
 * 사용: node scripts/visual-check.mjs [baseUrl]
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = "artifacts/visual";

const PAGES = [
  { path: "/", name: "landing" },
  { path: "/demo", name: "demo" },
  { path: "/print/sample", name: "print-sample" },
  { path: "/product", name: "product" },
  { path: "/request-demo", name: "request-demo" },
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 360, height: 780 },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const failures = [];

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    locale: "ko-KR",
  });
  const page = await context.newPage();
  for (const target of PAGES) {
    const url = `${BASE}${target.path}`;
    try {
      const res = await page.goto(url, { waitUntil: "load", timeout: 30000 });
      if (!res || res.status() >= 400) {
        failures.push(`${vp.name} ${target.path}: HTTP ${res?.status()}`);
        continue;
      }
      // 웹 폰트·KaTeX 자산 준비 완료 후 캡처 (2P — 폰트 미로드 캡처 금지)
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      // 수식 게이트 검사
      const katexErrors = await page.locator(".katex-error").count();
      if (katexErrors > 0) {
        failures.push(`${vp.name} ${target.path}: katex-error ${katexErrors}건`);
      }
      const rawMath = await page.locator("code.math-raw").count();
      if (rawMath > 0) {
        failures.push(`${vp.name} ${target.path}: 원시 LaTeX 폴백 ${rawMath}건`);
      }
      // 본문 가로 스크롤 검사 (개별 overflow-x 컨테이너는 허용)
      const hScroll = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      if (hScroll && target.path !== "/print/sample") {
        failures.push(`${vp.name} ${target.path}: 페이지 가로 스크롤 발생`);
      }
      await page.screenshot({
        path: `${OUT}/${target.name}-${vp.name}.png`,
        fullPage: true,
      });
      console.log(`✓ ${vp.name} ${target.path}`);
    } catch (error) {
      failures.push(`${vp.name} ${target.path}: ${error.message.split("\n")[0]}`);
    }
  }
  await context.close();
}

await browser.close();

if (failures.length > 0) {
  console.error("\n✗ 시각 검증 실패:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ 시각 검증 통과 — 캡처: ${OUT}/`);
