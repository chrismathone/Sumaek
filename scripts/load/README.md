# 부하 시나리오

> 근거: [../../docs/phase0/slo.md](../../docs/phase0/slo.md) 9장(부하시험 통과 조건) ·
> [../../docs/phase0/assumptions.md](../../docs/phase0/assumptions.md) 3.1(피크 답안 RPS)

목표 수치는 문서에서 그대로 가져왔다.

| 항목 | 값 | 출처 |
|---|---|---|
| 집중 창 평균 확정 제출 | 208 RPS | assumptions 3.1 |
| burst 포함 확정 제출 | **625 RPS** | ×3.0 (수업 종료 정각 동시 제출) |
| 임시 저장 포함 답안 쓰기 | **875 RPS** | ×1.4 |
| 설계 수용 목표 | 1,000 RPS | 올림 |
| **부하시험 목표** | **2,000 RPS** | 설계의 2배 (골프롬프트 29장) |
| 시험 시작 | 33.3 시작/초 | 학생 20,000명 ÷ 10분 |

시험 환경은 운영의 1/10 규모(스테이징)이며, 결과는 **선형 외삽 + 보정 계수 1.3**을
적용해 환산한다. 그래서 `RPS_SCALE` 기본값이 `0.1`이다.

---

## 1. 먼저 알아야 할 제약 — 답안 저장·제출은 HTTP API가 아니다

이 저장소의 답안 저장(`saveAnswerAction`)과 제출(`submitAttemptAction`)은
**Next.js 서버 액션**이다(`apps/web/src/app/learn/tests/[id]/actions.ts`).
`POST /api/v1/attempts/…` 같은 공개 엔드포인트가 없다.

서버 액션은 HTTP로 이렇게 나간다.

```http
POST /learn/tests/<assessmentId> HTTP/1.1
Next-Action: 7f3c9a1b…          ← 빌드 산출물의 액션 ID (해시)
Content-Type: text/plain;charset=UTF-8
Cookie: sb-<ref>-auth-token=base64-…

[{"attemptId":"…","assessmentQuestionId":"…","answer":{…},"clientSequence":12}]
```

재현 가능하지만 두 가지가 걸린다.

| 제약 | 내용 |
|---|---|
| **액션 ID가 빌드마다 바뀐다** | 소스 경로+함수명 해시라서 재배포하면 무효가 된다. 배포마다 다시 뽑아야 한다 |
| 응답이 RSC 스트림이다 | `text/x-component` 본문이라 성공·실패 판정을 상태 코드와 본문 문자열로 해야 한다 |

그래서 `submit-answers.k6.js`는 **조회 경로 + 제출 API 골격** 구성이다.
액션 ID를 넣지 않으면 조회 시나리오만 돌고 쓰기는 건너뛴다(콘솔에 경고를 찍는다).

### 언제 k6 대신 Playwright를 쓰나

| 상황 | 도구 |
|---|---|
| 정기 회귀(배포 파이프라인)에서 875·2,000 RPS 확인 | **k6** — 액션 ID 추출을 파이프라인 단계로 자동화 |
| 액션 ID 추출을 자동화하기 전 1회성 측정 | **Playwright 동시성 스크립트** (2장 아래) |
| 실제 학생 화면 동작(임시 저장 타이밍·재접속 재전송) 포함 검증 | **Playwright** — 브라우저가 실제 클라이언트 코드를 돈다 |
| 순수 RPS·지연 분포 | **k6** — Playwright로는 수천 RPS를 못 만든다 |

**Playwright로는 목표 RPS를 못 만든다.** 브라우저 하나당 수 RPS가 한계다.
정확성은 Playwright, 규모는 k6로 나눠 쓴다.

---

## 2. 로그인 세션 쿠키 주입

인증은 Supabase(@supabase/ssr 0.10)이고 세션은 **쿠키**로 오간다.
미들웨어가 아니라 `apps/web/src/lib/supabase/server.ts`가 쿠키를 읽는다.

### 2.1 쿠키 얻기 (권장 — Playwright로 한 번 로그인)

```bash
# 로그인해서 storageState를 저장한 뒤 쿠키만 뽑는다
node scripts/load/capture-session.mjs   # (없으면 아래 수동 절차)
```

수동 절차:

1. 스테이징에 학생 계정으로 로그인한다.
2. DevTools → Application → Cookies에서 `sb-<project-ref>-auth-token` 값을 복사한다.
3. 값이 3,180바이트를 넘으면 `sb-<ref>-auth-token.0`, `.1`로 **쪼개져 있다.**
   전부 복사해 `;`로 이어 붙인다.

