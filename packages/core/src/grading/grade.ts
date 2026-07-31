import type { AnswerKey, StudentAnswer } from "@su-maek/contracts";
import {
  canonicalizeExpressionText,
  normalizeShortAnswer,
  type NormalizedAnswer,
} from "./answer-normalize";

/* ─────────────────────────────────────────────────────────────
 * 자동 채점 계층 (골프롬프트 19장).
 * 1) 객관식 정확 일치 → 2) 단답 정규화 비교 → 3) 안전 범위 동치 검사
 * → 4) 복수 빈칸 부분 점수 → 5) 서술형은 루브릭(사람·AI 보조) 경로.
 *
 * 원칙 8: 불확실한 자동 판정을 임의로 확정하지 않는다 — needs_review로
 * 채점 예외함에 보낸다. 신뢰도 임계값은 정책 입력이다 (하드코딩 금지).
 * ───────────────────────────────────────────────────────────── */

export type GradeVerdict = "correct" | "incorrect" | "partial" | "needs_review";

export type GradeSource =
  | "auto_exact"
  | "auto_normalized"
  | "auto_equivalence"
  | "needs_human";

export interface GradeOutcome {
  verdict: GradeVerdict;
  /** 획득 점수 (needs_review면 null — 확정하지 않는다) */
  score: number | null;
  maxScore: number;
  confidence: number;
  source: GradeSource;
  /** 판단 근거 — 정규화 결과·비교 로그 (채점 예외함 표시용) */
  rationale: string[];
  /** 예외함 분류 (needs_review일 때) */
  exceptionKind?:
    | "multiple_valid_answers"
    | "format_mismatch"
    | "essay_partial"
    | "ambiguous_answer";
}

export interface GradeOptions {
  /** 이 신뢰도 미만이면 자동 확정하지 않는다 (정책 버전에서 주입) */
  minAutoConfidence: number;
}

function rationalEquals(
  a: { num: bigint; den: bigint } | null,
  b: { num: bigint; den: bigint } | null,
): boolean {
  if (!a || !b) return false;
  return a.num === b.num && a.den === b.den;
}

/** 단일 수용 답과 학생 답의 비교 */
function compareShort(
  student: NormalizedAnswer,
  accepted: {
    value: string;
    form: string;
    unit?: string | undefined;
    allowEquivalence?: boolean | undefined;
  },
  rationale: string[],
): { match: boolean; equivalence: boolean; unitIssue: boolean } {
  const key = normalizeShortAnswer(accepted.value);

  // 단위 검사 — 기준에 단위가 있으면 학생 답 단위와 비교
  const keyUnit = accepted.unit ?? key.unit;
  let unitIssue = false;
  if (keyUnit) {
    if (!student.unit) {
      unitIssue = true;
      rationale.push(`단위 누락: 기대 "${keyUnit}", 입력에 단위 없음`);
    } else if (student.unit !== keyUnit) {
      unitIssue = true;
      rationale.push(`단위 불일치: 기대 "${keyUnit}", 입력 "${student.unit}"`);
    }
  }

  // 1) 정확 일치 (정리된 문자열)
  if (student.cleaned === key.cleaned) {
    rationale.push("정리된 문자열 정확 일치");
    return { match: true, equivalence: false, unitIssue };
  }

  // 2) 유리수 동치 (0.5 = 1/2 = 2/4) — 수학적으로 안전한 범위
  if (rationalEquals(student.rational, key.rational) && student.rational) {
    const equivalence = student.form !== key.form;
    rationale.push(
      `유리수 동치: ${student.cleaned} = ${key.cleaned} (${student.form}↔${key.form})`,
    );
    if (equivalence && accepted.allowEquivalence === false) {
      rationale.push("동치이지만 이 문항은 표기 형태를 요구 — 사람 확인 필요");
      return { match: false, equivalence: true, unitIssue };
    }
    return { match: true, equivalence, unitIssue };
  }

  // 3) 식 문자열의 보수적 정규화 비교 (대수 변형 없음)
  if (student.form === "expression" || key.form === "expression") {
    if (
      canonicalizeExpressionText(student.cleaned) ===
      canonicalizeExpressionText(key.cleaned)
    ) {
      rationale.push("식 표기 정규화 일치 (공백·기호 통일)");
      return { match: true, equivalence: true, unitIssue };
    }
  }

  return { match: false, equivalence: false, unitIssue };
}

