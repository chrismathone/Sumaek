# ADR-0020 — 콘텐츠는 플랫폼 자산이다 (초안)

| 항목 | 값 |
|---|---|
| 상태 | **초안** — 소유자 결정 대기 (2026-08-05) |
| 결정자 | 수맥 팀 |
| 관련 | [ADR-0003](./0003-tenant-isolation.md) 테넌트 격리 · [ADR-0014](./0014-content-rights-enforcement.md) 사용권 · `packages/db/migrations/0001a_rls_core.sql` |

---

## 맥락

소유자 결정(2026-08-05): **콘텐츠는 조직별이 아니라 DB 전체 자산이고, 마스터 계정만 추가한다. 조직별 콘텐츠는 고려하지 않는다.**

지금 코드는 그 반대다. `0001a_rls_core.sql`이 콘텐츠 표 18개를 `*_org_isolation` 정책으로 조직에 묶었고, 스키마도 `organization_id`가 NOT NULL이다. 그래서 **새 조직을 만들면 개념만 알고 보여 줄 것이 없다 — 학생 화면이 빈다.** eywa 중1반을 가져올 때 새 조직을 포기하고 데모 조직에 얹은 이유가 이것이다.

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

### 2. 콘텐츠 표 18개를 옮긴다 — 나머지는 그대로

| 옮긴다 (플랫폼) | 남는다 (조직) |
|---|---|
| `publishers` `books` `book_editions` | `learners` `learning_groups` `sessions` |
| `source_files` `source_pages` | `route_*` `assessment_*` `attempts` `responses` |
| `questions` `question_versions` `question_alignments` | `grade_decisions` `mastery_*` `review_items` |
| `math_expressions` `math_normalization_runs` `math_render_artifacts` | `notifications` `reports` `import_jobs` |
| `formula_reviews` `diagram_assets` `question_assets` | `document_exports` — **조직의 출력물**이지 콘텐츠가 아니다 |
| `duplicate_groups` `content_reviews` `content_rights` | |
| `learning_materials` | |

학습자 쪽 표는 콘텐츠를 **id로** 가리킨다(`assessment_questions.question_version_id`, `responses` 등). 조직이 달라져도 FK는 그대로 성립한다 — 옮기는 데 학습 기록을 건드릴 일이 없다.

### 3. 읽기는 질의가, 쓰기는 역할이 가른다

**읽기** — 콘텐츠 질의의 `organization_id = ${orgId}`를 `= ${contentOrgId()}`로 바꾼다. 도우미 하나를 두고 16개 파일이 그것만 부른다.

```ts
/** 콘텐츠가 사는 곳. 학습자 데이터의 organizationId와 절대 섞지 않는다. */
export function contentOrganizationId(): string
```

**쓰기** — 플랫폼 조직에 `content_manager`(또는 `owner`) 멤버십이 있는 계정만. 지금 4곳의 쓰기가 `user.organizationId`를 쓰고 있으니 여기를 `contentOrganizationId()` + 권한 검사로 바꾼다.

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

표 18개에 같은 문장을 돌린다. 테스트 조직 30곳이 남긴 문항 1건씩은 **옮기지 않는다** — 테스트 잔여물이고, 옮기면 플랫폼 콘텐츠가 더러워진다. `purge:test-data`가 걷어 간다.

## 이 결정이 건드리는 제품 표면 — **소유자 판단이 필요한 지점**

### ① 교사의 자료 저작이 사라진다

지금 교사는 `/app/content/materials`에서 설명·인강·연습 자료를 **직접 만든다**(`createMaterialAction`, 권한 `canWrite(matrix, role, "materials")`). E2E가 그 왕복을 통째로 덮고 있다(`materials.spec.ts` — 저작 → 고치기 → 게시 → 학생이 본다).

「마스터만 콘텐츠를 추가한다」를 글자대로 적용하면 이 화면은 교사에게서 사라진다. 갈래는 셋이다.

