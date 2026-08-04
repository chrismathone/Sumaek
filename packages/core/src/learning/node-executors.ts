import type { IsoDate } from "../shared/dates";
import type { DayPlanItemInput, DayPlanItemStatus } from "./day-plan";

/* ─────────────────────────────────────────────────────────────
 * 루트 노드 실행기 — 노드를 학생이 실제로 할 수 있는 항목으로 편다.
 *
 * 이것이 없던 동안 `book_range`·`homework`·`confirmation_test` 노드는
 * 교사가 만들 수는 있어도 학생 화면에 **아무것도 나타나지 않았다** (G-05).
 * 조용히 사라지는 것이 가장 나쁜 실패다: 교사는 배정했다고 믿고 학생은
 * 그런 것이 있는 줄도 모른다. 그래서 여기서는 세 결과만 낸다 —
 * **펼친다 / 학생 행동이 없다 / 막혔다.** 넷째는 없다.
 *
 * 「막혔다」는 사고이지 상태가 아니다. 사유 코드는 준비도 게이트(T2.4)와
 * 학생 화면(T1.4)이 같은 레지스트리를 쓴다 — 교사가 게시 전에 보는 말과
 * 학생이 당일 만나는 말이 다르면 복구 링크를 이을 수 없다.
 * ───────────────────────────────────────────────────────────── */

/**
 * DB `route_node_kind` enum의 정본 사본.
 *
 * 순수 패키지라 DB를 읽을 수 없으므로 여기 적고, **DB와 정확히 같은지는
 * 통합 테스트가 확인한다**(apps/web route-node-payload). enum에 한 종류가
 * 늘면 그 테스트가 먼저 깨지고, 여기 더하면 아래 exhaustive 검사가 깨진다.
 * 두 관문을 다 지나야 새 종류가 조용히 흘러들지 않는다.
 */
export const ROUTE_NODE_KINDS = [
  "concept_lesson",
  "problem_solving",
  "book_range",
  "homework",
  "daily_test",
  "confirmation_test",
  "wrong_answer_review",
  "remediation",
  "cumulative_review",
  "buffer",
  "break",
  "custom",
] as const;

export type RouteNodeKind = (typeof ROUTE_NODE_KINDS)[number];

/** 차단 사유 — 화면·게이트가 같은 코드를 쓴다 */
export const BLOCK_REASONS = {
  materialMissing: "material_missing",
  noQuestions: "no_questions",
  bookRangeIncomplete: "book_range_incomplete",
  homeworkModeMissing: "homework_mode_missing",
  assessmentNotGenerated: "assessment_not_generated",
  unknownNodeKind: "unknown_node_kind",
} as const;

export type BlockReason = (typeof BLOCK_REASONS)[keyof typeof BLOCK_REASONS];

export type NodeExecution =
  /** 학생이 할 수 있는 항목으로 펼쳐졌다 */
  | { outcome: "items"; items: DayPlanItemInput[] }
  /** 학생 행동이 없는 노드다 (버퍼·휴강) — 결손이 아니다 */
  | { outcome: "not_required"; note: string }
  /** 필수인데 지금 실행할 수 없다 — 사고다 */
  | { outcome: "blocked"; reason: BlockReason };

export interface ExecutableNode {
  id: string;
  kind: string;
  title: string;
  bookEditionId?: string | null;
  pageRange?: { startPage: number; endPage: number } | null;
  homework?: { mode: string; practiceMaterialId?: string } | null;
  blueprintId?: string | null;
}

export interface NodeMaterial {
  id: string;
  kind: "reading" | "video" | "practice";
  title: string;
  /** 연습 자료의 문항 수 — 0이면 학생이 눌러도 아무것도 없다 */
  questionCount: number;
  progress: "none" | "in_progress" | "completed";
}

export interface NodeAssessment {
  id: string;
  title: string;
  scheduledDate: IsoDate | null;
  questionCount: number;
  /** 최신 응시 상태 — 없으면 아직 시작하지 않았다 */
  status: DayPlanItemStatus;
}

export interface NodeExecutionContext {
  /** 이 노드의 개념에 붙은 게시 자료 */
  materials: readonly NodeMaterial[];
  /** 이 노드에 대해 생성된 평가 — 아직 없으면 null */
  assessment: NodeAssessment | null;
  /** 교재 이름 (학생에게 보일 문구) */
  bookTitle?: string | null;
  /** 숙제를 끝냈나 */
  homeworkDone?: boolean;
  /** 기한이 온 복습 건수 */
  dueReviewCount?: number;
  /** 항목 순번의 시작값 — 노드 순서를 화면 순서로 잇는다 */
  ordinalFrom: number;
}

