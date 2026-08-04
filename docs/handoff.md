# 인수인계 — 교재 반입(ingest) 작업

> **이 문서의 존재 이유는 「다음 사람이 처음부터 다시 알아내지 않게」다.**
> 작성 2026-08-03 · 대상 커밋 `a41621e` (main 병합 전 기준)
> 다루는 범위: `packages/ingest`(교재 PDF → 문제은행) + `packages/core/src/variants`(숫자 변형)
> **저장소 전체를 처음 여는 것이라면 [handoff-project.md](handoff-project.md)부터.** 이 문서는 반입 한 갈래다.
> 관련: [../packages/ingest/README.md](../packages/ingest/README.md) · [./acceptance-status.md](./acceptance-status.md) · [./phase0/decisions.md](./phase0/decisions.md)

여기 적힌 수치·경로·명령은 전부 저장소에서 실측한 것이다. 확인하지 않은 것은
「확인 안 함」이라고 적었다. **없는 것을 있다고 적지 않는다** — 이 저장소의
문서 관례([acceptance-status.md](./acceptance-status.md))를 따른다.

---

## 1. 지금 어디까지 됐나

**중학 다섯 권**이 문제은행에 들어가 있다(2026-08-05). RPM 중1-1·중2-1·중2-2·
중3-1·중3-2 문항 5035개와, 짝이 되는 개념원리 개념 블록 268개다.

| 권 | 문항 | 대단원별 | 개념 미지정 | 수식 격리 | 배치 격리 | 개념 자료 |
|---|---|---|---|---|---|---|
| 중1-1 | 1123 | I 213 · II 310 · III 391 · IV 209 | 0 | 34 | 71 | 55 |
| 중2-1 | 1099 | I 136 · II 235 · III 203 · IV 223 · V 302 | 0 | 25 | 50 | 58 |
| 중2-2 | 1007 | I 190 · II 210 · III 380 · IV 227 | 0 | 82 | 194 | 64 |
| 중3-1 | 1133 | I 372 · II 265 · III 233 · IV 263 | 0 | **385** | 38 | 63 |
| 중3-2 | 673 | I 243 · II 283 · III 147 | 0 | **165** | 152 | 28 |

개념 정렬 5801건 · 렌더 실패 145 / 5035문항(해설 97 · 발문 26 · 선택지 15 · 정답 7).

중3의 수식 격리가 큰 것은 **근호 때문이고 설계된 것이다**(7.6b). 중2-2·중3-2의
배치 격리는 도형 문항이고 그림 파이프라인을 기다린다([figure-svg-plan.md]).

전부 `review_required` 계열이고 `is_auto_assignable`은 여전히 `false`다.
중1-1의 사용권·검수 경위는 아래 6절과 handoff-learn.md 4절에 그대로 있다.

권마다 새 조판을 만났고, 그때마다 **중1-1에도 영향을 주는 결함**이 함께
드러났다. 그래서 다섯 권을 같은 코드로 다시 넣었다. 무엇을 고쳤는지는
`git log`의 커밋 메시지에 하나씩 적혀 있다 — 요약하면:

- 연립방정식이 한 줄로 뭉개짐 (본책 84 · 별책 163) — 8과 3이 붙어 83이 됐다
- 조각난 지수 `x^{1}^{0}` (별책 259)
- 2행 분수의 분모가 떨어져 나감 (중1-1 145 → 49) — **handoff 7.6a의 원인
  진단이 틀렸다.** 부호가 아니라 세로 판정이 원인이었다(7.6a 참고)
- 도형 라벨이 발문에 섞임 (중2-2 947) · 개념 자료가 엉뚱한 책에 매달림 (58)

> **2026-08-05 이전 기록을 읽는 사람에게.** 그때까지는 1단원 213문항뿐이었고
> 검수가 끝나 197건이 published였다. II~IV단원을 뽑으면서 **1단원에도 영향을
> 주는 결함 여섯**을 찾아 고쳤고(개념 정렬 두 가지·정답 두 건·분수 해독·큰 괄호),
> 소유자 승인을 받아 1단원을 지우고 네 단원을 다시 넣었다. 그래서 지금 검수
> 상태는 전부 `review_required`다 — 사람이 매긴 published 197건은 사라졌다.

| 항목 | 값 | 확인 방법 |
|---|---|---|
| 반입 문항 | **5035** (다섯 권) | `select count(*) from questions where source_ref is not null` |
| 권별 | 위 표 | `source_ref->>'book'` |
| 개념 미지정 | **0** (스무 대단원 전부) | `load` 출력 · `concept-coverage` |
| 수식 렌더 실패 | 46 / 3229문항 (중2까지 반영한 값) | `pnpm --filter @su-maek/ingest audit-katex` |
| 내용 이상 징후 | 권마다 다르다 — 3절 참고 | `audit-content` |
| 검수 격리 | 근호(중3-1 I 318)·그림(중2-2 180 등) | `select review_status, count(*)` |
| 개념서 자료 | 268블록 · 전부 draft | `learning_materials` |
| 권한 | `is_auto_assignable`은 전부 `false` · 중1-1 사용권은 2026-08-04 `usable` | 아래 6절 |

> **2026-08-04 소유자 판단으로 사용권이 `usable`로 확정됐고 검수도 일괄 통과했다**
> (published 197 · 추출 결함 격리 13 · 절단 지시문 v2 복원 12 · 그림 3건은 layout
> 검수 대기). 그래서 **연습문제는 흐른다.** 다만 `is_auto_assignable`은 여전히 전부
> `false`라 **평가 자동 출제 풀에는 안 들어가 있다** — 그 개방은 별도 판단이다.
> 경위·감사 기록·재실측 SQL·잔여 내용 검수는 [handoff-learn.md](handoff-learn.md) 4절.

DB 전체 문항 584개 중 371개는 시드이고, RPM 반입분은 `source_ref is not null`로
정확히 갈린다.

---

## 2. 새 컴퓨터에서 준비하기

### 2.1 저장소에 **없는 것**