| 갈래 | 뜻 | 대가 |
|---|---|---|
| **A. 전부 마스터** | 자료도 문항도 마스터만 | 교사가 자기 반에 맞춘 설명을 못 붙인다. 학원마다 다른 설명이 필요할 때 본사에 요청해야 한다 |
| **B. 문항은 플랫폼, 자료는 조직** | 교재 문항은 공용, 설명·인강은 학원이 만든다 | 「조직별 콘텐츠 없음」과 어긋난다. 자료가 두 곳에 산다 |
| **C. 플랫폼이 기본, 조직이 덮어쓰기** | 마스터 자료를 모두가 보고, 학원이 같은 개념에 자기 자료를 더하면 그것이 우선 | 가장 유연하지만 우선순위 규칙과 화면이 하나 더 필요하다 |

지금 코드는 B에 가깝고(자료는 조직), 결정문은 A다. **C가 대개 학원 SaaS가 도달하는 자리**지만 지금 필요한지는 판단이 필요하다.

### ② 사용권이 조직마다 다를 수 있다

`content_rights.allowed_scope`가 이미 있다. 개념원리를 A학원은 쓸 수 있고 B학원은 못 쓰는 상황이 생기면, 플랫폼 콘텐츠에 **조직별 게이트**가 필요하다. 지금은 학원이 하나라 미룰 수 있지만, 미루는 결정임을 적어 둔다.

### ③ 검수도 마스터의 일이 된다

`content_reviews`·`formula_reviews`가 플랫폼으로 가면 검수 화면도 마스터 전용이다. 교사가 오탈자를 발견해도 고칠 수 없고 **신고할 곳이 필요하다** — 지금 그런 경로가 없다.

## 대안과 기각 이유

**`organization_id`를 nullable로 (null = 플랫폼)** — 되돌릴 수 없다. 위 1절.

**콘텐츠를 조직마다 복사** — 방향과 정반대다. 같은 문항이 학원 수만큼 늘고, 하나를 고치면 전부를 고쳐야 한다.

**뷰로 가린다 (`create view questions_visible as …`)** — 질의 16곳을 안 고쳐도 되지만, 쓰기 경로가 뷰를 우회하고 드리즐 타입이 뷰를 모른다. 고칠 곳을 줄이는 대신 「어디가 진짜인지」가 흐려진다.

## 검증 계획

| | 무엇을 | 어떻게 |
|---|---|---|
| V-1 | 새 조직이 콘텐츠를 본다 | 빈 조직 하나 만들고 학생 하루가 자료·연습까지 채워지는지 (자율 E2E 재사용) |
| V-2 | 마스터 아닌 계정은 콘텐츠를 못 쓴다 | `set local role authenticated` + 교사 JWT로 insert 시도 → 0행 |
| V-3 | 학생은 문항 원본을 못 읽는다 | 기존 `*_staff_only` 회귀 (rls-isolation.test.ts) |
| V-4 | 학습 기록이 끊기지 않는다 | 이전 전후 `verify:recovery` 31건 0위반 |
| V-5 | 조직 purge가 플랫폼 콘텐츠를 안 지운다 | `purge:test-data` 후 문항 수 불변 |

## 작업 크기

| 단계 | 내용 | 파일 |
|---|---|---|
| 1 | `platform` kind + `platform_org_id()` + 플랫폼 조직 1행 | 마이그레이션 1 |
| 2 | 콘텐츠 18표 이전 | 마이그레이션 1 |
| 3 | `contentOrganizationId()` 도입 + 읽기 질의 전환 | 16 |
| 4 | 쓰기 4곳에 마스터 권한 게이트 | 4 |
| 5 | RLS 정책 교체(읽기 개방 · 쓰기 제한) | 마이그레이션 1 |
| 6 | purge·시드·E2E 픽스처가 플랫폼을 건드리지 않게 | 4~6 |
| 7 | V-1~V-5 | 테스트 3~4 |

**①의 갈래(A/B/C)가 정해지기 전에는 3~4단계를 시작할 수 없다** — 자료가 어디 사는지가 질의를 가른다.
