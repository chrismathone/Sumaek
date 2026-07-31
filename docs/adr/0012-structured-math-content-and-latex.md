# ADR-0012 — 구조화 수학 콘텐츠와 LaTeX 정규화 정책

| 항목 | 값 |
|---|---|
| 상태 | **채택됨** (2026-07-31) |
| 관련 | [erd.md](../phase0/erd.md) 5장 · [state-machines.md](../phase0/state-machines.md) 6절 · [ADR-0013](./0013-renderer-versions-and-publish-gate.md) |

---

## 맥락

수학 콘텐츠를 LaTeX 문자열 하나로 저장하면 다음이 전부 불가능해진다.

| 요구 | 문자열 저장으로 불가능한 이유 |
|---|---|
| 선택지를 세로 배치 (다행 수식일 때) | 어디까지가 선택지인지 구조가 없다 |
| 표 안 수식을 본문과 같은 경로로 렌더 | 표 구조가 없다 |
| 도형과 본문 참조 일치 검사 | 참조 ID가 없다 |
| 스크린리더 대체 텍스트 | 블록 의미가 없다 |
| PDF 페이지 분할 지점 지정 | 분할 가능 경계가 없다 |
| HWPX 수식 객체 개수 검증 | 수식이 몇 개인지 셀 수 없다 |
| 의미 보존 중복 탐지 | 수식 단위가 없다 |

동시에 `mathg-gen`에서 실제로 발생한 문제들이 있다.

- JSON 처리 중 백슬래시가 손상됨
- `$` 없이 LaTeX가 본문에 흘러나옴
- OCR이 분수 구조와 나눗셈 문자열을 혼동
- `1`/`l`/`I`, `0`/`O`, `x`/`×` 문자 오인식
- 유니코드 기호(`−`, `×`, `≤`)가 섞임
- 겹친 구분자, 고립 크기 명령

이 중 **일부는 자동으로 고쳐도 안전하고, 일부는 수학적 의미를 바꾼다.** 이 경계를 명확히 하지 않으면 "조용히 틀린 문제"가 학생에게 나간다.

## 결정

### 1. 구조화 블록이 원본이다

```
LaTeX 문자열  ← 원본이 아니다 (수식 하나의 표현일 뿐)
Markdown      ← 원본이 아니다 (입력 경로 중 하나)
렌더된 HTML   ← 원본이 아니다 (재생성 가능한 캐시)
────────────────────────────────────────────
StructuredContentBlock[]  ← 원본
```

**블록 11종 (확정)**:

| 블록 | payload 구조 |
|---|---|
| `TextBlock` | `{ text, lang }` |
| `InlineMath` | `{ expression_ref }` — 실제 수식은 `math_expressions` |
| `DisplayMath` | `{ expression_ref }` |
| `ChoiceGroup` | `{ choices: [{ choice_id, blocks: [...] }], layout_hint }` |
| `ConditionBox` | `{ label, blocks: [...] }` — `<조건>`, `<보기>` |
| `MathTable` | `{ header_rows, rows: [[{ cell_type, content }]], merges, caption, a11y_summary }` |
| `Diagram` | `{ diagram_asset_id, ref_id, alt_text }` |
| `ImageCrop` | `{ asset_id, source_rect, alt_text }` |
| `WorkedStep` | `{ step_no, label, blocks: [...] }` |
| `AnswerBlank` | `{ blank_id, expected_kind, unit }` |
| `PageBreakHint` | `{ priority }` — 허용 분할 지점 |

**선택지는 표시 문자(`①`)가 아니라 불변 `choice_id`로 저장한다.** 순서가 바뀌어도, 표시 문자가 바뀌어도 채점이 깨지지 않는다.

**표 셀은 `cell_type`(text/math/image)을 구분한다.** 원시 HTML 문자열로 저장하지 않는다. 행·열 병합, 헤더, 읽기 순서, 접근성 설명을 보존한다.

`<조건>`·`<보기>`·풀이 단계 라벨을 **정규식 하나로 추측하지 않고** 구조화 블록으로 구분한다.

