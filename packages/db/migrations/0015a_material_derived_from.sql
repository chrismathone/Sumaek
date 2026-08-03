-- 0015a: 정제 계보 — 정제본이 어느 추출본에서 왔는가 (docs/refine-design.md 결정 1)
--
-- 정제는 추출본을 덮어쓰지 않는다. 새 행을 만들고 이 컬럼으로 원본을
-- 가리킨다. 원본(추출본)은 archived로 남아 지면 근거가 보존된다.

alter table public.learning_materials
  add column if not exists derived_from_material_id uuid;

comment on column public.learning_materials.derived_from_material_id is
  '정제 원본(추출본) 자료 id. 정제본에만 있다. FK를 걸지 않는 이유: 원본이 보관·삭제돼도 정제본은 살아야 한다.';

-- 정제 잡의 멱등 판정(살아 있는 자식이 있는가)과 검수 나란히 보기가 읽는다
create index if not exists learning_materials_derived_idx
  on public.learning_materials (organization_id, derived_from_material_id)
  where derived_from_material_id is not null;