clone만으로는 반입 작업을 이어갈 수 없다. 아래는 저장소에 들어 있지 않다.

| 없는 것 | 어떻게 채우나 |
|---|---|
| `.env` | **`.env.example`을 복사해 채운다. 안내 주석을 읽을 것** — direct 연결은 이 프로젝트에서 DNS가 안 풀린다 |
| `node_modules` | `pnpm install` |
| DB 스키마·시드 | `pnpm db:migrate && pnpm db:seed` |
| **로그인 계정** | `pnpm --filter @su-maek/db demo-account` — `db:seed`는 users 행만 넣고 **인증 계정은 안 만든다** |
| **교재 PDF 원본** | 저장소에 두지 않는다 (아래 경고) |
| 추출 덤프 JSON | PDF에서 다시 만든다 (3절 1~2단계) |
| PyMuPDF | `python -m pip install pymupdf` — 저장소에 파이썬 의존성 선언 파일이 없다 |
| `artifacts/` 스크린샷 | 재생성 가능한 파생물이라 제외 |

> **교재 PDF를 저장소에 넣지 말 것.** 이 PDF는 쪽마다 텍스트 레이어에
> **구매자 이메일이 워터마크로 박혀 있다.** 공개 저장소에 올라가면 구매자가
> 특정되고 되돌릴 수 없다. **덤프 JSON과 지면 이미지도 같은 것을 담는다.**
>
> `.gitignore`가 막는 것: `*.pdf` · 저장소 루트의 `*.json`(추적 중인
> `package.json`·`tsconfig.base.json`만 예외) · `*-dump.json` · `audit*.md` ·
> `*.png`. 이 규칙은 **3절이 시키는 산출물 이름을 실제로 덮는지** 확인한
> 것이다 — 처음에는 `book.json`이 안 걸렸다. 다른 이름을 쓸 거라면
> `git check-ignore -v <파일>`로 먼저 확인할 것.
>
> 파서는 `patterns.purchaserStamp`로 이 문자열을 본책·별책 양쪽에서 걸러 내고,
> `audit-content`가 발견을 알릴 때도 `‹구매자 식별 문자열›`로 **가려서** 적는다
> — 검사기가 워터마크를 옮기는 통로가 되지 않게.

### 2.2 원본 PDF 위치

**`N:\개인\강아\교재자료\RPM\22\`는 이제 없다.** 2026-08-05 기준 같은 파일이
`D:\mathlab\data\` 아래에 있다 — 이름만 다르고 내용은 같다(본책 184쪽·평균
995자/쪽으로 예전 실측과 일치).

| 역할 | 파일 | 뽑은 쪽 범위 |
|---|---|---|
| 본책 | `D:\mathlab\data\RPM\RPM 중학 1-1 학생용.pdf` (184쪽) | I p.2–33 · II p.34–73 · III p.74–123 · IV p.124–155 |
| 별책 | `D:\mathlab\data\RPM\RPM 중학 1-1 정답.pdf` (104쪽) | p.2–93 (0001~1123 전부) |
| 개념서 | `D:\mathlab\data\개념원리\개념원리 중학 1-1 교사용.pdf` (224쪽) | I p.6–47 · II p.48–101 · III p.102–173 · IV p.174–224 |

같은 폴더에 중1-2~중3-2 여섯 권이 다 있다(본책·정답·개념서 각각).

본책 p.156–184는 「다시 풀기」 부록이다. 본문 문항을 번호로 되짚는 쪽이라
**반입하지 않았다** — 넣으면 같은 문항이 두 번 들어간다. 별책 p.94–104가
그 부록의 답이다.

`source_files.storage_path`에는 `local:22개정 RPM 중 1-1 학생용.pdf`만 남아 있다
— **원본은 객체 스토리지에 올리지 않았다.** 체크섬(sha256)은 덤프의
`source.checksum`과 `source_files` 행에 남아 있으므로 같은 파일인지 대조할 수 있다.

---

## 3. 처음부터 끝까지 재현하기

명령은 전부 소스에서 확인한 실제 플래그다.

> **새 권을 여는 순서는 정해져 있다.** 아래 3절은 중1-1을 예로 든 것이고,
> 다른 권도 같은 순서인데 **앞에 두 단계가 더 붙는다.**
>
> ```bash
> # A) 아직 못 읽는 글리프부터 센다 — 자가채점의 실패 대부분이 글자 하나다
> pnpm --filter @su-maek/ingest glyph-census u1.json u2.json …
> #    출력이 render-page.py의 --clip 좌표를 그대로 준다. **지면을 열어 볼 것.**
> #    (span 하나씩 돌리므로 앞뒤와 합쳐야 읽히는 것은 여기 계속 남는다 —
> #     선분 기호 `Ó`가 그렇다. 진짜 결과는 extract의 자가채점으로 본다)
>
> # B) 개념 표를 쓴 뒤, DB를 건드리기 전에 다 걸리는지 본다
> pnpm --filter @su-maek/ingest concept-coverage \
>   --textbook=m2-1 --chapter=II --dump=u2.json
> #    개념이 안 걸린 문항은 **아무 오류도 내지 않는다.** 적재는 성공하고
> #    화면도 멀쩡하며 숙련도 추정에서만 조용히 빠진다.
>
> # 개념서 쪽 목록도 손으로 세지 않는다
> pnpm --filter @su-maek/ingest concept-page-scan kwr1.json kwr2.json …
> ```
>
> 그리고 `load`·`delete-ingested`·`load-concepts`는 **`--textbook`을 반드시**
> 받는다. 인쇄 번호는 권마다 1부터 다시 시작하므로, 권을 안 주면 다른 권이
> 함께 지워지거나 자료가 엉뚱한 책에 매달린다(둘 다 실제로 겪었다).
> 등록부는 `src/profiles/rpm-books.ts`와 `src/cli/load-concepts.mts`에 있다.

> **TypeScript CLI(`pnpm --filter @su-maek/ingest …`)는 `--이름=값` 등호 형식만
> 읽는다.** 공백으로 띄우면(`--expect 1-213`) 오류 없이 무시된다.
> 파이썬 `extract.py`·`render-page.py`는 argparse라 두 형식을 다 받는다.

```bash
# 0) 준비 — 이 순서를 건너뛰면 6)에서 조용히 빈 DB에 넣게 된다
cp .env.example .env        # DATABASE_URL 주석을 읽을 것 (direct 연결은 안 된다)
pnpm install
pnpm db:migrate && pnpm db:seed    # 6)의 --org·--actor가 시드가 만드는 조직·교사다
python -m pip install pymupdf

