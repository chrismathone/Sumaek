/**
 * 기하 덤프(JSON) → 문항 추출 → 자가채점 리포트.
 *
 *   pnpm --filter @su-maek/ingest extract <dump.json> \
 *     [--pages=20,21] [--expect=1-213] [--outline] [--verbose]
 *
 * **등호를 빼면 조용히 무시된다.** 파서가 `--pages=`만 읽으므로 `--pages 20,21`은
 * 오류 없이 전 쪽을 처리한다. 아래 사용법을 그대로 복사해 쓸 것.
 *
 * 화면에 뽑힌 문항을 그대로 보여 주는 이유: 점수만 보면 "무엇이 틀렸는지"를
 * 알 수 없다. 지면과 나란히 놓고 읽을 수 있어야 고칠 수 있다.
 */
import { readFileSync } from "node:fs";
import { extractPage } from "../segment";
import { expectedRange, scoreExtraction } from "../score";
import { RPM_2022 } from "../profiles/rpm-2022";
import type { PageExtraction, Run, SourceDump } from "../types";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("사용법: extract <dump.json> [--pages=20,21] [--expect=1-213] [--outline] [--verbose]");
  process.exit(1);
}
const pagesArg = args.find((a) => a.startsWith("--pages="))?.split("=")[1];
const only = pagesArg ? new Set(pagesArg.split(",").map((s) => Number(s.trim()))) : null;
const verbose = args.includes("--verbose");

const dump = JSON.parse(readFileSync(file, "utf8")) as SourceDump;
const target = dump.pages.filter((p) => !only || only.has(p.page));

/** --expect=0001-0207 — 인쇄된 문항 번호 구간 (누락 탐지의 근거) */
const expectArg = args.find((a) => a.startsWith("--expect="))?.split("=")[1];
const expected = expectArg
  ? expectedRange(...(expectArg.split("-").map(Number) as [number, number]))
  : undefined;

const extractions: PageExtraction[] = target.map((p) => extractPage(p, RPM_2022));
const score = scoreExtraction(extractions, expected);

const render = (runs: Run[]): string =>
  runs.map((r) => (r.kind === "text" ? r.text : `$${r.latex}$`)).join("");

/* --outline: 유형 구조만 훑어본다. 문항을 개념에 잇는 표를 사람이 만들려면
 * 먼저 이 교재가 무엇을 어떤 이름으로 묶어 두었는지 봐야 한다. */
if (args.includes("--outline")) {
  const seen = new Map<string, { title: string; ref: string | null; numbers: string[] }>();
  const orphan: string[] = [];
  for (const page of extractions) {
    for (const q of page.questions) {
      if (!q.typeContext) {
        orphan.push(q.printedNumber);
        continue;
      }
      const c = q.typeContext;
      const key = c.kind === "type" ? `유형 ${c.number} ${c.title}` : `소단원 ${c.title}`;
      const entry = seen.get(key) ?? {
        title: q.typeContext.title,
        ref: q.typeContext.textbookRef,
        numbers: [],
      };
      entry.numbers.push(q.printedNumber);
      seen.set(key, entry);
    }
  }
  console.log(`유형 ${seen.size}개`);
  for (const [key, v] of seen) {
    console.log(
      `  ${key.padEnd(28)} ${String(v.numbers.length).padStart(3)}문항  ` +
        `${v.numbers[0]}~${v.numbers[v.numbers.length - 1]}  ${v.ref ?? ""}`,
    );
  }
  console.log(`\n유형 없는 문항 ${orphan.length}개: ${orphan.slice(0, 40).join(" ")}`);
  process.exit(0);
}

if (verbose) {
  for (const page of extractions) {
    console.log(`\n${"═".repeat(72)}\n  p.${page.page} — ${page.questions.length}문항`);
    for (const q of page.questions) {
      console.log(`\n  [${q.printedNumber}] 단${q.column + 1}` +
        (q.typeContext ? `  · ${q.typeContext.kind === "type" ? "유형 " + q.typeContext.number : "소단원"} ${q.typeContext.title}` : "") +
        (q.figureBoxes.length > 0 ? `  · 그림 ${q.figureBoxes.length}` : ""));
      console.log(`    발문: ${render(q.stem)}`);
      if (q.conditionBox) {
        console.log(`    ${q.conditionBox.label}: ` +
          q.conditionBox.items.map((i) => `${i.marker ?? "?"}. ${render(i.runs)}`).join("  "));
      }
      if (q.choices) {
        for (const c of q.choices) console.log(`    ${c.marker} ${render(c.runs)}`);
      }
    }
    if (page.unaccounted.length > 0) {
      console.log(`\n  ⚠ 미분류 span ${page.unaccounted.length}개:`);
      for (const s of page.unaccounted.slice(0, 12)) {
        console.log(`     y=${s.y0.toFixed(0)} x=${s.x0.toFixed(0)} ${s.font} ${JSON.stringify(s.text)}`);
      }
    }
  }
}

console.log(`\n${"═".repeat(72)}`);
console.log(`  대상 ${target.length}쪽 · 문항 ${score.questions.length}개`);
console.log(`  추출 완성도  ${(score.completeness * 100).toFixed(2)}%  ` +
  `(${score.passedChecks}/${score.totalChecks} 항목)`);
console.log("═".repeat(72));

if (score.failures.length > 0) {
  console.log(`\n실패 ${score.failures.length}건:`);
  const byKey = new Map<string, typeof score.failures>();
  for (const f of score.failures) {
    const list = byKey.get(f.key) ?? [];
    list.push(f);
    byKey.set(f.key, list);
  }
  for (const [key, list] of [...byKey].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ● ${key} — ${list.length}건`);
    for (const f of list.slice(0, 8)) {
      console.log(`      ${f.where}  ${f.detail.slice(0, 130)}`);
    }
    if (list.length > 8) console.log(`      … 외 ${list.length - 8}건`);
  }
}
