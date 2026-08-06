# ADR-0020 — 콘텐츠는 플랫폼 자산이다

| 항목 | 값 |
|---|---|
| 상태 | **채택됨** (2026-08-05) — 자료는 갈래 **C**(플랫폼 기본 + 조직 덮어쓰기), 구현은 단계별 |
| 결정자 | 수맥 팀 |
| 관련 | [ADR-0003](./0003-tenant-isolation.md) 테넌트 격리 · [ADR-0014](./0014-content-rights-enforcement.md) 사용권 · `packages/db/migrations/0001a_rls_core.sql` |

---

## 맥락

소유자 결정(2026-08-05): **콘텐츠는 조직별이 아니라 DB 전체 자산이고, 마스터 계정만 추가한다. 조직별 콘텐츠는 고려하지 않는다.**

지금 코드는 그 반대다. `0001a_rls_core.sql`이 콘텐츠 표 18개를(+ 뒤에 붙은 `learning_materials`·`concept_blank_sets`) `*_org_isolation` 정책으로 조직에 묶었고, 스키마도 `organization_id`가 NOT NULL이다. 그래서 **새 조직을 만들면 개념만 알고 보여 줄 것이 없다 — 학생 화면이 빈다.** eywa 중1반을 가져올 때 새 조직을 포기하고 데모 조직에 얹은 이유가 이것이다.

### 먼저 못 박아야 할 사실 — RLS는 지금 아무것도 막고 있지 않다

```
current_user = postgres · rolbypassrls = true
```

서버 질의는 전부 이 롤로 나간다(`packages/db/src/client.ts`). **RLS 정책은 한 줄도 평가되지 않는다.** 실제 테넌트 경계는 질의문에 손으로 쓴 `where organization_id = ${...}`이고, RLS는 사용자 access token으로 PostgREST에 직접 붙는 경로를 막는 이중 방어다(eywa 실사고 1번).

이것이 설계를 가른다. **RLS만 고치면 화면은 하나도 안 바뀐다.** 진짜 작업은 질의문이다.

### 실측 (2026-08-05)

| 표 | 행 | 조직 수 |
|---|---:|---:|
| `math_expressions` | 99,590 | 1 |
| `questions` / `question_versions` | 7,980 | **31** |
| `question_alignments` | 7,688 | 3 |
| `content_rights` | 1,070 | 3 |
| `source_pages` | 779 | 1 |
| `learning_materials` | 366 | 1 |
| `books` / `book_editions` | 12 | 1 |
| 나머지 8표 | 0 | — |

조직 31개는 통합 테스트가 문항 1건씩 남긴 것이다(실데이터가 아니다). **실질 콘텐츠는 데모 조직 한 곳에 있다** — 이전이 거의 공짜라는 뜻이다.

콘텐츠를 만지는 코드는 **파일 16개**, 쓰는 곳은 그중 **4개**뿐이다:
`packages/db/src/domain/ingestion.ts` · `packages/ingest/src/load.ts` · `load-materials.ts` · `apps/web/src/app/app/content/materials/actions.ts`.

## 결정 (제안)

### 1. 플랫폼 조직 한 곳을 둔다 — `organization_id`는 nullable로 만들지 않는다

`workspace_kind` enum에 `platform`을 더하고, 그런 행이 **정확히 하나만** 있게 부분 유니크 인덱스로 막는다. 콘텐츠 행의 `organization_id`는 늘 이 조직을 가리킨다.

```sql
alter type workspace_kind add value 'platform';
create unique index organizations_single_platform
  on organizations ((kind)) where kind = 'platform';

create or replace function public.platform_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from organizations where kind = 'platform' limit 1
$$;
```

**함정 — enum 값은 더한 트랜잭션 안에서 쓸 수 없다.** `migrate.ts:41`이 마이그레이션 하나를 `sql.begin`으로 감싸는데, PostgreSQL 17.6은 같은 트랜잭션에서 새 enum 값을 쓰면 거부한다. 실측:

