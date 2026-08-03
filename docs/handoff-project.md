# 인수인계 — 프로젝트 전체

> **다른 컴퓨터에서 이어서 작업하기 위한 문서.**
> 작성 2026-08-03 · 저장소 `https://github.com/chrismathone/Sumaek` (main 직푸시)
> 범위: 저장소 전체. 교재 반입(ingest) 한 갈래만 필요하면 [handoff.md](handoff.md)로.
> 관련: [acceptance-status.md](acceptance-status.md) · [phase0/decisions.md](phase0/decisions.md) · [../README.md](../README.md)

여기 적은 수치·경로·명령은 작성 시점에 **이 저장소와 이 DB에서 실측한 것**이다.
확인하지 않은 것은 「확인 안 함」이라고 적었다. **없는 것을 있다고 적지 않는다** —
[acceptance-status.md](acceptance-status.md)의 문서 관례를 따른다.

---

## 0. 30초 요약

수맥은 **수학 교수 설계·실행 운영체제**다. 선생님이 학기 전에 학습 루트를 한 번
설계하면 매일의 진도·출제·채점·복습·일정 재계산이 자동으로 돈다. 학원 ERP·CRM·
전자출결이 **아니다** — 그 경계는 `scripts/boundary-check.mjs`가 빌드 수준에서 막는다.

| 무엇 | 어디 |
|---|---|
| 저장소 | `https://github.com/chrismathone/Sumaek` — main 직푸시 |
| 웹 배포 | `https://su-maek.vercel.app` — Vercel 프로젝트 `su-maek`, rootDirectory=`apps/web` |
| DB | Supabase 서울 리전 |
| 워커 배포 | **없음** — Dockerfile만 있고 플랫폼 미정 (5.2절) |
| 인수 회계 | 62개 시나리오 ✅26 / 🟡32 / 📋4 / ❌0 ([acceptance-status.md](acceptance-status.md)) |

DB 실측(2026-08-03): 문항 833(그중 RPM 반입 213) · 학습자료 24 · 정본 개념 372 ·
성취기준 60.

---

## 1. 새 컴퓨터에서 여는 순서

```bash
git clone https://github.com/chrismathone/Sumaek.git
cd Sumaek
corepack enable            # package.json이 pnpm@10.33.1로 고정돼 있다
pnpm install
cp .env.example .env       # 1.1절을 읽고 채운다
pnpm db:migrate
pnpm db:seed
pnpm --filter @su-maek/db demo-account   # ← 이걸 빼면 로그인이 안 된다
pnpm dev:all               # 웹 :3000 + 워커
```

검증된 조합: **Node v22.17.1 · pnpm 10.33.1 · Windows 11**. 다른 OS에서는 돌려
보지 않았다.

> **`db:seed`와 `demo-account`는 다른 일을 한다.** seed는 `users` 테이블에 행만
> 넣고 **Supabase 인증 계정은 만들지 않는다.** 브라우저로 로그인하려면
> `demo-account`를 따로 돌려야 한다. 이걸 모르면 「시드는 됐는데 로그인이 안 된다」에서
> 한참 헤맨다.

> **`pnpm dev`(웹만)로 오래 작업하지 말 것.** 이벤트가 outbox에 쌓이기만 하고
> 일정 재계산·알림·사용권 회수 영향 분석이 전부 멈춘다. 화면은 "자동
> 재계산됨"이라 말하는데 실제로는 아무 일도 안 일어난다. 평소에는 `dev:all`.

로그인 계정 — 비밀번호는 **셋 다 `1234@@@@`로 통일**돼 있다(커밋 `5ea0e27`).

| 역할 | 계정 | 들어가는 곳 |
|---|---|---|
| 교사·소유자 | `demo-teacher@su-maek.app` | `/app` |
| 학생 | `demo-student@su-maek.app` | `/learn` |

### 1.1 `.env`에서 실제로 막히는 두 줄

