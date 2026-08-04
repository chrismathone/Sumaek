# 인수인계 — 학생 학습 화면(/learn)

> **다른 컴퓨터에서 이 갈래를 이어받기 위한 문서.**
> 작성 2026-08-04 · 기준 커밋 `5843cd2` · 저장소 `https://github.com/chrismathone/Sumaek` (main 직푸시)
> 범위: `apps/web/src/app/learn/**` + 그 조회 계층. **저장소 전체를 처음 여는 것이라면
> [handoff-project.md](handoff-project.md)부터.** 교재 반입 갈래는 [handoff.md](handoff.md).
> 관련: [acceptance-status.md](acceptance-status.md) · [adr/0014-content-rights-enforcement.md](adr/0014-content-rights-enforcement.md) · [runbooks/08-content-rights-emergency-stop.md](runbooks/08-content-rights-emergency-stop.md)

여기 적은 수치는 전부 **2026-08-04에 이 저장소와 이 DB에서 실측한 것**이다. 다시 뽑는
SQL을 4.3절에 그대로 실었다. 확인하지 않은 것은 「확인 안 함」이라고 적었다.
**없는 것을 있다고 적지 않는다** — [acceptance-status.md](acceptance-status.md)의 관례를 따른다.

---

## 0. 30초 요약

학생 「오늘 학습」(`/learn/today`)은 하루를 **순서 있는 6단계**로 내는 궤도 레일 화면이다.
`5843cd2`에서 화면이 스스로 모순되던 다섯 자리를 고쳤다(1절).

다음으로 하려던 것은 **개념 중심 통합** — 개념 공부·개념 인강·연습문제를 따로 단계로
두지 말고, 개념 하나를 펼친 자리에서 읽기 → 인강 → 연습으로 이어지게 하는 것이다(3절).
설계와 데이터 확인까지 했고 **구현은 시작하지 않았다.**

그 통합의 연습 칸은 지금 **아무것도 낼 수 없다.** 1단원 문항 213건이 전부 검수·사용권
게이트에 막혀 있고, 여는 것은 저작권 판단이라 **사람이 해야 한다**(4절). 이것이 이
갈래의 유일한 차단 사유다.

---

## 1. 방금 들어온 것 (`5843cd2`)

「머리 주석을 사양으로 읽고 코드와 대조한다」로 나온 다섯이다. 다섯 다 타입 검사·린트·
렌더 어디에도 안 걸린다 — 화면은 멀쩡히 그려지면서 틀린 말을 한다.

| # | 무엇이 틀렸나 | 어떻게 고쳤나 |
|---|---|---|
| 1 | 「할 차례」 배지가 **할 차례가 아닌 단계에만** 붙었다 | 배지는 `남은 N건`만 말한다 |
| 2 | 예정 테스트가 상태에 안 잡혀 화면이 두 줄 사이에서 모순됐다 | `StepState`에 `upcoming` 추가 |
| 3 | 히어로 머리글이 카드를 첫 자료의 개념명으로 잘못 불렀다 | `conceptSpan` — 「… 외 개념 N개」 |
| 4 | 복습 히어로만 「몇 건」에 머물렀다 | 개념 이름을 낸다 + 집계 질의 통합 |
| 5 | 복습 화면이 이미 고친 거짓 문구가 오늘 화면에 남아 있었다 | 복습 화면의 문구로 맞췄다 |

**1번이 이 갈래에서 가장 배울 것이 많다.** 배지는 구조상 `!active` 분기에서만 렌더된다.
그래서 배지 라벨이 「할 차례 N건」이면 **화면에 뜨는 모든 「할 차례」가 할 차례가 아닌
단계의 것**이 된다. 파일 머리에 「한 번에 한 단계만 할 차례다」라고 적어 두고, 그 불변이
가장 잘 보이는 자리에서 깨져 있었다. 주석과 코드를 대조하지 않으면 안 보인다.

**2번의 함정**: `upcoming`을 더할 때 `readDay`의 `hadWork`를 `!== "none"`으로 두면
예정 하나가 오늘 몫으로 딸려 들어가, 아무것도 배정되지 않은 날 **거짓 축하**가 되돌아온다
(`today-steps.ts`가 애초에 생긴 이유가 그 버그다). `todo`·`done`만 세도록 못 박았고
변이 검증으로 확인했다.

---

## 2. 지금의 화면 구조

### 2.1 파일 지도

