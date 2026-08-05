# 수맥 (Su-Maek)

> 수업 계획은 한 번. 오늘의 진도와 테스트는 자동으로.

수학 선생님이 학기 시작 전에 반·학생별 학습 루트를 설계하면, 매일의 수업 진도·교재 범위·숙제·일일테스트·확인테스트·채점·오답 복습·보강과 미래 일정 재계산을 시스템이 자동으로 운영하는 **수학 교수 설계·실행 운영체제**.

핵심 순환:

```
교사 ─ 학습 루트 설계·게시 ─→ 오늘 수업 생성(일정 실체화)
                                    │
                          [워커] 테스트 자동 출제 ─ 교사가 버튼을 누르지 않는다
                                    │
학생 ─ 오늘 화면 열기 ─→ 하루 계획 확정 ─→ 응시 ─→ 자동 채점
                                    │                   │
                      필수 전부 완료 → 하루 완료(기록)   숙련도 갱신 → 복습·재시험 배치
                                    │                   │
교사 ─ 반별 오늘 진행에서 확인 ←────┘        [워커] 미래 일정 재계산
                                                        │
교사 ─ 수업 마감(실제 진도 기록) ─────────────→ 위험한 변경은 승인 대기 변경안으로
```

**[워커]로 표시한 두 칸은 사람이 누르지 않는다.** 워커가 없으면 그 둘이
멈추고 나머지가 따라 막힌다 — 무엇이 막혔는지 보는 법은 아래 「워커 운영」.

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
pnpm dev:all           # 웹(localhost:3000) + 워커를 함께
```

`pnpm dev`(웹만)와 `pnpm dev:worker`(워커만)도 있지만, **웹만 띄우면 이벤트가
쌓이기만 한다.** 화면은 "자동 재계산됨"이라 말하는데 일정도 알림도 그대로다.
평소에는 `dev:all`을 쓴다.

## 워커 운영

워커는 요청이 없어도 계속 도는 프로세스다. Outbox 이벤트를 소비자 작업으로
바꾸고(일정 자동 재계산·알림·사용권 회수 영향 분석), 그 작업을 실행한다.
**워커가 없으면 그 세 가지가 전부 멈춘다** — 웹 경로로 도는 채점 예외함·AI
비용 경고·카나리 중단·break-glass 고지는 계속 동작한다.

### 띄우는 법

| 상황 | 명령 |
|---|---|
| 로컬 개발 | `pnpm dev:all` (웹과 함께) 또는 `pnpm dev:worker` |
| 배포 | `docker build -f apps/worker/Dockerfile -t su-maek-worker .` → `docker run -d --env-file .env --restart unless-stopped su-maek-worker` |

배포 플랫폼은 아직 정하지 않았다. 저장소가 제공하는 것은 **어느 플랫폼이든
그대로 받는 이미지 정의**다. 재시작 정책(`--restart unless-stopped`)이나
플랫폼의 프로세스 감독은 반드시 켜라 — 워커는 죽으면 아무도 대신 하지 않는다.

환경변수: `DATABASE_URL`(필수) · `WORKER_CONCURRENCY`(기본 4) ·
`WORKER_HEARTBEAT_SECONDS`(기본 15) · `WORKER_SHUTDOWN_GRACE_MS`(기본 30000) ·
`OUTBOX_MAX_ATTEMPTS`(기본 8).

### 죽었는지 아는 법

```bash
pnpm worker:status   # 살아 있는 워커가 없거나 박동이 끊겼으면 종료 코드 1
pnpm queue:status    # 무엇이 얼마나 밀렸는가 (jobs·outbox·inbox·박동)
```

워커는 `worker_heartbeats`에 15초마다 박동을 남긴다. 마지막 박동이 주기의
3배를 넘으면 죽은 것이다. **정상 종료는 `stopped_at`에 남는다** — 표시 없는
침묵만 사건이다. SIGTERM을 받으면 새 클레임을 멈추고 진행 중 작업을 마친 뒤
내려간다(유예 초과 시 강제 종료. 남은 작업은 lease 만료로 다른 워커가 회수).

적체가 생겼을 때의 절차는 [docs/runbooks/04-queue-backlog-dlq.md](docs/runbooks/04-queue-backlog-dlq.md).

### 오늘 수업이 성립하는지 아는 법

워커 생존과 **다른 질문**이다. 워커가 멀쩡하고 큐도 비어 있는데 학생 화면에
시험이 없을 수 있다 — 생성이 정상적으로 실패했을 때다(정책 없음·문항 부족).
그때 위 두 명령은 전부 초록이다.

```bash
pnpm worker:status -- --flow                 # 오늘 전체
pnpm worker:status -- --flow --org=<org_id>  # 한 학원만
```

평가 누락·차단 학생·이벤트 적체·워커 죽음을 **따로** 세고 각각에 다음 행동을
붙인다. 이상이 있으면 종료 코드 1.

절차는 [docs/runbooks/16-autonomous-day-pipeline.md](docs/runbooks/16-autonomous-day-pipeline.md).

### 이벤트가 막혔을 때

```bash
pnpm requeue-outbox --dry-run   # 격리된 이벤트 조회 (되살리기 전 원인부터 확인)
pnpm requeue-dlq --dry-run      # DLQ 작업 조회
```

Outbox 이벤트는 이벤트별로 실패가 격리된다. 한 건이 실패해도 나머지는 배달되고,
실패한 건만 백오프로 재시도하다 한도(`OUTBOX_MAX_ATTEMPTS`)를 넘기면 격리된다.
**격리는 자동 복구되지 않는다** — 원인을 고친 뒤 위 명령으로 되살린다.

## 검증

```bash
pnpm typecheck         # 전체 워크스페이스 타입 검사
pnpm test              # 단위·통합 테스트 (vitest)
pnpm --filter @su-maek/e2e test   # E2E (Playwright)
pnpm boundary:check    # 제품 경계 회귀 검사
pnpm verify:recovery   # 검사 31건 — 불변 I-01~I-22 + 참조·위생 R-01~R-09 (읽기 전용)
```

`verify:recovery`가 위반을 내는데 원인이 **테스트 잔재**로 보이면
(`itest-`·`e2e-auto-` 조직) `pnpm purge:invariant-residue --dry-run`으로
먼저 세어 본다. 늘 빨간 게이트는 아무도 읽지 않으므로, 잔재는 그때그때
치우고 원인은 그 테스트에서 고친다.

## 설계 문서

- `docs/phase0/decisions.md` — 확정 결정 기록 (단일 소스)
- `docs/phase0/` — 가정·용량, C4, 도메인 맵, ERD, 상태 머신, 계약, 위협 모델, SLO
- `docs/adr/` — 아키텍처 결정 기록
- `docs/runbooks/` — 운영 런북
- `docs/handoff-project.md` — **프로젝트 전체 인수인계** — 새 컴퓨터에서 여는 순서, 못박힌 규칙, 다음 우선순위
- `docs/handoff.md` — **교재 반입 작업 인수인계** — 재현 절차·설계 근거·남은 일
- `docs/acceptance-status.md` — 인수 시나리오 62개 현재 상태
