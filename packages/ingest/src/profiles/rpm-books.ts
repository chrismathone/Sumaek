/* ─────────────────────────────────────────────────────────────
 * RPM 교재 등록부 — 어느 권의 어느 대단원이 어느 개념 표를 보는가.
 *
 * 예전에는 이 표가 load.mts 안에 중1-1만 박혀 있었다. 다른 권의 덤프를
 * 그대로 넣으면 **문항은 들어가고** 대단원이 「I. 소인수분해」로 기록되며
 * 개념은 중1-1 표를 봐서 하나도 안 걸린다 — 오류 없이 그렇게 된다.
 * 권과 대단원을 둘 다 인자로 받고, 둘 다 기본값을 두지 않는다.
 *
 * 인쇄 번호 구간(range)은 자가채점(`extract --expect=`)으로 확인한 값이다.
 * 여기가 틀리면 0문항이 들어가고 그것이 성공처럼 보인다.
 * ───────────────────────────────────────────────────────────── */

import type { ConceptDefinition, ConceptWeight } from "./rpm-2022-concepts";
import {
  RPM_M1_CH1_CONCEPTS,
  RPM_M1_CH1_TITLE_TO_CONCEPT,
  RPM_M1_CH1_UNIT_TO_CONCEPT,
  RPM_M1_CH2_CONCEPTS,
  RPM_M1_CH2_TITLE_TO_CONCEPT,
  RPM_M1_CH2_UNIT_TO_CONCEPT,
  RPM_M1_CH3_CONCEPTS,
  RPM_M1_CH3_TITLE_TO_CONCEPT,
  RPM_M1_CH3_UNIT_TO_CONCEPT,
  RPM_M1_CH4_CONCEPTS,
  RPM_M1_CH4_TITLE_TO_CONCEPT,
  RPM_M1_CH4_UNIT_TO_CONCEPT,
} from "./rpm-2022-concepts";
import {
  RPM_M21_CH1_CONCEPTS,
  RPM_M21_CH1_TITLE_TO_CONCEPT,
  RPM_M21_CH1_UNIT_TO_CONCEPT,
  RPM_M21_CH2_CONCEPTS,
  RPM_M21_CH2_TITLE_TO_CONCEPT,
  RPM_M21_CH2_UNIT_TO_CONCEPT,
  RPM_M21_CH3_CONCEPTS,
  RPM_M21_CH3_TITLE_TO_CONCEPT,
  RPM_M21_CH3_UNIT_TO_CONCEPT,
  RPM_M21_CH4_CONCEPTS,
  RPM_M21_CH4_TITLE_TO_CONCEPT,
  RPM_M21_CH4_UNIT_TO_CONCEPT,
  RPM_M21_CH5_CONCEPTS,
  RPM_M21_CH5_TITLE_TO_CONCEPT,
  RPM_M21_CH5_UNIT_TO_CONCEPT,
} from "./rpm-2022-concepts-m21";

export interface ChapterSpec {
  number: string;
  title: string;
  /** 인쇄 번호 구간 (양끝 포함) */
  range: readonly [number, number];
  /** 본책 PDF 쪽 구간 (1부터, 양끝 포함) — 덤프를 뜰 때 쓴다 */
  pages: readonly [number, number];
  concepts: ConceptDefinition[];
  titleToConcept: ReadonlyMap<string, ConceptWeight[]>;
  unitToConcept: ReadonlyMap<string, ConceptWeight[]>;
}

export interface BookSpec {
  /** 문제은행에 적히는 교재 제목 */
  title: string;
  gradeBand: "middle-1" | "middle-2" | "middle-3";
  /** 개념서 쪽 참조에 쓰이는 이름 (「개념원리 중학 수학 2-1」) */
  companion: string;
  chapters: Record<string, ChapterSpec>;
}

export const RPM_BOOKS: Record<string, BookSpec> = {
  "m1-1": {
    title: "RPM 중학 수학 1-1 (2022 개정)",
    gradeBand: "middle-1",
    companion: "개념원리 중학 수학 1-1",
    chapters: {
      I: {
        number: "I",
        title: "소인수분해",
        range: [1, 213],
        pages: [7, 38],
        concepts: RPM_M1_CH1_CONCEPTS,
        titleToConcept: RPM_M1_CH1_TITLE_TO_CONCEPT,
        unitToConcept: RPM_M1_CH1_UNIT_TO_CONCEPT,
      },
      II: {
        number: "II",
        title: "정수와 유리수",
        range: [214, 523],
        pages: [39, 78],
        concepts: RPM_M1_CH2_CONCEPTS,
        titleToConcept: RPM_M1_CH2_TITLE_TO_CONCEPT,
        unitToConcept: RPM_M1_CH2_UNIT_TO_CONCEPT,
      },
      III: {
        number: "III",
        title: "문자와 식",
        range: [524, 914],
        pages: [79, 128],
        concepts: RPM_M1_CH3_CONCEPTS,
        titleToConcept: RPM_M1_CH3_TITLE_TO_CONCEPT,
        unitToConcept: RPM_M1_CH3_UNIT_TO_CONCEPT,
      },
      IV: {
        number: "IV",
        title: "좌표평면과 그래프",
        range: [915, 1123],
        pages: [129, 160],
        concepts: RPM_M1_CH4_CONCEPTS,
        titleToConcept: RPM_M1_CH4_TITLE_TO_CONCEPT,
        unitToConcept: RPM_M1_CH4_UNIT_TO_CONCEPT,
      },
    },
  },

  "m2-1": {
    title: "RPM 중학 수학 2-1 (2022 개정)",
    gradeBand: "middle-2",
    companion: "개념원리 중학 수학 2-1",
    chapters: {
      I: {
        number: "I",
        title: "유리수와 순환소수",
        range: [1, 136],
        pages: [7, 26],
        concepts: RPM_M21_CH1_CONCEPTS,
        titleToConcept: RPM_M21_CH1_TITLE_TO_CONCEPT,
        unitToConcept: RPM_M21_CH1_UNIT_TO_CONCEPT,
      },
      II: {
        number: "II",
        title: "식의 계산",
        range: [137, 371],
        pages: [27, 56],
        concepts: RPM_M21_CH2_CONCEPTS,
        titleToConcept: RPM_M21_CH2_TITLE_TO_CONCEPT,
        unitToConcept: RPM_M21_CH2_UNIT_TO_CONCEPT,
      },
      III: {
        number: "III",
        title: "일차부등식",
        range: [372, 574],
        pages: [57, 84],
        concepts: RPM_M21_CH3_CONCEPTS,
        titleToConcept: RPM_M21_CH3_TITLE_TO_CONCEPT,
        unitToConcept: RPM_M21_CH3_UNIT_TO_CONCEPT,
      },
      IV: {
        number: "IV",
        title: "연립일차방정식",
        range: [575, 797],
        pages: [85, 118],
        concepts: RPM_M21_CH4_CONCEPTS,
        titleToConcept: RPM_M21_CH4_TITLE_TO_CONCEPT,
        unitToConcept: RPM_M21_CH4_UNIT_TO_CONCEPT,
      },
      V: {
        number: "V",
        title: "일차함수",
        range: [798, 1099],
        pages: [119, 162],
        concepts: RPM_M21_CH5_CONCEPTS,
        titleToConcept: RPM_M21_CH5_TITLE_TO_CONCEPT,
        unitToConcept: RPM_M21_CH5_UNIT_TO_CONCEPT,
      },
    },
  },
};
