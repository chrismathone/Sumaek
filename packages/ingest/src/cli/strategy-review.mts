/**
 * 「전략」 상자로 걸러 낼 내용을 **지우기 전에** 보여 준다.
 *
 *   pnpm --filter @su-maek/ingest strategy-review <answers-dump.json> [--html=<out.html>]
 *
 * 파서가 담아 둔 것을 그대로 읽는다 — 검수 도구가 파싱을 다시 하면 규칙이
 * 어긋나 「검수는 통과했는데 실제로는 다른 것이 지워지는」 일이 생긴다.
 *
 * 수식은 LaTeX 그대로 두지 않고 읽을 수 있는 글자로 옮긴다
 * (`2^{2}\times 3` → `2²×3`). 검수하는 사람이 `2Û_3`을 읽어야 한다면
 * 검수가 되지 않는다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseAnswers, RPM_2022_ANSWERS } from "../answers";
import type { Run, SourceDump } from "../types";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const htmlOut = args.find((a) => a.startsWith("--html="))?.split("=").slice(1).join("=");
if (!file) {
  console.error("사용법: strategy-review <answers-dump.json> [--html=<out.html>]");
  process.exit(1);
}

const dump = JSON.parse(readFileSync(file, "utf8")) as SourceDump;
const parsed = parseAnswers(dump, RPM_2022_ANSWERS);

/** LaTeX을 사람이 읽는 글자로 — 검수용이라 정확한 조판보다 읽힘이 먼저다 */
const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", n: "ⁿ", x: "ˣ", y: "ʸ",
};
function readable(latex: string): string {
  return latex
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2")
    .replace(/\^\{([^{}]*)\}/g, (_m, body: string) =>
      [...body].every((c) => SUP[c] !== undefined)
        ? [...body].map((c) => SUP[c]).join("")
        : `^${body}`,
    )
    .replace(/\\times\s*/g, "×")
    .replace(/\\div\s*/g, "÷")
    .replace(/\\cdots?/g, "…")
    .replace(/[{}]/g, "")
    .trim();
}
const render = (runs: Run[]): string =>
  runs
    .map((r) => (r.kind === "text" ? r.text : readable(r.latex)))
    .join("")
    .trim();
const renderLines = (lines: Run[][]): string[] =>
  lines.map(render).filter((s) => s !== "");

interface Item {
  number: string;
  strategy: string[];
  explanation: string[];
  /** 전략에 문장이 거의 없으면 계산식을 물었다는 뜻 — 경계가 의심스럽다 */
  suspicious: boolean;
}

const items: Item[] = [];
for (const number of [...parsed.keys()].sort()) {
  const answer = parsed.get(number)!;
  const strategy = renderLines(answer.strategy);
  if (strategy.length === 0) continue;
  const joined = strategy.join(" ");
  items.push({
    number,
    strategy,
    explanation: renderLines(answer.explanation),
    suspicious: (joined.match(/[가-힣]/g)?.length ?? 0) < 6,
  });
}
const risky = items.filter((i) => i.suspicious);

if (!htmlOut) {
  console.log(`「전략」 상자 ${items.length}개 · 확인 필요 ${risky.length}개\n`);
  for (const i of items) {
    console.log(
      `  [${i.number}]${i.suspicious ? " ⚠" : "  "} ${i.strategy.join(" ⏎ ").slice(0, 120)}`,
    );
  }
  process.exit(0);
}

/* ── 검수 페이지 ───────────────────────────────────────────── */

const escape = (s: string): string =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );

const row = (i: Item): string => `
<article class="row${i.suspicious ? " row--check" : ""}">
  <div class="row__id">
    <span class="num">${i.number}</span>
    ${i.suspicious ? '<span class="flag">확인</span>' : ""}
  </div>
  <div>
    <p class="cap">빠지는 것 · 전략</p>
    ${i.strategy.map((s) => `<p class="cut">${escape(s)}</p>`).join("")}
  </div>
  <div>
    <p class="cap">남는 것 · 해설</p>
    ${
      i.explanation.length === 0
        ? '<p class="empty">해설 없음</p>'
        : i.explanation.map((s) => `<p class="keep">${escape(s)}</p>`).join("")
    }
  </div>
</article>`;