# 1) 본책 → 기하 덤프 (해석 없음, 좌표만). 대단원마다 따로 뽑는다
BOOK="D:/mathlab/data/RPM/RPM 중학 1-1 학생용.pdf"
python packages/ingest/python/extract.py "$BOOK" -o u1.json --from 2   --to 33
python packages/ingest/python/extract.py "$BOOK" -o u2.json --from 34  --to 73
python packages/ingest/python/extract.py "$BOOK" -o u3.json --from 74  --to 123
python packages/ingest/python/extract.py "$BOOK" -o u4.json --from 124 --to 155

# 2) 별책 → 기하 덤프 (한 번에 1123문항 전부)
python packages/ingest/python/extract.py \
  "D:/mathlab/data/RPM/RPM 중학 1-1 정답.pdf" -o ans.json --from 2 --to 93

# 3) 추출 + 자가채점 (--expect가 없으면 통째로 빠진 문항이 채점표에 안 나온다)
pnpm --filter @su-maek/ingest extract u2.json --expect=214-523 --verbose
pnpm --filter @su-maek/ingest extract u2.json --outline   # 유형 구조 — 개념 표를 쓸 때 본다

# 4) 정답 대조
pnpm --filter @su-maek/ingest answers ans.json --range=1-1123 --verbose

# 5) 내용 전수검사 — 렌더가 아니라 「지면과 같은가」
#    발견이 1건이라도 있으면 **종료 코드 1**이다. && 체인에 넣지 말 것.
#    별책 덤프가 1123문항 전부를 담으므로 **해설 쪽 발견은 단원마다 되풀이된다** —
#    네 번 돌린 결과를 그냥 더하면 안 된다 (문항 번호로 중복을 걷어낼 것)
pnpm --filter @su-maek/ingest audit-content \
  --book=u2.json --answers=ans.json --md=audit-u2.md

# 6) 적재 — **--chapter에 기본값이 없다.** 단원마다 개념 표가 다르다
ORG=00000000-0000-7000-8000-000000000001
ACTOR=00000000-0000-7000-8000-0000000000a1
pnpm --filter @su-maek/ingest load --chapter=II \
  --book=u2.json --answers=ans.json --org=$ORG --actor=$ACTOR --dry-run
# --dry-run만 빼면 실제로 들어간다 (여기서부터 DATABASE_URL이 필요하다)

# 6-1) 개념서 (개념 블록 → learning_materials). 개념 쪽 허용목록은 CLI가 안다
KWR="D:/mathlab/data/개념원리/개념원리 중학 1-1 교사용.pdf"
python packages/ingest/python/extract.py "$KWR" -o kwr2.json --from 48 --to 101
pnpm --filter @su-maek/ingest load-concepts --chapter=II \
  --dump=kwr2.json --org=$ORG --actor=$ACTOR

# 7) 적재 후 DB 검사
pnpm --filter @su-maek/ingest audit-katex --verbose        # 화면 문자열 그대로 렌더
pnpm --filter @su-maek/ingest verify-templates --verbose   # 변형 엔진의 원본 재현
pnpm --filter @su-maek/ingest variants --seed=42 --per=3   # 변형 미리보기 (DB 미기록)

# 지면을 눈으로 볼 때 — 판단하기 전에 반드시
python packages/ingest/python/render-page.py "교재.pdf" 12 -o p12.png
python packages/ingest/python/render-page.py "교재.pdf" 12 --clip 315 275 580 350 -o q.png
```

> **`--org`를 조심할 것.** 기본값 `00000000-0000-7000-8000-000000000001`(과
> `--actor`의 `…0000a1`)은 `pnpm db:seed`가 만드는 **데모 조직과 데모 교사**다
> (`packages/db/src/seed/index.ts:14-15`). 기본값이 있는 것은 `audit-katex`·
> `verify-templates`·`variants` 셋뿐이고 `load`는 반드시 넘겨야 한다.
>
> 다른 조직에 반입했다면 **7)의 세 CLI에도 같은 `--org`를 넘겨야 한다.**
> 안 넘기면 데모 조직을 보고 「문항 0개」를 오류 없이 찍는다 — 실패가 성공처럼
> 보이는 자리다.

### 3.1 재적재는 **덮어쓰지 않는다**

`load`는 `(organization_id, book_edition_id, printed_number)`로 이미 있는 문항을
찾으면 **건너뛴다**(`load.ts:355-364`). 갱신하지 않는다.

**즉 추출 로직을 고친 뒤 그냥 다시 돌리면 아무 일도 일어나지 않는다.**
반영하려면 지우고 다시 넣어야 한다.

```bash
pnpm --filter @su-maek/ingest delete-ingested --yes            # 반입분 전부
pnpm --filter @su-maek/ingest delete-ingested --yes --chapter=IV   # 한 단원만
```

예전에는 이 절차가 이 문서의 SQL 조각이었다. **psql이 기본 autocommit이라
`begin;`을 빠뜨리면 문장마다 커밋되고 안전망이 사라진다** — 그래서 CLI로
옮겼다(2026-08-05). `--yes` 없이는 안 지우고, 지우기 전에 검수 상태를 찍는다.

지우는 것은 `source_ref is not null`인 문항뿐이다(시드는 안 건드린다).
`questions`를 참조하는 외래키는 `question_alignments`·`question_versions`
둘뿐이고 둘 다 `on delete NO ACTION`이라 **자식부터 지운다.**
`question_versions`를 참조하는 `assessment_questions`가 걸려 있으면
트랜잭션이 통째로 롤백된다 — 그것이 안전망이다(평가에 이미 쓰인 문항은
못 지운다).

> **검수 상태는 되살아나지 않는다.** published·quarantined는 사람이 매긴
> 것이고 지우면 그대로 사라진다. 2026-08-05 재적재로 published 197건이
> 사라졌다 — 지우기 전에 문항별 상태를 백업할지 먼저 정할 것.

지우고 다시 넣으면 문항 id가 바뀐다. 인쇄 번호로 다시 찾으려면:

```sql
select id from questions where source_ref->>'printedNumber' = '0027';
```

**문항만** 안 덮어써지는 것이다. `book_editions.extraction_profile`은 재적재할
때마다 갱신되므로, 프로파일 버전만 올리고 다시 돌리면 판의 프로파일과 문항의
`source_ref.extractedBy.version`이 어긋난 채로 남는다.

### 3.2 개념서(개념원리 본책) — 개념 블록 반입 (2026-08-05 네 단원 완료)

RPM 문항과 별개로 『개념원리 중학 1-1 교사용.pdf』에서 **개념 블록 55개**를
뽑아 `learning_materials`(kind=reading, draft)로 넣었다. 학생 「개념 공부」
화면이 읽는 자리다. RPM 문항이 걸린 것과 같은 정본 개념(m1-*)에 붙어서,
개념 설명 → 문항이 한 줄로 이어진다.

```bash
KWR="D:/mathlab/data/개념원리/개념원리 중학 1-1 교사용.pdf"
python packages/ingest/python/extract.py "$KWR" -o kwr2.json --from 48 --to 101
pnpm --filter @su-maek/ingest load-concepts --chapter=II \
  --dump=kwr2.json --org=<uuid> --actor=<uuid>
