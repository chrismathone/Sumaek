/**
 * 개념서 추출 결과 → 학습 자료(learning_materials) 적재.
 *
 *   pnpm --filter @su-maek/ingest load-concepts --chapter=<I|II|III|IV> \
 *     --dump=<개념서 덤프.json> --org=<uuid> --actor=<uuid> [--dry-run] [--verbose]
 *
 * **--chapter에 기본값이 없다.** 대단원마다 개념 쪽 허용목록과 잇는 표가
 * 다르고, 틀린 것을 쓰면 자료가 엉뚱한 개념에 붙거나 통째로 안 들어간다.
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
import {
  KWR_2022,
  KWR_M11_CH1_TARGETS,
  KWR_M11_CH2_TARGETS,
  KWR_M11_CH3_TARGETS,
  KWR_M11_CH4_TARGETS,
  KWR_M21_CH1_TARGETS,
  KWR_M21_CH2_TARGETS,
  KWR_M21_CH3_TARGETS,
  KWR_M21_CH4_TARGETS,
  KWR_M21_CH5_TARGETS,
} from "../profiles/kwr-2022";
import {
  RPM_M1_CH1_CONCEPTS,
  RPM_M1_CH2_CONCEPTS,
  RPM_M1_CH3_CONCEPTS,
  RPM_M1_CH4_CONCEPTS,
  type ConceptDefinition,
} from "../profiles/rpm-2022-concepts";
import {
  RPM_M21_CH1_CONCEPTS,
  RPM_M21_CH2_CONCEPTS,
  RPM_M21_CH3_CONCEPTS,
  RPM_M21_CH4_CONCEPTS,
  RPM_M21_CH5_CONCEPTS,
} from "../profiles/rpm-2022-concepts-m21";
import type { SourceDump } from "../types";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

/**
 * 대단원마다 개념 쪽 허용목록·개념 정의·잇는 표가 다르다.
 *
 * **개념 쪽 허용목록은 사람이 확인한 값이다.** 문제 쪽은 조판 신호가 개념
 * 쪽과 겹쳐, 추론에 맡겼더니 개념 하나가 문제 12쪽 분량(500줄)을 삼켰다.
 * 여기 적힌 쪽은 두 가지로 확인했다 — 「N. 중단원」 머리글이 있는 쪽과
 * 「…는가?」+핵심문제로 이어지는 쪽을 훑어 뽑은 뒤, 1단원 결과가 사람이
 * 손으로 확인해 둔 10,11,17,30,35와 정확히 같은지 대조했다.
 */
interface ConceptChapter {
  number: string;
  title: string;
  dumpRange: string;
  pages: number[];
  concepts: ConceptDefinition[];
  targets: ReadonlyMap<string, string>;
}

const M1_1: Record<string, ConceptChapter> = {
  I: {
    number: "I",
    title: "소인수분해",
    dumpRange: "6-47",
    pages: [10, 11, 17, 30, 35],
    concepts: RPM_M1_CH1_CONCEPTS,
    targets: KWR_M11_CH1_TARGETS,
  },
  II: {
    number: "II",
    title: "정수와 유리수",
    dumpRange: "48-101",
    pages: [50, 51, 56, 70, 71, 81, 89],
    concepts: RPM_M1_CH2_CONCEPTS,
    targets: KWR_M11_CH2_TARGETS,
  },
  III: {
    number: "III",
    title: "문자와 식",
    dumpRange: "102-173",
    pages: [104, 105, 111, 117, 132, 133, 139, 156, 163],
    concepts: RPM_M1_CH3_CONCEPTS,
    targets: KWR_M11_CH3_TARGETS,
  },
  IV: {
    number: "IV",
    title: "좌표평면과 그래프",
    dumpRange: "174-224",
    pages: [176, 177, 184, 198, 208],
    concepts: RPM_M1_CH4_CONCEPTS,
    targets: KWR_M11_CH4_TARGETS,
  },
};