`.env.example`에 주석이 있지만 **여기서 두 번 이상 사고가 났다.**

1. **`DATABASE_URL`에 direct 연결(`db.<ref>.supabase.co`)을 쓰지 말 것.** 이
   프로젝트에서 그 호스트는 DNS로 풀리지 않는다. Supabase → Settings → Database →
   **Session pooler**(포트 5432, prepared statement 지원)를 복사한다. 풀러 호스트는
   **`aws-1`**-ap-northeast-2다 — 문서에 흔한 `aws-0`이 아니다.

2. **`DATA_GO_KR_API_KEY`는 Decoding 키를 넣는다.** Encoding 키(`%2B`·`%3D` 포함)를
   넣으면 호출 코드가 URL 인코딩을 한 번 더 해서 `SERVICE_KEY_IS_NOT_REGISTERED`가 난다.

키를 바꾼 뒤 `pnpm env:sync`를 돌리면 Vercel 프로덕션 env와 `apps/web/.env`에
미러된다.

### 1.2 저장소에 **없는 것**

| 없는 것 | 어떻게 채우나 |
|---|---|
| `.env` | `.env.example` 복사 (1.1절) |
| `node_modules` | `pnpm install` |
| DB 스키마·시드 | `pnpm db:migrate && pnpm db:seed` |
| 로그인 계정 | `pnpm --filter @su-maek/db demo-account` |
| **교재 PDF 원본** | 저장소에 두지 않는다 — 아래 경고 |
| 추출 덤프 JSON | PDF에서 다시 만든다 ([handoff.md](handoff.md) 3절) |
| PyMuPDF | `python -m pip install pymupdf` (파이썬 의존성 선언 파일이 없다) |

> **교재 PDF·덤프 JSON·지면 이미지를 커밋하지 말 것.** 이 PDF는 쪽마다 텍스트
> 레이어에 **구매자 이메일이 워터마크로 박혀 있다.** 공개 저장소에 올라가면 구매자가
> 특정되고 되돌릴 수 없다. `.gitignore`가 `*.pdf`·루트 `*.json`·`*-dump.json`·
> `audit*.md`·`*.png`를 막지만, **다른 이름을 쓸 거면 `git check-ignore -v <파일>`로
> 먼저 확인할 것** — 처음에 `book.json`이 안 걸렸다.

---

## 2. 지도

### 2.1 패키지

```
apps/web          Next.js 16 — 공개 웹, 교사 앱(/app), 학생 앱(/learn), BFF API
apps/worker       백그라운드 워커 — 일정·평가·리포트 / OCR·AI / 수식 검증·문서 출력
packages/core     순수 도메인 — 일정 엔진, 평가, 채점, 숙련도, 수식, 교육과정 그래프
packages/db       Drizzle 스키마 + SQL 마이그레이션(RLS) + 시드 + 운영 스크립트
packages/contracts zod 계약 — API·이벤트·구조화 수학 콘텐츠 블록
packages/ingest   교재 PDF → 문제은행·개념 블록 (CLI 12개)
e2e               Playwright (desktop·tablet·mobile), 스펙 20개
docs              Phase 0 설계, ADR 16, 런북 15, 인수 회계
```

`packages/core`는 **순수**다 — DB·네트워크를 모른다. 여기에 I/O를 넣으면
경계 검사가 아니라 테스트 구조가 먼저 무너진다.

### 2.2 화면

