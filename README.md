# 수맥 (Su-Maek)

> 수업 계획은 한 번. 오늘의 진도와 테스트는 자동으로.

수학 선생님이 학기 시작 전에 반·학생별 학습 루트를 설계하면, 매일의 수업 진도·교재 범위·숙제·일일테스트·확인테스트·채점·오답 복습·보강과 미래 일정 재계산을 시스템이 자동으로 운영하는 **수학 교수 설계·실행 운영체제**.

핵심 순환: `학습 루트 설계 → 오늘 수업 생성 → 테스트 자동 출제 → 학생 응시 → 자동 채점 → 개념 숙련도 갱신 → 복습·재시험 생성 → 미래 일정 재계산`

수맥은 학원 ERP·CRM·전자출결·상담 관리가 **아니다**. 해당 도메인은 `scripts/boundary-check.mjs`가 빌드 수준에서 차단한다.

## 구조

```
apps/web          Next.js 16 — 공개 웹, 교사 앱(/app), 학생 앱(/learn), BFF API
apps/worker       백그라운드 워커 — 일정·평가·리포트 / OCR·AI / 수식 검증·PDF·HWP 출력
packages/core     순수 도메인 모듈 — 일정 엔진, 평가, 채점, 숙련도, 수식 파이프라인, 교육과정 그래프
packages/db       Drizzle 스키마 + SQL 마이그레이션(RLS 포함) + 합성 시드
packages/contracts zod 계약 — API·이벤트·구조화 수학 콘텐츠 블록
e2e               Playwright E2E (데스크톱·태블릿·모바일)
docs              Phase 0 설계 산출물, ADR, 런북
```

## 시작하기

```bash
pnpm install
cp .env.example .env   # Supabase 접속 정보 입력
pnpm db:migrate        # 마이그레이션 적용
pnpm db:seed           # 합성 시드 (실제 학생 데이터 금지)
pnpm dev               # 웹 (localhost:3000)
pnpm dev:worker        # 워커
```

## 검증

```bash
pnpm typecheck         # 전체 워크스페이스 타입 검사
pnpm test              # 단위·통합 테스트 (vitest)
pnpm --filter @su-maek/e2e test   # E2E (Playwright)
pnpm boundary:check    # 제품 경계 회귀 검사
```

## 설계 문서

- `docs/phase0/decisions.md` — 확정 결정 기록 (단일 소스)
- `docs/phase0/` — 가정·용량, C4, 도메인 맵, ERD, 상태 머신, 계약, 위협 모델, SLO
- `docs/adr/` — 아키텍처 결정 기록
- `docs/runbooks/` — 운영 런북