### 2. MathExpression 필드 (확정)

```sql
raw_source          text     -- OCR·AI·편집기가 처음 만든 원문 (절대 덮어쓰지 않음)
normalized_latex    text     -- 승인된 정규화 결과
display_mode        text     -- inline | display
semantic_fingerprint text    -- 의미 보존 중복 비교용 정규화 지문
parse_status        text     -- unparsed | parsed | failed
parse_errors        jsonb
unsupported_commands jsonb
repair_actions      jsonb    -- 규칙 ID + 전후 diff
has_semantic_risk   boolean  -- 의미 변경 가능 보정 발생 여부
normalizer_version  text
katex_version       text
macro_policy_version text
render_hash         text
visual_baseline_id  text
review_status       text
reviewer            uuid
reviewed_at         timestamptz
```

**`raw_source`는 절대 덮어쓰지 않는다.** 정규화 결과가 틀렸을 때 원본으로 돌아갈 수 있어야 한다.

### 3. 정규화 분류 (확정)

이것이 이 ADR의 핵심이다.

#### 자동 허용 (무손실 — 수학적 의미가 확실히 보존)

| # | 규칙 ID | 변환 |
|---|---|---|
| N-01 | `json-backslash-repair` | JSON 처리 중 손상된 알려진 LaTeX 백슬래시 복구 (`\\frac` → `\frac`) |
| N-02 | `unicode-operator` | `−`→`-`, `×`→`\times`, `÷`→`\div`, `≤`→`\le`, `≥`→`\ge`, `≠`→`\ne`, `℃`→`^\circ\mathrm{C}` |
| N-03 | `delimiter-standardize` | `$...$`, `$$...$$`, `\(...\)`, `\[...\]` → 표준 형태 |
| N-04 | `nested-delimiter-cleanup` | 겹쳐 들어간 동일 구분자 정리 (`$$ $ x $ $$` → `$$ x $$`) |
| N-05 | `orphan-size-command` | 명백히 고립된 크기 명령 제거 (`\left` 없는 `\right` 등은 **N-05 아님 — 검토 대상**) |
| N-06 | `unicode-superscript` | `x²` → `x^{2}` |
| N-07 | `choice-circle` | 선택지 동그라미 표기의 승인된 문자 변환 |
| N-08 | `upright-unit-label` | 단위와 기하 점 라벨 직립체 (`\mathrm{cm}`, `\mathrm{A}`) |
| N-09 | `whitespace-standardize` | 공백·줄바꿈·표시 크기 명령 표준화 |

#### 사람 검토 필수 (의미 변경 가능)

| # | 트리거 ID | 상황 |
|---|---|---|
| R-01 | `empty-slot` | 빈 분모·지수·근호 내용을 임의 값으로 채우기 |
| R-02 | `bracket-guess` | 괄호·절댓값·집합 기호의 짝을 추측해 추가 |
| R-03 | `sign-change` | `-`, `±`, 부등호 방향, 정의역을 바꾸는 보정 |
| R-04 | `fraction-vs-division` | OCR이 분수 구조와 나눗셈 문자열 중 무엇을 뜻했는지 불명확 |
| R-05 | `ambiguous-glyph` | `1`/`l`/`I`, `0`/`O`, `x`/`×` 문자 교체 |
| R-06 | `implicit-parameter` | 로그 밑, 극한 방향, 적분 구간, 행렬 원소, 지수 범위 추정 |
| R-07 | `korean-text-move` | 한글 문장을 `\text{}` 안팎으로 옮겨 식 구조 변경 |

**게시 파이프라인에서 R-계열은 실패다.** 저작 화면에서는 **제안**으로만 제공한다.

```ts
// packages/core/src/math/normalize.ts
export function normalize(raw: string, policy: MacroPolicy): NormalizeResult {
  // ...
  return {
    normalized,
    appliedRules: ['N-02', 'N-06'],       // 규칙 ID
    diff: [{ rule: 'N-02', from: '≤', to: '\\le', offset: 12 }],
    semanticRisks: [],                     // R-계열이 있으면 여기에
    hasSemanticRisk: false,
  };
}
```