| 경로 | 무엇 |
|---|---|
| `/` | 마케팅 랜딩 |
| `/login` | 로그인 (역할에 따라 `/app` 또는 `/learn`으로) |
| `/app/today` | 교사 — 오늘 수업 |
| `/app/routes` | 학습 루트 빌더 (검증 게이트 → 게시 → 일정 실체화) |
| `/app/students/[id]` | 학생 상세 — 오버라이드·개별 일정·계정 연결 |
| `/app/content/**` | 교재·문항·교육과정·반입·검수 |
| `/app/grading` | 채점 예외함 |
| `/app/settings/**` | 반·학습자 등록, 외부 연동, break-glass |
| `/learn/today` | 학생 — 오늘 할 일 (궤도 레일) |
| `/learn/records` | 학생 — **지난 기록 월간 달력** (2026-08-03 신규) |
| `/learn/study` · `/learn/practice` · `/learn/tests/[id]` · `/learn/review` | 개념 공부·연습·응시·복습 |

### 2.3 자주 쓰는 명령

```bash
pnpm dev:all              # 웹 + 워커 (평소 이것)
pnpm typecheck            # 워크스페이스 전체
pnpm lint
pnpm test                 # 단위·통합 (e2e 제외)
pnpm --filter @su-maek/e2e test
pnpm boundary:check       # 제품 경계 회귀
pnpm verify:recovery      # 불변 조건 29검사 (읽기 전용)
pnpm queue:status         # 큐·Outbox 적체
pnpm worker:status        # 워커 생사 (죽었으면 종료 코드 1)
pnpm kill-switch          # 기능 차단 스위치
pnpm requeue-outbox --dry-run   # 격리된 이벤트 (되살리기 전 원인부터)
pnpm requeue-dlq --dry-run
pnpm env:sync             # .env → Vercel 프로덕션 env 미러
pnpm curriculum:collect   # 교육부 고시 원문 → 성취기준 적재
pnpm curriculum:release   # status / verify-source / publish / diff
pnpm --filter @su-maek/db seed-unit1-demo   # 1단원 데모 세팅 (멱등) — 4.4절 주의
```

---

## 3. 못박힌 규칙 — 어기면 조용히 틀린다

여기 있는 것들은 전부 **한 번씩 사고가 났고**, 대부분 테스트나 게이트가 지키고 있다.
"조용히"가 핵심이다 — 어겨도 에러가 안 나고 화면이 멀쩡하다.

### 3.1 시간대는 무조건 KST

`packages/core/src/shared/dates.ts`의 `KST = "Asia/Seoul"` **하나만** 존재한다.

- **시간대를 인자로 받거나 DB에서 읽어 동작을 바꾸지 않는다.** `formatDate`·
  `formatTime`·`formatDateTime`·`todayInKst`·`zonedTimeToUtc` 전부 시간대 인자가
  없다. `CurrentUser`에 `timezone` 필드가 없다.
- SQL도 `at time zone ${KST}` 바인딩으로 쓴다. 리터럴 `'Asia/Seoul'`를 SQL에 박지 않는다.
- DB의 `timezone` 컬럼들은 **그때 무엇이 쓰였는지 남기는 감사 스냅샷**으로만 남는다 —
  읽어서 분기하지 않는다.
- `packages/core/test/kst-pin.test.ts` **6건이 소스를 훑어 이 규칙을 강제**한다.
  다른 시간대 리터럴이나 `timeZone:` 다른 값이 들어오면 테스트가 깨진다.

### 3.2 `drizzle-kit push` 금지

`meta/_journal.json`에는 `0000~0005`만 있고 **수기 SQL 12개**(`0001a`·`0002a`·
`0004a`·`0005a`·`0006a`~`0013a`)가 빠져 있다. 그중 `0001a_rls_core.sql`이 RLS와
핵심 외래키를 만든다. `push`를 돌리면 그것들이 사라진 스키마가 만들어진다.
마이그레이션은 `pnpm db:migrate`만 쓴다.

### 3.3 append-only 사슬은 지우지 않는다

`mastery_evidences → grade_decisions → responses → attempts`. 테스트 정리에서
지우면 고아 참조가 남고 `verify:recovery`의 R-01에 걸린다(실제로 9행 수리한 적 있다).
`purgeTestData`는 불변 증거를 가진 행을 **삭제하지 않고 보관 처리**한다.

