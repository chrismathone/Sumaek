import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/* ─────────────────────────────────────────────────────────────
 * 응시 러너 회귀 검사.
 *
 * 브라우저로 직접 풀어 보다가 발견한 결손을 붙잡는다. jsdom·testing-library를
 * 두지 않은 저장소라(vitest environment는 node) 소스 검사로 막는다 —
 * 약한 검사인 것을 알고 쓰되, 무엇을 못 잡는지 아래에 적어 둔다.
 *
 * 못 잡는 것: 실제 렌더 결과. key를 붙여도 다른 이유로 값이 남는 경우는
 * 이 검사를 통과한다. 실렌더 검증은 사람이 브라우저로 하거나 E2E가 필요하다.
 * ───────────────────────────────────────────────────────────── */

const RUNNER = fileURLToPath(
  new URL("../../src/components/runner/AttemptRunner.tsx", import.meta.url),
);
const src = readFileSync(RUNNER, "utf8");

describe("응시 러너 규약", () => {
  it("단답 입력에 문항별 key가 있다 — 앞 문항 답이 다음 칸에 남지 않도록", () => {
    /* 실측 결손: key가 없으면 React가 문항을 넘길 때 같은 DOM 노드를
     * 재사용하고, 비제어 입력이라 defaultValue가 다시 적용되지 않는다.
     * 3번에 「5」를 넣고 넘어가니 손대지 않은 4번 칸에 「5」가 보였다. */
    const inputBlock = src.slice(
      src.indexOf('q.kind === "short_answer"'),
      src.indexOf('q.kind === "short_answer"') + 1400,
    );
    expect(inputBlock).toContain("<input");
    expect(inputBlock).toMatch(/key=\{q\.assessmentQuestionId\}/);
  });

  it("단답 입력은 여전히 비제어(defaultValue)다 — key 검사가 의미를 갖는 전제", () => {
    // 제어 입력으로 바뀌면 key 없이도 값이 갈리므로 위 검사의 전제가 사라진다.
    // 그때는 이 검사를 지우고 다른 방식으로 막아야 한다는 신호다.
    const inputBlock = src.slice(
      src.indexOf('q.kind === "short_answer"'),
      src.indexOf('q.kind === "short_answer"') + 1400,
    );
    expect(inputBlock).toContain("defaultValue=");
  });

  it("제한 시간은 서버가 준 startedAt을 기준으로 센다 (새로고침으로 되돌릴 수 없게)", () => {
    expect(src).toMatch(/startedAt/);
    // 클라이언트 현재 시각만으로 마감을 계산하면 새로고침마다 시간이 되살아난다
    expect(src).toMatch(/Date\.parse\(\s*startedAt/);
  });
});
