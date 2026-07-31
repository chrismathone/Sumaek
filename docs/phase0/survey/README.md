# 기존 프로젝트 조사 — 통합 재사용 매트릭스

> 골프롬프트 3장 이행. 조사일 2026-07-31, 프로젝트 8개 읽기 전용.
> `.env`·비밀키·실제 학생 개인정보·상담 기록 미열람. 실운영 데이터는 시드로 복사하지 않는다.

상세: [eywa-allinone.md](./eywa-allinone.md) · [mathlab-mathtest.md](./mathlab-mathtest.md) · [edutrix-ijw.md](./edutrix-ijw.md) · [mathgen-hwp.md](./mathgen-hwp.md)

## 판정 요약 (골프롬프트 5분류)

### 재사용 가능 (코드 이식)
| 자산 | 출처 | 수맥 대상 |
|---|---|---|
| Supabase 인증 4-클라이언트 + proxy 세션 갱신 + getCurrentUser | eywa | apps/web 인증 (#5) |
| RLS 3계층 + DO 루프 + RESTRICTIVE 게이트 + 테스트 하네스 | eywa | packages/db (#4 — 채택 완료) |
| LaTeX 정규화 (textPreprocess/sanitize/katexRender) | mathg-gen | packages/core/math (#9) |
| 블록 타입·JSON 복구·동시성 유틸·테스트 하네스 | mathg-gen | #9·#10·#17 |
| 수식 정규화 보조 (유니코드 10종·글루 분리) | mathlab text-preprocess.ts | #9 (mathg-gen과 병합) |
| SVG 도형 엔진 30모듈 | mathlab (트리밍 생존) | #10 도형 |
| 컨테이너 이벤트 판정·속도 산식 v3·백분위 | edutrix progress-analytics | #13 진도 분석 |
| 학생 시간충돌 감지 + 테스트 20케이스 | ijw-calander | #7 충돌 명세 |

### 구조 참고 재구현
권한 매트릭스 엔진·역할 위계·운영실 4패턴(eywa) / Question 모델·응시 흐름·교수전략 4종·일일테스트 슬롯(mathlab·math_test) / LaTeX→HWP 엔진·크기 추정·OCR A/B 하네스·측정-검증-수리(한글화) / 컨테이너 스키마·트랙 분류(edutrix) / WeekBlock 매트릭스·자동배정(ijw)

### 데이터 마이그레이션만
HWP 매핑 192 + 글꼴 메트릭 171 + 튜닝 상수 + 수식 골든 84 + OCR 코퍼스 195편(한글화) / 오개념 174 + 개념 그래프 A + 계통 11종(math_test·mathlab 7ac62050) / 문항 이미지 6,192 + 교재 JSON 8(mathlab) / 소단원 텍스트 847 — 2015 개정 구간 재검증 전제(edutrix) / 휴일 2025~2027(edutrix)

### 새로 구현
2022 개정 성취기준 체계(어디에도 0건) / 교육과정 릴리스·버전드 노드 그래프 / 결정론 일정 엔진(완료) / RRULE식 반복·보강 1급 모델 / 응시 상태머신 / 숙련도 정책 버전 / Outbox·작업 큐(완료) / HWPX Node 생성 / 평가 블루프린트

### 폐기·비범위
allinone 전체(관계 스코프 아이디어 제외) / eywa 출결·수납·상담·급여 도메인 / 847 단일 순번 체계 / 개념 ID 체계 B·C·D·E / 게임화·콤보 / HWP COM 자동화(외부 서비스로 유지 가능) / PySide6 GUI / 클라이언트 주도 AI 파이프라인

## 설계 제약으로 승격된 실사고·결함 (위협 모델·ADR 반영)

1. 앱 게이트만 있고 RLS 없으면 PostgREST 직접 접속으로 우회 (eywa 실사고)
2. 미들웨어 getUser 검증 = 로그인 무한루프 (eywa)
3. fail-closed 권한 조회 = 관리자 복구불능 락아웃 (eywa)
4. 동기화 상태 UI 미노출 = 유령 데이터 침묵 누적 (eywa makeedu)
5. 개념 ID 다중 체계 = 교육학 자산 런타임 유실 (math_test 5중 분열)
6. 임계값 하드코딩 + 설정 컬럼 사문화 (math_test 30곳)
7. is_mastered 영구 래치 + 점수 오염 (math_test 콤보 배수)
8. 커리큘럼 버전 참조 없는 순번 저장 = 재수집 시 과거 기록 의미 붕괴 (edutrix 847)
9. 미지원 LaTeX 토큰 조용한 삭제 (한글화 :1196)
10. 반복 일정 물리 복제 / 클라이언트 마운트 시 예약 적용 (ijw)
