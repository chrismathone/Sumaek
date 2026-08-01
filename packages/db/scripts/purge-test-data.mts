import { config } from "dotenv";
config({ path: ["../../.env", ".env"] });
import { createSql } from "../src/client";
import { purgeTestData } from "../src/testing/purge-test-data";

/**
 * 테스트 잔재 정리 CLI.
 *   pnpm purge:test-data --dry-run   실제로 지우지 않고 대상만 센다
 *   pnpm purge:test-data             실행
 *
 * E2E 티어다운(e2e/global-teardown.ts)이 같은 함수를 쓴다.
 */
const DEMO_ORG = "00000000-0000-7000-8000-000000000001";
const dryRun = process.argv.includes("--dry-run");
const orgArg = process.argv.find((a) => a.startsWith("--org="));
const organizationId = orgArg ? orgArg.slice("--org=".length) : DEMO_ORG;

const sql = createSql();
try {
  const r = await purgeTestData(sql, organizationId, { dryRun });
  console.log(dryRun ? "[purge] DRY RUN — 지우지 않았다" : "[purge] 실행 완료");
  console.log(`  반 삭제            ${r.groupsDeleted}`);
  console.log(`  루트 삭제          ${r.routePlansDeleted}`);
  console.log(`  학습자 삭제        ${r.learnersDeleted}`);
  console.log(`  학습자 보관 처리   ${r.learnersArchived}  (불변 증거 보유 — 삭제 불가)`);
  console.log(`  개념 삭제          ${r.conceptsDeleted}`);
  console.log(`  학생 오버라이드    ${r.learnerOverridesDeleted}  (딸린 학습자 일정 포함)`);
  console.log(`  사용권 삭제        ${r.contentRightsDeleted}`);
} finally {
  await sql.end();
}
