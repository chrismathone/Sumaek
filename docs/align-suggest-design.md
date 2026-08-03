# 정렬 제안 시스템 — 미정렬 문항에 개념 후보를 붙이는 파이프라인

2026-08-03 · 상태: **구현 완료** (§5 실측) · 선행: 사람 매핑 표(profiles/rpm-2022-concepts.ts) · 정제 시스템(docs/refine-design.md)

## 1. 왜 필요한가

문항→개념 정렬은 숙련도 추정과 자동 출제의 축이다. 지금까지는 **사람이 쓴
표**(유형·소단원 제목 → 개념)가 유일한 경로였고, 그 원칙은 옳다 — 문항이
엉뚱한 개념에 걸리면 오류가 학생 화면 어디에도 드러나지 않은 채 출제만
틀어진다. 그런데 표는 지면을 실측한 단원까지만 자란다. 새 단원·새 교재가
들어올 때마다 정렬 없는 문항이 쌓이고, 검수자는 백지에서 시작한다.

이 시스템은 그 원칙을 깨지 않고 검수자의 대기열을 채운다:

- **AI는 제안만 한다.** provenance='ai_suggested' + confidence로 저장되고,
  절대 human으로 위장하지 않는다 (스키마가 이미 이 구분을 예비해 뒀다 —
  question_alignments.provenance·confidence·reviewedBy).
- **승인만이 human을 만든다.** review-alignments CLI로 사람이 승인하는
  순간 provenance='human' + reviewed_by가 기록된다.
- **표에 없으면 없다고 말한다.** 맞는 후보가 없으면 abstain — 행을 남기지
  않는다. 억지로 가장 비슷한 개념에 붙이는 것이 이 도메인의 최악이다.

## 2. 결정

### 결정 1 — 신뢰 등급은 소비처가 걸러야 실재한다

provenance는 라벨이 아니라 게이트다. concept_edges에 이미 선례가 있다
(진행 탐색 화면의 `provenance <> 'ai_suggested'`). 같은 필터를
question_alignments의 **믿음이 필요한 소비처 전부**에 적용했다:

| 소비처 | 파일 | 처리 |
|---|---|---|
| 자동 출제 풀의 개념 축 | lib/domain/assessment.ts (2곳) | 필터 |
| 숙련도 가중치 스냅샷 | lib/domain/assessment.ts (2곳) | 필터 |
| 연습문제 자동 선정 | lib/domain/learning-material.ts | 필터 |
| 자료 화면 낼 문항 수 | content/materials (2화면) | 필터 (자동 선정과 같은 기준 유지) |
| 학생 결과 화면 개념명 | learn/results | 필터 |
| 개념 커버리지 수 | content/curriculum·progression (5곳) | 필터 (제안으로 부풀리지 않는다) |
| 문제은행 목록 개념명 | content/questions | **라벨** 「(AI 제안)」 — 숨기지 않되 같은 얼굴로 세우지 않는다 |
| 문항 상세 | content/questions/[id] | 변경 없음 — 이미 provenance 배지·검토자 표시 |

`= 'human'`이 아니라 `<> 'ai_suggested'`인 이유: 스키마 밖의 세 번째 값
`'imported'`(프로젝트 이관 경로, db/domain/ingestion.ts)가 이미 흐르고
있다 — 기존 동작을 바꾸지 않는다. 폐기 영향 검사(curriculum-release.ts)는
일부러 안 거른다: 제안이 걸린 개념을 폐기하려는 시도는 막히는 쪽이 안전하다.

### 결정 2 — 후보 밖 slug는 오타가 아니라 지어낸 개념이다

프롬프트에 canonical_concepts 후보 목록(기본: 대상 문항 교재의 학년 대역,
`--band`로 조절)을 실어 주고, 게이트가 목록 밖 slug를 **통째로 거부**한다.
가장 비슷한 후보로 바꿔 주지 않는다 — 그 보정이 바로 이 게이트가 막으려는
추측이다. 가중치 규약은 사람 표와 같다: 합 1, 복합 유형만 분할.

### 결정 3 — abstain은 행이 없다. 그래서 재시도가 공짜다

맞는 후보가 없으면 행을 남기지 않고 보고만 한다. 미정렬 = 행 없음이 곧
대상 조건이므로, 해당 단원의 개념이 정의되면 **다음 실행이 자연히
재시도한다**. 상태 기계도 재시도 큐도 필요 없다.

### 결정 4 — 근거는 감사 이벤트에, 판단은 사람 이름으로

- rationale(발문의 어느 표현이 근거인지)은 행이 아니라 audit_events
  (`alignment.suggest`, after에 전체 제안)에 남고, 검수 목록이 읽어 보여 준다.
- 승인·반려는 `alignment.approve`·`alignment.reject`로 남는다. 반려는 행
  삭제다 — 문항은 미정렬로 돌아가고, 무엇을 지웠는지는 after에 남는다.
- **일괄 자동 승인 옵션은 일부러 없다.** 보지 않고 승인하는 것은 provenance
  위장과 같다. confidence는 검수 순서를 잡는 힌트이지 자동 승인 문턱이 아니다.

