import { config } from "dotenv";
config({ path: ["../../.env", ".env"] });
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

/**
 * 복구 검증 — 복원된 DB가 건강한지 확인한다.
 *
 * 런북 진입점: node scripts/verify-recovery.mjs (루트 런처가 이 파일을 부른다)
 * 근거: docs/phase0/backup-recovery.md 5장 V-1~V-10,
 *       docs/runbooks/05-db-failure-pitr.md 5.7·6장
 *
 * 대상 DB 우선순위: RECOVERY_DATABASE_URL → DATABASE_URL.
 * 운영 DB를 실수로 검증 대상으로 삼는 사고를 막기 위해 **어느 쪽을 쓰는지 항상
 * 표준출력에 밝힌다**. 이 스크립트는 읽기만 한다 — 쓰기 문장이 없다.
 *
 * 종료 코드: 위반 0건이면 0, 하나라도 있으면 1. 연결·실행 실패도 1.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const invariantsPath = join(__dirname, "..", "src", "checks", "invariants.sql");

/** 복구 후 눈으로 대조하는 핵심 테이블 (backup-recovery.md V-5·V-8) */
const CORE_TABLES = [
  "organizations",
  "users",
  "memberships",
  "learners",
  "learning_groups",
  "sessions",
  "route_plans",
  "route_versions",
  "assessment_instances",
  "assessment_questions",
  "assignments",
  "attempts",
  "responses",
  "grade_decisions",
  "mastery_evidences",
  "concept_masteries",
  "audit_events",
  "outbox_events",
  "inbox_events",
  "jobs",
] as const;

interface Check {
  id: string;
  name: string;
  sql: string;
}

/** invariants.sql을 `-- CHECK: <ID> <이름>` 주석 단위로 쪼갠다. */
function splitChecks(text: string): Check[] {
  const lines = text.split(/\r?\n/);
  const checks: Check[] = [];
  let current: Check | null = null;
  for (const line of lines) {
    const header = /^--\s*CHECK:\s*(\S+)\s*(.*)$/.exec(line);
    if (header) {
      if (current) checks.push(current);
      current = { id: header[1] ?? "?", name: (header[2] ?? "").trim(), sql: "" };
      continue;
    }
    if (current) current.sql += `${line}\n`;
  }
  if (current) checks.push(current);
  return checks.filter((c) => c.sql.replace(/--[^\n]*\n/g, "").trim().length > 0);
}

function pickTarget(): { url: string; source: string } {
  const recovery = process.env.RECOVERY_DATABASE_URL?.trim();
  if (recovery) return { url: recovery, source: "RECOVERY_DATABASE_URL" };
  const primary = process.env.DATABASE_URL?.trim();
  if (primary) return { url: primary, source: "DATABASE_URL (.env)" };
  throw new Error(
    "검증 대상 DB가 없습니다. RECOVERY_DATABASE_URL 또는 DATABASE_URL을 설정하세요.\n" +
      "복원본을 검증하려면: node scripts/verify-recovery.mjs --target=\"<복원본 URL>\"",
  );
}