**자동 보정은 전후 diff와 규칙 ID를 반드시 남긴다.** `math_normalization_runs`에 기록.

### 4. 멱등성과 결정성

| 속성 | 검증 |
|---|---|
| 멱등성 | `normalize(normalize(x)) = normalize(x)` — 실행할 때마다 검증하고 `math_normalization_runs.idempotent_verified`에 기록. **false면 게시 게이트 실패** |
| 결정성 | 같은 입력 + 같은 `normalizer_version` + 같은 `macro_policy_version` → 같은 출력, 같은 `render_hash` |
| 토큰 보존 | 정규화가 숫자, 연산자, 부등호 방향, 변수 토큰을 **임의로 변경하지 않음** (속성 테스트) |
| 왕복 보존 | 구조화 블록의 저장·조회 후 `semantic_fingerprint` 동일 |

### 5. 의미 지문 (`semantic_fingerprint`)

중복 탐지와 web·PDF·HWPX 산출물 대조에 쓴다.

```
semantic_fingerprint = SHA256( canonicalizeSemantics(normalized_latex) )
```

`canonicalizeSemantics`가 무시하는 것(표시상의 차이):
- 공백, 줄바꿈
- `\dfrac` ↔ `\frac` (display mode는 별도 필드)
- `\left(`/`\right)` ↔ `(`/`)` (균형이 맞을 때)
- 크기 명령(`\big`, `\Big`)
- `\,`, `\;`, `\quad` 간격

**무시하지 않는 것**(의미상의 차이): 숫자, 연산자, 부등호 방향, 변수 이름, 첨자·지수 구조, 함수 이름, 괄호의 논리적 중첩, 단위.

### 6. 지원 문법 허용 목록 (`macro_policy_version`)

버전 관리되는 명시적 허용 목록. 범주:

기본 연산·분수·근호·절댓값·바닥/천장 / 지수·첨자·조합·순열 / 등식·부등식·집합·논리 / 함수·삼각함수·로그·지수함수 / 수열·합·곱·극한 / 미분·적분 / 벡터·행렬 / `cases`·`aligned`·`array` 등 승인된 다행 환경 / 기하 기호(각·호·선분·평행·수직) / 확률·통계 기호와 분포 표기 / 단위·한국어 설명과 기호의 혼합.

**사용하지 않는 명령은 조용히 삭제하지 않는다.** 저작 화면에서 **정확한 위치, 명령, 대체 방법**을 보여주고 검수함으로 보낸다.

```ts
// 허용 목록 위반 시
{
  parse_status: 'failed',
  unsupported_commands: ['\\substack'],
  parse_errors: [{ offset: 42, length: 10, command: '\\substack',
                   suggestion: '\\begin{array}{c} ... \\end{array} 사용' }]
}
```

### 7. 단일 파이프라인 강제

교사용 미리보기, 학생 응시, 문제은행 상세, 해설, 리포트, 인쇄 미리보기가 **모두 같은 `MathContentPipeline`** 을 쓴다.

```ts
// packages/core/src/math/render.ts
export function renderMath(blocks: StructuredBlock[], opts: RenderOptions): RenderResult;
```

**ESLint 규칙**: `packages/core/src/math/render.ts` 외에서 `katex` 패키지를 import하는 것을 금지한다. 화면마다 다른 수식 처리기를 갖지 않게 하는 구조적 장치다.

파이프라인 순서(골프롬프트 2P):

1. 구조화 블록과 원본 자산 읽기
2. SVG·표·이미지 블록을 자리표시자로 보호
3. 손상 백슬래시·구분자·유니코드 무손실 복구 (N-계열)
4. 블록/인라인 수식 토큰화, 괄호·중괄호·환경 균형 검사
5. 승인된 명령·매크로·환경만 남기는 구문 검증
6. KaTeX 서버 사전 파싱
7. 접근 가능한 HTML+MathML과 시각 HTML 생성, `render_hash` 저장
8. 표·조건 박스·선택지 그리드·도형 재조립
9. 웹·태블릿·모바일·인쇄 CSS 시각 회귀
10. PDF·HWPX 변환과 의미·레이아웃 동등성 검사
11. 모든 게이트 통과한 버전만 게시

