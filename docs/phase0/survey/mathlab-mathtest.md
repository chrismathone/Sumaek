# Phase 0 조사 — D:\mathlab · D:\math_test

> 조사일: 2026-07-31. 읽기 전용. 상세 원문은 조사 에이전트 보고서 기준 요약.

## 전제를 바꾼 발견 2가지

1. **mathlab은 기출분석 전용으로 트리밍됨** (커밋 `cc50e2c3`). LMS 자산(시험·숙제·퀴즈·진단·학생 앱)은 직전 커밋 **`7ac62050`** 에만 존재 — 재사용 시 `git show 7ac62050:<path>`로 추출. 트리밍 전 스키마(2,117줄/90모델)는 스크래치패드 `pretrim-schema.prisma`에 확보됨.
2. **mathlab = math_test의 TS 재작성판** (`src/lib/constants/concepts.ts:10`, `grading.ts:2`에 명시). 전략: 이식 결과물(TS)을 쓰되 유실분을 math_test에서 회수.

## 즉시 이식 가능 자산

- **수식 정규화 레이어**: `D:\mathlab\src\components\math\shared\text-preprocess.ts:44-94` — 한국 교과서 유니코드 10종(℃ ℉ Ω Å ㎡ ㎥ ㎝ ㎜ ㎞ ㎏), `$A$$B$` 글루 분리(5회 반복), 인라인→display 환경 승격, `\dfrac`→`\frac`
- **수식 위치 역주입**: `MathRenderer.tsx:22-47` — 렌더된 KaTeX에서 원본 LaTeX 오프셋 역추적 (인라인 편집기 기반)
- **SVG 도형 엔진 30모듈**: `D:\mathlab\src\lib\utils\svg-diagrams\` (초등 13 + 중등 11 + 공용) + `src/types/diagram.ts:228-235` 7-way 유니온. 트리밍 생존
- **오개념 174개**: `D:\math_test\backend\app\services\prompt_context.py:111-3225` — 초3~고2, core_concepts/misconceptions/design_guidelines 3필드. **최고 밀도 교육학 자산.** 단 키(체계 D)는 폐기하고 체계 A로 재키잉 (현재 런타임 조회 100% 실패 중)
- **개념문항 3단 프로토콜**: `prompt_context.py:18-38` — Extract→Invert→Context + [NO CALC]/[WHY] 게이트
- **교수전략 4종**: `concept_generator.py:33-307` (일반형/점진적 소거 4레벨/오개념 분석/시각적 해체) — 결함 3개 수정 전제(난이도 매핑 역전 `:110-112`, part 하드코딩, key_summary 1/174)
- **한국어 수학용어 정규식 사전**: `fb_derivation_service.py:9-58, 263-275` (형태소 오탐 방지 포함)
- **개념 그래프 체계 A** (`E4-NUM-01`): 유일하게 선수관계 보유. TS판 `7ac62050:src/lib/constants/concepts.ts` (326줄) + `CROSS_GRADE_CHAINS` 11계통 (`seed_concepts.py:1440-1528`)
- **문항 이미지 6,192개**: `D:\mathlab\public\questions\` `{교재}_p{NN}_q{NN}[_ans].png` — 초등 3~6만
- **Question 모델 설계**: `schema.prisma:210-276` — 변형 추적(variantOfId/variantSeed/variantSource), 드래프트 배치, 도형 이원화(diagramSpec+SVG). domain/abilityDomain 자유 문자열은 enum화

## 골프롬프트 경고를 실증하는 결함 (수맥 설계가 피할 것)

- **개념 ID 5중 분열** (A~E 체계) → 오개념 데이터가 런타임에 0건 조회. 수맥: canonical concept + SourceAlias로 단일화
- **임계값 하드코딩 30곳+**: MASTERY_THRESHOLD=90, 약점<60(한 곳만 80), 프론트 표시 등급도 불일치. 설정 컬럼(`chapter.mastery_threshold`)은 존재하나 코드가 안 읽는 사문화 → 수맥: MasteryPolicyVersion 테이블
- **is_mastered 영구 래치**: True 설정 1곳, False 복귀 코드 0곳. **콤보 배수 오염으로 정답률 80%에 mastery 95 판정** 사례. 수맥: 상태는 파생·재계산 가능, 증거 불변
- **간격 복습 결함**: 고정 배열(Python {1,3,7,30,60} vs TS [1,3,7,14,30] — 이식 중 무단 변경), 복습 큐 10개 초과 시 뒤쪽 영구 기아, 등록 훅 except-pass로 침묵 유실
- **마이그레이션 베이스라인 붕괴**: mathlab 29모델에 3개, math_test 핵심 12테이블 마이그레이션 부재 + 빈 DB에서 upgrade head 실패
- **테넌트 격리 실패 경로**: `tenant-scope.ts:14` tenantId 없는 사용자에 `{}` (무필터) 반환 → 수맥: DB RLS
- **응시 상태머신 부재**: completedAt null로만 판별 — 중단·재개·시간초과 표현 불가
- **성취기준 코드([9수01-01]) 양쪽 모두 0건** — 수맥이 완전 신규 구축

## 참고 값

- 간격 복습: `spaced-review.ts:20` REVIEW_INTERVALS = [1, 3, 7, 14, 30] (에빙하우스, SM-2 아님)
- 일일테스트 슬롯: 복습 최대 2문항(20%) / 약점 3~4(30-40%) / 신규 4~5(40-50%) (`daily_test_service.py:351-388`)
- 난이도 배점: BASIC 10 / MEDIUM 20 / HIGH 30 / HIGHEST 40
- AI 채점 신뢰도 하한 0.8 (`api/v1/tests.py:663`)
- 교재 문항 JSON: `D:\mathlab\data\questions-실력-{3~6}-{1,2}.json` 8개