/** URL에서 비밀번호를 지운 표시용 문자열 */
function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.username ? `${u.username}:***@` : ""}${u.host}${u.pathname}`;
  } catch {
    return "(형식을 해석할 수 없는 URL)";
  }
}

function formatRow(row: Record<string, unknown>): string {
  return Object.entries(row)
    .map(([k, v]) => `${k}=${v === null ? "null" : String(v)}`)
    .join("  ");
}

async function main(): Promise<void> {
  const drill = process.argv.includes("--mode=drill");
  const { url, source } = pickTarget();

  console.log("─".repeat(72));
  console.log("복구 검증 (backup-recovery.md 5장 V-1~V-10)");
  console.log(`대상 DB : ${maskUrl(url)}`);
  console.log(`출처    : ${source}`);
  if (source.startsWith("DATABASE_URL")) {
    console.log(
      "주의    : 복원본이 아니라 **현재 운영 DB**를 검증하고 있습니다. " +
        "복원본을 보려면 RECOVERY_DATABASE_URL을 설정하세요.",
    );
  }
  if (drill) console.log("모드    : drill (월별 자동 복구 검증)");
  console.log("─".repeat(72));

  const source_sql = await readFile(invariantsPath, "utf8");
  const checks = splitChecks(source_sql);
  if (checks.length === 0) {
    throw new Error(`검사를 찾지 못했습니다: ${invariantsPath}`);
  }

  const sql = postgres(url, { max: 1, prepare: false, idle_timeout: 20 });
  let violations = 0;
  let failedChecks = 0;
  const failures: string[] = [];

  try {
    const [meta] = await sql<{ db_time: Date; is_replica: boolean }[]>`
      select now() as db_time, pg_is_in_recovery() as is_replica
    `;
    console.log(
      `DB 시각 : ${meta?.db_time.toISOString() ?? "?"}  |  복제본 여부: ${meta?.is_replica ? "예" : "아니오"}`,
    );
    console.log("");
    console.log(`[V-1] 불변 조건 검사 ${checks.length}건`);
    console.log("");

    for (const check of checks) {
      let rows: Record<string, unknown>[];
      try {
        rows = (await sql.unsafe(check.sql)) as unknown as Record<string, unknown>[];
      } catch (error) {
        failedChecks += 1;
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${check.id} 실행 실패: ${message}`);
        console.log(`  ✗ ${check.id.padEnd(5)} ${check.name}`);
        console.log(`        실행 실패: ${message}`);
        continue;
      }
      if (rows.length === 0) {
        console.log(`  ✓ ${check.id.padEnd(5)} ${check.name}`);
        continue;
      }
      violations += rows.length;
      failures.push(`${check.id} ${check.name}: ${rows.length}행`);
      console.log(`  ✗ ${check.id.padEnd(5)} ${check.name} — 위반 ${rows.length}행`);
      for (const row of rows.slice(0, 5)) {
        console.log(`        ${formatRow(row)}`);
      }
      if (rows.length > 5) console.log(`        … 외 ${rows.length - 5}행`);
    }

    console.log("");
    console.log("[V-5·V-8] 핵심 테이블 행 수");
    console.log("");
    for (const table of CORE_TABLES) {
      try {
        const [row] = (await sql.unsafe(
          `select count(*)::bigint as n from ${table}`,
        )) as unknown as { n: string }[];
        console.log(`  ${table.padEnd(22)} ${String(row?.n ?? "?").padStart(10)}`);
      } catch (error) {
        failedChecks += 1;
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${table} 조회 실패: ${message}`);
        console.log(`  ${table.padEnd(22)} 조회 실패: ${message}`);
      }
    }

    /* 행 수만으로는 "이벤트 사슬이 살아 있는가"를 알 수 없다. pending 1000건과
     * delivered 1000건은 같은 1000건이지만 전자는 아무 일도 일어나지 않은
     * 것이다. 상태별로 갈라서 보여 준다 (RB-04 4-4·6장 V-5). */
    console.log("");
    console.log("[V-8] Outbox·작업 상태 분해");
    console.log("");
    try {
      const outbox = (await sql.unsafe(
        `select status::text as status, count(*)::bigint as n,
                max(now() - created_at)::text as oldest
         from outbox_events group by 1 order by 2 desc`,
      )) as unknown as { status: string; n: string; oldest: string | null }[];
      for (const row of outbox) {
        console.log(
          `  outbox ${row.status.padEnd(12)} ${String(row.n).padStart(10)}   최고령 ${row.oldest ?? "-"}`,
        );
      }
      const jobs = (await sql.unsafe(
        `select status::text as status, count(*)::bigint as n
         from jobs group by 1 order by 2 desc`,
      )) as unknown as { status: string; n: string }[];
      for (const row of jobs) {
        console.log(`  jobs   ${row.status.padEnd(12)} ${String(row.n).padStart(10)}`);
      }
      console.log("");
      console.log(
        "  적체 자체는 위반이 아니다 — 워커가 안 떠 있으면 쌓인다. 상세는 `pnpm queue:status`.",
      );
    } catch (error) {
      failedChecks += 1;
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`상태 분해 조회 실패: ${message}`);
      console.log(`  조회 실패: ${message}`);
    }
  } finally {
    await sql.end();
  }

  console.log("");
  console.log("─".repeat(72));
  if (violations === 0 && failedChecks === 0) {
    console.log(`✓ 불변 조건 ${checks.length}건 전부 통과 — 위반 0행`);
    console.log("");
    console.log("이 스크립트가 검증하지 **않는** 것 (사람이 따로 확인한다):");
    console.log("  V-2  테넌트 격리(RLS) — pnpm --filter @su-maek/db test");
    console.log("       (소유자 롤로는 false-green이다. set local role authenticated 필수)");
    console.log("  V-6  Storage 체크섬 대조");
    console.log("  V-10 합성 모니터링 SYN-1~SYN-4");
    console.log("  M-1~M-4 수동 검증 (backup-recovery.md 5.3)");
    process.exit(0);
  }
  console.log(`✗ 검증 실패 — 위반 ${violations}행 / 실행 실패 ${failedChecks}건`);
  for (const line of failures) console.log(`  · ${line}`);
  console.log("");
  console.log("복원본이라면 손상 범위를 뜻한다 (RB-05 4-5). 전환하지 말고 IC에게 보고한다.");
  process.exit(1);
}

main().catch((error) => {
  console.error("[verify-recovery] 실패");
  console.error(error);
  process.exit(1);
});