```bash
export SB_COOKIE='sb-abcd-auth-token.0=base64-eyJ…; sb-abcd-auth-token.1=…'
```

### 2.2 REST로 직접 발급받기

```bash
curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"student@example.com","password":"…"}'
```

응답의 세션 JSON을 `base64-` 접두사를 붙인 base64로 인코딩해 위 쿠키 이름에 넣는다.
**@supabase/ssr의 인코딩 규약이 버전마다 바뀌므로**, 이 경로를 쓸 거면 실제
브라우저 쿠키와 한 번 대조해 형식을 확인하고 시작한다. 형식이 틀리면 전 요청이
조용히 로그인 리다이렉트가 되고, k6는 그것을 "성공"으로 셀 수 있다.
그래서 시나리오에 `로그인으로 튕기지 않음` 체크를 넣어 두었다.

**부하시험용 계정은 합성 조직에만 만든다.** 실제 학생 계정으로 시험하지 않는다.

---

## 3. 서버 액션 ID 뽑기

배포된 빌드에서 한 번 뽑아 환경변수로 넘긴다.

```bash
# 1) 학생 시험 화면을 열고 DevTools Network에서 답안 저장을 한 번 한다.
#    요청 헤더의 Next-Action 값이 그대로 액션 ID다.

# 2) 또는 빌드 산출물에서 찾는다 (self-host 기준)
grep -rho '"[0-9a-f]\{40,\}"' apps/web/.next/server/app/learn/tests/ | sort -u
```

```bash
export NEXT_ACTION_SAVE=<saveAnswerAction의 ID>
export NEXT_ACTION_SUBMIT=<submitAttemptAction의 ID>
```

배포할 때마다 다시 뽑는다. 옛 ID를 쓰면 404가 나고, 그러면 부하가 아니라
404 처리 성능을 재게 된다.

---

## 4. 고정 데이터 준비

응시 중인 attempt와 그 문항 ID가 미리 있어야 한다. 없으면 임시 저장이 전부
`not_started` 거부로 끝난다.

`FIXTURES`는 다음 모양의 JSON 배열 파일이다.

```json
[
  {
    "assessmentId": "0199…",
    "attemptId": "0199…",
    "assessmentQuestionId": "0199…",
    "choiceId": "2"
  }
]
```

준비 원칙:

- **합성 조직에서만** 만든다. 실데이터 금지(backup-recovery.md 9장).
- 응시 수 ≥ 목표 동시 VU 수. 같은 attempt에 몰리면 `client_sequence` CAS 충돌만
  측정하게 된다 — 그건 동시성 테스트지 부하시험이 아니다.
- 시험 시간대 안이어야 한다(`opens_at ~ closes_at`). O-02 측정 창이 그 구간이다.

---

## 5. 실행

```bash
k6 run \
  -e BASE_URL=https://staging.example.com \
  -e SB_COOKIE="$SB_COOKIE" \
  -e NEXT_ACTION_SAVE="$NEXT_ACTION_SAVE" \
  -e NEXT_ACTION_SUBMIT="$NEXT_ACTION_SUBMIT" \
  -e FIXTURES=./scripts/load/fixtures.json \
  -e RPS_SCALE=0.1 \
  scripts/load/submit-answers.k6.js
```

조회 경로만 먼저 확인하려면 `SB_COOKIE`만 주고 돌린다.

단일 부하 발생기로는 2,000 RPS를 못 만든다. 운영 규모(`RPS_SCALE=1`)로 갈 때는
k6 분산 실행(k6 operator 또는 여러 노드)으로 나눈다. **부하 발생기 자체가 병목이면
측정값이 아니라 발생기 성능을 재는 것**이므로, 시험 전에 발생기 CPU·소켓 여유를
확인한다.

---

## 6. 통과 판정

k6 임계값(`options.thresholds`)은 **지연·오류율만** 본다. 통과 조건 전체는
slo.md 9장이며, 나머지는 부하 중·후에 따로 확인한다.

| # | 조건 | 확인 방법 |
|---|---|---|
| 1 | 제출 유실 0건 | k6의 성공 카운트와 `attempts`·`responses` 행 수 대조 |
| 2 | 교차 테넌트 노출 0건 | 부하 중 `pnpm --filter @su-maek/db test` (RLS) 동시 실행 |
| 3 | 핵심 API 오류율 < 1% | k6 `http_req_failed` |
| 4 | p95·p99 SLO 충족 | k6 임계값 (L-01·L-02·L-05) |
| 5 | realtime 큐가 ai 큐에 고갈되지 않음 | [RB-04](../../docs/runbooks/04-queue-backlog-dlq.md) 4-1 쿼리 |
| 6 | 공정 큐·테넌트 한도 작동 | RB-04 4-3 — 단일 조직 점유율 ≤ 40% |
| 7 | 불변 조건 위반 0건 | `node scripts/verify-recovery.mjs` (부하 종료 후) |