| 경로 | 하는 일 |
|---|---|
| `apps/web/src/app/learn/layout.tsx` | 셸. 학생 아닌 역할은 자기 영역으로 되돌린다 |
| `apps/web/src/app/learn/today/page.tsx` | 오늘 학습 — 6단계 궤도 레일 |
| `apps/web/src/app/learn/today/OrbitRail.tsx` | 궤도 노드·선·상태 배지 |
| `apps/web/src/lib/learn/today-steps.ts` | **판정 순수 함수** — `readDay`·`orbitOf`·`solidBelow`·`badgeLabel`·`conceptSpan` |
| `apps/web/src/app/learn/study/page.tsx` | 개념 공부 — 읽기 자료 **1건씩** (`?p=`) |
| `apps/web/src/app/learn/watch/page.tsx` | 개념 인강 — 유튜브 임베드 |
| `apps/web/src/app/learn/practice/page.tsx` | 연습문제 — 점수로 남지 않는다 |
| `apps/web/src/app/learn/review/page.tsx` | 복습 — 기한이 온 것 1건씩 |
| `apps/web/src/app/learn/records/page.tsx` | 지난 기록 월간 달력 |
| `apps/web/src/lib/domain/learning-material.ts` | 자료 조회·진도·연습 문항 선택 |
| `apps/web/src/lib/domain/review.ts` | 복습 조회·채점·`listDueReviewConcepts` |

### 2.2 못박힌 것 — 어기면 조용히 틀린다

- **판정은 화면에 두지 않는다.** `today-steps.ts`가 있는 이유가 「화면 안에 두면 확인할
  방법이 실제 데이터를 만드는 것밖에 없다」다. 라벨 문자열(`badgeLabel`)까지 여기 있는
  것도 같은 이유 — 변이 검증이 가능해진다.
- **「할 차례」는 히어로 캡션 바가 독점한다.** 배지에 쓰면 1절 1번이 되돌아온다.
  `today-steps.test.ts`의 「배지는 「할 차례」라고 말하지 않는다」가 붙잡고 있다.
- **오늘 수업은 개별 일정(`learner_schedule_items`) 우선, 없을 때만 반 공통(`sessions`).**
  보충·재합류로 반과 달라진 학생에게 반 공통을 보이면 화면이 거짓말한다.
- **자료 건수는 「남은 것」을 센다.** 총건수를 쓰면 `/learn/study`의 「8건 중 3건」과
  오늘 화면이 서로 다른 사실을 말한다.
- **완료는 학생이 누를 때만 찍힌다** — 「열어 봤다」를 「공부했다」로 세지 않는다.

### 2.3 검증 현황 (2026-08-04 실측)

| 검사 | 결과 |
|---|---|
| `pnpm --filter @su-maek/web exec tsc --noEmit` | **0 오류** |
| `pnpm lint` | 0 오류 / 2 경고 — 둘 다 기존 것 |
| `pnpm boundary:check` | 통과 |
| `apps/web` 단위·통합 | **177/177** (25 파일) |
| E2E | 이 커밋에서 **돌리지 않았다** — 「확인 안 함」 |

---

## 3. 하려던 것 — 개념 중심 통합 (미구현)

### 3.1 무엇을

지금은 개념 공부·개념 인강·연습문제가 **각각 다른 단계이자 다른 화면**이다. 학생은 같은
개념을 배우면서 세 화면을 오간다. 사용자 요청은 「따로 단계 두지 말고 개념을 열어놓고
인강 시청」, 그리고 「연습문제도 해당 개념·인강에 배정해서 이어서 풀어볼 수 있게」다.

그리려던 모양:

```
1단계  오늘 배울 것
2단계  개념 학습   ← 읽기 + 인강 + 연습을 개념 단위로 묶은 한 단계
3단계  테스트
4단계  복습
```

화면(`/learn/study`)은 **자료 단위가 아니라 개념 단위로 넘긴다**. 한 쪽 = 한 개념이고,
그 안에서 개념 본문 → 인강 임베드 → 연습문제 순으로 이어진다.

### 3.2 데이터가 받쳐 주는가 — 받쳐 준다 (실측)

게시된 학습자료 **22건 / 개념 9개**:

| 개념 | 읽기 | 영상 | 연습 |
|---|---|---|---|
| 소수와 합성수 | 1 | 1 | 0 |
| 소인수분해 | 2 | 2 | 0 |
| 약수와 약수의 개수 | 1 | 1 | 0 |
| 최대공약수 | 2 | 2 | 0 |
| 최소공배수 | 2 | **0** | 0 |
| 가감법 | 1 | 1 | **1** |
| 연립일차방정식의 뜻 | 1 | 1 | **1** |
| 일차방정식 복습 | **0** | 1 | 0 |
| 확인 개념 | **0** | 1 | 0 |

