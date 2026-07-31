import { describe, expect, it } from "vitest";

import {
  DOCUMENT_EXPORT_STATES,
  InvalidExportTransitionError,
  applyExportEvent,
  canTransition,
  isTerminalExportState,
  nextExportState,
} from "../../src/export";
import type {
  DocumentExportEventType,
  DocumentExportSnapshot,
  DocumentExportState,
} from "../../src/export";

/* ─────────────────────────────────────────────────────────────
 * 문서 출력 상태 머신.
 *
 * 이 파일에서 가장 중요한 테스트는 "검증을 건너뛰고 ready 에 도달할 수 없다"이다.
 * 나머지는 전이표를 옮겨 적은 것에 가깝지만, 그 하나는 불변 조건 18을 그래프
 * 탐색으로 잠근다 — 나중에 누가 편의를 위해 지름길 전이를 하나 추가하면 즉시
 * 깨진다.
 * ───────────────────────────────────────────────────────────── */

const ALL_EVENTS: DocumentExportEventType[] = [
  "start_render",
  "render_succeeded",
  "render_failed",
  "validation_passed",
  "validation_needs_review",
  "validation_failed",
  "review_approved",
  "review_rejected",
  "retry",
];

describe("문서 출력 상태 머신 — 상태 집합", () => {
  it("DB 의 render_artifact_status enum 과 값·순서가 같다", () => {
    // packages/db/src/schema/content.ts 의 renderArtifactStatus 와 대조.
    // 여기가 어긋나면 코드가 만들 수 있는 상태를 DB 가 저장하지 못한다.
    expect([...DOCUMENT_EXPORT_STATES]).toEqual([
      "queued",
      "rendering",
      "format_validation",
      "ready",
      "review_required",
      "failed",
    ]);
  });

  it("ready 만 종착 상태다", () => {
    const terminal = DOCUMENT_EXPORT_STATES.filter(isTerminalExportState);
    expect(terminal).toEqual(["ready"]);
  });

  it("ready 에서는 어떤 사건도 받지 않는다", () => {
    for (const event of ALL_EVENTS) {
      expect(canTransition("ready", event), event).toBe(false);
    }
  });
});

describe("문서 출력 상태 머신 — 검증 우회 금지 (불변 조건 18)", () => {
  /** from 에서 시작해 금지된 상태를 지나지 않고 도달 가능한 상태 전체. */
  function reachable(
    from: DocumentExportState,
    forbidden: ReadonlySet<DocumentExportState>,
  ): Set<DocumentExportState> {
    const seen = new Set<DocumentExportState>([from]);
    const queue: DocumentExportState[] = [from];
    while (queue.length > 0) {
      const current = queue.shift() as DocumentExportState;
      for (const event of ALL_EVENTS) {
        const to = nextExportState(current, event);
        if (!to || seen.has(to) || forbidden.has(to)) continue;
        seen.add(to);
        queue.push(to);
      }
    }
    return seen;
  }

  it("format_validation 을 거치지 않으면 ready 에 절대 도달할 수 없다", () => {
    const withoutValidation = reachable("queued", new Set(["format_validation"]));
    expect(withoutValidation.has("ready")).toBe(false);
  });

  it("format_validation 을 허용하면 ready 에 도달한다", () => {
    expect(reachable("queued", new Set()).has("ready")).toBe(true);
  });

  it("ready 로 들어오는 전이는 검증 통과와 사람 승인 둘뿐이다", () => {
    const intoReady: Array<[DocumentExportState, DocumentExportEventType]> = [];
    for (const from of DOCUMENT_EXPORT_STATES) {
      for (const event of ALL_EVENTS) {
        if (nextExportState(from, event) === "ready") intoReady.push([from, event]);
      }
    }
    expect(intoReady).toEqual([
      ["format_validation", "validation_passed"],
      ["review_required", "review_approved"],
    ]);
  });

  it("모든 상태에서 ready 나 실패로 빠져나갈 길이 있다 (막다른 골목 없음)", () => {
    for (const from of DOCUMENT_EXPORT_STATES) {
      if (isTerminalExportState(from)) continue;
      const targets = reachable(from, new Set());
      expect(targets.has("ready") || targets.has("failed"), from).toBe(true);
    }
  });
});