부하시험 뒤에는 반드시 7번을 돌린다. 동시성 결함은 지연 그래프가 아니라
불변 조건 위반으로 드러난다.

---

## 7. 시나리오 두 벌 — 무엇을 나눠 재나

| 스크립트 | 재는 것 | 쿠키 말고 필요한 것 |
|---|---|---|
| `submit-answers.k6.js` | 답안 **쓰기** — 임시 저장·확정 제출 (L-05·L-02) | 서버 액션 ID(3장) · `fixtures.json`(4장) |
| `autonomous-day.k6.js` | 수업 직전의 **읽기** — 학생 오늘 화면, 교사 운영실·준비도 (L-01) | 없음. 전부 GET이라 그대로 돈다 |

읽기 쪽을 따로 두는 이유는 부하의 모양이 다르기 때문이다. 답안 제출은 학생 수만큼
일어나지만, 교사 화면 하나는 **반 인원만큼의 계산**을 돌린다
(`listGroupDayProgress` · `loadDayReadiness`가 학생별 하루 계획을 각각 계산한다).
요청 수만 보면 교사 쪽은 학생의 1/20이라 무시해도 될 것처럼 보이는데, 계산량은
그렇지 않다. 쓰기만 재고 넘어가면 그 곱셈을 놓친다.

```bash
k6 run -e BASE_URL=https://staging.example.com        -e STUDENT_COOKIE="$SB_STUDENT"        -e TEACHER_COOKIE="$SB_TEACHER"        -e GROUP_ID=0199...        scripts/load/autonomous-day.k6.js
```

학생·교사 쿠키는 **다른 계정**이어야 한다. 하나만 주면 그쪽 시나리오만 돈다.

---

## 8. 아직 없는 것

정직하게 적어 둔다.

| 항목 | 상태 |
|---|---|
| `submit-answers.k6.js` | 작성 완료. 조회 경로는 그대로 실행 가능 |
| `autonomous-day.k6.js` | 작성 완료. 세션 쿠키만 있으면 그대로 실행 가능 |
| 액션 ID 자동 추출 | **없음.** 지금은 수동(3장) |
| `capture-session.mjs` | **없음.** 지금은 수동(2.1) |
| `fixtures.json` 생성기 | **없음.** 합성 조직 시드에서 뽑아 써야 한다 |
| k6 실측 결과 | **없음.** k6 바이너리도 스테이징도 아직 없다 |

### k6 없이 지금 재고 있는 것 (T6.3)

k6는 **규모**를 재는 도구다. 그것이 없다고 동시성까지 못 재는 것은 아니다.
라이브 DB를 상대로 실제로 겹쳐 부르는 테스트가 있고, 이것들은 지금 돈다.

| 테스트 | 재는 것 | 결과 |
|---|---|---|
| `packages/db/test/concurrent-commands.test.ts` | 하루 완료·평가 생성·수업 마감을 각각 10개씩 겹쳐 부른다 | 각 명령이 한 번만 반영됨 |
| `apps/web/test/integration/concurrent-submit.test.ts` | 학생 30명이 같은 평가를 동시에 제출한다 | 유실 0건 · 예외 0건 · 채점 결정 응시당 1건 |

**동시 제출의 실측 지연** (2026-08-05, 개발기 + 공유 Supabase):
`p50 590ms · p95 623ms · 최대 626ms` — 30건.

이 수치를 SLO 통과로 읽으면 안 된다. **도메인 경로만** 잰 값이고 HTTP·Next 서버
액션·직렬화·네트워크가 빠져 있다. L-02(제출 p95 1초) 옆에 두는 것은 **하한**으로서다:
도메인만으로 이미 1초를 넘으면 실제 값은 반드시 넘는다. 반대 방향으로는 아무것도
보장하지 않는다.

지연을 CI 임계값으로 걸지 않은 이유도 적어 둔다. 개발기·공유 DB·네트워크 왕복이
섞인 값이라 그것으로 빌드를 깨면 「환경이 느린 날」에 빨간불이 켜지고, 그러면
사람들은 임계값을 올린다 — 그 순간 그 줄은 아무것도 지키지 않게 된다. 그래서
**정확성**(유실·중복·예외)만 임계값으로 걸고 지연은 콘솔에 기록해서 보여 준다.