```

`--chapter`가 덤프 쪽 범위·개념 쪽 허용목록·잇는 표를 다 안다. 기본값은 없다.

| 대단원 | 덤프 쪽 | 개념 쪽 (허용목록) | 블록 |
|---|---|---|---|
| I | 6–47 | 10, 11, 17, 30, 35 | 9 |
| II | 48–101 | 50, 51, 56, 70, 71, 81, 89 | 16 |
| III | 102–173 | 104, 105, 111, 117, 132, 133, 139, 156, 163 | 18 |
| IV | 174–224 | 176, 177, 184, 198, 208 | 12 |

**허용목록은 사람이 확인한 값이다.** 문제 쪽은 조판 신호가 개념 쪽과 겹쳐,
추론에 맡겼더니 개념 하나가 문제 12쪽 분량(500줄)을 삼켰다. 위 값은
「N. 중단원」 머리글이 있는 쪽과 「…는가?」+핵심문제로 이어지는 쪽을 224쪽
전체에서 훑어 뽑은 뒤, **1단원 결과가 사람이 손으로 확인해 둔
10,11,17,30,35와 정확히 같은지** 대조해 규칙을 검증한 것이다.

규칙·함정·실측은 [packages/ingest/README.md](../packages/ingest/README.md)의
`kwr-2022` 절에 있다. 재적재는 문항과 같은 원칙 — **덮어쓰지 않는다**
(같은 조직·개념·제목이면 건너뜀). 고친 것을 반영하려면
`source_ref->>'book'`으로 지운 뒤 다시 넣는다. 검증은 셋: CLI가 찍는
미분류·미해독 수(0이어야 한다), 게시 렌더 게이트(renderMixedText 실패 0),
그리고 지면 이미지(render-page.py) 대 화면 렌더의 눈 대조.

**정제 층 (2026-08-03 구현 완료)**: 추출본은 지면 사본이라 게시할 수 없다.
`refine-concepts`가 우리 표현·구조화 블록으로 다시 쓴 새 draft를 만들고
원본을 archived로 보관한다 — 시범으로 8건 전부 정제됨(차단 0·렌더 실패 0).
게시는 자료 상세의 나란히 보기(원본 vs 정제본 + 게이트 경고)에서 사람이.
설계·실측·해설 정제 평가는 [refine-design.md](refine-design.md).

**데모 1단원 검증 세팅**: `pnpm --filter @su-maek/db seed-unit1-demo` (멱등).
검증반·오늘 세션·**개별 일정**(중요: 학생 「오늘」은 learner_schedule_items가
있으면 반 세션을 무시한다)을 잇고 정제본을 게시한다. demo-student로
/learn/study에 8건이 나오는 것까지 실화면 확인(2026-08-03). 연습·테스트
검증은 1단원 문항 213건의 검수·사용권 확정이 선행이다(현재 출제 가능 0).

---

## 4. 왜 이렇게 만들었나 — 다시 알아내지 않아도 되는 것들

### 4.1 파이썬은 해석하지 않는다

```
PDF ──(python/extract.py, PyMuPDF)──▶ 기하 덤프 JSON ──(src/, TypeScript)──▶ 문항
     좌표·글꼴·색·글자상자만                            해석 전부
