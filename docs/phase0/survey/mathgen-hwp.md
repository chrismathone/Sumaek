# Phase 0 조사 — D:\mathg-gen · D:\시험지 한글화

> 조사일: 2026-07-31. 읽기 전용 요약. 태스크 #9(수식 파이프라인)·#10(콘텐츠)·#14(PDF·HWP)의 직접 기반.

## 구조적 발견

- 두 프로젝트는 **이미 통합된 한 쌍**: mathg-gen(웹) → `hwpConnector.ts:21` HwpPayload v2 POST → 한글화 `server/connector.py` → COM 렌더 → .hwpx. TS `contentParser.ts`는 Python `core/content_parser.py`의 검증된 이식본 (골든 25건 상시 대조).
- **HWPX 직접 생성(비-COM)은 "레이아웃 깨짐으로 사용 금지" 봉인** (`convert_cli.py:2-9`). 품질 검증된 경로는 Windows COM뿐 → 수맥 HWPX 어댑터는 신규 구현 + 필요 시 로컬 커넥터를 외부 서비스로 유지.

## A. 코드 이식 (순수 TS, 의존성 0)

| 자산 | 경로 | 핵심 |
|---|---|---|
| LaTeX 정규화 전체 | `D:\mathg-gen\src\lib\textPreprocess.ts` (996줄) | `cleanMalformedLatex`(:283, 18케이스), `preprocessMathText`(:834, 10단계), `uprightGeometryLabels`, `autoSizeBrackets`, `wrapBareConditionBoxes` |
| 저장 전 sanitize | `src\services\ai\sanitize.ts` | `fixLatexEscaping`(:39, JSON escape 복구 10규칙), `protectLooseLatex`(:388, KNOWN_LATEX_CMDS 150개), `normalizeCircledMarkers`(:462) |
| KaTeX 안전 렌더 | `src\lib\katexRender.ts:64-88` | 3단 폴백: clean→aggressiveRepair→`.math-raw` 중립 폴백. 모든 렌더 경로가 단일 함수 수렴 |
| 블록 타입·변환 | `src\types\ocrBlocks.ts`, `src\lib\blocksToMarkdown.ts` | text/equation/equation_block/table 4종 (Python ContentType과 정합) |
| JSON 복구 | `src\services\ai\ocrJsonRecovery.ts:245` | 6단계 recoverJson |
| 동시성 유틸 | `src\lib\concurrency.ts` | pLimit, pLimitWithGap(RPM), withRetry(429/529/503만) |
| 선택지 열 결정 | `printLayout.ts:78` + `MarkdownRenderer.tsx:171-194` | TALL_LATEX_RE(cases|matrix|aligned|array…) 감지 시 1열 강제, maxLen>25 → 1열 |
| 테스트 하네스 7종 | `scripts\*.mts` | API 없이 단독 실행. katexRenderHarness(19+8+5 케이스) |

주의: 구분자 스캔은 항상 block(`$$`) 먼저 → inline(`$`). `(?<!\\)\$` 룩비하인드. 선택지 열 결정이 3곳 독립 구현(웹 tall 감지 있음 / 인쇄 없음 / COM 복잡도 18) — **수맥은 단일 함수로 통합, #9와 #14가 같은 규칙 공유**.

## B. 데이터 자산 (재취득 비용 최대 — 최우선 확보)

| 자산 | 경로 | 규모 |
|---|---|---|
| LaTeX→HWP 매핑 테이블 | `시험지 한글화\core\latex_to_hwpeq.py:347,390,521,558` | GREEK 38 + SYMBOL 105 + FUNC 33 + ACCENT 16 = 192 + 구조 패턴 13종 |
| HYhwpEQ 글꼴 메트릭 | `core\hwpx_writer.py:112,158` | 문자폭 81 + 키워드폭 90 = 171 (TTF 실측) |
| 크기 추정 튜닝 상수 | `hwpx_writer.py:134-156`, `scripts\tune_equation\best_params.json` | v5: GLOBAL_SCALE=0.8076, BIAS=394, FRAC_SCALE=0.75, FRAC_PAD=400, LEFT_RIGHT_EXTRA=1800, 한글 650. MAPE 6.55% |
| 수식 골든셋 | `scripts\tune_equation\golden_equations.json` | 84항목 (실측 HWPX 유래: width/height/baseLine/outMargin) |
| OCR 골든셋·코퍼스 | `tests\golden_ocr\` 7샘플, `corpus\` 195편(검수 162) | sha256 검증 |
| contentParser 골든 | `mathg-gen\scripts\contentParserGolden.*.json` | 25쌍 |
| 보기 박스 XML 템플릿 | `core\bogi_box_template.py:20,32` | 5×5 병합표 + 테두리 9종 |
| 교육과정 상수 | `mathg-gen\src\constants\curriculum.ts` | #6 시드 후보 |

## C. 구조 참고 재구현

- **LaTeX→HWP 변환 엔진** (`latex_to_hwpeq.py:919`): 정규식 치환 13단계 + 재귀. 순서 의존 강함 — 매핑은 데이터로, 엔진은 재작성. **미지원 토큰을 조용히 삭제(:1196)하는 결함 → 수맥은 리포팅+격리 필수** (골프롬프트 2O 위반 사례)
- **수식 크기 추정**: 키워드 폭 치환→첨자 50% 축소 재귀→한글 650 고정→분수 0.75+400→선형 보정. height 이진(1200/2400), baseline 85% 고정
- **OCR A/B 하네스** (`scripts\ocr_eval\` 10모듈): 정규화 철학("정답 바꾸는 차이 절대 흡수 금지" — 대소문자 보존), risk token 8종(홀짝/소수/신뢰구간 high), prompt_signature sha256으로 캐시 자동 분리, 승격 기준 = 회귀율 ≤ 기준 AND 신규 악화 0
- **측정-검증-수리 패턴** (`hwp_form_writer.py:1454`): 빌드 후 실측 위치를 계획과 대조, 밀리면 재빌드 — PDF 조판에도 적용
- **수학 방어 프롬프트** (`mathDefense.ts`): 메타인지 오류 8패턴 + 학년별 함정 10종
- 크롭 탐지 프롬프트 (`cropDetect.ts:54-167`), OCR 프롬프트 (`ocr_engine.py:336-548` 213줄)

## D. 회피 대상

- pdf.js 자산 CDN 로드 (`pdfProcessor.ts:28`) → 자체 호스팅
- dev에서 API 키 클라이언트 노출 (`dangerouslyAllowBrowser`) → 서버 전용
- 클라이언트 주도 파이프라인 (usePageOcr) → 서버 워커
- AI 라우팅 수동 if-else → 공급자 추상화 (수맥 ADR-0010)
- 이미지 전처리 모듈은 구현됐으나 미호출(죽은 코드) — 승계 시 실제 연결 여부 결정
- 코드 내 모델 ID 리터럴은 이식 시점에 실재 여부 재확인