function materialItems(
  node: ExecutableNode,
  ctx: NodeExecutionContext,
): DayPlanItemInput[] {
  return ctx.materials.map((m, i) => {
    /* 문항 0개 연습 자료는 게시돼 있어도 학생이 할 수 있는 것이 없다.
     * 「할 차례」로 보이고 눌러도 빈 화면이면 학생은 자기가 잘못한 줄 안다. */
    const empty = m.kind === "practice" && m.questionCount === 0;
    return {
      key: `${m.kind}:${m.id}`,
      kind: m.kind,
      required: true,
      status: empty ? ("blocked" as const) : progressStatus(m.progress),
      blockedReason: empty ? BLOCK_REASONS.noQuestions : null,
      titleSnapshot: m.title,
      ordinal: ctx.ordinalFrom + i,
      routeNodeId: node.id,
      refType: "learning_material",
      refId: m.id,
    };
  });
}

function progressStatus(p: NodeMaterial["progress"]): DayPlanItemStatus {
  return p === "none" ? "pending" : p;
}

function assessmentItem(
  node: ExecutableNode,
  ctx: NodeExecutionContext,
): DayPlanItemInput | null {
  const a = ctx.assessment;
  if (!a) return null;
  const empty = a.questionCount === 0;
  return {
    key: `assessment:${a.id}`,
    kind: "assessment",
    required: true,
    status: empty ? "blocked" : a.status,
    blockedReason: empty ? BLOCK_REASONS.noQuestions : null,
    scheduledDate: a.scheduledDate,
    titleSnapshot: a.title,
    ordinal: ctx.ordinalFrom,
    routeNodeId: node.id,
    refType: "assessment_instance",
    refId: a.id,
  };
}

type Executor = (node: ExecutableNode, ctx: NodeExecutionContext) => NodeExecution;

/** 개념을 배우는 차시 — 붙은 자료가 곧 학생의 할 일이다 */
const teachFromMaterials: Executor = (node, ctx) => {
  const items = materialItems(node, ctx);
  /* 자료가 하나도 없으면 학생은 이 차시에 할 수 있는 것이 없다. 빈 배열을
   * 돌려주면 그 사실이 조용히 사라진다 — 막혔다고 말해야 교사에게 닿는다. */
  if (items.length === 0) {
    return { outcome: "blocked", reason: BLOCK_REASONS.materialMissing };
  }
  return { outcome: "items", items };
};

const executeBookRange: Executor = (node, ctx) => {
  if (!node.bookEditionId || !node.pageRange) {
    return { outcome: "blocked", reason: BLOCK_REASONS.bookRangeIncomplete };
  }
  const { startPage, endPage } = node.pageRange;
  const book = ctx.bookTitle ?? "교재";
  return {
    outcome: "items",
    items: [
      {
        key: `book_range:${node.id}`,
        kind: "book_range",
        required: true,
        status: ctx.homeworkDone ? "completed" : "pending",
        titleSnapshot: `${book} ${startPage}~${endPage}쪽`,
        ordinal: ctx.ordinalFrom,
        routeNodeId: node.id,
        refType: "book_edition",
        refId: node.bookEditionId,
      },
    ],
  };
};

const executeHomework: Executor = (node, ctx) => {
  const mode = node.homework?.mode;
  if (mode !== "book_pages" && mode !== "practice_set") {
    return { outcome: "blocked", reason: BLOCK_REASONS.homeworkModeMissing };
  }

  if (mode === "book_pages") {
    if (!node.bookEditionId || !node.pageRange) {
      return { outcome: "blocked", reason: BLOCK_REASONS.bookRangeIncomplete };
    }
    const { startPage, endPage } = node.pageRange;
    const book = ctx.bookTitle ?? "교재";
    return {
      outcome: "items",
      items: [
        {
          key: `homework:${node.id}`,
          kind: "homework",
          required: true,
          status: ctx.homeworkDone ? "completed" : "pending",
          titleSnapshot: `숙제 — ${book} ${startPage}~${endPage}쪽`,
          ordinal: ctx.ordinalFrom,
          routeNodeId: node.id,
          refType: "book_edition",
          refId: node.bookEditionId,
        },
      ],
    };
  }

  const materialId = node.homework?.practiceMaterialId;
  if (!materialId) {
    return { outcome: "blocked", reason: BLOCK_REASONS.homeworkModeMissing };
  }
  /* 시스템 연습 숙제는 그 자료의 문항이 실제로 있어야 한다. 없으면 학생은
   * 숙제 화면에서 빈 목록을 본다. */
  const material = ctx.materials.find((m) => m.id === materialId);
  if (material && material.questionCount === 0) {
    return { outcome: "blocked", reason: BLOCK_REASONS.noQuestions };
  }
  return {
    outcome: "items",
    items: [
      {
        key: `homework:${node.id}`,
        kind: "homework",
        required: true,
        status: ctx.homeworkDone
          ? "completed"
          : progressStatus(material?.progress ?? "none"),
        titleSnapshot: `숙제 — ${material?.title ?? "연습문제"}`,
        ordinal: ctx.ordinalFrom,
        routeNodeId: node.id,
        refType: "learning_material",
        refId: materialId,
      },
    ],
  };
};

