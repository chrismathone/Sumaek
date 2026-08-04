import { z } from "zod";

/* ─────────────────────────────────────────────────────────────
 * 노드 종류별 payload 검증 (T2.1).
 *
 * DB에는 book_edition_id·page_range·homework·blueprint_id·
 * completion_criteria가 처음부터 있었는데 폼도 액션도 하나도 저장하지
 * 않았다. 교재 범위 노드를 만들어도 어느 교재 몇 쪽인지 남지 않으니
 * 학생 화면이 그 노드를 펼칠 방법이 없었다 (G-05).
 *
 * 그래서 여기서는 **비어 있는 것을 거부한다.** 조용히 빈 노드를 만들면
 * 결손이 학생 화면에서 처음 드러나고, 그때는 이미 수업 당일이다.
 * 없는 것을 있는 것처럼 저장하지 않는 것이 준비도 게이트(T2.4)의 전제다.
 *
 * "use server" 파일에서는 async 함수 외에 내보낼 수 없어서 actions.ts가
 * 아니라 여기 둔다 — 폼(클라이언트)과 액션(서버)이 같은 규칙을 본다.
 * ───────────────────────────────────────────────────────────── */

/** 숙제 방식 — MVP는 둘뿐이다. 파일 업로드·자유 서술은 비범위. */
export const HOMEWORK_MODES = ["book_pages", "practice_set"] as const;
export type HomeworkMode = (typeof HOMEWORK_MODES)[number];

export const HOMEWORK_MODE_LABEL: Record<HomeworkMode, string> = {
  book_pages: "교재 쪽 범위 확인",
  practice_set: "시스템 연습문제",
};

export interface PageRange {
  startPage: number;
  endPage: number;
}

export interface NodePayload {
  bookEditionId: string | null;
  pageRange: PageRange | null;
  homework: { mode: HomeworkMode; practiceMaterialId?: string } | null;
  blueprintId: string | null;
  completionCriteria: { passScore: number } | null;
}

const EMPTY: NodePayload = {
  bookEditionId: null,
  pageRange: null,
  homework: null,
  blueprintId: null,
  completionCriteria: null,
};

/** 교재 범위를 요구하는 종류 */
const NEEDS_BOOK_RANGE = new Set(["book_range"]);
/** 평가 참조를 요구하는 종류 */
const NEEDS_ASSESSMENT_REF = new Set(["daily_test", "confirmation_test"]);

const uuid = z.uuid();
const pageSchema = z.coerce.number().int().min(1).max(9999);

export type ParseResult =
  | { ok: true; data: NodePayload }
  | { ok: false; message: string };

function fail(message: string): ParseResult {
  return { ok: false, message };
}

function readPageRange(raw: Record<string, string>): PageRange | "invalid" | null {
  const start = raw.startPage?.trim();
  const end = raw.endPage?.trim();
  if (!start && !end) return null;
  const s = pageSchema.safeParse(start);
  const e = pageSchema.safeParse(end);
  if (!s.success || !e.success) return "invalid";
  /* 끝이 시작보다 앞서면 학생 화면에 「40~12쪽」이 뜬다. 사람은 오타로
   * 읽고 넘기지만 진도 계산은 음수 쪽수를 그대로 쓴다. */
  if (e.data < s.data) return "invalid";
  return { startPage: s.data, endPage: e.data };
}

/**
 * 폼 값을 종류별 payload로 해석한다.
 *
 * 종류에 맞지 않는 값이 섞이면 **거부한다.** 무시하고 버리면 교사는 자기가
 * 입력한 것이 저장됐다고 믿고, 학생 화면에서만 없다.
 */