```

경계를 여기 둔 이유는 두 가지다. 해석에는 테스트가 필요한데 저장소의 계약·게이트·
뮤테이션 검증이 전부 TS에 있고, 원문(`math_expressions.raw_source`)은 불변이어야
한다(원칙 2O). 추출기가 수식을 "고쳐서" 넘기면 원문이 사라진다.

### 4.2 렌더 성공은 정확성이 아니다

**이것이 이 작업에서 가장 비싸게 배운 것이다.**

`A=2b\times 3^{b}\times 5c`는 KaTeX가 아무 오류 없이 예쁘게 그린다. 그런데 지면은
`A=2^a×3^b×5^c`다. 학생은 틀린 풀이를 읽고, 화면 어디에도 이상하다는 표시가 없다.
「렌더 실패 0건」이라고 보고한 직후에 사용자가 화면을 보고 오류를 지적했다.

그래서 검사가 **둘**이다. 둘 다 돌려야 한다.

| 도구 | 묻는 것 | 잡는 것 |
|---|---|---|
| `audit-katex` | 그려지는가 | 깨진 LaTeX 문법 |
| `audit-content` | **지면과 같은가** | 뜻이 바뀐 오류 — 위첨자 소실, 글꼴별 오독, 표 붕괴, 순서 뒤집힘, 워터마크 잔존 |

`audit-content`(`src/audit.ts`)의 규칙 7종은 전부 **실제로 한 번씩 틀렸던 것**이다.
규칙을 더할 때는 거짓 양성을 반드시 확인할 것 — 처음 만들었을 때 264건 중
상당수가 규칙 자체의 오검출이었다(`120m`을 「120의 위첨자 m」으로 읽고, 수식이
앉은 자리를 빈칸으로 세어 멀쩡한 발문 17개를 잡았다).

### 4.3 글자만 봐서는 뜻이 안 정해진다

국내 교재 PDF의 수식 글꼴은 **부분집합 글꼴**이라 코드가 글꼴 안에서만 뜻을 갖는다.
`src/hwp-encoding.ts`가 다루는 것:

| 근거 | 무엇을 가르나 | 안 하면 |
|---|---|---|
| **글꼴** (`BY_FONT`) | EHyak `y`=⋯ · EHyak `¾`=≥ vs EHsang `¾`=℃ | 「자연수 y의 제곱」이 「⋯의 제곱」 |
| **글자 폭** (`markSuperscripts`) | 폭 0 = 앞 글자에 겹쳐 찍은 위첨자. 위첨자 `a`가 코드 `b`로 온다 | 발문이 `2^a×3²×5` 대신 `2b×3²×5` |
| **색** (`src/ink.ts`) | 흰 글자 중 **맨 종이 위**의 것만 지운다 | `2)6`이 `2)46`, 표의 `2 5 6`이 `20 50 60` |
| **벡터 도형** | 높이 0인 선분 = 분수 막대 · EHboNA 조각 = 세로셈 괄호 · 칠한 사각형 = 격자표 경계 | 표가 숫자 나열로 펴진다 |

`BY_FONT`에는 **EHyak의 `y`만** 들어 있다. EHsang의 `y`가 변수 y로 나오는 것은
표에 항목이 있어서가 아니라 `PASSTHROUGH`가 통과시키기 때문이다 — 「EHsang `y`
항목이 왜 없지」 하고 넣으면 오히려 망가진다.

세로 위치로는 위첨자를 못 가른다 — PyMuPDF의 글자 상자는 글리프의 잉크가 아니라
**줄 높이**를 준다(한 줄의 여덟 글자가 전부 같은 y). 그래서 판정은 **폭 0이면서
아스키 영숫자**일 때만 한다(전용 위첨자 글리프 `Û`·세로셈 조각 `³`은 해독표가
이미 아니까 두 겹으로 감싸지 않으려고). 그리고 글자 상자 개수가 글자 수와
어긋나면 표식 없이 원문을 그대로 돌려준다 — **위첨자를 놓쳐도 경고가 없다.**

해독표에 **확인하지 않은 값은 넣지 않는다.** 지수는 `Ú`(1)~`à`(7)만 있고, 그 이상은
같은 연속 배치로 보이지만 대조하지 않았으므로 비워 두었다. 테스트가 그 원칙을
직접 단언한다(`á`를 넣으면 `unknown`에 담기는지 검사).

### 4.4 답을 못 읽으면 비워 둔다

그럴듯하게 지어내면 학생이 맞는 답을 쓰고 틀렸다는 채점을 받는다. `points`는
`'10'` 고정이고, 난이도는 지면의 뱃지가 벡터 그림이라 텍스트로 못 뽑아 비워 두었다.

> **다만 「못 읽었다」는 판단도 틀릴 수 있다 — 실제로 틀렸다.**
> 이 문서는 0166·0184를 「그림 문항이라 별책에서 답을 못 읽는다」고 적어
> 두었는데 사실이 아니었다. 별책 13쪽·15쪽 **첫 단에 답 16과 답 ③이 그대로
> 인쇄돼 있다.** 해설이 단 끝을 넘어가면서 「답」 배지가 다음 쪽으로 밀렸고,
> 파서가 쪽마다 따로 읽어서 그 배지를 통째로 버린 것이다(2026-08-05 수리).
> 중1-1 전권에서 이 결함으로 25건이 비어 있었고, 지금은 7건이다.
>
> 비워 두는 것은 옳지만, **왜 비었는지를 지면을 열어 확인하지 않은 채
> 이유를 적으면** 그 문장이 다음 사람의 조사를 막는다.

> **난이도 컬럼은 `null`이 아니다.** `{"band": null, "source": "미측정 — 지면
> 뱃지가 벡터라 추출 불가"}`라는 jsonb가 들어간다. 그래서 미지정 문항을 찾을 때는
> `where difficulty is null`이 아니라 **`where difficulty->>'band' is null`**로
> 물어야 한다 — 전자로 물으면 213문항 전부 0건이 나온다.

---

## 5. 파일 지도

| 경로 | 줄 | 하는 일 |
|---|---|---|
| `packages/ingest/python/extract.py` | 147 | PDF → 기하 덤프. `rawdict`로 **글자별 bbox**까지 싣는다 |
| `packages/ingest/python/render-page.py` | 69 | 쪽(또는 `--clip` 영역)을 이미지로. **판단 전에 지면을 여는 도구** |
| `packages/ingest/src/segment.ts` | 886 | 지면 → 문항. 모든 span을 「문항/비문항/미분류」로 반드시 분류 — 미분류 수가 곧 손실 |
| `packages/ingest/src/answers.ts` | 888 | 별책 파서. 정답·해설(줄 단위)·채점기준·전략을 나눈다. 세로셈·격자표를 KaTeX 배열로 |
| `packages/ingest/src/hwp-encoding.ts` | 410 | 수식 글꼴 → LaTeX 해독표 + `markSuperscripts` |
| `packages/ingest/src/ink.ts` | 39 | 보이지 않는 흰 글자 걸러 내기 |
| `packages/ingest/src/audit.ts` | 199 | 내용 이상 징후 7종 |
| `packages/ingest/src/score.ts` | 270 | 자가채점 (인쇄 번호 커버리지·span 커버리지·수식 렌더 등) |
| `packages/ingest/src/load.ts` | 559 | 문제은행 적재. 권한 게이트·수식 게이트·문항별 트랜잭션 |
| `packages/ingest/src/profiles/rpm-2022.ts` | 83 | 교재별 실측값 (글꼴·단·여백·패턴) |
| `packages/ingest/src/profiles/rpm-2022-concepts.ts` | 189 | **사람이 쓴** 유형 → 개념 표 |
| `packages/core/src/variants/` | 1198 | 숫자 변형 엔진 (템플릿 11개) |

테스트는 `packages/ingest/test/hwp-encoding.test.ts` **34개 하나뿐**이고,
`packages/core/test/variants/` 33개가 있다. `segment`·`answers`·`load`·`score`·
`audit`에는 단위 테스트가 없다 — 이것이 이 코드의 가장 큰 구멍이다(7절 참조).

---

## 6. 적재가 DB에 무엇을 남기나

`load.ts`가 쓰는 테이블: `publishers` · `books` · `book_editions` · `content_rights` ·
`source_files` · `source_pages` · `canonical_concepts` · `questions` ·
`question_versions` · `math_expressions` · `question_alignments`.

**`questions.source_ref`(jsonb)** — 출처 메타데이터. 컬럼 코멘트에
「학생 화면에 노출 금지」가 박혀 있다. 담기는 키 15개:

```
publisher · book · edition · chapter{number,title} · unit · section · type
textbookRef · printedNumber · printedPage · column · bbox
figureBoxes · figureLabels · extractedBy{profile,version}
```

**`book_editions.extraction_profile`(jsonb)** — 그 판을 **어떤 규칙으로 뽑았는지**.
직렬화 가능한 6필드(`id·version·label·appliesTo·layout·figures`)만 들어가고
정규식인 `fonts`·`patterns`는 빠진다.

검수 상태 분기는 3갈래이고 반입에서 `approved`·`published`는 절대 안 나온다:

```
수식이 깨졌으면      → formula_review_required
그림 박스가 있으면    → layout_review_required
아니면               → review_required
```

「수식이 깨졌다」 = 해독 못 한 글리프가 **발문·선택지·조건 상자**에 하나라도 있거나,
`processExpression` 결과가 `render_validated`가 아닌 표현식이 하나라도 있는 경우.

> **해설·채점기준의 미해독 글리프는 이 게이트가 세지 않는다**(`load.ts:400-404`가
> stem·choices·conditionBox만 훑는다). 두 번째 조건이 대신 잡아 주지도 않는다 —
> KaTeX는 `strict: "ignore"`라 모르는 글자도 그냥 그려 내고 `render_validated`를
> 돌려준다. 4.2절의 「렌더 성공은 정확성이 아니다」가 여기에도 그대로 걸린다.
> 해설의 미해독 글리프는 `audit-content`로만 잡힌다.

> **jsonb 바인딩 주의.** 이 경로는 drizzle을 거치지 않는 raw postgres.js라
> `sql.json()`/`tx.json()`을 써야 한다. `JSON.stringify(x)::jsonb`로 쓰면 **이중
> 인코딩되는데 에러가 나지 않는다** — 읽을 때 `source_ref.chapter`가 `undefined`로
> 나오는 것으로만 드러난다. 한 번 당해서 전부 지우고 다시 넣었다.

---

## 7. 남은 일

우선순위 순. 각 항목에 **어디를 고쳐야 하는지**까지 적었다.

### 7.1 ~~개념 매핑표의 키 충돌~~ — 고쳤다 (2026-08-05)

유형·소단원 표(`*_TITLE_TO_CONCEPT`)와 중단원 표(`*_UNIT_TO_CONCEPT`)를 나눴고,
`conceptTable()`이 **중복 키를 불러들이는 순간 던진다.** 사람이 조심해서 될
일이 아니었다 — 표를 다시 짜면서 2단원에 「절댓값」을 또 두 번 넣었다.

같은 자리에서 둘을 더 찾았다.

- 지면의 □는 공백이 아니라 **사설 영역 글자(U+E22D)**다. `\s`로 눌러도 안
  없어져서 1단원 4문항이 유형 표를 못 찾고 있었다 — 중단원 표가 받아 주는
  바람에 「개념 미지정 0」으로 보였다. 걸리기는 걸리되 엉뚱한 데 걸린 것이다.
- 소단원 머리글 둘이 한 줄에 붙어 오는 「소수와 합성수 소인수분해」 29문항도
  표에 없어 같은 길로 샜다.

### 7.2 그림 문항 55건이 반쪽이다

벡터 도형 뭉치를 찾아 `figureBoxes`·`figureLabels`를 `source_ref`에 남기고
`layout_review_required`로 격리하는 데까지만 되어 있다.

- `diagram_assets`·`question_assets` 테이블은 **존재하지만 아무것도 넣지 않는다**
- 문항 본문(`buildBody`)이 만드는 블록은 `paragraph`·`condition_box`·`choice_group`
  3종뿐 — **그림 블록도 표 블록도 없다**
- 웹 화면(`apps/web/src`)은 `figureBoxes`를 아예 참조하지 않는다

**설계와 실행 계획은 [figure-svg-plan.md](figure-svg-plan.md)에 있다.** 요점:

- 55건 중 **19건은 그림이 아니라 표**다(달력·대응표·농도표). 괘선이 벡터라
  그림으로 잡혔을 뿐이다. SVG가 아니라 본문 표 블록으로 가야 한다.
- 25건은 좌표평면·그래프라 **프리셋 spec으로 결정적으로 생성**할 수 있다.
  `D:\mathlab\src\lib\utils\svg-diagrams`(24종)와
  `D:\mathg-gen\src\lib\diagram`(정리된 이식본)에 이미 있다.
- 진짜로 사람이나 AI가 그려야 하는 것은 **3건**뿐이다(그릇·타는 초·용수철).
  그 3건용 GPT 프롬프트도 같은 문서에 있다.

### 7.3 숫자 변형이 DB에 저장되지 않는다

엔진과 검증은 다 되어 있다 — 템플릿 11개, 테스트 33개, 원본 재현 관문(교재에
인쇄된 답이 그대로 나오는 문항만 변형).

그런데 **저장 경로가 없다.** `variants.mts`가 실행하는 SQL은 원본을 읽는 SELECT
한 건뿐이고, 마지막 줄이 `"DB에 쓰지 않았습니다. 답은 코드가 보증하지만 문장이
말이 되는지는 사람이 봅니다."`를 찍는다. 의도된 설계다.

저장하려면 먼저 정해야 할 것:
- 변형을 담을 테이블이 **스키마에 없다** (`content.ts`의 pgTable 18개 중 없음)
- ADR-0014와 ERD가 요구하는 계보 컬럼 `derived_from_version_id`가 **코드·마이그레이션
  어디에도 없다** — 문서에만 존재한다 (`docs/adr/0014-...:171`, `docs/phase0/erd.md:662`)

### 7.4 드릴 템플릿 7개에 테스트가 없다

`templates.test.ts`는 `templates.ts`의 4개만 import한다. `templates-drill.ts`의
7개와 `RPM_M1_CH1_ALL_TEMPLATES`의 순서 규칙(구체적인 것 먼저)은 테스트되지 않는다.

### 7.5 파서 본체에 단위 테스트가 없다

`segment.ts`(886줄)·`answers.ts`(888줄)·`load.ts`(559줄)·`score.ts`·`audit.ts`·
`ink.ts` 전부 테스트가 없다. 지금 이 코드를 지키는 것은 `audit-katex`/`audit-content`
전수검사뿐인데, 그건 **덤프 JSON과 DB가 있어야** 돌릴 수 있다. 새 컴퓨터에서 PDF
없이 작업하면 안전망이 없다.

`load.ts`의 멱등성도 자동 검증되지 않는다 — `loadQuestions`를 부르는 곳은 CLI
하나뿐이다.

### 7.6 ~~2단원 미해독 글리프 9건~~ — 고쳤다 (2026-08-05)

`¥ ¦ » ª ¼ Á ¢ ¤`는 **분수의 분자 자리 전용 글리프**였다. 조판기는 분자와
분모의 자릿수가 같으면 shift 행(`;1#2%;`=35/12)을 쓰고, 다르면 이쪽 벌을
쓴다(가운데 맞춤 때문에 좌우 여백이 다른 글자가 필요해서다). 열 자리를 전부
지면에서 확인했다: `¼=0 Á=1 ª=2 £=3 ¢=4 °=5 ¤=6 ¦=7 ¥=8 »=9`.

같이 드러난 것 — **분수를 읽는 규칙 자체가 틀려 있었다.** 「짝수 자리가 분모」
라는 교대 규칙이었는데, 자릿수가 같은 동안만 우연히 맞는 규칙이었다.
실제로는 글자의 종류가 자리를 정한다(평문 숫자·소문자는 분모, 전용 글리프는
분자). 그래서 1단원은 통과하고 2단원의 4/12·20/4가 통째로 unknown이 됐다.

### 7.6a 2행 분수가 납작해진다 — 대부분 고쳤다 (2026-08-05)

지면의 `C(-6, -a/6)`이 `C(-6, -a)`로 저장되고 **KaTeX는 아무 오류 없이
그린다.** 렌더 검사로는 영영 안 잡히는 종류다.

> **이 절의 예전 진단은 틀렸다.** 「앞의 마이너스가 분자와 한 span으로 와서
> 폭 검사에서 탈락한다」고 적어 두었는데, 실제로 `within()`의 왼쪽을 7pt
> 넓혀 보니 **더 나빠졌다**(중1-1 49→52 · 중2-2 13→16). 옆 수식을 물고
> 오면서 다른 분수의 짝을 빼앗는다. 되돌리고 그 사실을 코드 주석에 남겼다.

진짜 원인은 **세로 판정**이었다. 별책 파서는 끝점으로 재고 있었는데
(`s.y0 >= bar.y1 - 4`), 지수가 든 분모는 상자가 위첨자 높이만큼 위로 더
올라와 있어 그 조건을 못 넘긴다. 본책 파서는 처음부터 **가운데**로 재고
있었다 — 두 파서가 어긋나 있었고, 별책만 몇 달째 분모를 흘렸다.

가운데로 맞춘 뒤: 중1-1 145 → 49 · 중2-1 99 → 50 · 중2-2 22 → 13.

**남아 있는 것**은 중3-2 별책 220건이다. 삼각비 해설의 분수는 분자가 근호
(`√3/2`)라, 근호 조각이 따로 서서 분자 span을 가린다. 근호의 가로 범위를
알 수 없는 글꼴(7.6b) 문제와 같은 뿌리다.

### 7.6b 근호가 어디서 끝나는지 알 수 없다 — **남아 있다** (2026-08-05)

중3은 근호(√)가 나온다. 조판기는 근호를 글자가 아니라 **가구**로 앉힌다 —
갈고리 조각, 근호 안의 수, 윗줄 조각이 따로 온다.

- **EHboNA는 마감 조각이 없다.** 갈고리 뒤 11.3pt 자리에 폭 0인 조각이 하나
  더 오는데 그것은 윗줄의 **시작점**이지 끝이 아니다 — 갈고리와의 간격이 근호
  안 내용의 길이와 무관하게 늘 같다(p.11에서 416.7→428.0, 469.5→480.8로 둘 다
  11.3). 윗줄은 글리프를 가로로 늘여 그리므로 그 길이가 텍스트 층에 남지
  않고, 벡터 도형으로도 오지 않는다.
- **EHRoot에는 마감 조각이 있다**(p.9 「√289」가 `14`·`289`·`6`). 그래서
  한동안 `\sqrt{289}`로 옮겼는데 — **그것도 되돌렸다.** 여는 조각과 닫는
  조각이 한 span에 함께 오는 자리(`!%`·`14`)가 있어 짝이 어긋나고,
  `\sqrt{}(-9a)^{2}}`처럼 빈 근호와 떠도는 중괄호가 생긴다(다섯 권 358건).

그래서 **어느 글꼴이든 끝을 지어내지 않는다.** 본책은 `\surd`(√ 기호만)로
옮기고 미해독으로 올려 검수함에 보낸다. 별책에서는 아예 손대지 않는다 —
`\surd`로 바꿔 봤더니 해설이 통째로 뒤엉켰다(`=\surd x=¹^{3^{2}}^{+…}`).
본책은 한 줄에 수식 하나꼴이라 괜찮았지만 해설은 조각이 훨씬 잘게 나뉜다.

중괄호를 쓰는 한, 조각이 흩어질 때마다 균형이 무너진다. 그 균형을 파서가
추측으로 맞추는 것이 곧 **범위를 지어내는 것**이다.

이 때문에 중3-1 I단원(제곱근) 372문항 중 318이 `formula_review_required`다.
**설계된 격리이지 사고가 아니다** — 읽을 수 없다는 사실이 밖으로 나간 것이다.

풀려면 근호의 가로 범위를 알아내야 한다. 후보 둘:
1. 렌더한 쪽 이미지에서 윗줄의 픽셀 범위를 재기(그림 파이프라인과 같은 도구)
2. 근호 안의 내용을 **수식으로** 파싱해 균형이 맞는 지점을 찾기 — 다만
   `√((-6a)²)+√((-a)²)`처럼 뒤에 연산이 이어지면 그것만으로는 못 가른다

### 7.7 그 밖에 확인된 작은 것들

| 무엇 | 어디 | 상태 |
|---|---|---|
| 성취기준 코드(`[9수01-01]`) | `ConceptDefinition`에 필드 자체가 없다 | 완전 신규 구축 대상 |
| 원본 PDF 객체 스토리지 업로드 | `storage_path`가 `local:…` | 미구현 |
| `books`·`book_editions` 유니크 색인 | 없음 | 판 중복은 안 났지만 **문항은 중복됐다** — 아래 |
| `load`를 **두 번 겹쳐 돌리면 문항이 중복된다** | 멱등 검사(`printed_number`)가 트랜잭션 밖이라 둘 다 「없다」를 본다. 2026-08-05에 중3-2가 673 대신 1075가 됐다 — 배경 작업을 중지해도 자식 프로세스가 살아 있었던 탓이다 | `delete-ingested --textbook=…` 후 **한 번만** 다시 넣는다 |
| drizzle 스냅샷 | `meta/_journal.json`이 0000~0005만 — 수기 SQL 12개(0001a·0002a·0004a·0005a·0006a~0013a)가 빠져 있다. 그중 `0001a_rls_core.sql`이 3.1절이 기대는 외래키를 만든다 | `drizzle-kit push` **금지** |

---

## 8. 이어서 작업할 때의 순서

1. **먼저 재현부터.** 3절 1~5단계를 돌려 `audit-content`가 12건으로 나오는지 본다.
   숫자가 다르면 환경이나 PDF가 다른 것이다 — 코드를 고치기 전에 그것부터 맞춘다.
2. 고칠 것을 정하고 **지면을 연다.** 이 작업에서 옳았던 판단은 전부 해당 쪽을
   이미지로 뽑아 눈으로 대조한 것이었고, 틀렸던 판단은 전부 코드만 보고 추론한
   것이었다. `render-page.py`가 그 도구다 — 덤프의 좌표를 `--clip`에 그대로 넣으면
   그 자리만 잘라 준다.
3. 고친 뒤 **두 검사를 다 돌린다** (`audit-katex` + `audit-content`).
4. DB에 반영하려면 3.1절대로 **지우고 다시 넣는다.**
5. 마지막으로 **브라우저에서 실제 화면을 본다.**

   ```bash
   pnpm --filter @su-maek/db demo-account   # 인증 계정 (db:seed는 이걸 안 한다)
   pnpm dev                                  # 또는 .claude/launch.json 의 web
   ```

   `/login`에서 `demo-teacher@su-maek.app`으로 들어간다(비밀번호는
   `.env`의 `DEMO_TEACHER_PASSWORD`, 없으면 `packages/db/src/seed/demo-account.ts`의
   기본값). 문항 상세는 `/app/content/questions/<uuid>` — 인쇄 번호가 아니라
   uuid이므로 3.1절의 조회 쿼리로 찾거나 `/app/content/questions` 목록에서 연다.

---

## 9. 인수 확인 목록

- [ ] `.env`를 채우고(**direct 아닌 session pooler**) `pnpm db:migrate`가 통과하는가
- [ ] `pnpm db:seed` 후 `pnpm --filter @su-maek/db demo-account`로 로그인이 되는가
- [ ] 교재 PDF 두 개를 확보했는가 (체크섬이 `source_files`와 맞는가)
- [ ] `pnpm --filter @su-maek/ingest extract book-dump.json --expect=1-213`이 99.3% 이상인가
- [ ] `audit-content`가 12건(2단원 글리프 9 + 빈 정답 3)으로 나오는가
      — 이 명령은 발견이 있으면 **종료 코드 1**이다. `&&` 체인에 넣지 말 것
- [ ] `audit-katex`가 0건인가 (다른 조직에 넣었다면 `--org`를 넘겼는가)
- [ ] `pnpm lint && pnpm typecheck && pnpm test`가 통과하는가
- [ ] 브라우저에서 문항 0027(세로셈)·0031(격자표)·0160(위첨자)이 지면과 같은가
- [ ] `git status`에 PDF·덤프 JSON·지면 이미지가 하나도 안 나타나는가
