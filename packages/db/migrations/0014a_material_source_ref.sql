-- ============================================================
-- 0014a — 학습 자료의 출처 메타데이터
--
-- learning_materials.source_ref: 교재에서 반입한 개념 설명이 「어느 교재
--   몇 판 몇 쪽 어느 소단원 몇 번 개념」인지를 한 덩어리로 들고 있게 한다.
--   0013a(questions.source_ref)와 같은 이유·같은 꼴이다 — 교재 고유의
--   계층(소단원·개념 번호·핵심문제 상호참조)은 교재마다 달라 컬럼으로
--   못 박을 수 없다.
--
--   교사용 여백 주석(강의Plus)도 여기 담는다 — 학생 본문(body)에 실을
--   내용이 아니지만 버리면 검수자가 지면과 대조할 근거가 사라진다.
--
--   이 값은 **학생 화면에 노출하지 않는다.** 학생 질의는 body만 읽는다.
--
-- nullable이라 기존 행(교사가 직접 쓴 자료)이 깨지지 않는다. 멱등.
-- drizzle 정의는 packages/db/src/schema/learning.ts.
-- ============================================================

alter table public.learning_materials
  add column if not exists source_ref jsonb;

comment on column public.learning_materials.source_ref is
  '출처 메타데이터 (비공개) — 교재·판·소단원·개념 번호·지면쪽·교사 주석·추출 프로파일. 학생 화면에 노출 금지';
