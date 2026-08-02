import { config } from "dotenv";
import { createSql, purgeTestData } from "@su-maek/db";

/* ─────────────────────────────────────────────────────────────
 * E2E 티어다운 — 스펙이 만든 반·루트·학습자를 지운다.
 *
 * 앱에는 삭제 UI가 없다(감사 기록이 append-only인 제품 결정). 그래서 스펙이
 * UI로 자기 뒷정리를 할 수 없고, 실행할 때마다 데모 워크스페이스에 반이
 * 쌓였다 — 표에 페이지네이션이 붙은 뒤로는 시드 데이터가 2쪽 뒤로 밀려
 * 스펙이 조용히 깨지기까지 했다.
 *
 * 불변 데이터(mastery_evidences·progress_events)를 가진 행은 건드리지 않고
 * 보관 처리만 한다 — 자세한 규칙은 purgeTestData 주석 참고.
 * DATABASE_URL이 없으면 조용히 넘어간다 (DB 없이 도는 실행 대비).
 * ───────────────────────────────────────────────────────────── */

const DEMO_ORG = "00000000-0000-7000-8000-000000000001";

export default async function globalTeardown(): Promise<void> {
  config({ path: ["../.env", ".env"] });
  if (!process.env.DATABASE_URL) {
    console.log("[e2e teardown] DATABASE_URL 없음 — 정리를 건너뛴다");
    return;
  }
  const sql = createSql();
  try {
    const r = await purgeTestData(sql, DEMO_ORG);
    console.log(
      `[e2e teardown] 반 ${r.groupsDeleted} · 루트 ${r.routePlansDeleted} · ` +
        `학습자 ${r.learnersDeleted} 삭제, ${r.learnersArchived} 보관 · ` +
        `개념 ${r.conceptsDeleted} · 사용권 ${r.contentRightsDeleted} · ` +
        `학생 오버라이드 ${r.learnerOverridesDeleted} · ` +
        `학습 자료 ${r.materialsDeleted}`,
    );
  } catch (e) {
    // 정리 실패가 테스트 결과를 뒤집지 않게 한다 — 보고만 하고 넘어간다
    console.error("[e2e teardown] 정리 실패:", (e as Error).message);
  } finally {
    await sql.end();
  }
}
