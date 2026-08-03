# 정제 시스템 설계 — 추출한 개념을 수맥 것으로

2026-08-03 · 상태: **구현 완료** (같은 날 §7 실측 참조) · 선행: 개념 추출 파이프라인(docs/handoff.md §3.2)

## 1. 왜 필요한가

kwr-2022로 뽑은 개념 8블록은 **지면의 충실한 사본**이다. 그게 추출층의 일이었고
잘 끝났다. 그런데 사본인 채로는 학생에게 못 내보낸다:

- **표현이 출판사 것이다.** 문장을 그대로 게시하면 원칙 9(상업 교재 검수 전
  미게시)를 상태 하나 바꾸는 것으로 깨게 된다. 추출본은 근거 자료이지 제품이 아니다.
- **조판이 지면 논리다.** 곁블록·배지·여백 주석은 종이 위에서의 배치고, 화면에는
  화면의 문법이 있다. 지금 학생 화면은 블록을 평문으로 눌러 펴서(`blocksToText`)
  단락 나열로 보여 준다 — 정의도 예도 단계도 전부 같은 회색 문단이다.
- **개념서가 더 들어온다.** 출판사마다 추출 프로파일은 따로 만들어야 하지만,
  "다듬어서 우리 표현으로 만드는" 일은 한 번만 만들어 전부에 써야 한다.

그래서 세 층으로 나눈다. 두 층은 이미 있다.

| 층 | 입력 | 출력 | 사람의 역할 | 상태 |
|---|---|---|---|---|
| 추출 | PDF | `learning_materials` draft + `source_ref` (지면 사본) | 프로파일 실측·figureOverrides | **있음** |
| **정제** | 추출 draft | 새 draft — 우리 표현·구조화 블록 + `refineReport` | 검수(승인·수정 지시) | **이 문서** |
| 게시 | 정제 draft | published | 게시 버튼 | **있음** |

## 2. 결정

### 결정 1 — 정제본은 새 행이다. 원본은 불변.

정제가 추출본을 덮어쓰면 지면 근거가 사라진다. 원문 불변 원칙(2O — 원본은 손대지
않는다)을 자료에도 그대로 적용한다:

- 정제본은 `learning_materials`의 **새 행**. `derived_from_material_id`로 추출본을
  가리킨다(0015a 마이그레이션).
- 추출본은 정제 성공 시 자동 **archived** — 어차피 게시 대상이 아니었고, 목록에서
  치우되 지우지 않는다. 재정제·대조는 언제든 archived를 읽으면 된다.
- 정제본의 `source_ref`는 얇다: `{ refinedFrom, refineReport, model, promptVersion }`.
  교재 서지·쪽수는 추출본에 이미 있고, 두 곳에 적으면 갈라진다.

### 결정 2 — 블록 어휘는 기존 계약을 넓힌다. 새 체계를 만들지 않는다.

`packages/contracts/src/content`에 문항용 구조화 블록 12종이 이미 있다. 읽기
자료용으로 **재사용 4종 + 신규 5종**의 `readingContent` 어휘를 같은 파일 곁에
정의한다:

재사용: `paragraph` · `display_math` · `math_table` · `image_crop`

신규:

```
heading     { level: 2|3, runs }                       — 본문 소제목 (⑴⑵⑶ 묶음 머리)
definition  { term, content: runs }                     — 용어 정의 카드
key_point   { title?, items: runs[] }                   — 핵심 정리 박스 (개념원리의 색 박스 자리)
callout     { tone: example|note|caution|supplement,
              label?, content: (paragraph|display_math|math_table)[] }
                                                        — 예·참고·주의·보충 (중첩 1단만)
steps       { title?, items: { content: runs }[] }      — 순서 있는 단계 (❶❷❸)
```

원칙 둘:

- **표시 문자를 저장하지 않는다** (2P와 같은 정신). ❶은 렌더러가 붙인다.
  `steps.items`는 순서만 안다. 나중에 번호 모양을 바꿔도 데이터는 그대로다.
- **자료의 수식 run은 `{ latex }`만 요구한다.** 문항의 `mathRef`는
  `expressionId`(math_expressions 행)가 필수지만, 자료 수식은 채점·동치검사
  대상이 아니다 — 지금 반입된 8건도 이미 latex만 담고 있다. 계약이 현실을
  뒤늦게 위반으로 만들면 안 된다.

`math_table` 셀에는 선택 필드 `emphasis: "bold" | "struck"`을 더한다.
에라토스테네스의 체를 `\cancel` LaTeX가 아니라 **구조**(지워진 셀)로 저장하고,
사선은 CSS가 긋는다. 추가 필드는 선택이므로 문항 쪽 기존 데이터와 렌더러는
영향이 없다.