const executeAssessment: Executor = (node, ctx) => {
  const item = assessmentItem(node, ctx);
  /* 평가 노드인데 평가가 아직 없다. 워커가 만들 예정이면 정상이지만,
   * **오늘 것이라면 사고다** — 학생은 시험 칸을 영원히 기다린다.
   * 오늘인지 미래인지는 투영기가 날짜로 가르므로 여기서는 막혔다고만 한다. */
  if (!item) {
    return { outcome: "blocked", reason: BLOCK_REASONS.assessmentNotGenerated };
  }
  return { outcome: "items", items: [item] };
};

const executeReview: Executor = (node, ctx) => {
  const due = ctx.dueReviewCount ?? 0;
  /* 복습할 것이 없는 날은 결손이 아니다 — 망각 곡선이 아직 부르지 않았을 뿐. */
  if (due === 0) {
    return { outcome: "not_required", note: "기한이 온 복습이 없습니다." };
  }
  return {
    outcome: "items",
    items: [
      {
        key: "review:due",
        kind: "review",
        required: true,
        status: "pending",
        titleSnapshot: `복습 ${due}건`,
        ordinal: ctx.ordinalFrom,
        routeNodeId: node.id,
        refType: "review_batch",
      },
    ],
  };
};

const notRequired = (note: string): Executor => () => ({
  outcome: "not_required",
  note,
});

const blocked = (reason: BlockReason): Executor => () => ({
  outcome: "blocked",
  reason,
});

/**
 * 종류 → 실행기.
 *
 * `Record<RouteNodeKind, …>`이므로 enum에 종류를 더하면 **컴파일이 깨진다.**
 * 런타임 exhaustive 검사(아래 테스트)와 함께 두 겹으로 막는다.
 */
export const NODE_EXECUTORS: Record<RouteNodeKind, Executor> = {
  concept_lesson: teachFromMaterials,
  problem_solving: teachFromMaterials,
  remediation: teachFromMaterials,
  book_range: executeBookRange,
  homework: executeHomework,
  daily_test: executeAssessment,
  confirmation_test: executeAssessment,
  wrong_answer_review: executeReview,
  cumulative_review: executeReview,
  buffer: notRequired("여유 차시입니다 — 밀린 것을 따라잡는 시간입니다."),
  break: notRequired("휴강 구간입니다."),
  /* 무엇을 하는 노드인지 아무도 모른다. 빌더가 내밀지 않지만(T2.1) 과거
   * 데이터나 마이그레이션으로 남아 있을 수 있다. 조용히 넘기면 학생 화면에
   * 아무것도 안 나오고 아무도 모른다. */
  custom: blocked(BLOCK_REASONS.unknownNodeKind),
};

/**
 * 노드 하나를 실행한다.
 *
 * 알 수 없는 종류는 **차단**이다. 무시가 아니다 — 무시하면 필수 노드가
 * 조용히 사라지고, 그 하루는 「할 일 없음」으로 완주 처리된다.
 */
export function executeNode(
  node: ExecutableNode,
  ctx: NodeExecutionContext,
): NodeExecution {
  const executor = NODE_EXECUTORS[node.kind as RouteNodeKind];
  if (!executor) {
    return { outcome: "blocked", reason: BLOCK_REASONS.unknownNodeKind };
  }
  return executor(node, ctx);
}

export interface ExecuteAllResult {
  items: DayPlanItemInput[];
  /** 막힌 노드 — 학생 화면과 교사 준비도가 같은 목록을 본다 */
  blocked: { nodeId: string; kind: string; title: string; reason: BlockReason }[];
  /** 학생 행동이 없는 노드 — 결손이 아니라는 사실을 남긴다 */
  notRequired: { nodeId: string; title: string; note: string }[];
}

/**
 * 노드 목록을 하루 계획 항목으로 편다.
 *
 * 막힌 노드를 **버리지 않고 함께 돌려준다.** 항목만 돌려주면 호출자는
 * 「원래 없던 것」과 「있었는데 실행할 수 없는 것」을 구분할 방법이 없다.
 */
export function executeNodes(
  nodes: readonly ExecutableNode[],
  contextFor: (node: ExecutableNode, ordinalFrom: number) => NodeExecutionContext,
): ExecuteAllResult {
  const result: ExecuteAllResult = { items: [], blocked: [], notRequired: [] };

  for (const node of nodes) {
    const execution = executeNode(node, contextFor(node, result.items.length));
    if (execution.outcome === "items") {
      result.items.push(...execution.items);
    } else if (execution.outcome === "blocked") {
      result.blocked.push({
        nodeId: node.id,
        kind: node.kind,
        title: node.title,
        reason: execution.reason,
      });
    } else {
      result.notRequired.push({
        nodeId: node.id,
        title: node.title,
        note: execution.note,
      });
    }
  }

  return result;
}
