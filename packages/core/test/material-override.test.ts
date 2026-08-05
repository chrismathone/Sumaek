import { describe, expect, it } from "vitest";
import { hideOverriddenMaterials } from "../src/learning/material-override";

/* ─────────────────────────────────────────────────────────────
 * 학원 자료가 공용 자료를 가린다 (ADR-0020 갈래 C).
 *
 * 이 규칙을 쓰는 곳이 둘이라(학생 화면·교사 준비도) 규칙 자체를 여기서
 * 못 박는다. 두 화면이 갈리면 교사가 미리 본 것과 학생이 만나는 것이
 * 달라지고, 그때 어느 쪽이 맞는지는 아무도 모른다.
 * ───────────────────────────────────────────────────────────── */

const ORG = "org-1";
const PLATFORM = "platform";
const m = (organizationId: string, conceptId: string, kind: string, id: string) => ({
  organizationId,
  conceptId,
  kind,
  id,
});

describe("자료 덮어쓰기", () => {
  it("우리 자료가 없으면 공용을 그대로 본다", () => {
    const rows = [m(PLATFORM, "c1", "reading", "p1"), m(PLATFORM, "c1", "video", "p2")];
    expect(hideOverriddenMaterials(rows, ORG).map((r) => r.id)).toEqual(["p1", "p2"]);
  });

  it("같은 개념·같은 종류에 우리 것이 있으면 공용은 가려진다", () => {
    const rows = [
      m(PLATFORM, "c1", "reading", "p1"),
      m(ORG, "c1", "reading", "o1"),
      m(PLATFORM, "c1", "video", "p2"),
    ];
    /* 설명만 우리 것으로 바뀌고 인강은 공용 그대로 — 이것이 「개념·종류」
     * 단위로 가리는 뜻이다. 개념 전체를 가리면 학원이 설명 하나 썼다고
     * 공용 인강까지 사라진다. */
    expect(hideOverriddenMaterials(rows, ORG).map((r) => r.id)).toEqual(["o1", "p2"]);
  });

  it("종류가 다르면 안 가린다", () => {
    const rows = [m(PLATFORM, "c1", "reading", "p1"), m(ORG, "c1", "video", "o1")];
    expect(hideOverriddenMaterials(rows, ORG).map((r) => r.id)).toEqual(["p1", "o1"]);
  });

  it("개념이 다르면 안 가린다", () => {
    const rows = [m(PLATFORM, "c1", "reading", "p1"), m(ORG, "c2", "reading", "o1")];
    expect(hideOverriddenMaterials(rows, ORG).map((r) => r.id)).toEqual(["p1", "o1"]);
  });

  it("우리 자료가 여럿이어도 우리 것은 전부 남는다", () => {
    const rows = [
      m(PLATFORM, "c1", "reading", "p1"),
      m(ORG, "c1", "reading", "o1"),
      m(ORG, "c1", "reading", "o2"),
    ];
    expect(hideOverriddenMaterials(rows, ORG).map((r) => r.id)).toEqual(["o1", "o2"]);
  });

  it("순서를 바꾸지 않는다 — 호출부의 order by가 학생이 보는 차례다", () => {
    const rows = [
      m(PLATFORM, "c2", "reading", "p2"),
      m(PLATFORM, "c1", "reading", "p1"),
      m(ORG, "c3", "reading", "o3"),
    ];
    expect(hideOverriddenMaterials(rows, ORG).map((r) => r.id)).toEqual(["p2", "p1", "o3"]);
  });

  it("다른 학원 자료는 우리 것을 대신하지 못한다", () => {
    /* 조직 id가 인자와 다르면 「우리 것」이 아니다. 질의가 잘못 넓어져
     * 남의 자료가 섞여 들어와도 그것이 공용을 가리지는 않는다. */
    const rows = [m(PLATFORM, "c1", "reading", "p1"), m("org-2", "c1", "reading", "x1")];
    expect(hideOverriddenMaterials(rows, ORG).map((r) => r.id)).toEqual(["p1", "x1"]);
  });
});