```
alter type workspace_kind add value 'platform';
select 'platform'::workspace_kind;
→ ERROR: unsafe use of new value "platform" of enum type workspace_kind
```

그래서 **마이그레이션을 둘로 쪼갠다** — 앞 파일이 값만 더하고, 뒤 파일이 플랫폼 조직 행을 만든다. 한 파일에 몰면 배포가 그 자리에서 죽는다. (enum을 안 쓰고 `organizations`에 표시 열을 두는 길도 있지만, `kind`가 이미 「이 워크스페이스가 무엇인가」를 답하는 자리라 값을 하나 더하는 편이 맞다.)

**`organization_id`를 nullable로 만들지 않는 이유**는 되돌릴 수 없어서다. NOT NULL을 풀면 유니크 인덱스·FK·`group by`가 전부 NULL 의미론을 타고, 그 뒤에 「역시 조직별이 필요하네」가 되면 되돌릴 길이 없다. 플랫폼 조직은 그냥 조직이라 기존 FK·인덱스·감사 로그가 **한 줄도 바뀌지 않는다.**

### 2. 콘텐츠 표 19개를 옮긴다 — 나머지는 그대로

| 옮긴다 (플랫폼) | 남는다 (조직) |
|---|---|
| `publishers` `books` `book_editions` | `learners` `learning_groups` `sessions` |
| `source_files` `source_pages` | `route_*` `assessment_*` `attempts` `responses` |
| `questions` `question_versions` `question_alignments` | `grade_decisions` `mastery_*` `review_items` |
| `math_expressions` `math_normalization_runs` `math_render_artifacts` | `notifications` `reports` `import_jobs` |
| `formula_reviews` `diagram_assets` `question_assets` | `document_exports` — **조직의 출력물**이지 콘텐츠가 아니다 |
| `duplicate_groups` `content_reviews` `content_rights` | |
| `learning_materials` `concept_blank_sets` | |

학습자 쪽 표는 콘텐츠를 **id로** 가리킨다(`assessment_questions.question_version_id`, `responses` 등). 조직이 달라져도 FK는 그대로 성립한다 — 옮기는 데 학습 기록을 건드릴 일이 없다.

### 3. 읽기는 질의가, 쓰기는 역할이 가른다

**읽기** — 콘텐츠 질의의 `organization_id = ${orgId}`를 `= any(${contentOrganizationIds(orgId)}::uuid[])`로 바꾼다. 도우미는 `packages/db/src/content-org.ts` 한 곳에 있고 18개 파일이 그것만 부른다.

**쓰기** — 플랫폼 조직에 `content_manager`(또는 `owner`) 멤버십이 있는 계정만. 지금 4곳의 쓰기가 `user.organizationId`를 쓰고 있으니 여기를 `contentWriteOrganizationId()` + 권한 검사로 바꾼다.

**RLS**는 이중 방어를 유지하되 같은 규칙을 새긴다 — 읽기는 열고, 쓰기는 막는다.

```sql
create policy <t>_platform_read on public.<t> for select to authenticated
  using (organization_id = platform_org_id()
         or organization_id in (select auth_org_ids()));

create policy <t>_platform_write on public.<t> as restrictive for all to authenticated
  using (organization_id <> platform_org_id() or public.is_content_master())
  with check (organization_id <> platform_org_id() or public.is_content_master());
```

기존 `*_staff_only` RESTRICTIVE(학생 차단) 6개는 **그대로 둔다.** 학생이 문항 원본을 직접 긁는 경로는 계속 막혀 있어야 한다.

### 4. 이전은 한 문장씩

```sql
update questions set organization_id = platform_org_id()
where organization_id = '<데모 조직>';
```

표 19개에 같은 문장을 돌린다. 테스트 조직 30곳이 남긴 문항 1건씩은 **옮기지 않는다** — 테스트 잔여물이고, 옮기면 플랫폼 콘텐츠가 더러워진다. `purge:test-data`가 걷어 간다.

