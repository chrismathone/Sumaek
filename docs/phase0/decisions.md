# 수맥(Su-Maek) — 확정 결정 기록

> 이 파일은 모든 Phase 0 문서·ADR·코드가 따라야 하는 단일 결정 소스다.
> 골프롬프트 원문: `C:\Users\user\Documents\Codex\2026-07-31\new-chat\outputs\mathroute-curriculum-formula-goal-prompt-v3.md`

## 사용자 확정 사항 (2026-07-31)

| 결정 | 값 | 근거 |
|---|---|---|
| 서비스명 | **수맥 (Su-Maek)** | 사용자 확정. 골프롬프트의 `MathRoute`/`[서비스명]`을 전부 교체 |
| DB·인증 기반 | **Supabase 클라우드** (프로젝트: tovtbmhmemjyixgstmse) | 사용자 확정 |
| AI 공급자 | **목 어댑터 우선** — `AI_PROVIDER=mock\|anthropic` 추상화, 키는 환경변수 | 사용자 확정. 키 없이 E2E 통과 |
| 완료 기준 | **코드 완결 + 로컬 검증** — 실환경 전용 항목(한글 앱 재열기, 2만 동시 부하, 교육부 원문 실수집, 분기 복구 훈련)은 실행 가능한 스크립트·어댑터·런북으로 준비 | 사용자 확정 |

## 기술 스택 (eywa_refactoring 실운영 실측 기반 — survey/eywa-allinone.md)

- **모노레포**: pnpm workspace — `apps/web`(Next.js 16 App Router), `apps/worker`(tsx 워커), `packages/core`(순수 도메인), `packages/db`(Drizzle 스키마+SQL 마이그레이션), `packages/contracts`(zod 4 계약), `e2e`(Playwright)
- **웹**: Next.js ^16.2, React ^19.2, TypeScript ^5.8, Tailwind 4 (@theme 토큰)
- **데이터**: PostgreSQL(Supabase) 단일 진실 공급원. drizzle-orm ^0.45는 **스키마 정의·타입 소스**로, 런타임은 postgres.js 서버 전용 데이터 계층. `drizzle-kit push` 금지 — 마이그레이션 2갈래(생성 `NNNN_*.sql` + 수기 `NNNNa_*.sql` RLS·트리거, 전부 멱등, 자체 러너 `src/migrate.ts`)
- **인증**: Supabase Auth. Next.js 16 `proxy.ts` 세션 갱신(eywa 패턴 이식). 게이트=쿠키 존재, 검증=레이아웃. refresh 회전 ON(멀티고객 SaaS)
- **테넌트**: `organization_id` 컬럼 명명(골프롬프트 용어 준수). RLS 3계층: ① `auth_organization_id()` SECURITY DEFINER + 전 테이블 isolation 정책 ② RESTRICTIVE 역할 게이트 ③ Storage 경로 선두 세그먼트
- **큐**: PostgreSQL 기반 자체 작업 큐(SKIP LOCKED) + Transactional Outbox/Inbox. 외부 브로커 없음 (실측 병목 전 도입 금지 원칙)
- **수식**: KaTeX ^0.16 서버 사전 파싱, 자체 정규화기(mathg-gen 노하우 이식), 의미 지문, 렌더 해시
- **PDF**: Playwright(Chromium) 인쇄 CSS → PDF. **HWPX**: 자체 XML 생성 + LaTeX→HWP 수식 변환기(시험지 한글화 매핑 이식)
- **테스트**: Vitest ^3(단위·통합·속성 기반 fast-check), Playwright(E2E), RLS 하네스(`set local role authenticated` — eywa 패턴)
- **ID**: UUIDv7 (시간순 정렬)
- **시간**: UTC 저장 + 워크스페이스 시간대 ID 보존

## 아키텍처 골격 (골프롬프트 2B 준수)

- 모듈형 모놀리스. web/API와 worker는 독립 실행·배포
- 강한 일관성: 단일 트랜잭션 (2D 목록). 최종 일관성: 파생 데이터(숙련도·추천·집계·검색·알림)
- 전체 이벤트 소싱 없음 — 루트·채점·숙련도·일정 변경만 버전·정정 이벤트·감사
- 도메인 컨텍스트 9개(2C 표): 워크스페이스·권한 / 수업 실행 / 교육과정·콘텐츠 / 수학 표현·출력 / 학습 경로·계획 / 평가 / 응시·채점 / 학습 지능 / 지원 기능
- 컨텍스트 간 직접 테이블 수정 금지 — 공개 명령·조회 인터페이스 또는 도메인 이벤트

## 경계 (불변)

- 수납·상담·전자출결·차량·급여·CRM 미구현. `scripts/boundary-check.mjs`가 빌드 게이트
- 학생 최소 데이터: 불변 ID, 표시명, 소속 그룹, 적용 교육과정, 진도·숙련도·증거만
- 보호자 연락처·주소·생활기록·결제 정보 스키마 금지

## 디자인 (5장)

- 콘셉트: "좌표 노트 위에 그려지는 수업 궤도" — 그라데이션·글래스모피즘 금지
- 팔레트: 교사용지 #F3F6F6 / 잉크 네이비 #162338 / 볼펜 블루 #2257D7 / 채점 레드 #C9453D / 형광 노랑 #F1D66A / 괘선 그레이 #AAB8C2
- 타이포: MaruBuri(히어로만) / Pretendard Variable(기본) / IBM Plex Mono(숫자·코드) / KaTeX(수식)
- 시그니처: 수업 궤도판 — 랜딩 데모·루트 빌더·학생 상세에서 같은 문법