- 읽기·영상 **둘 다** 있는 개념 **6**
- 읽기만 **1** (최소공배수) · 영상만 **2** (일차방정식 복습, 확인 개념)
- 연습 자료가 있는 개념 **2** — 둘 다 오늘 차시(1단원) **밖**이다

**즉 한쪽이 비는 개념이 3개 있으므로, 통합 화면은 「읽기 없음」·「영상 없음」을 각각
말할 수 있어야 한다.** 셋이 다 있는 개념은 지금 하나도 없다.

### 3.3 아직 정하지 않은 것

- `/learn/watch`·`/learn/practice` 라우트를 남길지 지울지. **지금은 남아 있고**
  `e2e/tests/materials.spec.ts:202,210`이 두 주소를 직접 연다 — 지우면 그 스펙이 깨진다.
- 개념 안에 읽기가 2건인 경우(소인수분해·최대공약수) 한 쪽에 이어 붙일지 나눌지.
- 6단계 → 4단계로 줄면 `today-steps.ts`의 `ACTION_ORDER`와 `today-steps.test.ts`
  26건, 그리고 오늘 화면의 「현재 위치 N / 6」 분모가 함께 바뀐다. **분모를 「없음이 아닌
  단계」로 바꾸지 말 것** — 오후에 자료가 올라오면 진행률이 뒤로 간다(주석에 이유가 있다).

---

## 4. 차단 사유 — 연습문제가 하나도 안 나온다

### 4.1 증상

오늘 화면 4단계가 「없음 · 오늘 개념에 등록된 연습문제가 아직 없습니다」다.
`/learn/practice`도 비어 있다.

### 4.2 원인 (실측 2026-08-04) — 추출 문제가 **아니다**

교재 반입은 제 몫을 다 했다. 213문항이 **전부 오늘 배우는 개념에 정렬되어 있다.**
막는 것은 그 뒤의 게이트다.

**오늘 차시 개념 5개**: 소수와 합성수 · 소인수분해 · 약수와 약수의 개수 · 최대공약수 · 최소공배수

| 게이트를 하나씩 열면 | 건수 |
|---|---|
| 1. 개념에 정렬된 문항 | **213** (전부 RPM 반입분, 시드분 0) |
| 2. + `review_status = 'published'` | **0** |
| 3. + `content_rights.status = 'usable'` | **0** |

반입분 213의 상태:

| 컬럼 | 값 | 건수 |
|---|---|---|
| `review_status` | `review_required` | 210 |
| | `layout_review_required` | 3 (그림 문항) |
| `content_rights.status` | `under_review` | **213** |
| `is_auto_assignable` | `false` | **213** |

> **개념별 정렬 수를 더하면 379인데 문항은 213이다.** 한 문항이 여러 개념에 정렬되기
> 때문이다(소수와 합성수 74 · 소인수분해 79 · 약수와 약수의 개수 79 · 최대공약수 73 ·
> 최소공배수 74). 「문항이 379개 있다」로 읽지 말 것.

이것은 버그가 아니라 **의도된 격리**다. `packages/ingest/src/load.ts`가 반입분을 검수
대기로 넣는다 — 사람이 저작권을 확인하기 전에는 출제 풀에 올리지 않는다(원칙 9,
[adr/0014-content-rights-enforcement.md](adr/0014-content-rights-enforcement.md)).
[handoff-project.md](handoff-project.md) 6절의 우선순위 2번이 정확히 이 항목이다.

### 4.3 이 수치를 다시 뽑는 SQL

```sql
-- 오늘 차시 개념 + 게이트 통과 수
with today_concepts as (
  select distinct cc.concept_id::uuid as id
  from learner_schedule_items li
  cross join lateral jsonb_array_elements_text(li.planned_node_ids) as n(node_id)
  join route_nodes rn on rn.id = n.node_id::uuid
  cross join lateral jsonb_array_elements_text(rn.concept_ids) as cc(concept_id)
  where li.item_date = (now() at time zone 'Asia/Seoul')::date
), q as (
  select distinct q.id, q.review_status::text as rs,
         coalesce(r.status::text, 'none') as rights
  from question_alignments a
  join today_concepts t on t.id = a.concept_id
  join questions q on q.id = a.question_id
  left join content_rights r on r.id = q.content_right_id
  where a.provenance <> 'ai_suggested'   -- 미검수 AI 제안은 학생에게 안 나간다
)
select count(*) filter (where true)                                    as 정렬,
       count(*) filter (where rs = 'published')                        as 검수통과,
       count(*) filter (where rs = 'published' and rights = 'usable')  as 출제가능
from q;
```

