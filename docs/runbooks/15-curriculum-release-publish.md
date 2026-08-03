# RB-15 · 교육과정 릴리스 발행·원문 대조·차이 계산 (평시 절차)

> 다른 런북과 달리 장애 대응이 아니라 **평시 운영 절차**다.
> 대상: 인수 41(원문 역추적)·43(발행 게이트)·50(릴리스 diff).
> 코드 정본: `packages/db/src/domain/curriculum-release.ts`,
> CLI `pnpm curriculum:release`, 게이트 판정은 core `validateRelease` 한 곳.
> 롤백이 필요한 사고는 [RB-09](./09-curriculum-mapping-rollback.md)로.

---

## 0. 현재 상태 (2026-08-03 기준)

- 릴리스 `KR-MATH-2022` 1 (`00000000-0000-7000-8000-0000000c1003`): **parsed**.
- 발행 게이트 dry-run 실측: 그래프·커버리지·근거 게이트 전부 통과.
  **남은 차단 사유는 사람 원문 대조(verify-source) 하나뿐이다.**
- 데이터 적재는 `pnpm curriculum:collect`가 전부 멱등으로 담당한다
  (성취기준 60 · 개념 매핑 60/60 · 학습 목표·증거 · 수직 계통·표상·오개념).

상태 확인은 언제나 여기서 시작한다:

```
pnpm curriculum:release status
```

소스의 sha256·대조 상태·릴리스 상태·마지막 게이트 리포트가 나온다.
같은 정보가 화면에도 있다: 콘텐츠 → 교육과정 (성취기준 표 아래 발행 게이트 칸).

## 1. 원문 대조 (사람 절차 — 도구가 대신하지 않는다)

무엇을 확인하는 것인가: **DB에 적재된 성취기준 문구가 취득한 고시문 실물과
자구까지 일치하는가.** 파서(HWP 추출)가 잘못 잘랐다면 여기서 잡아야 한다.

1. `pnpm curriculum:release status` 로 저장된 sha256과 원문 URL을 확인한다.
2. 원문 URL(교육부 고시 제2022-33호 붙임)에서 실물을 내려받아 sha256을 직접
   계산한다. PowerShell: `Get-FileHash -Algorithm SHA256 <파일>`.
   압축 안의 `[별책8] 수학과 교육과정.hwp`가 대조 대상이다.
3. 화면(콘텐츠 → 교육과정)의 성취기준 표본 몇 개를 원문과 자구 대조한다.
   기계 검증도 있다 — `curriculum-chain.test.ts`의 자구 일치 표본 테스트.
4. 일치하면 기록한다:

```
pnpm curriculum:release verify-source --checksum <sha256 앞 12자 이상> --by <이메일>
```

- `--checksum` 은 **직접 계산한 값**의 앞자리를 입력한다. 저장값과 다르면
  거부된다 — 이 입력이 "실물을 확인했다"는 최소한의 증거다.
- `--by` 는 users 테이블의 실계정이어야 한다 (대조 책임자 기록).
- 결과: `registered → verified`, reviewed_by 기록,
  audit_events `curriculum.source_verify`.
- 멱등: 이미 verified면 변경 없이 그렇다고 말한다.

## 2. 발행

```
pnpm curriculum:release publish --dry-run            # 게이트만 (리포트 저장)
pnpm curriculum:release publish --by <이메일>         # 실제 전이
```

게이트 (하나라도 실패하면 상태 불변, 리포트만 `validation_report`에 저장):

