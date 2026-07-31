/**
 * 문서 출력 상태 머신 (골프롬프트 2F · 불변 조건 18).
 *
 * `document_exports.status` / `math_render_artifacts.status` 의 enum 과 값이
 * 정확히 같다 — DB 가 저장할 수 있는 상태와 코드가 만들 수 있는 상태가 어긋나면
 * 둘 중 하나는 반드시 거짓말을 하게 된다.
 *
 * 이 머신이 지키는 단 하나의 중요한 성질:
 *
 *   **`ready` 는 `format_validation` 을 거치지 않고는 도달할 수 없다.**
 *
 * 렌더가 성공했다는 것과 산출물이 쓸 만하다는 것은 다른 말이다. 폭 0 수식이나
 * 잘린 분수를 담은 PDF 도 "렌더는 성공"한다. 검증 단계를 우회하는 경로를 하나라도
 * 열어두면 불변 조건 18(필수 산출물 누락 시 게시 불가)이 무너진다.
 * `reachableWithoutValidation` 테스트가 이 성질을 그래프 탐색으로 잠근다.
 */

/** `render_artifact_status` pgEnum 과 동일. 순서까지 맞춘다. */
export const DOCUMENT_EXPORT_STATES = [
  "queued",
  "rendering",
  "format_validation",
  "ready",
  "review_required",
  "failed",
] as const;

export type DocumentExportState = (typeof DOCUMENT_EXPORT_STATES)[number];

/** 더 이상 스스로 움직이지 않는 상태. 재시도는 새 사건이 들어와야 한다. */
const TERMINAL_STATES: ReadonlySet<DocumentExportState> = new Set(["ready"]);

export function isTerminalExportState(state: DocumentExportState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * 상태를 바꾸는 사건. 각 사건이 다음 상태에 필요한 데이터를 함께 들고 온다 —
 * "실패로 갔는데 사유가 없다" 같은 상태를 타입 수준에서 막기 위함이다.
 */
export type DocumentExportEvent =
  | { readonly type: "start_render"; readonly rendererVersion: string }
  | {
      readonly type: "render_succeeded";
      readonly storagePath: string;
      readonly checksum: string;
    }
  | { readonly type: "render_failed"; readonly reason: string }
  | { readonly type: "validation_passed"; readonly report: unknown }
  | {
      readonly type: "validation_needs_review";
      readonly report: unknown;
      readonly reason: string;
    }
  | {
      readonly type: "validation_failed";
      readonly reason: string;
      readonly report?: unknown;
    }
  | { readonly type: "review_approved"; readonly reviewer: string }
  | { readonly type: "review_rejected"; readonly reason: string }
  | { readonly type: "retry" };

export type DocumentExportEventType = DocumentExportEvent["type"];

/** `document_exports` 한 행에서 상태 전이에 관계된 부분. */
export interface DocumentExportSnapshot {
  readonly state: DocumentExportState;
  readonly rendererVersion?: string;
  readonly storagePath?: string;
  readonly checksum?: string;
  readonly validationReport?: unknown;
  readonly failureReason?: string;
  /** 사람이 검수해 통과시킨 경우 그 사람. 감사 추적에 쓴다. */
  readonly reviewedBy?: string;
}

/** 허용 전이표. 여기에 없는 (상태, 사건) 조합은 전부 거부된다. */
const TRANSITIONS: Readonly<
  Record<DocumentExportState, Partial<Record<DocumentExportEventType, DocumentExportState>>>
> = {
  queued: {
    start_render: "rendering",
    // 큐에 있는 동안 취소·오류로 죽는 경우 (예: 대상 시험이 회수됨)
    render_failed: "failed",
  },
  rendering: {
    render_succeeded: "format_validation",
    render_failed: "failed",
  },
  format_validation: {
    validation_passed: "ready",
    validation_needs_review: "review_required",
    validation_failed: "failed",
  },
  review_required: {
    review_approved: "ready",
    review_rejected: "failed",
    retry: "queued",
  },
  failed: {
    retry: "queued",
  },
  ready: {},
};

export class InvalidExportTransitionError extends Error {
  readonly from: DocumentExportState;
  readonly event: DocumentExportEventType;

  constructor(from: DocumentExportState, event: DocumentExportEventType) {
    super(`문서 출력 상태 전이가 허용되지 않는다: ${from} --${event}-->`);
    this.name = "InvalidExportTransitionError";
    this.from = from;
    this.event = event;
  }
}

/** 전이 결과 상태. 허용되지 않으면 undefined — 판정만 하고 싶을 때 쓴다. */
export function nextExportState(
  from: DocumentExportState,
  event: DocumentExportEventType,
): DocumentExportState | undefined {
  return TRANSITIONS[from][event];
}

export function canTransition(
  from: DocumentExportState,
  event: DocumentExportEventType,
): boolean {
  return nextExportState(from, event) !== undefined;
}

/**
 * 사건을 적용해 다음 스냅샷을 만든다.
 *
 * 실패 경로에서 `failureReason` 을 반드시 채우고, 성공 경로에서 이전 실패 사유를
 * 지운다 — 재시도로 성공한 행에 옛 실패 사유가 남아 운영자를 헷갈리게 하는 것을
 * 막는다.
 *
 * @throws {InvalidExportTransitionError} 전이표에 없는 조합
 */
export function applyExportEvent(
  snapshot: DocumentExportSnapshot,
  event: DocumentExportEvent,
): DocumentExportSnapshot {
  const to = nextExportState(snapshot.state, event.type);
  if (!to) throw new InvalidExportTransitionError(snapshot.state, event.type);

  switch (event.type) {
    case "start_render":
      return {
        ...withoutFailure(snapshot),
        state: to,
        rendererVersion: event.rendererVersion,
      };

    case "render_succeeded":
      return {
        ...snapshot,
        state: to,
        storagePath: event.storagePath,
        checksum: event.checksum,
      };

    case "render_failed":
    case "review_rejected":
      return { ...snapshot, state: to, failureReason: event.reason };

    case "validation_passed":
      return {
        ...withoutFailure(snapshot),
        state: to,
        validationReport: event.report,
      };

    case "validation_needs_review":
      return {
        ...snapshot,
        state: to,
        validationReport: event.report,
        failureReason: event.reason,
      };

    case "validation_failed":
      return {
        ...snapshot,
        state: to,
        validationReport: event.report,
        failureReason: event.reason,
      };

    case "review_approved":
      return { ...withoutFailure(snapshot), state: to, reviewedBy: event.reviewer };

    case "retry":
      // 재시도는 이전 시도의 흔적을 전부 지우고 처음부터 간다. 옛 산출물 경로를
      // 남겨두면 실패한 파일이 성공한 것처럼 참조될 수 있다.
      return { state: to };
  }
}

/** 성공 방향으로 갈 때 이전 실패 흔적을 지운다. */
function withoutFailure(
  snapshot: DocumentExportSnapshot,
): DocumentExportSnapshot {
  const { failureReason: _dropped, ...rest } = snapshot;
  return rest;
}