### 4.4 여는 데 필요한 것 — **사람 판단이다. 코드가 아니다**

1. **사용권 확정** — `content_rights.status`를 `usable`로. 개념원리/RPM 교재의 저작권
   판단이므로 **에이전트가 임의로 올려서는 안 된다.**
2. **검수 통과** — `review_status`를 `published`로. 210건은 일반 검수, 3건은 그림
   문항이라 별개다 — 그림 자산이 아직 안 붙어 있어 화면에 그림 없이 나온다
   ([handoff.md](handoff.md) 7.2절).
3. **자동 출제 허용** — 자동 출제 풀에 넣으려면 `is_auto_assignable`도 함께.
   연습문제만 열 거라면 `listPracticeQuestions`는 이 플래그를 보지 않는다(아래 주의).

> **`listPracticeQuestions`의 게이트는 평가 출제와 다르다.** 연습은
> `review_status = 'published'` + `content_rights.status = 'usable'`만 본다
> (`is_auto_assignable`을 보지 않는다). `learning-material.ts:198-227`에서 확인한 것이다.
> 즉 **1·2번만 열어도 연습문제는 흐른다.**

**아래 SQL은 제안이고, 실행하지 않았다.** 실행 전에 반드시 대상 범위를 눈으로 확인할 것.

```sql
-- 제안 — 실행하지 않았다. 저작권 판단이 끝난 뒤에만.
begin;
update content_rights set status = 'usable'
 where id in (select content_right_id from questions where source_ref is not null);
update questions set review_status = 'published'
 where source_ref is not null and review_status = 'review_required';   -- 그림 3건은 제외
commit;
```

### 4.5 게이트를 연 뒤에 해야 하는 것

1단원 개념에 **연습 자료(`learning_materials`, `kind='practice'`) 행이 0건**이다.
게이트가 열려도 자료가 없으면 화면에 나오지 않는다. `question_ids`를 비워 두면
`listPracticeQuestions`가 그 개념의 출제 가능 문항에서 자동으로 골라 오므로
(`learning-material.ts:210-227`), **행만 만들면 된다.**
`packages/db/scripts/seed-unit1-demo.mts`가 붙일 자리다 — **확인 안 함**(그 스크립트가
지금 무엇을 넣는지 이 갈래에서 읽지 않았다).

---

## 5. 이어서 작업할 때의 순서

1. **먼저 4.3절 SQL을 돌려 수치가 같은지 본다.** 다르면 DB가 다른 것이다 — 코드를
   고치기 전에 그것부터 맞춘다.
2. 게이트를 열지 말지 **사람에게 확인받는다.** 열기 전에는 연습 칸을 실제 문항으로
   검증할 수 없다 — 검증 못 하는 UI를 만들지 않는 것이 이 저장소의 관례다(3.7절,
   「렌더 성공은 정확성이 아니다」).
3. 3절의 통합을 구현한다. 판정·라벨은 `today-steps.ts`에 두고 **변이 검증**을 거친다
   (검증 대상을 일부러 망가뜨려 테스트가 실제로 깨지는지 보고 원복).
4. 데이터 상태 때문에 닿지 않는 분기는 **로컬에서 잠깐 고정해 눈으로 보고 되돌린다.**
   DB를 건드리지 말 것. (`5843cd2`에서 예정 배지·복습 히어로를 이렇게 확인했다.)
5. 마지막으로 브라우저에서 실제 화면을 본다.

```bash
pnpm --filter @su-maek/db demo-account   # db:seed는 인증 계정을 안 만든다
pnpm dev:all                              # 웹만 띄우면 워커가 멈춘다
# /login → demo-student@su-maek.app / 1234@@@@ → /learn/today
```

---

## 6. 인수 확인 목록

- [ ] `pnpm --filter @su-maek/web exec vitest run`이 177/177인가
- [ ] `pnpm --filter @su-maek/web exec tsc --noEmit`이 0 오류인가
- [ ] 4.3절 SQL이 정렬 213 · 검수통과 0 · 출제가능 0을 주는가
- [ ] `demo-student@su-maek.app`으로 `/learn/today`가 열리고 「할 차례」가 **화면에
      딱 한 번**(히어로 캡션 바) 나오는가
- [ ] 3.2절 표대로 읽기·영상 짝이 맞는가 (`learning_materials` 게시분 22건)
- [ ] 사용권·검수 게이트를 열지 여부에 대해 **사람의 판단을 받았는가**
