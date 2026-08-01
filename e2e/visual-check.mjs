#!/usr/bin/env node
/**
 * 시각 검증 캡처 (골프롬프트 29장 시각 검증).
 * 핵심 페이지를 데스크톱·태블릿·모바일 폭으로 캡처하고
 * katex-error·원시 LaTeX 노출·가로 스크롤을 검사한다.
 * 사용: node e2e/visual-check.mjs [baseUrl]
 *
 * 교사 앱은 로그인이 필요하다. DEMO_TEACHER_PASSWORD가 없으면 그 구간만
 * 건너뛰고 건너뛴 사실을 출력한다 — 조용히 통과시키면 "교사 앱 시각 회귀
 * 없음"이라는 거짓 결론이 남는다.
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = "artifacts/visual";

const PUBLIC_PAGES = [
  { path: "/", name: "landing" },
  { path: "/demo", name: "demo" },
  { path: "/print/sample", name: "print-sample" },
  { path: "/product", name: "product" },
  { path: "/request-demo", name: "request-demo" },
];

const TEACHER_PAGES = [
  { path: "/app/today", name: "app-today" },
  { path: "/app/classes", name: "app-classes" },
  { path: "/app/students", name: "app-students" },
  { path: "/app/calendar", name: "app-calendar" },
  { path: "/app/routes", name: "app-routes" },
  { path: "/app/settings", name: "app-settings" },
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 360, height: 780 },
];

const TEACHER_EMAIL = process.env.DEMO_TEACHER_EMAIL ?? "demo-teacher@su-maek.app";
// 기본 비밀번호를 넣지 않는다 — 없으면 건너뛰었다고 말해야 한다
const TEACHER_PASSWORD = process.env.DEMO_TEACHER_PASSWORD;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const failures = [];

/** 한 화면을 열고 게이트 검사 후 캡처한다. 실패는 failures에 쌓는다. */
async function capture(page, target, vp) {
  const url = `${BASE}${target.path}`;
  try {
    const res = await page.goto(url, { waitUntil: "load", timeout: 30000 });
    if (!res || res.status() >= 400) {
      failures.push(`${vp.name} ${target.path}: HTTP ${res?.status()}`);
      return;
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

/** 교사 계정으로 로그인. 실패하면 이유를 돌려주고 해당 폭의 교사 앱 캡처는 포기한다. */
async function login(page) {
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 30000 });
    await page.getByLabel("이메일").fill(TEACHER_EMAIL);
    await page.getByLabel("비밀번호").fill(TEACHER_PASSWORD);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForURL(/\/app\/today/, { timeout: 30000 });
    return null;
  } catch (error) {
    return error.message.split("\n")[0];
  }
}

if (!TEACHER_PASSWORD) {
  console.log(
    "! DEMO_TEACHER_PASSWORD 미설정 — 교사 앱 캡처를 건너뜁니다 " +
      `(${TEACHER_PAGES.map((p) => p.path).join(", ")}). ` +
      "이번 실행은 마케팅 화면만 검증했습니다.",
  );
}

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    locale: "ko-KR",
  });
  const page = await context.newPage();

  for (const target of PUBLIC_PAGES) await capture(page, target, vp);

  if (TEACHER_PASSWORD) {
    const loginError = await login(page);
    if (loginError) {
      failures.push(`${vp.name} 교사 로그인 실패: ${loginError}`);
    } else {
      for (const target of TEACHER_PAGES) await capture(page, target, vp);
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
const scope = TEACHER_PASSWORD ? "마케팅 + 교사 앱" : "마케팅만 (교사 앱 건너뜀)";
console.log(`\n✓ 시각 검증 통과 — ${scope}, 캡처: ${OUT}/`);