### 3.4 교재 반입은 덮어쓰지 않는다

`load`는 `(organization_id, book_edition_id, printed_number)`가 이미 있으면
**건너뛴다.** 추출 로직을 고치고 다시 돌려도 **아무 일도 일어나지 않는다.**
지우고 다시 넣어야 한다 — 삭제 SQL과 순서는 [handoff.md](handoff.md) 3.1절
(`begin;`으로 감쌀 것. 안 감싸면 안전망이 사라진다).

### 3.5 postgres.js 바인딩 두 가지

- **jsonb**: `sql.json()`/`tx.json()`을 쓴다. `JSON.stringify(x)::jsonb`는
  **이중 인코딩되는데 에러가 안 난다** — 읽을 때 필드가 `undefined`로만 드러난다.
- **timestamptz**: `${문자열}::timestamptz`로 바인딩하면 JS `Date`(밀리초)를 거쳐
  직렬화되어 **마이크로초가 잘린다** — 낙관적 동시성 토큰 비교가 영영 실패한다
  (실측: `UPDATE 0건`). 텍스트 왕복 토큰은 `컬럼::text = ${토큰}`으로 비교하고
  읽을 때도 `::text`로 받는다.

### 3.6 렌더 성공은 정확성이 아니다

`A=2b\times 3^{b}\times 5c`는 KaTeX가 오류 없이 예쁘게 그린다. 지면은
`A=2^a×3^b×5^c`다. **「렌더 실패 0건」이라고 보고한 직후에 사용자가 화면을 보고
오류를 지적했다.** 그래서 검사가 둘이다 — `audit-katex`(그려지는가) +
`audit-content`(지면과 같은가). 둘 다 돌린다.

이 교훈은 반입 밖에서도 그대로다: **"테스트를 썼다"와 "그 테스트가 무언가를 붙잡고
있다"는 다르다.** 이 저장소의 승격 관례가 **변이 검증**인 이유다 — 검증 대상 코드를
일부러 망가뜨려 테스트가 실제로 실패하는지 확인하고 원복한다.

### 3.7 제품 경계

학원 ERP·CRM·전자출결·상담 관리는 **범위 밖**이다. `pnpm build`가
`boundary-check.mjs`를 먼저 돌려 비범위 모듈과 금지 카피 7종을 막는다.
학생 달력에 결석을 그리지 않는 것도 같은 이유다(4.2절).

---

## 4. 최근에 들어온 것 (2026-08-03)

이 커밋 묶음이 담고 있는 것. 다른 문서에는 아직 안 퍼져 있을 수 있다.

### 4.1 KST 못박기

3.1절이 그 결과다. 시간대 인자를 받던 함수 전부에서 인자를 뺐고,
`user.timezone`을 읽던 SQL·화면을 `KST` 바인딩으로 바꿨으며,
소스를 훑는 가드 테스트 6건을 넣었다.

### 4.2 학생 앱 재설계 — 오늘 학습 + 지난 기록 달력

**문제**는 장식 부족이 아니라 **크기가 전부 같다**는 것이었다. 여섯 개의 똑같은
상자가 각각 "몇 건"만 말했고, `listMaterials`가 이미 들고 있던 제목·개념명·
항목별 진행을 화면이 버리고 있었다. 그래서 `/learn/today`의 "할 차례 3건"과
`/learn/study`의 "3건 중 2건"이 서로 다른 사실을 말했다.

- `/learn/today` — 히어로 카드 + 세로 궤도 레일 위의 접힌 행들.
  **거짓 축하 버그**를 함께 고쳤다: 옛 `allDone = activeStep === null`은
  *배정된 게 아무것도 없을 때도* 참이라 아무것도 안 받은 학생을 축하했다.
  판정을 `active` / `finished` / `sessionOnly` / `empty` 넷으로 갈랐다
  (`apps/web/src/lib/learn/today-steps.ts`, 단위 테스트 9건).