## 이 결정이 건드리는 제품 표면 — **소유자 판단이 필요한 지점**

### ① 교사의 자료 저작이 사라진다

지금 교사는 `/app/content/materials`에서 설명·인강·연습 자료를 **직접 만든다**(`createMaterialAction`, 권한 `canWrite(matrix, role, "materials")`). E2E가 그 왕복을 통째로 덮고 있다(`materials.spec.ts` — 저작 → 고치기 → 게시 → 학생이 본다).

「마스터만 콘텐츠를 추가한다」를 글자대로 적용하면 이 화면은 교사에게서 사라진다. 갈래는 셋이다.

| 갈래 | 뜻 | 대가 |
|---|---|---|
| **A. 전부 마스터** | 자료도 문항도 마스터만 | 교사가 자기 반에 맞춘 설명을 못 붙인다. 학원마다 다른 설명이 필요할 때 본사에 요청해야 한다 |
| **B. 문항은 플랫폼, 자료는 조직** | 교재 문항은 공용, 설명·인강은 학원이 만든다 | 「조직별 콘텐츠 없음」과 어긋난다. 자료가 두 곳에 산다 |
| **C. 플랫폼이 기본, 조직이 덮어쓰기** | 마스터 자료를 모두가 보고, 학원이 같은 개념에 자기 자료를 더하면 그것이 우선 | 가장 유연하지만 우선순위 규칙과 화면이 하나 더 필요하다 |

지금 코드는 B에 가깝고(자료는 조직), 결정문은 A다.

**결정: C.** 교사의 저작 화면을 살리면서 공용 자산도 얻는다.

**덮어쓰기 단위는 (개념, 종류)다.** `learning_material_kind`가 `reading`·`video`·`practice` 셋뿐이라, 규칙을 한 문장으로 말할 수 있다:

> **한 개념의 한 종류에 우리 학원 자료가 하나라도 게시돼 있으면, 그 개념·그 종류는 우리 것만 보인다.**

개념 「소인수분해」의 설명을 학원이 직접 썼다면 플랫폼 설명은 가려지고, 인강·연습은 그대로 플랫폼 것을 쓴다. 「우리 설명을 쓰겠다」는 교사의 의도와 정확히 같은 모양이다.

자료 **한 건씩** 가리키는 덮어쓰기(`overrides_material_id`)도 가능하지만 지금은 안 한다 — 화면이 하나 더 필요하고, 교사가 정말 원하는 것은 「이 개념 설명은 우리 것」이지 「플랫폼의 3번 자료 대신 이것」이 아니다. 필요해지면 그때 좁힌다.

읽기 질의는 이렇게 된다.

```sql
select … from learning_materials m
where m.concept_id = any($concepts) and m.status = 'published'
  and m.organization_id in ($org, $platform)
  and (m.organization_id = $org
       or not exists (            -- 우리 것이 있으면 플랫폼 것은 가린다
         select 1 from learning_materials mine
         where mine.organization_id = $org and mine.concept_id = m.concept_id
           and mine.kind = m.kind and mine.status = 'published'))
```

**화면은 출처를 밝힌다.** 교사 자료 목록에서 플랫폼 자료는 읽기 전용이고 「공용」 표시가 붙는다. 표시가 없으면 교사가 남의 자료를 고치려다 못 고치는 일이 생긴다.

### ② 사용권이 조직마다 다를 수 있다

`content_rights.allowed_scope`가 이미 있다. 개념원리를 A학원은 쓸 수 있고 B학원은 못 쓰는 상황이 생기면, 플랫폼 콘텐츠에 **조직별 게이트**가 필요하다. 지금은 학원이 하나라 미룰 수 있지만, 미루는 결정임을 적어 둔다.

### ③ 검수도 마스터의 일이 된다

