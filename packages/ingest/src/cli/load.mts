/**
 * 추출 결과 → 문제은행 적재.
 *
 *   pnpm --filter @su-maek/ingest load \
 *     --book=<본책 덤프.json> --answers=<별책 덤프.json> \
 *     --org=<uuid> --actor=<uuid> [--range=1-213] [--dry-run]
 *
 * --dry-run이 기본이 아닌 이유: 실수로 넣는 것보다 실수로 안 넣는 편이 낫다고
 * 생각하기 쉽지만, 여기서 진짜 위험한 것은 **반쯤 넣는 것**이다. 문항별로
 * 트랜잭션을 걸고 인쇄 번호로 멱등하게 만들었으니 다시 돌려도 안전하다.
 */
import { config } from "dotenv";
config({ path: [".env", "../../.env"] });

import { readFileSync } from "node:fs";
import postgres from "postgres";
import { parseAnswers, RPM_2022_ANSWERS } from "../answers";
import { loadQuestions } from "../load";
import { RPM_2022 } from "../profiles/rpm-2022";
import {
  RPM_M1_CH1_CONCEPTS,
  RPM_M1_CH1_TITLE_TO_CONCEPT,
} from "../profiles/rpm-2022-concepts";
import { extractPage } from "../segment";
import type { SourceDump } from "../types";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const bookDumpPath = arg("book");
const answersDumpPath = arg("answers");
const organizationId = arg("org");
const actorUserId = arg("actor");
if (!bookDumpPath || !answersDumpPath || !organizationId || !actorUserId) {
  console.error(
    "사용법: load --book=<본책.json> --answers=<별책.json> --org=<uuid> --actor=<uuid> [--range=1-213] [--dry-run]",
  );
  process.exit(1);
}

const [from, to] = (arg("range") ?? "1-213").split("-").map(Number) as [number, number];
const dryRun = args.includes("--dry-run");

const bookDump = JSON.parse(readFileSync(bookDumpPath, "utf8")) as SourceDump;
const answersDump = JSON.parse(readFileSync(answersDumpPath, "utf8")) as SourceDump;

const questions = bookDump.pages
  .flatMap((page) => extractPage(page, RPM_2022).questions)
  .filter((q) => {
    const n = Number(q.printedNumber);
    return n >= from && n <= to;
  })
  .sort((a, b) => a.printedNumber.localeCompare(b.printedNumber));

const answers = parseAnswers(answersDump, RPM_2022_ANSWERS);

console.log(`본책 ${bookDump.source.fileName}`);
console.log(`  문항 ${questions.length}개 (${from}~${to} 구간)`);
console.log(`별책 ${answersDump.source.fileName}`);
console.log(`  답 ${questions.filter((q) => answers.has(q.printedNumber)).length}개 매칭`);

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

const result = await loadQuestions(sql, {
  organizationId,
  actorUserId,
  book: {
    publisherName: "개념원리",
    title: "RPM 중학 수학 1-1 (2022 개정)",
    schoolLevel: "middle",
    gradeBand: "middle-1",
    editionLabel: "2022 개정 학생용",
    publishedYear: 2025,
  },
  source: {
    fileName: bookDump.source.fileName,
    checksum: bookDump.source.checksum,
    pageCount: bookDump.source.pageCount,
    /* 원본 PDF는 아직 객체 스토리지에 올리지 않았다. 어디서 왔는지는
     * 남겨야 나중에 다시 뽑을 수 있다. */
    storagePath: `local:${bookDump.source.fileName}`,
  },
  rights: {
    holder: "개념원리 (상업 교재)",
    /* 사람이 확인하기 전에는 자동 출제 풀에 들어가지 않는다 (원칙 9) */
    status: "under_review",
    evidenceRef: "반입 시점 미확인",
  },
  profile: RPM_2022,
  chapter: { number: "I", title: "소인수분해" },
  concepts: RPM_M1_CH1_CONCEPTS,
  titleToConcept: RPM_M1_CH1_TITLE_TO_CONCEPT,
  questions,
  answers,
});

console.log(`\n${"═".repeat(64)}`);
console.log(`  넣음 ${result.inserted} · 이미 있어 건너뜀 ${result.skipped}`);
console.log(`  검수 상태:`);
for (const [status, n] of Object.entries(result.byReviewStatus)) {
  console.log(`    ${status.padEnd(26)} ${n}`);
}
console.log(`  개념 미지정 ${result.unaligned.length}개`);
if (result.unaligned.length > 0) {
  console.log(`    ${result.unaligned.slice(0, 30).join(" ")}${result.unaligned.length > 30 ? " …" : ""}`);
}
console.log(`  답 없음 ${result.withoutAnswer.length}개  ${result.withoutAnswer.join(" ")}`);
console.log("═".repeat(64));
console.log(
  "\n권한이 under_review이므로 **자동 출제 풀에 들어가지 않습니다.**\n" +
    "교사가 검수·권한 확인을 마쳐야 출제에 쓰입니다.",
);

await sql.end();