- `/learn/records` — **월간 달력**. 화면 상단에 `[오늘 학습] [지난 기록]` 두 링크가
  생기고, 오늘 화면 맨 아래 접혀 있던 「지난 테스트 N건 보기」가 사라졌다.
  자바스크립트 0줄, 상태는 전부 URL(`?month=`·`?day=`)에 있어 깊은 링크와
  뒤로 가기가 공짜다.

달력 칸은 **두 층**으로 읽는다 — 좌측 잉크 선은 *학원이 정한 것*(수업이 있던 날),
✓는 *내가 한 것*(그날 남긴 기록). **이 둘을 섞지 않는 것이 설계의 핵심이다.**

**일부러 넣지 않은 것** (다시 넣자는 제안이 나오면 이 문단을 읽을 것):

- 점수 평균·정답률·완료율·연속 학습일 — 없다.
- 「이 달 기록 12일」 같은 월 집계 수치 — 없다. 8월 옆에서 31은 상수라 학생이
  분모 없이도 나눗셈을 스스로 한다.
- **기록이 없는 날의 ×·「미완료」 — 없다.** 빈 칸에 표식을 찍는 순간 달력이
  벌점표가 된다. 「다 봤어요」를 안 눌렀을 뿐 공부한 날일 수도 있다.
  `apps/web/test/ui/record-days.test.ts`의 「기록이 없는 날은 어떤 표식도 만들지
  않는다」가 이 규칙을 붙잡고 있다.
- **`learning_availability_events`(학습 불참)는 조회조차 하지 않는다** — 날짜
  격자에 결석을 그리면 이 제품이 출결부가 된다(3.7절). 휴일은 학원 운영의
  사실이라 격자 아래 한 줄로만 남겼다.

**질의에서 조심할 자리 셋:**

- 복습을 `completed_at`으로 세면 화면에서 거의 다 사라진다 — 졸업하지 않은 복습은
  그 값이 null로 되돌아간다. `last_reviewed_on`을 쓰되 **`outcome->>'closedBy' =
  'learner_review'`**를 함께 건다. 이게 없으면 *선생님이 채점한 날*에
  「복습 마침」이 찍혀 화면이 조용히 거짓말한다.
- 오늘 화면의 「개별 일정 우선, 없으면 반 공통」을 한 달에 그대로 베끼면 개별 일정이
  하루만 있어도 반 공통 수업이 통째로 사라진다. **날짜 단위**로 적용해야 한다.
- 응시는 `(submitted_at at time zone KST)::date`로 버킷하되 WHERE는 반개구간으로 —
  경계일이 빠지거나 겹친다.

### 4.3 E2E의 시한폭탄 하나를 제거

`full-loop.spec.ts`의 완료 판정이 「"결과 보기"가 오늘 화면에 있나」에 기대고
있었다. 목록을 옮기는 순간 이미 제출한 학생에게 판정이 영영 false가 되고, 없는
응시 링크를 30초 기다리다 죽는다. **「응시 링크가 *없나*」로 뒤집었다** — 지난 기록이
또 어디로 옮겨 가도 안 깨진다.

### 4.4 `seed-unit1-demo`와 `materials.spec.ts`가 충돌한다 (미해결)

`pnpm --filter @su-maek/db seed-unit1-demo`는 데모 학생에게 **오늘 09:00–22:00
KST** 개별 일정을 만든다(`reason_codes: ["demo_unit1_verification"]`).
`e2e/tests/materials.spec.ts`는 같은 학생에게 09:00 시작 일정을 넣으려 하고,
배제 제약 `learner_schedule_items_no_overlap`에 걸려 **스펙이 실패한다.**

2026-08-03 실측으로 남아 있는 행:

```sql
select id, item_date, starts_at, ends_at, reason_codes
  from learner_schedule_items
 where reason_codes::text like '%demo_unit1%';
-- 019fc6c0-4781-70b9-a94e-3979cb7c2622 | 2026-08-03 | 09:00 | 22:00 KST
```