export function gradeAnswer(
  key: AnswerKey,
  answer: StudentAnswer,
  points: number,
  options: GradeOptions,
): GradeOutcome {
  const rationale: string[] = [];

  /* 1) 객관식 — 선택지 ID 집합 비교 */
  if (key.kind === "multiple_choice") {
    if (answer.kind !== "multiple_choice") {
      return needsReview(points, "format_mismatch", [
        `답안 형식 불일치: 객관식 문항에 ${answer.kind} 답안`,
      ]);
    }
    const expected = new Set(key.correctChoiceIds);
    const got = new Set(answer.selectedChoiceIds);
    const equal =
      expected.size === got.size && [...expected].every((id) => got.has(id));
    rationale.push(
      `기대 {${[...expected].join(",")}} vs 선택 {${[...got].join(",")}}`,
    );
    return {
      verdict: equal ? "correct" : "incorrect",
      score: equal ? points : 0,
      maxScore: points,
      confidence: 1,
      source: "auto_exact",
      rationale,
    };
  }

  /* 2·3) 단답 */
  if (key.kind === "short_answer") {
    if (answer.kind !== "short_answer") {
      return needsReview(points, "format_mismatch", [
        `답안 형식 불일치: 단답 문항에 ${answer.kind} 답안`,
      ]);
    }
    const student = normalizeShortAnswer(answer.rawText);
    rationale.push(
      `정규화: "${answer.rawText}" → "${student.cleaned}" (${student.form}${student.unit ? `, 단위 ${student.unit}` : ""})`,
    );

    if (student.ambiguous) {
      return needsReview(points, "ambiguous_answer", [
        ...rationale,
        `모호성: ${student.ambiguityReason ?? "해석 불확실"}`,
      ]);
    }
    if (key.ambiguityNote) {
      return needsReview(points, "multiple_valid_answers", [
        ...rationale,
        `문항 자체 모호성 표시: ${key.ambiguityNote}`,
      ]);
    }

    let sawEquivalenceReject = false;
    let sawUnitIssue = false;
    for (const accepted of key.accepted) {
      const cmp = compareShort(student, accepted, rationale);
      if (cmp.match) {
        if (cmp.unitIssue) {
          // 값은 맞고 단위만 문제 — 자동 오답 확정 금지, 사람 판단
          return needsReview(points, "format_mismatch", [
            ...rationale,
            "값 일치, 단위 문제 — 부분 점수 여부는 사람 판단",
          ]);
        }
        const confidence = cmp.equivalence ? 0.95 : 1;
        if (confidence < options.minAutoConfidence) {
          return needsReview(points, "ambiguous_answer", rationale);
        }
        return {
          verdict: "correct",
          score: points,
          maxScore: points,
          confidence,
          source: cmp.equivalence ? "auto_equivalence" : "auto_normalized",
          rationale,
        };
      }
      if (cmp.equivalence) sawEquivalenceReject = true;
      if (cmp.unitIssue) sawUnitIssue = true;
    }

    // 동치인데 표기 형태 요구로 거절 — 사람 확인
    if (sawEquivalenceReject) {
      return needsReview(points, "multiple_valid_answers", rationale);
    }
    // 단위 문제로만 어긋난 경우 — 사람 확인
    if (sawUnitIssue && student.rational !== null) {
      return needsReview(points, "format_mismatch", rationale);
    }
    // 명백한 불일치 — 오답 확정
    rationale.push("모든 수용 답과 불일치");
    return {
      verdict: "incorrect",
      score: 0,
      maxScore: points,
      confidence: student.form === "expression" ? 0.85 : 0.99,
      source: "auto_normalized",
      rationale,
      // 식 형태 오답은 동치 가능성이 남아 신뢰도가 낮다 — 정책 임계값에 따라
      // 호출자가 예외함으로 보낼 수 있게 신뢰도를 그대로 노출한다.
    };
  }

  /* 4) 복수 빈칸 — 부분 점수 */
  if (key.kind === "multi_blank") {
    if (answer.kind !== "multi_blank") {
      return needsReview(points, "format_mismatch", [
        `답안 형식 불일치: 복수 빈칸 문항에 ${answer.kind} 답안`,
      ]);
    }
    const byBlank = new Map(answer.blanks.map((b) => [b.blankId, b.rawText]));
    let earned = 0;
    let total = 0;
    let anyReview = false;
    for (const blank of key.blanks) {
      total += blank.points;
      const raw = byBlank.get(blank.blankId) ?? "";
      const sub = gradeAnswer(
        { kind: "short_answer", ...blank.key },
        { kind: "short_answer", rawText: raw },
        blank.points,
        options,
      );
      rationale.push(`[${blank.blankId}] ${sub.verdict}: ${sub.rationale.join(" / ")}`);
      if (sub.verdict === "needs_review") anyReview = true;
      else earned += sub.score ?? 0;
    }
    if (anyReview) {
      return needsReview(total, "ambiguous_answer", rationale);
    }
    const verdict: GradeVerdict =
      earned === total ? "correct" : earned === 0 ? "incorrect" : "partial";
    return {
      verdict,
      score: earned,
      maxScore: total,
      confidence: 0.99,
      source: "auto_normalized",
      rationale,
    };
  }

  /* 5) 서술형 — 자동 확정 금지. 루브릭과 함께 사람(AI 보조) 경로로. */
  return needsReview(points, "essay_partial", [
    "서술형 — 루브릭 기반 채점 필요 (AI 보조는 근거·신뢰도만 제공, 최종 권한 없음)",
  ]);
}

function needsReview(
  maxScore: number,
  exceptionKind: NonNullable<GradeOutcome["exceptionKind"]>,
  rationale: string[],
): GradeOutcome {
  return {
    verdict: "needs_review",
    score: null,
    maxScore,
    confidence: 0,
    source: "needs_human",
    rationale,
    exceptionKind,
  };
}
