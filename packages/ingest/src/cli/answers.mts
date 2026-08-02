/**
 * 정답 별책 덤프 → 문항별 정답·해설 확인.
 *
 *   pnpm --filter @su-maek/ingest answers <answers-dump.json> [--range 1-213]
 *
 * 눈으로 대조하기 위한 도구다. 답이 비었거나 이상한 문항이 있으면 여기서
 * 먼저 드러나야지, DB에 들어간 뒤에 학생 채점으로 드러나면 늦다.
 */
import { readFileSync } from "node:fs";
import { parseAnswers, renderRuns, RPM_2022_ANSWERS } from "../answers";
import type { SourceDump } from "../types";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("사용법: answers <answers-dump.json> [--range 1-213]");
  process.exit(1);
}
const rangeArg = args.find((a) => a.startsWith("--range="))?.split("=")[1];
const [from, to] = rangeArg
  ? (rangeArg.split("-").map(Number) as [number, number])
  : [1, 9999];

const dump = JSON.parse(readFileSync(file, "utf8")) as SourceDump;
const parsed = parseAnswers(dump, RPM_2022_ANSWERS);

const wanted = Array.from({ length: to - from + 1 }, (_, i) =>
  String(from + i).padStart(4, "0"),
);
const found = wanted.filter((n) => parsed.has(n));
const missing = wanted.filter((n) => !parsed.has(n));
const empty = found.filter((n) => renderRuns(parsed.get(n)!.answer) === "");

console.log(`구간 ${wanted[0]}~${wanted[wanted.length - 1]} · ${wanted.length}문항`);
console.log(`  답을 찾음   ${found.length}`);
console.log(`  별책에 없음 ${missing.length}${missing.length ? `  ${missing.join(" ")}` : ""}`);
console.log(`  답이 비었음 ${empty.length}${empty.length ? `  ${empty.join(" ")}` : ""}`);

if (args.includes("--verbose")) {
  console.log("");
  for (const n of found) {
    const a = parsed.get(n)!;
    console.log(`[${n}] 답: ${renderRuns(a.answer)}`);
    const explanation = renderRuns(a.explanation);
    if (explanation) console.log(`      풀이: ${explanation.slice(0, 150)}`);
    const rubric = renderRuns(a.rubric);
    if (rubric) console.log(`      채점기준: ${rubric.slice(0, 160)}`);
  }
}
