import type { Locator, Page } from "@playwright/test";

/* ─────────────────────────────────────────────────────────────
 * 목록 표 조회 헬퍼 (ADR-0016).
 *
 * 목록이 카드(<li>)에서 표(<tr>)로 바뀌면서 `locator("li")`로 행을 찾던
 * 스펙이 조용히 0건을 잡게 됐다. 행 조회를 한 곳으로 모아 다음 구조 변경 때
 * 스펙 전체를 고치지 않게 한다.
 * ───────────────────────────────────────────────────────────── */

/** 표 본문에서 주어진 텍스트를 포함하는 행 */
export function tableRow(page: Page, hasText: string | RegExp): Locator {
  return page.locator("tbody tr").filter({ hasText });
}

/** 특정 영역(section) 안의 표에서 행을 찾는다 — 한 화면에 표가 둘 이상일 때 */
export function tableRowIn(scope: Locator, hasText: string | RegExp): Locator {
  return scope.locator("tbody tr").filter({ hasText });
}

/**
 * 검색으로 좁힌 뒤 행을 잡는다.
 *
 * 표에 페이지네이션이 붙은 뒤로 "목록에 있으니 보이겠지"가 성립하지 않는다 —
 * 테스트가 만든 행이 쌓이면 대상이 2쪽 뒤로 밀려 스펙이 조용히 깨진다.
 * 검색으로 좁히면 데이터 양과 무관하게 안정적이고, 필터 기능도 함께 검증된다.
 */
export async function gotoTableRow(
  page: Page,
  basePath: string,
  search: string,
  hasText: string | RegExp = search,
): Promise<Locator> {
  await page.goto(`${basePath}?q=${encodeURIComponent(search)}`);
  return tableRow(page, hasText);
}