`content_reviews`·`formula_reviews`가 플랫폼으로 가면 검수 화면도 마스터 전용이다. 교사가 오탈자를 발견해도 고칠 수 없고 **신고할 곳이 필요하다** — 지금 그런 경로가 없다.

## 대안과 기각 이유

**`organization_id`를 nullable로 (null = 플랫폼)** — 되돌릴 수 없다. 위 1절.

**콘텐츠를 조직마다 복사** — 방향과 정반대다. 같은 문항이 학원 수만큼 늘고, 하나를 고치면 전부를 고쳐야 한다.

**뷰로 가린다 (`create view questions_visible as …`)** — 질의를 안 고쳐도 되지만, 쓰기 경로가 뷰를 우회하고 드리즐 타입이 뷰를 모른다. 고칠 곳을 줄이는 대신 「어디가 진짜인지」가 흐려진다.

## 검증 계획

| | 무엇을 | 어떻게 |
|---|---|---|
| V-1 | 새 조직이 콘텐츠를 본다 | 빈 조직 하나 만들고 학생 하루가 자료·연습까지 채워지는지 (자율 E2E 재사용) |
| V-2 | 마스터 아닌 계정은 콘텐츠를 못 쓴다 | `set local role authenticated` + 교사 JWT로 insert 시도 → 0행 |
| V-3 | 학생은 문항 원본을 못 읽는다 | 기존 `*_staff_only` 회귀 (rls-isolation.test.ts) |
| V-4 | 학습 기록이 끊기지 않는다 | 이전 전후 `verify:recovery` 31건 0위반 |
| V-5 | 조직 purge가 플랫폼 콘텐츠를 안 지운다 | `purge:test-data` 후 문항 수 불변 |

## 단계 — 각 단계가 **혼자서도 배포 가능**해야 한다

순서를 잘못 잡으면 중간에 앱이 빈다. 「플랫폼 조직 만들고 데이터를 옮긴다」를 먼저 하면, 질의는 아직 데모 조직을 보고 있으므로 **그 배포의 순간 문항도 자료도 0건이 된다.** 옮기는 일과 보는 곳을 바꾸는 일은 **같은 배포**에 있어야 한다.

그래서 교살자(strangler) 순서로 간다 — 먼저 통로를 만들고, 통로가 제자리를 가리키게 해 두고, 마지막에 내용물을 옮긴다.

| 단계 | 내용 | 혼자 배포하면? |
|---|---|---|
| **1** | `platform` kind 추가 (마이그레이션 A) → 플랫폼 조직 1행 + `platform_org_id()` (마이그레이션 B, **별도 파일**) | 아무 동작도 안 바뀐다. 아무도 이 조직을 안 본다 |
| **2** | `contentOrganizationIds()` 도입 + 콘텐츠 읽기 16곳을 이 도우미로. **깃발은 꺼 둔다** | 동작 동일 — 깃발이 꺼져 있으면 자기 조직만 담은 배열이라 생성되는 SQL이 지금과 같다 |
| **3** | 콘텐츠 19표 이전 **+** 깃발 켜기 **+** 쓰기 4곳과 「쓰기 권한 확인용 조회」 13곳을 `contentWriteOrganizationId()`로 — **한 배포에** | 여기서 실제로 갈린다. 되돌리기는 반대 방향 update 한 문장 + 깃발 끄기 |
| **4** | 자료 읽기에 덮어쓰기 규칙(개념·종류) + 화면의 「공용」 표시 | 조직 자료가 아직 없으니 동작 동일 |
| **5** | 쓰기 4곳에 마스터 게이트 · RLS 정책 교체 | 이중 방어가 질의와 같은 말을 하게 된다 |
| **6** | purge·시드·E2E 픽스처가 플랫폼을 건드리지 않게 | — |
| **7** | V-1~V-5 | — |

2단계가 요점이다. **값이 바뀌지 않는 리팩터링을 먼저 끝내 두면**, 진짜 전환(3단계)이 「update 18문장 + 깃발 하나」로 줄어든다. 그 크기라야 되돌릴 수 있다.