export function parseNodePayload(
  kind: string,
  raw: Record<string, string>,
): ParseResult {
  const bookEditionId = raw.bookEditionId?.trim() || null;
  const homeworkMode = raw.homeworkMode?.trim() || null;
  const blueprintId = raw.blueprintId?.trim() || null;
  const practiceMaterialId = raw.practiceMaterialId?.trim() || null;
  const passScoreRaw = raw.passScore?.trim() || null;

  const pageRange = readPageRange(raw);
  if (pageRange === "invalid") {
    return fail("쪽 범위를 확인하세요 — 시작 쪽과 끝 쪽을 순서대로 입력합니다.");
  }

  const hasBookInput = Boolean(bookEditionId) || pageRange !== null;
  const hasAssessmentInput = Boolean(blueprintId) || Boolean(passScoreRaw);
  const hasHomeworkInput = Boolean(homeworkMode) || Boolean(practiceMaterialId);

  /* ── 교재 범위 ── */
  if (NEEDS_BOOK_RANGE.has(kind)) {
    if (hasAssessmentInput) return fail("교재 범위 노드에는 평가 설정을 넣을 수 없습니다.");
    if (hasHomeworkInput) return fail("교재 범위 노드에는 숙제 방식을 넣을 수 없습니다.");
    if (!bookEditionId || !uuid.safeParse(bookEditionId).success) {
      return fail("교재 판본을 선택하세요.");
    }
    if (!pageRange) return fail("시작 쪽과 끝 쪽을 입력하세요.");
    return { ok: true, data: { ...EMPTY, bookEditionId, pageRange } };
  }

  /* ── 숙제 ── */
  if (kind === "homework") {
    if (hasAssessmentInput) return fail("숙제 노드에는 평가 설정을 넣을 수 없습니다.");
    if (!homeworkMode) return fail("숙제 방식을 고르세요.");
    if (!(HOMEWORK_MODES as readonly string[]).includes(homeworkMode)) {
      /* 파일 업로드·자유 서술 제출은 MVP 비범위다. 폼에 없어도 값이
       * 들어올 수 있으므로 여기서 다시 막는다. */
      return fail("지원하는 숙제 방식은 교재 쪽 범위 또는 시스템 연습문제입니다.");
    }
    if (homeworkMode === "book_pages") {
      if (!bookEditionId || !uuid.safeParse(bookEditionId).success) {
        return fail("교재 판본을 선택하세요.");
      }
      if (!pageRange) return fail("숙제 범위의 시작 쪽과 끝 쪽을 입력하세요.");
      return {
        ok: true,
        data: { ...EMPTY, bookEditionId, pageRange, homework: { mode: "book_pages" } },
      };
    }
    if (!practiceMaterialId || !uuid.safeParse(practiceMaterialId).success) {
      return fail("연습문제 자료를 선택하세요.");
    }
    return {
      ok: true,
      data: { ...EMPTY, homework: { mode: "practice_set", practiceMaterialId } },
    };
  }

  /* ── 평가 노드 ── */
  if (NEEDS_ASSESSMENT_REF.has(kind)) {
    if (hasBookInput) return fail("평가 노드에는 교재 범위를 넣을 수 없습니다.");
    if (hasHomeworkInput) return fail("평가 노드에는 숙제 방식을 넣을 수 없습니다.");
    if (!blueprintId || !uuid.safeParse(blueprintId).success) {
      /* 참조가 없으면 생성 시점에 무엇을 출제할지 알 수 없다. 그때 실패하면
       * 이미 수업 당일이고 학생 화면은 빈 테스트를 기다린다. */
      return fail("출제 블루프린트를 선택하세요.");
    }
    let completionCriteria: NodePayload["completionCriteria"] = null;
    if (passScoreRaw) {
      const score = z.coerce.number().int().min(0).max(100).safeParse(passScoreRaw);
      if (!score.success) return fail("통과 점수는 0~100 사이의 정수입니다.");
      completionCriteria = { passScore: score.data };
    }
    return { ok: true, data: { ...EMPTY, blueprintId, completionCriteria } };
  }

  /* ── 나머지 — payload를 받지 않는다 ── */
  if (hasBookInput) return fail("이 종류의 노드에는 교재 범위를 넣을 수 없습니다.");
  if (hasHomeworkInput) return fail("이 종류의 노드에는 숙제 방식을 넣을 수 없습니다.");
  if (hasAssessmentInput) return fail("이 종류의 노드에는 평가 설정을 넣을 수 없습니다.");
  return { ok: true, data: EMPTY };
}

/** 폼에서 payload 입력을 받아야 하는 종류인가 — 빌더가 칸을 열지 결정한다. */
export function payloadFieldsFor(kind: string): {
  book: boolean;
  homework: boolean;
  assessment: boolean;
} {
  return {
    book: NEEDS_BOOK_RANGE.has(kind) || kind === "homework",
    homework: kind === "homework",
    assessment: NEEDS_ASSESSMENT_REF.has(kind),
  };
}