`materials.spec.ts`를 돌리려면 이 행을 지워야 한다. 어느 쪽이 양보해야 하는지
정하지 않았다 — **고치지 않고 알려진 결손으로 남긴다.** 데모 세팅이 22시까지
잡는 것이 과한 것인지, 스펙이 다른 학습자를 써야 하는지가 판단할 지점이다.

---

## 5. 검증과 배포

### 5.1 무엇을 돌리고 무엇을 믿나

작성 시점 실측:

| 검사 | 결과 |
|---|---|
| `pnpm typecheck` | **0 오류** (전 패키지) |
| `pnpm lint` | **0 오류 / 2 경고** — 둘 다 기존 것(`TestRunner.tsx`의 effect 내 setState, `settings/page.tsx`) |
| `pnpm boundary:check` | 통과 — 비범위 모듈·문구 0건 |
| KST 가드 | 6/6 |
| `apps/web` 단위 | 157/157 (24 파일, 단독 실행) |
| E2E `a11y`+`full-loop` (desktop·mobile) | 18/18 |

> **E2E 배치 실행의 실패를 곧이곧대로 믿지 말 것.** 모든 패키지가 **라이브 DB
> 하나를 공유**한다(`fullyParallel: false, workers: 1`이어도 패키지 간에는
> 동시에 돈다). 배치에서 실패한 것이 단독 재실행에서 통과하는 일이 흔하다 —
> 실제로 이번에 워커 `ECONNRESET`, 릴리스 발행, a11y 교사 타임아웃이 모두
> 그랬다. **의심되면 그 스펙만 단독으로 다시 돌린다.**

> **상태를 바꾸는 스펙을 배치에 섞지 말 것.** `schedule.spec.ts`는 일정 엔진의
> "변경 최소화" 때문에 상태를 누적시킨다.

`e2e/global-teardown.ts`가 `purgeTestData`를 부른다. **읽기만 하는 스크린샷·
진단 스펙을 만들 때는 `globalTeardown` 없는 별도 config를 쓸 것** — 안 그러면
확인하러 갔다가 데이터를 지운다.

### 5.2 배포

**웹** — Vercel 프로젝트 `su-maek`, rootDirectory=`apps/web`.

```bash
vercel deploy --prod --yes
```

> **깨끗한 워크트리에서 배포할 것.** Vercel CLI는 로컬 디렉터리를 그대로 올린다 —
> 미커밋 WIP가 프로덕션에 실린다.

**워커** — 배포 플랫폼이 **아직 정해지지 않았다.** 저장소가 주는 것은 이미지
정의뿐이다.

```bash
docker build -f apps/worker/Dockerfile -t su-maek-worker .
docker run -d --env-file .env --restart unless-stopped su-maek-worker
```

재시작 정책이나 플랫폼의 프로세스 감독을 **반드시 켤 것** — 워커는 죽으면 아무도
대신 하지 않고, 죽은 사실은 `worker_heartbeats`의 침묵으로만 드러난다
(`pnpm worker:status`가 종료 코드 1을 준다).

---

## 6. 다음 우선순위

1. **사람이 해야 하는 절차 — 교육과정 릴리스 발행.** 코드는 다 됐고 남은 차단
   사유가 **원문 대조 1건**뿐이다.
   ```bash
   pnpm curriculum:release verify-source --checksum <sha256 앞 12자 이상> --by <이메일>
   pnpm curriculum:release publish --dry-run
   ```
   절차는 [runbooks/15-curriculum-release-publish.md](runbooks/15-curriculum-release-publish.md).
2. **RPM 213문항 권한 개방.** 전부 `is_auto_assignable=false`,
   `content_rights.status='under_review'`라 **출제 풀에 0건**이다. 사람이 저작권을
   확인해 `usable`로 올려야 연습·테스트 검증을 할 수 있다(원칙 9).