### 결정 3 — AI는 초안만 쓴다. 게이트가 막고, 사람이 게시한다.

정제는 재서술이다. 재서술의 위험은 둘 — **지어내기**와 **베끼기**. 각각 기계
게이트를 세운다 (검수 문화: "잘 된 것 같다"는 판단은 쓸 수 없다, README 자가채점 절).

정제 잡의 게이트 3종, 순서대로:

1. **계약 parse** — zod `readingContent`. 실패하면 오류를 모델에 되돌려 1회 재시도,
   그래도 실패면 그 자료는 건너뛰고 보고한다.
2. **KaTeX 게시 게이트** — 모든 math run과 `math_table`의 math 셀을
   `processExpression`으로. 기존 게이트 재사용, 새 검사기 없음.
3. **보존·표절 검사** (신규, `refineReport`로 남는다):
   - *지어내기*: 정제본의 숫자·수식 토큰 중 추출본에 없는 것 → 경고.
     (단계 번호·연도 같은 허용 목록은 프로파일이 아니라 검사기 상수 — 교재
     무관하게 같아야 한다.)
   - *베끼기*: 추출본과 15자 이상 연속 일치하는 문장 → 경고. 정의·기호처럼
     달리 쓸 수 없는 문구가 있으므로 **경고이지 차단이 아니다** — 판단은 검수자가.
   - *유출*: 구매자 워터마크 패턴·출판사명이 본문에 있으면 → **차단**.
     이것만은 자동으로 막는다. 검수자가 놓치면 학생 화면에 나가기 때문이다.

경고는 게시를 막지 않지만 **검수 화면에 반드시 뜬다**. 차단은 행 자체를 만들지
않는다.

`disclosure`는 정제 시점에 박는다: "AI가 교재 내용을 바탕으로 다시 쓴 설명입니다.
선생님 검수를 거쳐 게시됩니다." — draft는 학생에게 안 보이므로 이 문장은 항상
참이다. 0012a 규약(자료와 함께 저장, 옮겨 적다 빠지는 사고 방지) 그대로.

### 결정 4 — 렌더러가 먼저다.

지금 `learn/study`와 자료 상세는 블록을 평문 `$…$` 문자열로 눌러 펴서 한 덩어리로
렌더한다. 이 경로 위에 새 블록을 얹으면 정의 카드도 콜아웃도 전부 도로 회색
문단이 된다. 구현 순서상 **렌더러가 정제 잡보다 앞**이다.

- `apps/web/src/components/materials/ReadingBody.tsx` (서버 컴포넌트) —
  블록별 분기: 정의 카드, 콜아웃(톤별 색 토큰), 단계 리스트, 표(사선 셀 포함),
  가운데 정렬 display math. 수식은 기존 `renderMixedText`/`processExpression`.
- **하위 호환이 기본이다.** 지금 8건(text·paragraph만)은 새 렌더러에서도 그대로
  문단으로 나온다. 마이그레이션 없음.
- 콜아웃 톤 ↔ 디자인 토큰: example→`paper`, note→`pen-soft`,
  caution→`grade-soft`, supplement→`highlight-soft` (기존 팔레트만, 새 색 없음).

### 결정 5 — 구조화 본문은 평문 편집을 잠근다.

자료 상세의 편집 폼은 본문을 `blocksToText`로 평문화해 textarea에 싣고, 저장하면
평문을 다시 블록으로 만든다. text·paragraph만 있을 땐 무손실이지만 **정의 카드
하나만 있어도 저장 순간 구조가 증발한다.**

가드: 본문에 text·paragraph 외 블록이 있으면 textarea를 숨기고 안내를 띄운다 —
"구조화 본문입니다. 문구 수정은 재정제 지시로, 구조 수정은 (추후) 블록 편집기로."
제목·개념·순서·고지·상태는 그대로 편집 가능하다. 블록 편집기는 비범위(§6).

## 3. 정제 잡 (CLI)

`packages/ingest/src/cli/refine-concepts.mts` — 추출 CLI들과 같은 자리, 같은 규약
(`--이름=값`만, dotenv, DATABASE_URL).

```bash
pnpm --filter @su-maek/ingest refine-concepts \
  --org=<uuid> --actor=<uuid> \
  [--material=<id>]        # 한 건만
  [--all]                  # source_ref 있는 추출본 전부
  [--dry-run] [--force] [--verbose]
```

- **대상 선정**: `source_ref->>'extractedBy'`가 있는 행(추출본) 중, 살아 있는
  (non-archived) 정제 자식이 없는 것. `--force`는 자식이 있어도 새로 만든다
  (옛 자식은 손대지 않는다 — 버릴지는 검수자가 정한다).
