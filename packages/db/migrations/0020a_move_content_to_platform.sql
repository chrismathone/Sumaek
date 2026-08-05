-- ============================================================
-- 0020a — 콘텐츠를 플랫폼 조직으로 옮긴다 (ADR-0020 3단계). 멱등.
--
-- **이 마이그레이션은 코드와 같은 배포에 있어야 한다.** 먼저 옮기면
-- 질의가 아직 자기 조직만 보고 있어 화면이 그 순간 빈다. 2단계에서
-- 읽기를 `any(contentOrganizationIds(...))`로 바꿔 두었고, 그 도우미가
-- 이 배포부터 플랫폼을 함께 낸다.
--
-- **옮기는 것은 데모 조직의 콘텐츠뿐이다.** 통합 테스트가 만든 조직 30곳이
-- 문항을 1건씩 갖고 있는데, 그것은 잔여물이라 옮기지 않는다 — 옮기면
-- 플랫폼 콘텐츠가 더러워지고, 그 테스트들은 자기 조직 콘텐츠를 자기가
-- 읽으므로 그대로 두어도 동작한다. `purge:test-data`가 걷어 간다.
--
-- **학습 기록은 건드리지 않는다.** attempts·responses·assessment_questions는
-- 콘텐츠를 id로 가리키므로 조직이 달라져도 FK가 그대로 성립한다.
--
-- 되돌리기: 아래 update의 두 조직을 뒤집어 한 번 더 돌리고, 코드를 되돌린다.
-- ============================================================

do $$
declare
  demo   uuid := '00000000-0000-7000-8000-000000000001';
  target uuid := public.platform_org_id();
  t      text;
  moved  bigint;
  total  bigint := 0;
  -- 콘텐츠 표 19개. 순서는 상관없다 — organization_id는 FK가 아니라 표시다.
  content_tables text[] := array[
    'publishers','books','book_editions','content_rights',
    'source_files','source_pages',
    'questions','question_versions','question_alignments','math_expressions',
    'math_normalization_runs','math_render_artifacts','formula_reviews',
    'diagram_assets','question_assets','duplicate_groups','content_reviews',
    'learning_materials','concept_blank_sets'
  ];
begin
  if target is null then
    raise exception '플랫폼 조직이 없습니다 — 0019b가 먼저 돌아야 합니다.';
  end if;

  foreach t in array content_tables loop
    execute format(
      'update public.%I set organization_id = $1 where organization_id = $2', t
    ) using target, demo;
    get diagnostics moved = row_count;
    total := total + moved;
    if moved > 0 then
      raise notice '% : %행 이동', t, moved;
    end if;
  end loop;

  raise notice '콘텐츠 이전 완료 — 총 %행이 플랫폼(%)으로', total, target;
end $$;
