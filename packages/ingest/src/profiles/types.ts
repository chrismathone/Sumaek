/* ─────────────────────────────────────────────────────────────
 * 교재별 추출 프로파일
 *
 * 문제집마다 조판이 다르다. 단 수, 문항 번호의 폰트·크기, 수식 폰트 계열,
 * 선택지 기호, 유형 머리글의 생김새가 전부 다르다. 그걸 파서 본문에
 * 흩어 두면 두 번째 교재를 붙일 때 첫 교재가 깨진다.
 *
 * 그래서 "이 교재는 이렇게 생겼다"를 한 곳에 모아 둔다. 파서는 프로파일을
 * 읽고 움직일 뿐 특정 교재를 모른다.
 *
 * 프로파일은 코드에만 두지 않고 반입 때 DB(book_editions.extraction_profile)에도
 * 적는다 — 어떤 규칙으로 뽑은 문항인지가 나중에 반드시 필요해진다.
 * ───────────────────────────────────────────────────────────── */

export interface ExtractionProfile {
  /** 안정적인 식별자 — DB에 적히는 값 */
  id: string;
  /** 이 프로파일을 고칠 때마다 올린다. 문항에 함께 기록된다. */
  version: string;
  label: string;
  /** 어떤 교재에 쓰는가 (사람이 읽는 설명) */
  appliesTo: string;

  layout: {
    /** 본문 단 수 */
    columns: number;
    /** 위·아래 여백 비율 — 이 안의 span은 머리글·꼬리말로 본다 */
    topMarginRatio: number;
    bottomMarginRatio: number;
    /** 같은 줄로 묶을 기준선 허용 오차(pt) */
    lineToleranceY: number;
  };

  fonts: {
    /** 수식 폰트 — 이 폰트의 span은 수식으로 해독한다 */
    math: RegExp;
    /** 문항 번호 */
    questionNumber: { font: RegExp; minSize: number };
    /** 선택지 기호 ①②③④⑤ */
    choiceMarker: RegExp;
    /** 유형 머리글: 라벨·번호·제목 */
    typeLabel: RegExp;
    typeNumber: RegExp;
    typeTitle: RegExp;
    /** 교과서 참조 («개념원리 중학 수학 1-1 32쪽») */
    textbookRef: RegExp;
    /** 보기·조건 박스의 라벨 */
    conditionLabel: RegExp;
    /** 쪽 번호 — 이 폰트가 든 줄은 러닝헤드다 */
    pageNumber: RegExp;
    /** 러닝헤드의 중단원 번호 — 「02 최대공약수와 최소공배수」 */
    unitNumber: RegExp;
  };

  patterns: {
    /** 문항 번호 형태 (인접 span을 붙인 뒤 검사) */
    questionNumber: RegExp;
    choiceMarker: RegExp;
    conditionLabel: RegExp;
    textbookRef: RegExp;
    /** 꼬리말의 단원 표기 */
    runningHead: RegExp;
    /** 구매자 식별 워터마크 (이메일 등) — 문항이 아니며 저장해서도 안 된다 */
    purchaserStamp: RegExp;
    /** 여러 문항이 공유하는 지시문의 번호 구간 — 캡처 그룹 2개 (from, to) */
    sharedInstruction: RegExp;
  };

  figures: {
    /** 이만큼 이상 뭉친 벡터 도형만 「그림」으로 본다 */
    minDrawings: number;
    /** 뭉치로 묶는 거리(pt) */
    clusterGap: number;
    /** 이보다 작은 뭉치는 밑줄·괄호 같은 장식으로 본다 */
    minWidth: number;
    minHeight: number;
  };
}