도우미는 **단일 id가 아니라 목록**을 낸다. 깃발이 꺼져 있는 동안 지금과 같은 SQL이 나와야 하기 때문이다.

```ts
/** 콘텐츠를 읽을 때 볼 조직. 깃발이 켜지면 플랫폼이 더해진다. */
export function contentOrganizationIds(organizationId: string): string[] {
  return PLATFORM_CONTENT ? [organizationId, PLATFORM_ORG_ID] : [organizationId];
}
//  where q.organization_id = any(${contentOrganizationIds(orgId)}::uuid[])
```

단일 id를 돌려주는 형태(`contentOrganizationId()`)로 하면 2단계가 **무동작이 아니게 된다** — 통합 테스트가 만든 조직 30곳은 자기 콘텐츠를 만들어 자기가 읽는데, 읽는 곳을 데모 조직으로 바꾸면 그 테스트들이 그 자리에서 깨진다. 목록 형태는 깃발이 켜진 뒤에도 그 조직들을 살려 둔다.

**일괄 치환은 금지다.** 한 파일 안에 콘텐츠 필터와 학습자 데이터 필터가 섞여 있다 — `learning-material.ts` 하나에도 `learning_materials`(콘텐츠)와 `learner_material_progress`(학습자 기록)가 같은 `input.organizationId`를 쓴다. 학습자 기록까지 플랫폼을 보게 만들면 **한 학원의 진도가 다른 학원에 보인다.** 줄마다 어느 쪽인지 판단해야 한다.

기계로 표를 알아내려다 두 번 다른 답이 나왔다(55곳 → 30곳). 별칭이 문제다 — `where r.organization_id`의 `r`이 `review_items`인지 `content_rights`인지는 앞쪽 `from`/`join`을 별칭까지 풀어야 알 수 있고, 중간의 `join`이 `from`을 가리기도 한다. **손으로 확인한 목록만 믿는다.**

### 읽기와 「쓰기 권한 확인용 조회」를 가른다

같은 `select`라도 **결과가 update·delete의 근거가 되는 것**은 2단계에서 건드리지 않는다.

```ts
// 읽기 — 넓힌다
select … from learning_materials where organization_id = any($contentOrgs)

// 쓰기 권한 확인 — 그대로 둔다
select id from learning_materials where id = $1 and organization_id = $myOrg
update learning_materials set … where id = $1 and organization_id = $myOrg
```

넓히면 **교사가 플랫폼 자료를 고칠 수 있게 된다.** 갈래 C는 「플랫폼 자료는 조직에게 읽기 전용」이 전제다. 이런 자리가 13곳이었다(자료 수정·상태 변경 5, 사용권 차단 1, 반입 중복 검사 7). 전부 쓰기와 **같은 배포**에서 옮긴다.

되돌리기(3단계 이후): `update <t> set organization_id = '<데모 조직>' where organization_id = platform_org_id()` 18문장 + 상수 원복. 학습 기록은 콘텐츠를 id로 가리키므로 어느 방향이든 끊기지 않는다.

---

## 실행 기록 — 4·6·7단계 (2026-08-05)

### 4단계 — 덮어쓰기 규칙과 「공용」

규칙은 `hideOverriddenMaterials`(`@su-maek/core/learning`) 한 곳에 있고 학생 목록과 교사 준비도가 같은 함수를 부른다. 화면 쪽은 **표시만으로는 모자랐다**: 목록에 「공용」 배지를 달아 두어도 게시·보관 버튼이 그대로 붙어 있었고, 상세를 열면 고치기 폼까지 그대로였다. 둘 다 쓰기 액션이 `organization_id`로 좁혀 있어 **눌러도 아무 일이 일어나지 않는다.** 그래서 공용 자료에는 버튼을 두지 않고, 상세는 「공용 자료입니다」와 함께 **무엇을 하면 되는지**(같은 개념·같은 종류로 우리 자료 만들기)를 낸다.

