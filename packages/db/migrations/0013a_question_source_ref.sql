-- ============================================================
-- 0013a — 문항의 출처 메타데이터 · 교재별 추출 프로파일
--
-- questions.source_ref: 문항 하나가 「어느 교재 몇 판 몇 쪽 몇 번」인지를
--   한 덩어리로 들고 있게 한다. 정규화된 FK(book_edition_id, source_page_id,
--   printed_number)만으로는 단원·유형·교과서 참조 같은 **교재 고유의 계층**을
--   담을 자리가 없다. 그 계층은 교재마다 달라서 컬럼으로 못 박을 수도 없다.
--
--   이 값은 **비공개다.** 학생 화면 질의는 body·choices만 읽는다. 출처를
--   학생에게 보여 주면 "몇 번 문제인지" 검색해서 답을 찾는다.
--
--   담기는 것: 교재명·판·출판사·단원·소단원·유형·교과서 쪽 참조·인쇄 문항
--   번호·지면 좌표·난이도 뱃지(있으면)·추출 프로파일 id와 버전.
--
-- book_editions.extraction_profile: 이 판을 **어떤 규칙으로 뽑았는지**.
--   문제집마다 조판이 다르다 — 단 수, 문항 번호 폰트, 수식 폰트 계열,
--   선택지 기호가 전부 다르다. 나중에 "이 문항 왜 이렇게 뽑혔지"를 물을 때
--   그때 쓴 규칙이 남아 있어야 답할 수 있다. 재반입할 때도 같은 규칙을
--   다시 찾아 헤매지 않는다.
--
-- 둘 다 nullable이라 기존 행이 깨지지 않는다. 멱등.
-- drizzle 정의는 packages/db/src/schema/content.ts.
-- ============================================================

alter table public.questions
  add column if not exists source_ref jsonb;

comment on column public.questions.source_ref is
  '출처 메타데이터 (비공개) — 교재·판·단원·유형·지면쪽·인쇄번호·좌표. 학생 화면에 노출 금지';

alter table public.book_editions
  add column if not exists extraction_profile jsonb;

comment on column public.book_editions.extraction_profile is
  '이 판을 뽑은 추출 규칙 — 프로파일 id·버전·실측 특징. 재반입과 사후 추적의 근거';

/* 출처로 문항을 되짚는 일이 잦다 — "RPM 중1-1 0135번 고쳐 주세요" 같은
 * 요청은 교재+인쇄번호로 들어온다. 부분 색인이라 source_ref 없는 문항
 * (직접 출제)에는 부담을 주지 않는다. */
create index if not exists questions_source_ref_number_idx
  on public.questions ((source_ref ->> 'printedNumber'))
  where source_ref is not null;
