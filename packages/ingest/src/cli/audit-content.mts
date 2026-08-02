/**
 * 추출 내용 전수검사 — **렌더가 아니라 내용을 본다.**
 *
 *   pnpm --filter @su-maek/ingest audit-content \
 *     --book=<본책.json> --answers=<별책.json> [--kind=위첨자-소실] [--md=<파일>]
 *
 * `audit-katex`는 「그려지는가」를 묻는다. 이 도구는 「지면과 같은가」를
 * 묻는다. 둘은 다른 질문이다 — `2b\times 3^{b}`는 아무 오류 없이 그려지지만
 * 지면의 `2^a×3^b`와 다른 식이고, 그 차이는 렌더로는 영원히 안 드러난다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseAnswers, RPM_2022_ANSWERS } from "../answers";
import { auditAnswer, auditQuestion, type Finding } from "../audit";
import { RPM_2022 } from "../profiles/rpm-2022";
import { extractPage } from "../segment";
import type { SourceDump } from "../types";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const bookPath = arg("book");
const answersPath = arg("answers");
if (!bookPath && !answersPath) {
  console.error("사용법: audit-content --book=<본책.json> --answers=<별책.json> [--kind=…] [--md=<파일>]");
  process.exit(1);
}

const findings: Finding[] = [];
let questions = 0;
let answers = 0;

if (bookPath) {
  const dump = JSON.parse(readFileSync(bookPath, "utf8")) as SourceDump;
  for (const page of dump.pages) {
    for (const q of extractPage(page, RPM_2022).questions) {
      questions++;
      findings.push(...auditQuestion(q));
    }
  }
}
if (answersPath) {
  const dump = JSON.parse(readFileSync(answersPath, "utf8")) as SourceDump;
  for (const [n, a] of parseAnswers(dump, RPM_2022_ANSWERS)) {
    answers++;
    findings.push(...auditAnswer(n, a));
  }
}

const only = arg("kind");
const shown = only ? findings.filter((f) => f.kind === only) : findings;

const byKind = new Map<string, Finding[]>();
for (const f of findings) {
  const list = byKind.get(f.kind) ?? [];
  list.push(f);
  byKind.set(f.kind, list);
}

console.log(`문항 ${questions}개 · 답 ${answers}개 검사`);
console.log(`${"─".repeat(56)}`);
for (const [kind, list] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
  const hit = new Set(list.map((f) => f.printedNumber));
  console.log(`  ${kind.padEnd(16)} ${String(list.length).padStart(4)}건 · 문항 ${hit.size}개`);
}
console.log(`${"─".repeat(56)}`);
console.log(`  합계 ${findings.length}건 · 문항 ${new Set(findings.map((f) => f.printedNumber)).size}개`);

if (only || args.includes("--verbose")) {
  console.log("");
  for (const f of shown.slice(0, 200)) {
    console.log(`[${f.printedNumber}] ${f.where} · ${f.kind}`);
    console.log(`    ${f.detail}`);
    if (f.excerpt) console.log(`    ${f.excerpt}`);
  }
  if (shown.length > 200) console.log(`… 그리고 ${shown.length - 200}건 더`);
}

const md = arg("md");
if (md) {
  const lines = ["# 추출 내용 검사", "", `문항 ${questions}개 · 답 ${answers}개`, ""];
  for (const [kind, list] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`## ${kind} — ${list.length}건`, "");
    for (const f of list) {
      lines.push(`- **${f.printedNumber}** ${f.where} — ${f.detail}`);
      if (f.excerpt) lines.push(`  - \`${f.excerpt.replace(/`/g, "'")}\``);
    }
    lines.push("");
  }
  writeFileSync(md, lines.join("\n"), "utf8");
  console.log(`\n→ ${md}`);
}

process.exit(findings.length > 0 ? 1 : 0);