E2E 「자료 왕복」이 오래 빨간불이었는데, 원인은 이 작업도 플랫폼 콘텐츠도 아니었다 — **수화(hydration) 경합**이었다. 만들기 폼의 개념·종류가 controlled select라, 자바스크립트가 붙기 전에 고른 값을 React가 수화 직후 초기값으로 되돌렸다. 화면에는 「가감법·개념 인강」이 보이는데 상태는 비어 있어 required 셀렉트가 제출을 막고, **토스트도 오류도 뜨지 않았다.** 커밋 전에 DOM 값을 훔쳐 두었다가 마운트 직후 상태로 받아들이게 고쳤다(`MaterialForms.tsx`의 `preHydration`).

경합이라 왕복 스펙은 실행마다 결과가 달랐다(변이 검증에서 고치기 전에도 통과했다). 그래서 **창을 일부러 만드는 스펙**을 따로 뒀다 — 청크를 2.5초 늦춰 수화 전 상태를 붙들고 그 사이에 고른 값이 살아남는지 본다. 이 스펙은 고치기 전 실패·고친 뒤 통과가 확인됐다.

### 6단계 — 정리·시드·픽스처

- `purgeTestData`도 플랫폼 조직을 거부한다(`purgeOrganizationRows`에 이어). `--org=`로 아무 조직이나 넘길 수 있고, 이 함수는 **이름 규칙**으로 고르기 때문이다 — 공용 자료 하나가 언젠가 「E2E자료-」로 시작하면 모든 학원이 함께 보는 자료가 조용히 사라진다. dry-run도 막는다.
- `db:seed`가 콘텐츠(사용권·문항·버전·정렬·자료)를 **플랫폼에** 쓴다. 조직에 쓰면 빈 DB에 시드만 돌린 상태에서 플랫폼이 비어 새 학원의 학생 화면이 그대로 빈다(V-1이 잡는 상태). 학습자·반·루트는 그대로 조직이다.
- `seed-unit1-demo`가 콘텐츠를 `contentOrganizationIds`로 찾는다. 조직 id로 찾고 있어서 **정제본 0건**을 보고 아무것도 게시하지 않고 있었다 — 반입이 만든 자료는 이미 플랫폼에 있었다.

### 7단계 — V-1~V-5가 실제로 어디서 도는가

| | 어디서 | 비고 |
|---|---|---|
| V-1 · V-1′ | `packages/db/test/platform-content.test.ts` | 새 조직이 공용 문항·자료를 본다 / 도우미 없이는 0건 |
| V-2 | 같은 파일 | 롤을 낮춰 잰다. 같은 삽입이 소유자 롤로는 되는 것까지 확인 |
| V-3 | `packages/db/test/rls-isolation.test.ts` | **플랫폼** 문항으로 잰다. 조직 문항으로 재면 조직 격리가 먼저 막아 false-green이 된다. 교사는 같은 행을 본다는 것도 함께 |
| V-4 | `pnpm verify:recovery` | 31건 0위반 (이전 전후) |
| V-5 | `platform-content.test.ts` | purge가 플랫폼을 건드리지 못한다 |

### 이전은 「옮기기」가 아니라 **재적재**로 끝났다 (2026-08-06)

옮기려 하면 유니크 인덱스에 걸린다. 실측:

| 표 | 열쇠 | 부딪히는 행 |
|---|---|---|
| `publishers` | `(organization_id, name)` | 1 (개념원리) |
| `source_files` | `(organization_id, checksum)` | 6 (**같은 PDF를 두 번 반입했다**) |

스크립트가 여기서 멈춘 것이 결과적으로 옳았다. 같은 교재가 두 벌이라는 뜻이고, 어느 쪽을 정본으로 둘지는 스크립트가 아니라 사람이 정할 일이다. **선택된 답은 이전이 아니라 재적재였다**: `load`가 이미 `contentWriteOrganizationId`로 쓰므로 플랫폼에 새로 적재한 뒤 데모 사본을 `delete-ingested --org=<데모>`로 지웠다(병행 세션, 2026-08-06). 순서를 뒤집으면 중간에 콘텐츠가 비는 구간이 생긴다.