| 게이트 | 실패 시 조치 |
|---|---|
| 원문 소스 전부 verified | 절차 1 수행 |
| 매핑 커버리지 (성취기준 전부에 활성 매핑) | `middle-math-concept-catalog.mts` 보강 후 `pnpm curriculum:collect` |
| 성취기준 코드 중복 0 | 수집 파서 확인 (DB 유니크가 1차 방어) |
| 강한 선수 순환 0 | 스튜디오 선수 관계에서 순환 경로 확인·간선 수정 |
| 고아 간선 0 (존재하지 않는 개념 참조) | 간선 삭제 또는 개념 복원 |
| 근거 없는 개념 0 (2L 최소 근거) | 개념 evidence 보강 (`collect`의 백필이 카탈로그 개념은 채운다) |
| AI 제안이 active로 위장한 간선 0 | provenance·status 정리 |
| 사용 중(문항·루트)인 폐기 개념 0 | 폐기 전 대체 매핑 |
| kill switch `curriculum_release` 정상 | `pnpm kill-switch resume curriculum_release` |

- 발행은 `parsed·mapped·expert_review·validated → published`만 허용.
  **재발행은 없다** — 변경은 다음 릴리스로 낸다.
- 게시된 루트·평가는 자동 재매핑되지 않는다 (원칙 13,
  `route_versions.curriculum_release_id`가 옛 릴리스를 계속 가리킨다).

## 3. 새 릴리스가 나왔을 때 — 차이 계산과 매핑 이관

새 고시·부분 개정이 나오면: 새 릴리스로 수집(release_number+1) 후,

```
pnpm curriculum:release diff --from <옛 릴리스 uuid> --to <새 릴리스 uuid>
pnpm curriculum:release diff --from … --to … --write-draft --by <이메일>
```

- 판정 7종: 동일·문구 수정·영역 이동·추가·삭제 + 유사도 추정(재코드 1:1 ·
  분할 1→N · 통합 N→1). 유사도 판정은 **후보일 뿐**이다 — `--threshold`
  (기본 0.45)로 민감도 조절.
- `--write-draft` 는 이관 초안을 **status=draft·provenance=imported** 매핑으로만
  저장한다. draft는 발행 게이트 커버리지에도, 자동 계획에도 잡히지 않는다.
  사람이 검토해 active로 승격해야 효력이 생기고, **승격한 행은 재실행이
  건드리지 못한다**.
- 삭제된 기준의 매핑 폐기, 신규 기준의 새 큐레이션은 보고 목록으로만 나온다 —
  자동으로 지우지 않는다.

## 4. 긴급 중지

발행 자체를 막아야 하면:

```
pnpm kill-switch stop curriculum_release --reason "<사유>" --actor <이메일>
```

집행 지점은 발행 전이 딱 하나다 — 릴리스 읽기·그래프 탐색·매핑 검수·
수직 진행 화면은 그대로 동작한다. 이미 발행된 릴리스의 사고는 RB-09.

## 5. 데이터 카탈로그 — 어디를 고치면 무엇이 변하나

전부 `packages/db/scripts/data/`의 사람 큐레이션 파일이고,
`pnpm curriculum:collect` 재실행으로 멱등 반영된다 (stable ID).

| 파일 | 내용 | 늘려야 할 때 |
|---|---|---|
| `middle-math-concept-catalog.mts` | 개념 69 + 성취기준 매핑 (커버리지 60/60) | 새 성취기준·새 개념 |
| `middle-math-objective-catalog.mts` | 학습 목표 14 · 평가 증거 18 (2M — 성공 증거·허용 오류 필수) | 교재 반입으로 문항 잇긴 개념이 늘 때 |
| `middle-math-vertical-catalog.mts` | 수직 계통 간선 15 · 표상 17 · 오개념 11 (인수 45) | 새 계통·오개념 관찰 |

검증 정본: `packages/db/test/curriculum-chain.test.ts`(13건 — 사슬·수직 계통),
`curriculum-release-publish.test.ts`(12건 — 게이트),
`curriculum-release-diff.test.ts`(5건 — diff·초안), core
`curriculum/graph.test.ts`(11건)·`curriculum/diff.test.ts`(12건),
web `blueprint-chain.test.ts`(4건 — 블루프린트 사슬).