const html = `<title>전략 상자 검수 — RPM 중1-1</title>
<style>
  :root {
    --paper: #f6f8fa; --card: #ffffff; --ink: #16202e; --ink-soft: #5b6878;
    --rule: #dde3ea; --accent: #1f4e79; --cut: #9a3b34; --cut-bg: #fbf1f0;
    --flag: #b5651d; --flag-bg: #fdf4e9;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #10151c; --card: #171e27; --ink: #e6ecf3; --ink-soft: #9aa8b8;
      --rule: #27313d; --accent: #7db3e0; --cut: #e0918a; --cut-bg: #251a19;
      --flag: #e0a463; --flag-bg: #241d13;
    }
  }
  :root[data-theme="dark"] {
    --paper: #10151c; --card: #171e27; --ink: #e6ecf3; --ink-soft: #9aa8b8;
    --rule: #27313d; --accent: #7db3e0; --cut: #e0918a; --cut-bg: #251a19;
    --flag: #e0a463; --flag-bg: #241d13;
  }
  :root[data-theme="light"] {
    --paper: #f6f8fa; --card: #ffffff; --ink: #16202e; --ink-soft: #5b6878;
    --rule: #dde3ea; --accent: #1f4e79; --cut: #9a3b34; --cut-bg: #fbf1f0;
    --flag: #b5651d; --flag-bg: #fdf4e9;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0 1.25rem 4rem;
    background: var(--paper); color: var(--ink);
    font-family: Pretendard, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR",
                 "Malgun Gothic", system-ui, sans-serif;
    line-height: 1.6; font-size: 15px;
  }
  .wrap { max-width: 1180px; margin: 0 auto; }
  header { padding: 2.5rem 0 1.1rem; border-bottom: 2px solid var(--ink); }
  h1 { margin: 0 0 .3rem; font-size: 1.55rem; font-weight: 700; letter-spacing: -.02em; text-wrap: balance; }
  .sub { margin: 0; color: var(--ink-soft); font-size: .9rem; }
  .stats { display: flex; gap: 2.25rem; margin: 1.2rem 0 0; padding: 0; list-style: none; }
  .stats li { display: flex; flex-direction: column; }
  .stats b { font-size: 1.7rem; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.15; }
  .stats span { font-size: .76rem; letter-spacing: .05em; color: var(--ink-soft); }
  .stats .warn b { color: var(--flag); }
  .note {
    margin: 1.4rem 0 0; padding: .8rem 1rem;
    border-left: 3px solid var(--accent); background: var(--card);
    font-size: .89rem; color: var(--ink-soft);
  }
  .note strong { color: var(--ink); font-weight: 600; }
  .list { margin: 1.6rem 0 0; display: flex; flex-direction: column; gap: .55rem; }
  .row {
    display: grid; grid-template-columns: 5rem 1fr 1fr; gap: 1.2rem;
    padding: .85rem 1rem; background: var(--card);
    border: 1px solid var(--rule); border-radius: 4px;
  }
  .row--check { border-color: var(--flag); background: var(--flag-bg); }
  .row__id { display: flex; flex-direction: column; gap: .3rem; align-items: flex-start; }
  .num {
    font-family: ui-monospace, "SF Mono", Consolas, monospace;
    font-size: .95rem; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--accent);
  }
  .flag {
    font-size: .68rem; font-weight: 600; padding: .08rem .35rem;
    color: var(--flag); border: 1px solid var(--flag); border-radius: 2px;
  }
  .cap { margin: 0 0 .28rem; font-size: .69rem; letter-spacing: .07em; color: var(--ink-soft); font-weight: 600; }
  .cut, .keep, .empty { margin: 0 0 .18rem; }
  .cut {
    color: var(--cut); background: var(--cut-bg);
    padding: .12rem .38rem; border-radius: 2px;
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--cut) 45%, transparent);
  }
  .empty { color: var(--ink-soft); font-style: italic; }
  @media (max-width: 760px) {
    .row { grid-template-columns: 1fr; gap: .5rem; }
    .row__id { flex-direction: row; align-items: center; gap: .5rem; }
  }
</style>
<div class="wrap">
  <header>
    <h1>「전략」 상자 검수</h1>
    <p class="sub">개념원리 RPM 중학 수학 1-1 · 정답 및 해설 · I. 소인수분해</p>
    <ul class="stats">
      <li><b>${items.length}</b><span>빼는 전략 상자</span></li>
      <li class="warn"><b>${risky.length}</b><span>확인 필요</span></li>
      <li><b>${parsed.size}</b><span>전체 문항</span></li>
    </ul>
  </header>

  <p class="note">
    별책은 풀이 앞에 <strong>전략</strong>을 붙여 접근법을 귀띔합니다. 해설이 아니라
    지침이라 문제은행에 넣지 않습니다. 경계는 <strong>글꼴</strong>로 잡았습니다 —
    전략은 고딕, 풀이는 명조로 짜여 있습니다. 그래서 전략 아래 딸린
    <strong>세로셈 표는 풀이로 남습니다</strong>(문항 0197).
    <br />왼쪽 취소선이 빠지는 것, 오른쪽이 남는 해설입니다.
    붉은 쪽에 계산이 섞여 있으면 알려 주세요.
  </p>

  <div class="list">${items.map(row).join("")}</div>
</div>`;

writeFileSync(htmlOut, html, "utf8");
console.log(`전략 상자 ${items.length}개 (확인 필요 ${risky.length}개) → ${htmlOut}`);