3. **[handoff.md](handoff.md) 7절의 반입 결함 4건** — 개념 매핑표 키 충돌(지금
   조용히 틀리고 있다), 그림 문항 3건, 변형 저장 경로 부재, 파서 단위 테스트 부재.
4. **🟡 32건 승격** — 근거란에 각각 무엇이 모자란지 적혀 있다.
   [acceptance-status.md](acceptance-status.md).

### 6.1 알고도 미룬 것 (제안이 아니라 기록)

- `/learn/tests/[id]`는 탭을 렌더하지 않아 내비가 없는데 **본문 탈출 링크도 없다.**
  서버가 마감을 검사하지 않는 상태에서 「나가기」 문구를 고르는 건 별도 판단이라
  손대지 않았다.
- 교사 달력 `apps/web/src/app/app/calendar/page.tsx`가 월 계산 30여 줄을 그대로
  들고 있다 — `apps/web/src/lib/calendar/month.ts`로 합칠 수 있다.
- `e2e/visual-check.mjs`에 학생 화면이 없다(교사 6화면만).
- 4.4절의 데모 세팅 대 스펙 충돌.

---

## 7. Windows에서 실제로 사고가 났던 것

- **한글이 든 파일은 Read/Write/Edit 도구로만 다룬다.** PowerShell
  `-replace` + `Set-Content`는 mojibake(파일 하나를 통째로 파괴한 적 있다),
  `-Encoding utf8`은 BOM을 넣어 `package.json` 파싱을 깬다.
- **git 커밋 메시지에 큰따옴표를 넣지 않는다.** PS 5.1 here-string이라도 네이티브
  인자 전달에서 내부 `"`가 메시지를 쪼갠다(pathspec 오류로 커밋 실패, **두 번 실측**).
  인용이 필요하면 홑낫표(「」)나 하이픈으로 대신한다.
- **줄바꿈이 CRLF다.** `perl -pe 's/foo\n//'` 류가 **오류 없이 아무것도 안 한다.**
  패턴에 `\r?\n`을 쓰거나 Node 스크립트로 바꾼다.
- `npx tsx -e "..."`는 백틱 이스케이프로 깨진다 — 임시 `.mts` 파일을 패키지
  디렉터리 **안에** 만들어 실행한다(Windows 절대 경로 import는 ESM URL 오류).
- React 19는 서버 액션 후 **폼을 리셋한다** — E2E에서 재제출 전 모든 필드를 다시
  채운다. `revalidatePath`로 분기가 바뀌면 폼이 언마운트되어 상태 메시지가
  사라지므로 **결과 기반으로 검증**한다.

---

## 8. 인수 확인 목록

- [ ] `pnpm install` 후 `pnpm typecheck`가 0 오류인가
- [ ] `.env`의 `DATABASE_URL`이 **session pooler**(`aws-1`, 포트 5432)인가
- [ ] `pnpm db:migrate && pnpm db:seed`가 통과하는가
- [ ] `pnpm --filter @su-maek/db demo-account` 후 `demo-teacher@su-maek.app` /
      `1234@@@@`로 `/app`에 들어가지는가
- [ ] `demo-student@su-maek.app`으로 `/learn/today`와 `/learn/records`가 열리는가
- [ ] `pnpm dev:all`로 워커가 같이 뜨고 `pnpm worker:status`가 0을 주는가
- [ ] `pnpm lint`가 0 오류인가 (경고 2건은 기존 것)
- [ ] `pnpm boundary:check`가 통과하는가
- [ ] `pnpm verify:recovery`가 위반 0행인가
- [ ] `pnpm test`가 통과하는가 — 실패하면 **그 패키지만 단독 재실행**해 보고
      판단한다(5.1절)
- [ ] `git status`에 PDF·덤프 JSON·지면 이미지가 하나도 없는가
