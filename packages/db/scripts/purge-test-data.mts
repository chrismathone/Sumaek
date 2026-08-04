import { config } from "dotenv";
config({ path: ["../../.env", ".env"] });
import { createSql } from "../src/client";
import { purgeTestData } from "../src/testing/purge-test-data";
import { purgeAutonomousWorkspaces } from "../src/testing/purge-workspace";

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
  console.log(`  데모 계정 복구     ${r.demoAccountRestored ? "했음 (빌린 채 남아 있었다)" : "불필요"}`);
  console.log(`  개념 삭제          ${r.conceptsDeleted}`);
  console.log(`  개념 폐기 처리     ${r.conceptsDeprecated}  (증거·문항 보유 — 삭제 불가, 목록에서만 제외)`);
  console.log(`  학생 오버라이드    ${r.learnerOverridesDeleted}  (딸린 학습자 일정 포함)`);
  console.log(`  사용권 삭제        ${r.contentRightsDeleted}`);
  console.log(`  학습 자료 삭제     ${r.materialsDeleted}  (딸린 진도 포함)`);

  /* 자율 E2E는 실행마다 **조직 자체를** 새로 만든다 (빈 학원이어야 하므로
   * 재사용할 수 없다). 위 정리는 데모 조직 **안**만 보므로 그 조직들에는
   * 손도 대지 않는다 — 여기서 따로 회수한다. */
  const w = await purgeAutonomousWorkspaces(sql, { dryRun });
  console.log(`  자율 조직 삭제     ${w.organizationsDeleted}`);
  console.log(
    `  자율 조직 보관     ${w.organizationsKept}  (삭제 불가, 목록에서만 제외)` +
      (w.keptBecauseOf.length > 0 ? `\n    막은 표: ${w.keptBecauseOf.join(", ")}` : ""),
  );
  console.log(
    `  자율 계정 삭제     ${w.accountsDeleted}` +
      (w.accountsBlocked > 0 ? `  · 막힘 ${w.accountsBlocked}` : ""),
  );
} finally {
  await sql.end();
}
