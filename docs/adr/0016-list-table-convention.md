# ADR-0016 — 목록 화면 표 규약 (정렬·필터·페이지네이션·행 링크)

| 항목 | 값 |
|---|---|
| 상태 | **채택됨** (2026-08-01) |
| 결정자 | 수맥 팀 |
| 관련 | `apps/web/src/components/DataTable.tsx` · `apps/web/src/lib/table.ts` · `apps/web/test/ui/list-table.test.ts` |

---

## 맥락

목록 화면이 화면마다 제각각이었다. 어떤 곳은 `<ul>` 카드, 어떤 곳은 표, 어떤 곳은 링크가 아예 없었다. 세 가지 실제 문제가 나왔다.

1. **클릭이 안 되는 목록** — `/app/today`의 "운영 중인 반" 카드는 `<li>`에 링크가 없어서 눌러도 아무 일이 없었다. 표시만 하고 이동은 못 하는 UI가 배포돼 있었다.
2. **정렬·필터 부재** — 반 30개, 문항 29개가 이름순 고정으로 한 번에 쏟아졌다. E2E 잔여 데이터가 섞이면 원하는 행을 찾을 수 없다.
3. **바깥 스크롤** — 전체 목록을 한 쪽에 그려 페이지가 길게 늘어졌다.

## 결정

`/app` 하위에서 **목록을 그리는 모든 화면은 공통 표 규약을 쓴다.** 탐색기의 '자세히' 보기와 같은 형태다.

### 구성 요소

| 파일 | 역할 |
|---|---|
| `lib/table.ts` | `parseTableQuery` — 검색 파라미터 해석·검증, `sortHref`/`tableHref` 링크 생성, `pageWindow` |
| `components/DataTable.tsx` | 정렬 가능한 열 머리, 행 전체 링크, 쪽 이동 |
| `components/TableFilters.tsx` | 검색어·선택 필터 (GET 폼) |

### 규칙

1. 페이지는 `{ searchParams }: { searchParams: Promise<RawSearchParams> }`를 받는다.
2. 정렬·필터·쪽은 **URL 파라미터**다. JS 없이 링크·GET 폼으로 동작하고, 뒤로 가기가 이전 상태로 돌아가며, URL을 그대로 공유할 수 있다.
3. 정렬 키는 `SORT_COLUMN` 화이트리스트를 통과한 것만 SQL에 닿는다. 사용자 입력이 `ORDER BY`에 직접 들어가지 않는다.
4. 집계는 한 번의 질의로 — `with base as (...)` + `select *, count(*) over ()::int as total_count` + `limit/offset`.
5. 한 쪽 행 수는 `DEFAULT_PAGE_SIZE`(10), 한 줄짜리 조밀한 표는 `DENSE_PAGE_SIZE`(15). **바깥 스크롤이 생기지 않는 범위**를 넘기지 않는다.
6. 상세 라우트가 있는 목록은 `rowHref`를 반드시 준다. 행 전체가 클릭되고, 탭 정지는 행당 하나다(첫 칸 링크를 `after:absolute inset-0`로 늘린다).
7. 상세 라우트가 없으면 `rowHref`를 주지 않는다 — 없는 경로로 링크를 걸지 않는다.

### 행 안의 액션은 결과를 알림으로 띄운다

행 안에 있는 버튼(일정 실체화, 사용권 중지 등)의 결과 문구를 **그 자리에 그리면 행 높이가 늘어나 표가 출렁인다.** `components/ActionToast.tsx`를 쓴다 — `position: fixed`라 레이아웃 흐름에서 빠져 행 높이가 그대로이고, DOM 트리에서는 여전히 그 행의 자손이라 E2E의 행 스코프 조회(`row.getByRole("status")`)도 그대로 동작한다. 6초 후 자동으로 사라지되 마우스를 올리면 멈춘다.

### E2E는 행을 헬퍼로 찾는다

표 전환으로 `page.locator("li")` 기반 스펙이 조용히 0건을 잡게 됐다. `e2e/lib/table.ts`를 쓴다.

| 헬퍼 | 쓰는 경우 |
|---|---|
| `tableRow(page, text)` | 표 본문에서 행 찾기. **필터 `<select>`의 `<option>`이 `getByText`에 먼저 걸리는 문제를 피하는 기본 수단** |
| `tableRowIn(scope, text)` | 한 화면에 표가 둘 이상일 때 |
| `gotoTableRow(page, path, q, text?)` | **페이지네이션에 밀릴 수 있는 대상** — `?q=`로 좁힌 뒤 잡는다 |

단언도 함께 봐야 한다 — `"v1 게시됨 · 노드 6개"`처럼 한 줄이던 문구가 표에서는 칸으로 쪼개져 `"게시됨"`, `"6개"`가 된다.

### 함정

- **enum 컬럼 필터는 양쪽 다 `::text` 캐스팅**한다. `status = ''`는 `invalid input value for enum`으로 런타임 500이 난다.
  ```sql
  and (${filter}::text = '' or g.status::text = ${filter})
  ```
- 정렬 대상은 base CTE의 **출력 별칭**이어야 한다.

## 결과

- 기준 구현: `apps/web/src/app/app/classes/page.tsx`. 새 목록은 이 파일을 열고 그대로 따른다.
- 회귀 검사: `apps/web/test/ui/list-table.test.ts`가 목록 화면의 `DataTable`·`parseTableQuery`·`rowHref` 존재와 쪽 크기 상한을 소스 수준에서 검사한다. **새 목록 화면을 추가하면 이 테스트의 `LIST_PAGES`에도 추가한다.**
- 권한 게이트(`requireAccess`)는 표 규약과 무관하게 페이지 첫 줄에 그대로 남는다 — `apps/web/test/authz/read-gate.test.ts`가 검사한다.