describe("문서 출력 상태 머신 — 정상 경로", () => {
  it("큐 → 렌더 → 검증 → 완료", () => {
    let snapshot: DocumentExportSnapshot = { state: "queued" };

    snapshot = applyExportEvent(snapshot, {
      type: "start_render",
      rendererVersion: "hwpx-2026.07.0",
    });
    expect(snapshot.state).toBe("rendering");
    expect(snapshot.rendererVersion).toBe("hwpx-2026.07.0");

    snapshot = applyExportEvent(snapshot, {
      type: "render_succeeded",
      storagePath: "exports/a.hwpx",
      checksum: "sha256:abc",
    });
    expect(snapshot.state).toBe("format_validation");
    expect(snapshot.storagePath).toBe("exports/a.hwpx");

    snapshot = applyExportEvent(snapshot, {
      type: "validation_passed",
      report: { status: "passed" },
    });
    expect(snapshot.state).toBe("ready");
    expect(snapshot.validationReport).toEqual({ status: "passed" });
    expect(snapshot.checksum).toBe("sha256:abc");
  });

  it("검증에서 걸리면 검수 대기로 가고, 승인하면 완료된다", () => {
    let snapshot: DocumentExportSnapshot = { state: "format_validation" };
    snapshot = applyExportEvent(snapshot, {
      type: "validation_needs_review",
      report: { status: "review_required" },
      reason: "골든 대비 폭 편차 4.1%",
    });
    expect(snapshot.state).toBe("review_required");
    expect(snapshot.failureReason).toBe("골든 대비 폭 편차 4.1%");

    snapshot = applyExportEvent(snapshot, {
      type: "review_approved",
      reviewer: "user-1",
    });
    expect(snapshot.state).toBe("ready");
    expect(snapshot.reviewedBy).toBe("user-1");
  });
});

describe("문서 출력 상태 머신 — 실패와 재시도", () => {
  it("실패 전이는 사유를 남긴다", () => {
    const failed = applyExportEvent(
      { state: "rendering" },
      { type: "render_failed", reason: "미지원 수식 3건" },
    );
    expect(failed.state).toBe("failed");
    expect(failed.failureReason).toBe("미지원 수식 3건");
  });

  it("검증 실패는 사유와 보고서를 함께 남긴다", () => {
    const failed = applyExportEvent(
      { state: "format_validation" },
      {
        type: "validation_failed",
        reason: "폭 0 수식 2건",
        report: { issues: 2 },
      },
    );
    expect(failed.state).toBe("failed");
    expect(failed.failureReason).toBe("폭 0 수식 2건");
    expect(failed.validationReport).toEqual({ issues: 2 });
  });

  it("재시도는 이전 시도의 흔적을 전부 지운다", () => {
    const retried = applyExportEvent(
      {
        state: "failed",
        rendererVersion: "hwpx-2026.07.0",
        storagePath: "exports/broken.hwpx",
        checksum: "sha256:old",
        failureReason: "폭 0 수식 2건",
        validationReport: { issues: 2 },
      },
      { type: "retry" },
    );
    // 실패한 산출물 경로가 남아 있으면 성공한 파일처럼 참조될 수 있다.
    expect(retried).toEqual({ state: "queued" });
  });

  it("재시도 후 성공하면 옛 실패 사유가 남지 않는다", () => {
    let snapshot: DocumentExportSnapshot = {
      state: "failed",
      failureReason: "일시적 렌더 타임아웃",
    };
    snapshot = applyExportEvent(snapshot, { type: "retry" });
    snapshot = applyExportEvent(snapshot, {
      type: "start_render",
      rendererVersion: "pdf-chromium-131",
    });
    expect(snapshot.failureReason).toBeUndefined();
  });

  it("검수에서 반려하면 실패로 간다", () => {
    const rejected = applyExportEvent(
      { state: "review_required" },
      { type: "review_rejected", reason: "수식 겹침 — 재작성 필요" },
    );
    expect(rejected.state).toBe("failed");
    expect(rejected.failureReason).toBe("수식 겹침 — 재작성 필요");
  });
});

describe("문서 출력 상태 머신 — 금지된 전이", () => {
  it("렌더 중에 검증 통과를 받을 수 없다", () => {
    expect(() =>
      applyExportEvent({ state: "rendering" }, { type: "validation_passed", report: {} }),
    ).toThrow(InvalidExportTransitionError);
  });

  it("큐 상태에서 바로 완료로 갈 수 없다", () => {
    expect(canTransition("queued", "validation_passed")).toBe(false);
    expect(canTransition("queued", "review_approved")).toBe(false);
  });

  it("완료된 산출물은 다시 움직이지 않는다", () => {
    expect(() =>
      applyExportEvent({ state: "ready" }, { type: "retry" }),
    ).toThrow(InvalidExportTransitionError);
  });

  it("오류가 어느 전이에서 났는지 알려준다", () => {
    try {
      applyExportEvent({ state: "queued" }, { type: "review_approved", reviewer: "u" });
      expect.unreachable("전이가 허용되면 안 된다");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidExportTransitionError);
      const typed = error as InvalidExportTransitionError;
      expect(typed.from).toBe("queued");
      expect(typed.event).toBe("review_approved");
    }
  });

  it("전이표에 없는 조합은 전부 거부된다", () => {
    const allowed = new Set([
      "queued|start_render",
      "queued|render_failed",
      "rendering|render_succeeded",
      "rendering|render_failed",
      "format_validation|validation_passed",
      "format_validation|validation_needs_review",
      "format_validation|validation_failed",
      "review_required|review_approved",
      "review_required|review_rejected",
      "review_required|retry",
      "failed|retry",
    ]);
    for (const from of DOCUMENT_EXPORT_STATES) {
      for (const event of ALL_EVENTS) {
        expect(canTransition(from, event), `${from}|${event}`).toBe(
          allowed.has(`${from}|${event}`),
        );
      }
    }
  });
});