**Markdown 입력 지원 시**: GFM 표의 파이프(`|`)가 수식 구분자로 오인되지 않게 파서 순서를 테스트한다. 원시 HTML 표 안의 수식도 일반 본문과 **같은 렌더 경로**를 거친다.

### 8. 도형·SVG

| 규칙 | 구현 |
|---|---|
| 가능하면 구조화 매개변수 + 결정적 SVG | `diagram_assets.geometry_params` (좌표계·점·선·각·곡선·눈금·라벨·스타일) |
| 원본 크롭·추출 SVG·수정 이력 보존 | `origin_crop_id`, `edit_history` |
| 모든 SVG에 `viewBox`·예상 크기·대체 텍스트·본문 참조 ID | NOT NULL |
| 검사 항목 | 라벨 겹침, 잘린 선, 열린 폐곡선, 점·선 크기, 글꼴 |
| 수식 내부 SVG와 교재 도형 SVG 구분 | `kind` 필드 |
| 엄격한 허용 목록 정제 | `script`, `on*` 이벤트 핸들러, 외부 URL, `foreignObject`, 위험 CSS 제거 |
| 의미를 바꿀 수 있는 기하 수정 | 원본과 diff 남기고 **검수 전 게시 금지** (예: 자동 폐곡선 보정) |
| 벡터 재구성 불확실 시 | 원본 크롭 보존 + 해상도·대체 텍스트·출처 좌표 유지 |

### 9. 선택지 레이아웃

| 규칙 | 근거 |
|---|---|
| 다행 수식(`cases`·`matrix`·`aligned`·`array`)이 있으면 **가로 다단 금지, 한 열 배치** | mathg-gen 실측 노하우 |
| 자동 열 수는 **원시 LaTeX 글자 수가 아니라 실제 렌더 폭·높이와 페이지 가용 폭**으로 결정 | 글자 수는 렌더 폭과 상관이 약하다 |

## 대안

| 대안 | 장점 | 채택하지 않은 이유 |
|---|---|---|
| **A. LaTeX 문자열 단일 저장** | 가장 단순, 편집 쉬움 | 맥락 표의 7가지가 전부 불가능. mathg-gen이 이 방식의 한계를 실증 |
| **B. Markdown + 수식 구분자** | 사람이 읽기 쉬움, 편집기 많음 | ① GFM 표 파이프와 수식 구분자 충돌 ② 표·선택지·조건 박스의 구조가 없음 ③ 결국 파싱해서 구조를 만들어야 함 |
| **C. MathML 원본 저장** | W3C 표준, 의미 명시적 | ① 사람이 작성·편집 불가 ② OCR·AI 출력이 LaTeX ③ KaTeX 입력이 LaTeX ④ **출력으로는 생성한다**(접근성) |
| **D. HTML 원본 저장** | 렌더 그대로 | ① 재생성 불가능한 것을 원본으로 취급 ② XSS 위험 ③ 정규화 규칙 변경 시 재렌더 불가 |
| **E. 구조화 블록 (채택)** | 7가지 요구 전부 충족 | — |
| **F. 모든 보정을 자동으로** | 검수 인력 절감 | 의미가 바뀐 문제가 학생에게 나간다. "조용히 틀린 문제"는 렌더 실패보다 나쁘다 |
| **G. 모든 보정을 사람에게** | 가장 안전 | 검수 인력 폭증. N-계열 9종은 명백히 무손실이며 자동화 가치가 크다 |
| **H. AI가 정규화 판단** | 유연 | 비결정론. 같은 입력에 다른 결과. 재현 불가 |
| **I. 화면마다 다른 수식 처리기** | 각 화면 최적화 | mathg-gen에서 실증된 실패 — 화면마다 다른 결과. 단일 파이프라인이 핵심 노하우 |
| **J. `.math-raw` 폴백을 전 화면에 허용** | 렌더 실패해도 뭔가 보임 | 학생이 원시 LaTeX를 본다. 게시 게이트 0건 요구 위반 |

