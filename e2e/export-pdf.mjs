#!/usr/bin/env node
/**
 * PDF 출력 검증 (골프롬프트 2P PDF·인쇄) — 워커 export.pdf 핸들러의 원형.
 * /print/* 경로를 A4 PDF로 인쇄하고 기본 무결성을 검사한다.
 * 사용: node export-pdf.mjs [path] [outFile]
 */
import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const path = process.argv[2] ?? "/print/sample";
const out = process.argv[3] ?? "artifacts/sample-exam.pdf";

await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 30000 });
// 폰트·KaTeX 자산 준비 완료 후 렌더 (2P — 미로드 캡처 금지)
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);

// 게시 게이트 재확인 — katex-error·원시 폴백이 있으면 출력 자체를 실패시킨다
const katexErrors = await page.locator(".katex-error").count();
const rawFallback = await page.locator("code.math-raw").count();
if (katexErrors > 0 || rawFallback > 0) {
  console.error(
    `✗ 수식 게이트 위반 — katex-error ${katexErrors}건, 원시 폴백 ${rawFallback}건. 출력 중단.`,
  );
  await browser.close();
  process.exit(1);
}

const pdf = await page.pdf({
  format: "A4",
  printBackground: true,
  preferCSSPageSize: true,
});
await writeFile(out, pdf);
await browser.close();

// 무결성 검사: PDF 헤더, 최소 크기, 페이지 수
const bytes = await readFile(out);
const header = bytes.subarray(0, 5).toString("latin1");
const pageCount = (bytes.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? [])
  .length;
if (header !== "%PDF-" || bytes.length < 10_000 || pageCount < 1) {
  console.error(
    `✗ PDF 무결성 실패 — header=${header}, size=${bytes.length}, pages=${pageCount}`,
  );
  process.exit(1);
}
console.log(
  `✓ PDF 출력 성공 — ${out} (${(bytes.length / 1024).toFixed(0)}KB, ${pageCount}쪽)`,
);