- **AI 호출**: Anthropic SDK, 기본 `claude-opus-5`. 프롬프트에 들어가는 것:
  개념명(canonical), 추출 본문(블록 그대로), `source_ref`의 소단원·개념 번호·
  핵심문제 상호참조, 교사 주석(teacherNotes — *지도 관점 참고용*, 본문 전사 금지
  명시), 블록 어휘 JSON Schema(zod에서 생성), 문체 규칙(학생 독자·존댓말 평서·
  원본에 없는 수치와 예시 도입 금지·원문 문장 복사 금지).
- **`REFINE_PROMPT_VERSION`** 상수(`refine/1.0.0`)를 두고 산출물에 함께 적는다 —
  macro-policy 버전과 같은 정신: 결과가 이상하면 어느 프롬프트가 만들었는지
  역추적할 수 있어야 한다.
- **산출**: 새 행 — 같은 concept, `kind=reading`, `status=draft`,
  `derived_from_material_id`, `sourceJobId=refine-<일자>-<난수>`, disclosure(§2-3),
  `source_ref={ refinedFrom, refineReport, model, promptVersion }`. 성공 시
  추출본을 archived로.
- **멱등**: 재실행해도 살아 있는 자식이 있으면 건너뛴다. E2E 멱등 원칙 그대로.
- 비용·키: `ANTHROPIC_API_KEY` 필요 — `.env.example`에 추가.

## 4. 검수 화면

자료 상세(`/app/content/materials/[id]`)에 두 가지를 더한다:

1. **본문 미리보기를 ReadingBody로** — 지금은 편집 textarea가 곧 미리보기다.
   구조화 본문은 렌더된 모습을 보여야 검수가 된다.
2. **나란히 보기** — `derived_from_material_id`가 있으면: 왼쪽 추출본(지면 사본)
   · 오른쪽 정제본 · 상단에 `refineReport` 경고 목록(지어내기 후보·연속 일치
   문구). 검수자가 보는 질문은 "예뻐졌나"가 아니라 **"지면의 뜻과 같나, 표현은
   우리 것인가"**다. 경고가 그 질문으로 시선을 끌고 간다.

게시 버튼·권한·개념 상태 경고는 지금 화면 것을 그대로 쓴다.

## 5. DB 변경 — 0015a

```sql
alter table public.learning_materials
  add column if not exists derived_from_material_id uuid;

comment on column public.learning_materials.derived_from_material_id is
  '정제 원본(추출본) 자료 id. 정제본에만 있다. FK를 걸지 않는 이유: 원본이
   보관·삭제돼도 정제본은 살아야 한다.';

create index if not exists learning_materials_derived_idx
  on public.learning_materials (organization_id, derived_from_material_id)
  where derived_from_material_id is not null;
```

drizzle 스키마(`learning.ts`)에도 같은 컬럼(2갈래 규약).

## 6. 구현 순서와 비범위

순서 — 각 단계가 그 자체로 머지 가능해야 한다:

1. **contracts**: `readingContent` 어휘 + 회귀 테스트 (기존 union은 불변)
2. **db**: 0015a + drizzle
3. **web**: ReadingBody + study·자료 상세 적용(하위 호환 확인) + 평문 편집 가드
   — *여기까지는 AI 없이 끝난다. 지금 8건 화면도 줄바꿈·display math가 나아진다.*
4. **ingest**: refine-concepts CLI + 게이트 3종 + refineReport
5. **web**: 나란히 보기 검수 화면
6. **시범**: kwr 8건 정제 → 검수 → 게시 — 여기서 프롬프트·게이트를 실측으로 조정

비범위 (이번에 안 한다):

- 블록 WYSIWYG 편집기 — 문구 수정은 재정제 지시로 우회. 편집기는 수요가
  쌓인 뒤에.
- 그림 자동 생성(SVG 도해) — figureOverrides 문장이 이미 뜻을 옮긴다.
  `image_crop`/`diagram` 자산 파이프라인이 생기면 그때.
- video·practice 정제 — reading만.
- 자동 게시 — 어떤 경로로도 없다. 게시는 사람 버튼 하나뿐이다.

## 7. 구현 실측 (2026-08-03)

6단계 전부 구현·검증됨. 설계에서 달라진 것:

- **`--input` 오프라인 경로가 추가됐다.** 초안이 오는 길이 둘이다 — API
  호출(별도 과금) 또는 미리 쓴 초안 JSON(Claude Code 세션에서 집필, 과금
  없음). **게이트는 같다.** 시범 8건은 오프라인 경로로 넣었다
  (`model=claude-code-session`).
- 읽기 표(readingMathTableBlock)는 문항 표를 고치지 않고 **자료 전용
  변형**으로 뒀다 — 문항 mathRef(expressionId 필수)와 자료 수식(latex만)의
  차이 때문에 어차피 별도 union이 필요했다.
