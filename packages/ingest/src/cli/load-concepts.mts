/**
 * 개념서 추출 결과 → 학습 자료(learning_materials) 적재.
 *
 *   pnpm --filter @su-maek/ingest load-concepts \
 *     --dump=<개념서 덤프.json> --org=<uuid> --actor=<uuid> [--dry-run] [--verbose]
 *
 * 문항 반입(load.mts)과 같은 안전 규칙: 멱등(같은 개념·제목은 다시 넣지
 * 않는다), draft로만 넣는다(게시는 사람이), 수식 게이트 실패는 보고한다.
 */
import { config } from "dotenv";
config({ path: [".env", "../../.env"] });

import { readFileSync } from "node:fs";
import postgres from "postgres";
import { extractConceptPages } from "../concepts";
import { loadConceptMaterials } from "../load-materials";
import { KWR_2022, KWR_M11_CH1_TARGETS } from "../profiles/kwr-2022";
import { RPM_M1_CH1_CONCEPTS } from "../profiles/rpm-2022-concepts";
import type { SourceDump } from "../types";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const dumpPath = arg("dump");
const organizationId = arg("org");
const actorUserId = arg("actor");
const dryRun = args.includes("--dry-run");
const verbose = args.includes("--verbose");

if (!dumpPath || (!dryRun && (!organizationId || !actorUserId))) {
  console.error(
    "사용법: load-concepts --dump=<덤프.json> --org=<uuid> --actor=<uuid> [--dry-run] [--verbose]",
  );
  process.exit(1);
}

const dump = JSON.parse(readFileSync(dumpPath, "utf8")) as SourceDump;
/* 개념 본문이 실리는 쪽 — 차례를 보고 사람이 확인한 값 (RPM의 --expect와
 * 같은 철학). 문제 쪽은 조판 신호가 개념 쪽과 겹쳐 추론만으로는 샌다. */
const conceptPages = (arg("pages") ?? "10,11,17,30,35")
  .split(",")
  .map((p) => Number(p.trim()))
  .filter((p) => Number.isInteger(p) && p > 0);
const { concepts, chapter, unassignedLines } = extractConceptPages(dump, KWR_2022, {
  conceptPages,
});

console.log(`개념서 ${dump.source.fileName}`);
console.log(`  덤프 범위 p.${dump.source.extractedRange[0]}~${dump.source.extractedRange[1]}`);
console.log(`  대단원: ${chapter ?? "(러닝헤드에서 못 읽음)"}`);
console.log(`  개념 블록 ${concepts.length}개 · 미분류 본문 줄 ${unassignedLines}개`);
for (const c of concepts) {
  const lines = c.paragraphs.reduce((n, p) => n + p.lines.length, 0);
  const asides = c.paragraphs.filter((p) => p.kind === "aside").length;
  console.log(
    `  [p.${String(c.page).padStart(2)}] ${c.subsection} · 개념${c.no ?? "?"} ${c.title}` +
      ` — 문단 ${c.paragraphs.length}(곁 ${asides}) · 줄 ${lines} · 주석 ${c.teacherNotes.length}` +
      ` · ${c.xref ?? "상호참조 없음"}` +
      (c.unknownGlyphs.length > 0 ? ` · 미해독 ${c.unknownGlyphs.length}` : ""),
  );
}

if (verbose) {
  for (const c of concepts) {
    console.log(`\n━━━ 개념${c.no} ${c.title} (p.${c.page}) ━━━`);
    for (const p of c.paragraphs) {
      const mark = p.kind === "aside" ? "▷" : "¶";
      console.log(
        `${mark} ` +
          p.lines
            .map((line) =>
              line
                .map((r) => (r.kind === "math" ? `$${r.latex}$` : r.text))
                .join(""),
            )
            .join(`\n  `),
      );
    }
    if (c.teacherNotes.length > 0) {
      console.log(`〔교사 주석〕`);
      for (const note of c.teacherNotes) console.log(`  · ${note.replace(/\n/g, " / ")}`);
    }
  }
}

if (dryRun) {
  console.log("\n--dry-run — DB에 쓰지 않았습니다.");
  process.exit(0);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL이 없습니다.");
  process.exit(1);
}
const sql = postgres(url, { ssl: "require", max: 4 });

const result = await loadConceptMaterials(sql, {
  organizationId: organizationId!,
  actorUserId: actorUserId!,
  book: {
    publisherName: "개념원리",
    title: "개념원리 중학 수학 1-1 (2022 개정)",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    editionLabel: "2022 개정 교사용",
    publishedYear: 2025,
  },
  source: {
    fileName: dump.source.fileName,
    checksum: dump.source.checksum,
    pageCount: dump.source.pageCount,
    storagePath: `local:${dump.source.fileName}`,
  },
  rights: {
    holder: "개념원리 (상업 교재)",
    status: "under_review",
    evidenceRef: "반입 시점 미확인",
  },
  profile: KWR_2022,
  chapter: { number: "I", title: "소인수분해" },
  concepts: RPM_M1_CH1_CONCEPTS,
  targets: KWR_M11_CH1_TARGETS,
  blocks: concepts,
});

console.log(`\n${"═".repeat(64)}`);
console.log(`  넣음 ${result.inserted} · 이미 있어 건너뜀 ${result.skipped}`);
if (result.unmapped.length > 0) {
  console.log(`  개념 표에 없어 못 넣음 ${result.unmapped.length}:`);
  for (const u of result.unmapped) console.log(`    ${u}`);
}
if (result.withFormulaIssues.length > 0) {
  console.log(`  수식 검수 필요 ${result.withFormulaIssues.length}:`);
  for (const f of result.withFormulaIssues) console.log(`    ${f}`);
}
console.log("═".repeat(64));
console.log(
  "\n자료는 전부 draft입니다. 교사가 검수·게시해야 학생 「개념 공부」에 나갑니다.",
);

await sql.end();
