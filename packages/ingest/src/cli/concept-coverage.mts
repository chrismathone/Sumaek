/**
 * 개념 표가 이 대단원의 문항을 **다 걸고 있나** — DB를 건드리지 않고 본다.
 *
 *   pnpm --filter @su-maek/ingest concept-coverage \
 *     --textbook=m2-1 --chapter=II --dump=<본책 덤프.json>
 *
 * 왜 따로 두나: 개념이 안 걸린 문항은 **아무 오류도 내지 않는다.** 적재는
 * 성공하고 화면도 멀쩡하며, 숙련도 추정에서만 조용히 빠진다. 표를 쓴 뒤
 * 넣기 전에 이걸로 확인해야 「몇 개가 어느 제목에서 새는지」가 보인다.
 *
 * 적재기(load.ts)와 **같은 순서**로 찾는다: 유형·소단원 → 중단원.
 */
import { readFileSync } from "node:fs";
import { RPM_BOOKS } from "../profiles/rpm-books";
import { normalizeConceptKey } from "../profiles/rpm-2022-concepts";
import { RPM_2022 } from "../profiles/rpm-2022";
import { extractPage } from "../segment";
import type { SourceDump } from "../types";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const book = RPM_BOOKS[arg("textbook") ?? ""];
const chapter = book?.chapters[arg("chapter") ?? ""];
const dumpPath = arg("dump");
if (!book || !chapter || !dumpPath) {
  console.error(
    "사용법: concept-coverage --textbook=<m1-1|m2-1|…> --chapter=<I|II|…> --dump=<덤프.json>",
  );
  console.error(`  교재: ${Object.keys(RPM_BOOKS).join(" ")}`);
  process.exit(1);
}

const dump = JSON.parse(readFileSync(dumpPath, "utf8")) as SourceDump;

/** 걸리지 않은 제목 → 문항 번호 */
const missed = new Map<string, string[]>();
/** 걸린 개념 → 문항 수 */
const hit = new Map<string, number>();
let viaTitle = 0;
let viaUnit = 0;
let none = 0;

let carriedUnit: { number: string; title: string } | undefined;
for (const page of dump.pages) {
  const extracted = extractPage(page, RPM_2022);
  if (extracted.runningHead.unit) carriedUnit = extracted.runningHead.unit;
  for (const q of extracted.questions) {
    const n = Number(q.printedNumber);
    if (n < chapter.range[0] || n > chapter.range[1]) continue;

    const title = q.typeContext?.title;
    const byTitle = title
      ? chapter.titleToConcept.get(normalizeConceptKey(title))
      : undefined;
    const byUnit = carriedUnit
      ? chapter.unitToConcept.get(normalizeConceptKey(carriedUnit.title))
      : undefined;
    const weights = byTitle ?? byUnit;

    if (byTitle) viaTitle += 1;
    else if (byUnit) viaUnit += 1;
    else none += 1;

    if (!byTitle) {
      /* 중단원으로 흘러간 문항도 어느 제목에서 흘렀는지 적어 둔다 —
       * 표에 넣을 만한 제목인지 사람이 봐야 한다 */
      const key = title ?? "(유형 없음)";
      missed.set(key, [...(missed.get(key) ?? []), q.printedNumber]);
    }
    for (const w of weights ?? []) {
      hit.set(w.slug, (hit.get(w.slug) ?? 0) + 1);
    }
  }
}

const total = viaTitle + viaUnit + none;
console.log(`${book.title} — ${chapter.number}. ${chapter.title}`);
console.log(`  문항 ${total}개`);
console.log(`    유형·소단원 표로 ${viaTitle}  (${((viaTitle / total) * 100).toFixed(1)}%)`);
console.log(`    중단원 표로   ${viaUnit}`);
console.log(`    개념 없음     ${none}`);

console.log(`\n  개념별 문항 수`);
for (const [slug, n] of [...hit].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${slug.padEnd(30)} ${String(n).padStart(4)}`);
}

if (missed.size > 0) {
  console.log(`\n  유형 표에 없는 제목 ${missed.size}종 — 중단원 표로 내려간 것들`);
  for (const [title, numbers] of [...missed].sort((a, b) => b[1].length - a[1].length)) {
    console.log(
      `    ${String(numbers.length).padStart(3)}문항  ${JSON.stringify(title)}  ` +
        `${numbers[0]}~${numbers[numbers.length - 1]}`,
    );
  }
}