## 비용

| 항목 | 비용 |
|---|---|
| 저장 | 문항당 블록 평균 9개(4 KB) + 수식 3.5개(2.45 KB). 1,000만 문항 = 187 GB (인덱스 포함) |
| 개발 | 블록 11종 스키마·파서·조립기, 정규화 규칙 16종, 지문 계산 (약 4,000줄) |
| 편집기 | 구조화 블록 편집기 + LaTeX 소스 편집 이중 모드 |
| 검수 | R-계열 발생 시 사람 검수. 예상 전환율 12% |
| 골든 코퍼스 | 17개 범주 × 사례. 출시 목표 1만 건 |
| 테스트 | 멱등성·결정성·왕복·퍼즈·속성 테스트 |

## 실패 방식

| # | 어떻게 실패하는가 | 조기 신호 | 대응 |
|---|---|---|---|
| F-1 | N-계열 규칙이 사실은 의미를 바꿈 | 골든 회귀 실패, 교사 신고 | 해당 규칙을 R-계열로 이동. `macro_policy_version` 증가. 과거 게시물은 고정 버전이라 무영향 |
| F-2 | 멱등성 깨짐 | `idempotent_verified=false` | 게시 게이트가 차단. 규칙 순서·상호작용 수정 |
| F-3 | 정규화가 숫자·부등호를 변경 | 속성 테스트 실패 | 토큰 보존 속성 테스트가 CI에서 검출 |
| F-4 | 미지원 명령이 조용히 삭제됨 | 수식 의미 손실, 신고 | 삭제하지 않고 `unsupported_commands`에 기록 + 검수 격리 |
| F-5 | 의미 지문이 다른 수식을 같다고 판정 | 잘못된 중복 병합 | 중복은 **자동 병합하지 않고** 그룹으로 묶어 검수자가 결정 |
| F-6 | 의미 지문이 같은 수식을 다르다고 판정 | web·PDF·HWPX 불일치 게이트 실패 | `canonicalizeSemantics`의 무시 목록 조정 |
| F-7 | 화면마다 다른 렌더 결과 | 시각 회귀 실패 | ESLint 규칙이 KaTeX 직접 호출을 금지. 우회 시 CI 실패 |
| F-8 | GFM 표 파이프가 수식으로 오인 | 파서 순서 테스트 실패 | 블록 우선, 인라인 다음의 결정적 스캔 순서 고정 |
| F-9 | SVG 정제가 정상 도형을 손상 | 도형 검사 실패 | `sanitize_report`에 제거 항목 기록. 검수자가 확인 |
| F-10 | `raw_source`가 덮어써짐 | 원본 복구 불가 | UPDATE 트리거로 `raw_source` 변경 차단 |

## 되돌리기

| 방향 | 방법 | 비용 |
|---|---|---|
| 규칙 추가·제거 | `macro_policy_version` 증가. **과거 게시물은 고정 버전 참조라 무영향** | 낮음 |
| 규칙을 자동 → 검토로 이동 | 정책 변경. 신규 반입부터 적용 | 낮음 |
| 정규화기 버전 롤백 | `NORMALIZER_VERSION` 환경변수 | 매우 낮음 |
| 재정규화 | `raw_source`가 보존되어 있어 언제든 다시 정규화 가능 | 낮음 (배치) |
| 블록 타입 추가 | 스키마 확장. 기존 블록 무영향 | 낮음 |
| 블록 타입 제거 | 마이그레이션으로 다른 타입으로 변환 | 중간 |
| 구조화 블록 → LaTeX 문자열 | **되돌리지 않는다.** 7가지 요구를 잃는다 | — |
| 단일 파이프라인 포기 | **되돌리지 않는다.** mathg-gen의 실증된 실패 | — |

`raw_source` 보존이 이 ADR의 가장 큰 되돌리기 여지다. 정규화 규칙을 아무리 바꿔도 원본에서 다시 시작할 수 있다.