지금 상태(실측):

| | 플랫폼 | 데모 |
|---|---:|---:|
| 문항 | 7,135 | 66 (통합 테스트 잔재) |
| `source_files` · 지면 | 17 · 779 (문항 6,161이 가리킴) | 6 · 757 (**가리키는 문항 0**) |
| 교재·판·출판사 | 12 · 12 · 1 | 6 · 6 · 1 (문항 0) |

데모 쪽에 남은 교재·지면 행은 **죽은 껍데기**다 — 어떤 문항도 가리키지 않는다. 지워도 되지만 급하지 않고, 지운다면 그 판단은 사람의 것이다. 테스트 잔재(문항 66·사용권 59)는 `purge:test-data`가 맡는다.

**이 결말이 남긴 교훈**은 스크립트에 남아 있다: 이전 도구는 부딪히면 멈추고 무엇이 부딪히는지 표로 낸다. 조용히 절반만 옮기는 것보다, 사람에게 선택지를 보여 주고 멈추는 편이 낫다.

### 도구가 콘텐츠를 조직 id로 찾던 자리 — 아홉 곳 (2026-08-05 고침)

`seed-unit1-demo`가 이미 그 상태였다 — 정제본 0건을 보고 아무것도 게시하지 않고 있었다. 예외도 오류도 없이 「할 일이 없습니다」로 보이는 것이 이 결함의 모양이다. 지금은 콘텐츠가 아직 데모 조직에 있어 동작하지만, 병합이 끝나는 순간 전부 조용히 0건이 된다. 그래서 병합을 기다리지 않고 먼저 고쳤다.

읽기는 `contentOrganizationIds(org)`로 넓히고, **쓰기는 그 행이 실제로 사는 조직**으로 한다(`row.organization_id`). 감사·예산·이벤트는 그대로 조직이다 — 승인한 것은 사람이고 그 사람은 학원에 속한다.

| 도구 | 무엇이 바뀌었나 | 확인 |
|---|---|---|
| `approve-ingested` | 반입본 현황·승인·검수 해소·사용권 승격을 플랫폼 포함으로. 헤더에 대상 조직을 밝힌다 | `--dry` — 승인 대상 5,518건(수식 격리 633건 제외)을 본다 |
| `audit-katex` | 수식 렌더 감사 대상 | 실행 — 렌더 실패 2건 |
| `figure-census` | 그림·표 조사 대상 | 실행 — 그림 문항 1,752개(6권 전체) |
| `verify-templates` | 템플릿 재현 검증 대상 | 실행 — 재현 실패 2건 |
| `variants` | 변형 생성 대상 | 실행 — 변형 96개·거부 10건 |
| `suggest-alignments` | 미정렬 탐지(읽기)와 정렬 행 기록(쓰기) | `--report` — 문항 7,201건 · 미정렬 1,042 |
| `review-alignments` | 미검수 제안 조회·승인·반려 | `--list` — 0건 |
| `refine-concepts` | 추출본 조회(읽기), 정제본은 **원본이 사는 곳에** | 타입 검사만 — API 키가 있어야 도는 경로다 |
| `delete-ingested` | (삭제 범위는 그대로 조직) 플랫폼을 이름으로 부르고, 대상이 0인데 플랫폼에 있으면 그 사실과 `--org=` 사용법을 말한다 | 코드 검토 |

`delete-ingested`의 **삭제 범위는 일부러 안 넓혔다.** 파괴적인 도구가 한 번에 두 조직을 지우게 만드는 것이 앞선 사고의 모양이었다. 대신 「여기엔 없고 플랫폼에 있다」를 말한다 — 조용한 0이 사람을 헤매게 하는 자리다.
