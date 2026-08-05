import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/* ─────────────────────────────────────────────────────────────
 * 서버 함수 지역이 DB 지역과 짝이 맞는가 (ADR-0019).
 *
 * 이 검사가 있는 이유는 **어긋나도 아무것도 빨개지지 않기** 때문이다.
 * 함수가 버지니아에서 돌고 DB가 서울에 있으면 질의 하나가 220ms다.
 * 에러는 없다. 화면이 조용히 14배 느려질 뿐이고, 그건 「원래 좀 느리네」로
 * 넘어간다 — 실제로 그렇게 넘어가고 있었다(실측 /app/readiness 11.26초 중
 * DB가 일한 시간 13ms).
 *
 * 설정은 쉽게 사라진다: 프로젝트를 다시 만들거나, 대시보드에서 초기화하거나,
 * 이 파일을 지우면 그만이다. 사라졌다는 것을 알려 주는 것이 여기 몫이다.
 * ───────────────────────────────────────────────────────────── */

/** DATABASE_URL 호스트가 알려 주는 Supabase 지역 → Vercel 지역 코드 */
const SUPABASE_TO_VERCEL: Record<string, string> = {
  "ap-northeast-2": "icn1", // 서울
  "ap-northeast-1": "hnd1", // 도쿄
  "us-east-1": "iad1", // 버지니아
  "us-west-1": "sfo1",
  "eu-central-1": "fra1",
};

const vercelJson = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../vercel.json", import.meta.url)),
    "utf8",
  ),
) as { regions?: string[] };

describe("배포 지역", () => {
  it("vercel.json이 지역을 못 박는다", () => {
    /* 비워 두면 Vercel 기본값(iad1 · 버지니아)으로 떨어진다 */
    expect(vercelJson.regions).toBeDefined();
    expect(vercelJson.regions).toHaveLength(1);
  });

  it("DB와 같은 지역이다", () => {
    const url = process.env.DATABASE_URL;
    if (!url) {
      /* DB 주소를 모르면 짝을 맞출 수 없다 — 위 검사만 하고 넘어간다.
       * 여기서 통과시키는 것이 맞다: 이 파일의 목적은 지역을 **고르는**
       * 것이 아니라 두 값이 **갈리는 것**을 잡는 것이다. */
      return;
    }
    const found = Object.keys(SUPABASE_TO_VERCEL).find((r) => url.includes(r));
    expect(
      found,
      `DATABASE_URL 호스트에서 알려진 지역을 찾지 못했다. ` +
        `새 지역이라면 SUPABASE_TO_VERCEL에 추가하고 ADR-0019를 갱신할 것.`,
    ).toBeDefined();

    expect(
      vercelJson.regions?.[0],
      `DB는 ${found}인데 서버 함수는 ${vercelJson.regions?.[0]}에 있다. ` +
        `질의 하나가 왕복 200ms를 넘는다 — ADR-0019 참고.`,
    ).toBe(SUPABASE_TO_VERCEL[found!]);
  });
});