### 결정 5 — 멱등·동시 실행

- 정렬 행이 하나라도 있는 문항은 건너뛴다. `--force`는 **미검수
  ai_suggested만** 갈아 끼운다 — human 행·검수 흔적(reviewed_by)이 있으면
  force로도 건드리지 않는다.
- 트랜잭션 안에서 문항 행을 잠그고(`select … for update` — 정렬 행이
  0개일 때는 잠글 행이 없어 행 잠금으로는 경합을 못 막는다) 재확인한다.
  refine의 「멱등 재확인」과 같은 정신, 잠금 대상만 다르다.

## 3. 사용법

```bash
# ① 탐지만 — API도 쓰기도 없다
pnpm --filter @su-maek/ingest suggest-alignments --org=<uuid> --report

# ② 제안 — API 경로(범위 명시 필수: --question | --limit | --all)
pnpm --filter @su-maek/ingest suggest-alignments \
  --org=<uuid> --actor=<uuid> --limit=20 [--band=middle-1] [--dry-run]

# ② 제안 — 오프라인 경로 (Claude Code 세션에서 쓴 초안, 과금 없음. 게이트는 같다)
#    형식: [{ questionId, decision: "align"|"abstain", alignments?: [{slug,weight,confidence,rationale}] }]
pnpm --filter @su-maek/ingest suggest-alignments \
  --org=<uuid> --actor=<uuid> --input=<초안.json>

# ③ 검수 — 목록(근거 포함) → 승인/반려
pnpm --filter @su-maek/ingest review-alignments --org=<uuid>
pnpm --filter @su-maek/ingest review-alignments --org=<uuid> --actor=<uuid> \
  --approve=<문항id>[,…] [--only=<slug,…>]     # 부분 승인은 문항 하나일 때만
pnpm --filter @su-maek/ingest review-alignments --org=<uuid> --actor=<uuid> \
  --reject=<문항id>[,…]
```

기본 모델은 claude-sonnet-5다 — 집필(refine, opus)이 아니라 제한된 후보에서
고르는 분류 과제다. `--model`로 올릴 수 있다.

## 4. 데이터 실태 (2026-08-03 실측)

착수 전 가정은 "RPM 572건 중 351건 미정렬"이었다. 실측은 다르다:

- 데모 조직 문항 572건 = **RPM 추출 213건(전부 정렬 완료)** + 교재 없는
  시드 문항 359건(그중 351건 미정렬 — 본문이 「물의 양을 구하시오.」
  자리표시자인 데모·페이지네이션 픽스처).
- 즉 사람 표 + 중단원 fallback이 1단원 추출분을 **이미 다 덮었다.** 이
  파이프라인의 일은 과거 청산이 아니라 **다음 반입**(2단원·새 교재)부터
  정렬 공백이 생기는 즉시 제안이 붙게 하는 것이다. 시드 자리표시자에는
  제안을 돌리지 않는다 — 내용이 없는 문항에 붙는 개념은 전부 거짓이다.

## 5. 구현 실측 — 시범 전 구간 (2026-08-03)

데모 조직에 시범 문항 2건(교재 없음)을 만들어 오프라인 경로로 전 구간을
돌리고 정리했다 (감사 이벤트는 불변이라 남는다 — 그것이 맞다):

1. `--report`: 572건 중 미정렬 351 — 탐지 쿼리가 실태와 일치.
2. 초안 2건 적재: align 1(m1-gcd w=1 c=0.9) · abstain 1 — abstain은 행 없음.
3. **재실행: 제안된 문항은 대상에서 빠지고 abstain만 재시도** (멱등).
4. 검수 목록: 본문 미리보기 + 가중치·신뢰도 + 감사 이벤트의 근거 표시.
5. 승인: provenance human 전환, reviewed_by 기록, **confidence 보존**.
6. 반려: 행 삭제, 문항은 미정렬로 복귀.
7. 감사 흔적: `alignment.suggest → approve → suggest → reject` 순서 그대로.

시범이 잡은 결함 하나: abstain 초안이 `alignments` 필드를 생략하면 계약
위반이 났다 → `.default([])`로 수정 (refine의 io:"input" 규약 그대로),
회귀 테스트 추가.

검증: ingest 단위 84건(정렬 게이트 15건 포함) · web 122건(신규 통합
2건 — ai_suggested가 학생 경로에서 빠지고 승인 순간 포함되는 것) 전부 통과.

## 6. 비범위

- **웹 검수 UI** — 문항 상세가 이미 provenance 배지·신뢰도·검토자를
  보여 준다. 승인 버튼은 검수량이 CLI를 넘어설 때.
- **새 개념 자동 생성** — 후보가 없으면 abstain으로 보고할 뿐이다. 개념
  정의는 교육과정 카탈로그·사람의 일이다.
- **자동 승인** — 어떤 confidence에서도 없다. 게시와 같은 원칙: 사람 버튼 하나뿐.
