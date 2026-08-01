"use client";

import { useState } from "react";
import {
  PENDING_NODE_ID,
  encodeRouteSnapshot,
  type RouteConflict,
  type RouteEditIntent,
  type RouteNodeChange,
  type RouteNodeSnapshot,
} from "@su-maek/core/routes";
import { BASELINE_FIELD, nodeKindLabel } from "./shared";

/* ─────────────────────────────────────────────────────────────
 * 동시 수정 충돌 화면 (인수 20 완결).
 *
 * "다른 사용자가 수정했습니다"만으로는 사용자가 할 수 있는 일이 새로 고침뿐이고,
 * 새로 고치면 내가 쓰던 것이 사라진다. 그래서 여기서 세 가지를 준다:
 *   1. 무엇이 달라졌는지 — 항목 단위(추가·삭제·순서·제목·종류·시수)
 *   2. 내 변경 vs 저장된 최신 상태 — 나란히
 *   3. 다음 행동 — 내 변경을 최신 상태 위에 **그대로 다시 적용**(잃지 않는다),
 *      또는 버리고 최신 상태로 이어서 작업
 *
 * position:fixed로 띄운다. 행 안 액션(↑·↓·삭제)에서도 열리는데 그 자리에
 * 그리면 행 높이가 늘어나 목록이 출렁인다 (ActionToast와 같은 이유).
 * ───────────────────────────────────────────────────────────── */

const CHANGE_LABEL: Record<RouteNodeChange["code"], string> = {
  ADDED: "추가",
  REMOVED: "삭제",
  TITLE: "제목",
  KIND: "종류",
  MINUTES: "시수",
  MOVED: "순서",
};

function describeChange(change: RouteNodeChange): string {
  switch (change.code) {
    case "ADDED":
      return `"${change.title}" 노드가 새로 생겼습니다`;
    case "REMOVED":
      return `"${change.title}" 노드가 사라졌습니다`;
    case "TITLE":
      return `"${change.before}" → "${change.after}"`;
    case "KIND":
      return `"${change.title}" — ${nodeKindLabel(change.before ?? "")} → ${nodeKindLabel(change.after ?? "")}`;
    case "MINUTES":
      return `"${change.title}" — ${change.before}분 → ${change.after}분`;
    case "MOVED":
      return `"${change.title}" — ${change.before}번째 → ${change.after}번째`;
  }
}