- 베끼기 검사에 **글자 필터**가 붙었다: 수 목록의 쉼표 텍스트런(`", , , ,"`)
  일치는 조판의 그림자이지 표절이 아니다 — 한글·영문이 있어야 후보다.

시범 결과: 8/8 정제(차단 0 · 렌더 실패 0), 정직한 경고 2건(달리 쓸 수 없는
표준 문구 — 자연수 분류 나열, G·L 도입구), 재실행 시 대상 0(멱등),
원본 8건 archived. 렌더 검증은 실제 ReadingBody 컴포넌트를 정적 렌더해
눈으로 확인 (scratchpad preview/refine-preview.html).

### 적대적 리뷰 (같은 날, 관점 3종 병렬 — 유출·정합성·계약/렌더 불일치)

실증 결함 32건이 나왔고 그중 27건을 고쳤다. 큰 것들:

- **게이트의 축이 틀렸었다.** processExpression의 status는 문항 검수
  플래그(수식 내 한글·≈)까지 묶는다 — `\text{배}`를 "렌더 실패"로 반려하고,
  display 환경(aligned)을 inline으로 검사했다. 지금 렌더 게이트는 **화면과
  같은 경로**(renderMixedText publish, inline은 `$…$`, display는 `$$…$$`)로만
  판정한다. 저장은 정규화본(normalizeRefinedBlocks) — 저장본=검사본.
- **추출본은 이제 기계가 지킨다.** 게시 차단(setMaterialStatusAction이
  `source_ref.extractedBy`를 본다), 평문 편집 잠금 확대(구조 블록뿐 아니라
  파이프라인 산출물 전부 — 추출본은 paragraph뿐이라 옛 기준에 안 걸렸다),
  게시 중 추출본은 정제 대상에서 제외(조용한 강등·진도 고아 방지).
- **유출 차단의 우회 셋을 막았다**: 런 경계 분할(검사도 렌더러처럼 붙여
  본다 + LaTeX 명령 벗긴 판), 대소문자·구분자 변형, 교사 주석 전사(주석을
  베끼기 대조 원본에 넣는다). 차단 사유의 워터마크 원문은 마스킹 —
  로그도 유출 경로다.
- **게시에도 렌더 게이트가 붙었다.** publish 모드는 실패 수식을 조용히
  비우므로, 읽기 자료 게시 시 본문 전체를 렌더 검사한다.
- 그 외: 이웃 수식 런 글루 오독(다행 수식 소실), 셀 kind-값 계약(union),
  caption·term 속 수식 렌더, 도구 스키마=파서 스키마(io:"input"),
  지어내기 허용 목록 폐지(0~3 프리패스가 최다 지어내기 구간이었다),
  트랜잭션 내 멱등 재확인, CLI 감사 이벤트, 원본 소실 경고 배너,
  drizzle 인덱스 정합.

고치지 않고 남긴 것(이유와 함께): 지어내기 검사는 집합 비교다(부호·자리
뒤바꿈·개수는 못 잡는다 — 검수자의 몫으로 문서화), `--force`가 살아 있는
자식 위에 새 draft를 얹는 것은 의도(유니크 제약은 이것과 상충해 미채택),
경고 속 원문 발췌는 원본 전문이 이미 같은 테이블에 있으므로 수용,
동시 편집의 본문 외 필드 덮어쓰기(questionIds 소실)는 정제 이전부터 있던
패턴이라 별도 작업으로 분리.

## 8. 다음 후보 — 해설 정제 (평가만, 미착수)

해설(question_versions.explanation)도 같은 틀로 정제할 수 있고, **자료보다
더 잘 맞는다**: 문항에는 이미 불변 버전 체계가 있다 (게시 후 수정 불가,
정정 = 새 버전 + changeReason + contentChecksum, 평가 스냅샷은
question_version_id로 고정 — 과거 시험지는 안 변한다). 즉 새 테이블이
필요 없다 — 정제 해설 = **새 question_version**(changeReason='해설 정제',
extraction에 model·promptVersion), 검수 후 current_version_id 갱신.

주의 둘: ① 해설은 풀이의 수치가 생명이다 — 지어내기 게이트의 원본 집합을
「발문 + 정답 + 옛 해설」로 잡아야 하고, 정답 수치가 정제 해설에
등장하는지도 검사할 수 있다(audit-content 규칙과 같은 정신).
② 규모가 다르다(1단원 해설 180건) — 오프라인 경로로는 여러 세션이 걸리고,
API 경로면 과금이 붙는다. 문항 본문 정제는 사용자 보류 중 — 착수하지 않는다.
