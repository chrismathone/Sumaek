-- ============================================================
-- 0012a — 학습 자료에 AI 고지·생성 잡 연결
--
-- `learning_materials`에 두 컬럼을 더한다.
--
-- disclosure: 자동 판서 강의 파이프라인은 「선생님이 검수한 AI 보충
--   강의입니다.」를 out/meta.json에 넣고 handoff.md는 그것을 유튜브 설명란에
--   적으라고 지시하지만, 수맥 안에는 담을 자리도 학생에게 보여 줄 자리도
--   없었다. 결과적으로 **AI가 만든 강의와 사람이 만든 강의를 학생이 구별할
--   수 없었다.** 고지는 자료와 함께 살아야 옮겨 적다 빠지지 않는다.
--
-- source_job_id: parseLectureMeta가 jobId를 읽어 놓고 버렸다. 등록된 인강과
--   그것을 만든 파이프라인 잡의 연결 고리가 없으면 "이 영상 어떤 잡에서
--   나왔지"를 사람 기억에 의존하게 되고, 재생성·추적이 불가능해진다.
--
-- 둘 다 nullable이라 기존 행이 깨지지 않는다. drizzle 정의는
-- packages/db/src/schema/learning.ts. 멱등.
-- ============================================================

alter table public.learning_materials
  add column if not exists disclosure text,
  add column if not exists source_job_id text;

comment on column public.learning_materials.disclosure is
  'AI 생성 고지 — 학생 화면에 그대로 표시한다. 파이프라인 meta.json의 disclosure';
comment on column public.learning_materials.source_job_id is
  '이 자료를 만든 파이프라인 잡 ID (meta.json의 jobId) — 재생성·추적의 연결 고리';

/* 고지에 공백만 넣어 "적었다"고 치는 것을 막는다 — 빈 고지는 고지가 아니다.
 * 없으면 null이어야 화면이 "고지 없음"을 정직하게 말할 수 있다. */
alter table public.learning_materials
  drop constraint if exists learning_materials_disclosure_not_blank_ck;
alter table public.learning_materials
  add constraint learning_materials_disclosure_not_blank_ck
  check (disclosure is null or btrim(disclosure) <> '');

/* 잡 ID로 되짚는 조회 — "이 잡이 만든 자료가 무엇인가". 자료 대부분은
 * 사람이 만들어 null이므로 부분 인덱스로 둔다. */
create index if not exists learning_materials_source_job_idx
  on public.learning_materials (organization_id, source_job_id)
  where source_job_id is not null;