/** 개념원리 중2-1 (교사용 224쪽) — 쪽 목록은 concept-page-scan으로 뽑았다 */
const M2_1: Record<string, ConceptChapter> = {
  I: {
    number: "I",
    title: "유리수와 순환소수",
    dumpRange: "8-33",
    pages: [10, 15, 21],
    concepts: RPM_M21_CH1_CONCEPTS,
    targets: KWR_M21_CH1_TARGETS,
  },
  II: {
    number: "II",
    title: "식의 계산",
    dumpRange: "34-79",
    pages: [36, 37, 46, 60, 66, 67],
    concepts: RPM_M21_CH2_CONCEPTS,
    targets: KWR_M21_CH2_TARGETS,
  },
  III: {
    number: "III",
    title: "일차부등식",
    dumpRange: "80-121",
    pages: [82, 83, 89, 106, 113],
    concepts: RPM_M21_CH3_CONCEPTS,
    targets: KWR_M21_CH3_TARGETS,
  },
  IV: {
    number: "IV",
    title: "연립일차방정식",
    dumpRange: "122-165",
    pages: [124, 130, 131, 150, 157],
    concepts: RPM_M21_CH4_CONCEPTS,
    targets: KWR_M21_CH4_TARGETS,
  },
  V: {
    number: "V",
    title: "일차함수",
    dumpRange: "166-224",
    pages: [168, 169, 178, 179, 185, 190, 195, 208, 214],
    concepts: RPM_M21_CH5_CONCEPTS,
    targets: KWR_M21_CH5_TARGETS,
  },
};

/**
 * 개념서 등록부.
 *
 * **권 이름을 여기서 가져온다.** 예전에는 「개념원리 중학 수학 1-1」이 아래
 * 적재 호출에 박혀 있었다. 중2-1 개념서를 넣었더니 자료 58개가 중1-1 책에
 * 매달렸고 — 오류는 하나도 나지 않았다 — 중1-1에 없는 V단원이 생겨서야
 * 드러났다.
 */
interface ConceptBook {
  title: string;
  gradeBand: "middle-1" | "middle-2" | "middle-3";
  chapters: Record<string, ConceptChapter>;
}

const BOOKS: Record<string, ConceptBook> = {
  "m1-1": {
    title: "개념원리 중학 수학 1-1 (2022 개정)",
    gradeBand: "middle-1",
    chapters: M1_1,
  },
  "m2-1": {
    title: "개념원리 중학 수학 2-1 (2022 개정)",
    gradeBand: "middle-2",
    chapters: M2_1,
  },
};

const dumpPath = arg("dump");
const organizationId = arg("org");
const actorUserId = arg("actor");
const dryRun = args.includes("--dry-run");
const verbose = args.includes("--verbose");
const textbookKey = arg("textbook");
const chapterKey = arg("chapter");
const book = textbookKey ? BOOKS[textbookKey] : undefined;
const target = book && chapterKey ? book.chapters[chapterKey] : undefined;

if (!dumpPath || !book || !target || (!dryRun && (!organizationId || !actorUserId))) {
  console.error(
    "사용법: load-concepts --textbook=<m1-1|m2-1|…> --chapter=<I|II|…> --dump=<덤프.json> \\\n" +
      "                     --org=<uuid> --actor=<uuid> [--pages=50,51] [--dry-run] [--verbose]",
  );
  if (textbookKey && !book) {
    console.error(`\n  --textbook=${textbookKey} 는 등록되지 않은 개념서입니다.`);
  }
  for (const [bookKey, spec] of Object.entries(BOOKS)) {
    console.error(`\n  --textbook=${bookKey}  ${spec.title}`);
    for (const [key, c] of Object.entries(spec.chapters)) {
      console.error(
        `    --chapter=${key.padEnd(4)} ${c.number}. ${c.title.padEnd(14)} ` +
          `덤프 p.${c.dumpRange} · 개념 쪽 ${c.pages.join(",")}`,
      );
    }
  }
  process.exit(1);
}

const dump = JSON.parse(readFileSync(dumpPath, "utf8")) as SourceDump;
/* --pages는 위 허용목록을 덮어쓴다 — 새 쪽을 시험해 볼 때만 쓴다 */
const conceptPages = (arg("pages") ?? target.pages.join(","))
  .split(",")
  .map((p) => Number(p.trim()))
  .filter((p) => Number.isInteger(p) && p > 0);
const { concepts, chapter, unassignedLines } = extractConceptPages(dump, KWR_2022, {
  conceptPages,
});

console.log(`대단원 ${target.number}. ${target.title}`);
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
    title: book.title,
    schoolLevel: "middle",
    gradeBand: book.gradeBand,
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
  chapter: { number: target.number, title: target.title },
  concepts: target.concepts,
  targets: target.targets,
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