function ChangeList({
  title,
  changes,
  tone,
  empty,
}: {
  title: string;
  changes: RouteNodeChange[];
  tone: "mine" | "theirs";
  empty: string;
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-ink-soft">{title}</h4>
      {changes.length === 0 ? (
        <p className="mt-1 text-xs text-ink-soft">{empty}</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {changes.map((c, i) => (
            <li key={`${c.code}-${c.nodeId}-${i}`} className="text-xs">
              <span
                className={`mr-1.5 rounded-[var(--radius-control)] border px-1.5 py-0.5 font-mono ${
                  tone === "mine"
                    ? "border-pen text-pen"
                    : "border-grade text-grade"
                }`}
              >
                {CHANGE_LABEL[c.code]}
              </span>
              {describeChange(c)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NodeColumn({
  title, // 열 제목
  caption,
  nodes,
  marked,
  tone,
}: {
  title: string;
  caption: string;
  nodes: RouteNodeSnapshot[];
  /** 강조할 노드 id — 이 열에서 달라진 것들 */
  marked: Set<string>;
  tone: "mine" | "theirs";
}) {
  return (
    <div className="min-w-0 rounded-[var(--radius-control)] border border-rule bg-paper p-3">
      <h4
        className={`text-sm font-semibold ${tone === "mine" ? "text-pen" : "text-ink"}`}
      >
        {title}
      </h4>
      <p className="mt-0.5 text-xs text-ink-soft">{caption}</p>
      {nodes.length === 0 ? (
        <p className="mt-2 text-xs text-ink-soft">노드가 없습니다.</p>
      ) : (
        <ol className="mt-2 space-y-1">
          {nodes.map((n, i) => (
            <li
              key={n.id}
              className={`rounded-[var(--radius-control)] px-1.5 py-1 text-xs ${
                marked.has(n.id)
                  ? tone === "mine"
                    ? "bg-pen-soft/60"
                    : "bg-grade-soft"
                  : ""
              }`}
            >
              <span className="font-mono text-ink-soft">{i + 1}.</span>{" "}
              <span className="text-ink-soft">{nodeKindLabel(n.kind)}</span>{" "}
              <span className="font-medium">{n.title}</span>{" "}
              <span className="font-mono text-ink-soft">
                {n.expectedMinutes}분
              </span>
              {n.id === PENDING_NODE_ID && (
                <span className="ml-1 font-mono text-pen">(저장 안 됨)</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** 다시 적용 폼 — 내 편집을 그대로, 다만 최신 토큰·최신 스냅샷 위에 얹는다 */
function reapplyFields(
  intent: RouteEditIntent,
): Array<{ name: string; value: string }> {
  switch (intent.type) {
    case "add":
      return [
        { name: "kind", value: intent.kind },
        { name: "title", value: intent.title },
        { name: "expectedMinutes", value: String(intent.expectedMinutes) },
        ...intent.conceptIds.map((id) => ({ name: "conceptIds", value: id })),
      ];
    case "delete":
      return [{ name: "nodeId", value: intent.nodeId }];
    case "move":
      return [
        { name: "nodeId", value: intent.nodeId },
        { name: "direction", value: intent.direction },
      ];
    case "publish":
      return [];
  }
}

const INTENT_LABEL: Record<RouteEditIntent["type"], string> = {
  add: "노드 추가",
  delete: "노드 삭제",
  move: "순서 변경",
  publish: "게시",
};

export function ConflictPanel({
  conflict,
  planId,
  action,
  pending,
}: {
  conflict: RouteConflict;
  planId: string;
  /** 원래 눌렀던 것과 같은 서버 액션 — 다시 적용도 같은 게이트를 통과한다 */
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const myNodeIds = new Set(conflict.myChanges.map((c) => c.nodeId));
  const theirNodeIds = new Set(conflict.theirChanges.map((c) => c.nodeId));

  return (
    <div
      role="dialog"
      aria-label="동시 수정 충돌"
      className="fixed inset-x-2 bottom-2 z-50 max-h-[80vh] overflow-y-auto rounded-lg border border-grade bg-surface p-4 shadow-lg sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[44rem] sm:max-w-[calc(100vw-2rem)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-grade">
            동시 수정 충돌 — 내 변경은 저장되지 않았습니다
          </h3>
          <p className="mt-0.5 font-mono text-xs text-ink-soft">
            VERSION_CONFLICT · 내가 읽은 버전 v{conflict.baseLockVersion} · 저장된
            버전 v{conflict.currentLockVersion} · 내 작업:{" "}
            {INTENT_LABEL[conflict.intent.type]}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="충돌 화면 닫기"
          className="shrink-0 text-ink-soft hover:text-ink"
        >
          ✕
        </button>
      </div>

      {!conflict.comparable ? (
        <p className="mt-3 rounded-[var(--radius-control)] bg-grade-soft px-3 py-2 text-sm text-grade">
          내가 읽은 시점의 상태를 폼에서 찾지 못해 항목별 비교를 만들 수
          없습니다. 아래 최신 상태를 확인한 뒤 다시 시도하세요.
        </p>
      ) : conflict.theirChanges.length === 0 ? (
        <p className="mt-3 rounded-[var(--radius-control)] bg-grade-soft px-3 py-2 text-sm text-grade">
          저장된 노드 목록에서는 달라진 항목을 찾지 못했습니다 — 다른 사용자가
          같은 시각에 다른 편집(예: 검증·게시)을 저장했을 수 있습니다. 아래
          최신 상태를 확인하세요.
        </p>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <NodeColumn
          title="내 변경 (저장 안 됨)"
          caption={`내가 읽은 v${conflict.baseLockVersion} 위에 내 편집을 얹은 모습`}
          nodes={conflict.mine}
          marked={myNodeIds}
          tone="mine"
        />
        <NodeColumn
          title="저장된 최신 상태"
          caption={`다른 사용자가 저장한 v${conflict.currentLockVersion}`}
          nodes={conflict.theirs}
          marked={theirNodeIds}
          tone="theirs"
        />
      </div>

      <div className="mt-3 grid gap-3 border-t border-rule-soft pt-3 sm:grid-cols-2">
        <ChangeList
          title="내가 하려던 변경"
          changes={conflict.myChanges}
          tone="mine"
          empty="노드 목록은 그대로입니다 (게시 등 상태 변경)."
        />
        <ChangeList
          title="내가 읽은 뒤 다른 사용자가 저장한 변경"
          changes={conflict.theirChanges}
          tone="theirs"
          empty="노드 목록에는 차이가 없습니다."
        />
      </div>

      {conflict.collisions.length > 0 && (
        <div className="mt-3 rounded-[var(--radius-control)] bg-grade-soft px-3 py-2">
          <h4 className="text-xs font-semibold text-grade">
            같은 노드를 양쪽이 건드렸습니다 — 다시 적용 전에 확인하세요
          </h4>
          <ul className="mt-1 space-y-1 text-xs text-grade">
            {conflict.collisions.map((c) => (
              <li key={c.nodeId}>
                <span className="font-medium">{c.title}</span> — 내{" "}
                {c.mine.map((m) => CHANGE_LABEL[m.code]).join("·")} vs 상대{" "}
                {c.theirs.map((t) => CHANGE_LABEL[t.code]).join("·")}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-rule-soft pt-3">
        {conflict.reapply.possible ? (
          <form action={action}>
            <input type="hidden" name="planId" value={planId} />
            <input
              type="hidden"
              name="expectedLockVersion"
              value={conflict.currentLockVersion}
            />
            <input
              type="hidden"
              name={BASELINE_FIELD}
              value={encodeRouteSnapshot(conflict.theirs)}
            />
            {reapplyFields(conflict.intent).map((f, i) => (
              <input
                key={`${f.name}-${i}`}
                type="hidden"
                name={f.name}
                value={f.value}
              />
            ))}
            <button
              type="submit"
              disabled={pending}
              className="rounded-[var(--radius-control)] bg-pen px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {pending ? "다시 적용 중…" : "내 변경을 최신 상태에 다시 적용"}
            </button>
          </form>
        ) : (
          <p className="text-sm text-grade">{conflict.reapply.blockedReason}</p>
        )}
        <a
          href={`/app/routes/${planId}`}
          className="rounded-[var(--radius-control)] border border-rule px-4 py-2 text-sm hover:bg-paper"
        >
          내 변경 버리고 최신 상태로 이어서 작업
        </a>
      </div>
      {conflict.reapply.note && (
        <p className="mt-2 text-xs text-ink-soft">{conflict.reapply.note}</p>
      )}
    </div>
  );
}
