/**
 * 개념서 덤프에서 **개념 블록이 나오는 쪽**을 찾는다.
 *
 *   pnpm --filter @su-maek/ingest concept-page-scan <덤프.json> [<덤프2.json> …]
 *
 * load-concepts는 개념 쪽 **허용목록**을 받는다. 추론에 맡겼다가 개념
 * 하나가 문제 12쪽(500줄)을 통째로 삼킨 적이 있어서다. 그 목록을 사람이
 * 손으로 세는 대신, 쪽마다 홀로 돌려 「여기서 개념 블록이 잡히는가」를
 * 보여 준다. 목록에 넣을지는 사람이 정한다 — 문제 쪽에서도 신호가 걸리는
 * 자리가 있으므로 제목을 보고 골라야 한다.
 */
import { readFileSync } from "node:fs";
import { extractConceptPages } from "../concepts";
import { KWR_2022 } from "../profiles/kwr-2022";
import type { SourceDump } from "../types";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("사용법: concept-page-scan <덤프.json> [<덤프2.json> …]");
  process.exit(1);
}

for (const file of files) {
  const dump = JSON.parse(readFileSync(file, "utf8")) as SourceDump;
  console.log(
    `\n=== ${file.split(/[\\/]/).pop()} p.${dump.source.extractedRange.join("~")} ===`,
  );
  const found: number[] = [];
  for (const page of dump.pages) {
    const { concepts, unassignedLines } = extractConceptPages(dump, KWR_2022, {
      conceptPages: [page.page],
    });
    if (concepts.length === 0) continue;
    found.push(page.page);
    console.log(
      `p.${String(page.page).padStart(3)}  블록 ${concepts.length} · 미분류 ${unassignedLines}  ` +
        concepts.map((c) => `[${c.subsection}|${c.no ?? "?"}] ${c.title}`).join("  "),
    );

    /* **이어지는 쪽을 놓치지 않는다.** 개념 하나가 다음 쪽까지 흐르면 그
     * 쪽은 홀로 스캔할 때 제목이 없어 아무것도 안 잡힌다 — 중1-1의 11·51·71
     * 쪽이 그랬다. 짝으로 한 번 더 돌려서 블록이 늘면 이어지는 쪽이다. */
    const pair = extractConceptPages(dump, KWR_2022, {
      conceptPages: [page.page, page.page + 1],
    });
    if (pair.concepts.length > concepts.length) {
      found.push(page.page + 1);
      const extra = pair.concepts.slice(concepts.length);
      console.log(
        `p.${String(page.page + 1).padStart(3)}  ← 이어짐 ${extra.length}블록  ` +
          extra.map((c) => `[${c.subsection}|${c.no ?? "?"}] ${c.title}`).join("  "),
      );
    }
  }
  console.log(`  → pages: [${found.join(", ")}]`);
}
