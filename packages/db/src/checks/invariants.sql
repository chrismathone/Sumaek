-- ============================================================
-- 시스템 불변 조건 검증 하네스
--
-- 근거: docs/phase0/state-machines.md 13장(불변 조건 20개)
--       docs/phase0/backup-recovery.md 5.1 V-1
--       docs/runbooks/05-db-failure-pitr.md 4-5·6장 V-1
--
-- 규약: 각 검사는 **위반 행만 반환**한다. 정상이면 0행이다.
--       검사 단위는 `-- CHECK: <ID> <이름>` 주석으로 구분한다.
--       scripts/verify-recovery.mjs가 이 주석을 기준으로 쪼개어 실행하고,
--       psql "$DATABASE_URL" -f 로 통째로 실행해도 같은 결과가 나온다.
--
-- 구성: I-01~I-20 = 골프롬프트 2E 불변 조건 20개
--       R-01~R-08 = 복구 검증용 보조 검사 (참조 무결성·테넌시·시각·큐 위생)
--
-- 주의: 이 파일은 실제 스키마(packages/db/src/schema/*.ts)의 컬럼명을 따른다.
--       런북 본문의 예시 SQL 일부는 Phase 0 시점 가칭 컬럼명(queue·job_type·
--       lease_until·inbox_messages 등)을 쓰고 있어 그대로 실행되지 않는다.
--       실행 가능한 정본은 이 파일이다.
-- ============================================================


-- CHECK: I-01 테넌트 격리 — organization_id와 RLS가 모든 테넌트 테이블을 덮는가
-- 근거: state-machines.md I-01, ADR-0003, RB-06 4-1. 위반 시 즉시 SEV1.
-- 제외 1: 플랫폼 공유 참조 데이터(교육과정 권위·개념 그래프)와 테넌트 루트·계정 미러.
-- 제외 2: authenticated에게 열지 않는 서버 전용 테이블(RLS는 켜고 정책을 두지 않아
--         기본 거부로 두는 것이 의도된 설계다).
select
  'organization_id 컬럼 없음'::text as issue,
  c.relname::text                   as object_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname not in (
    'organizations', 'users', 'su_maek_migrations', 'demo_requests', 'inbox_events',
    'curriculum_versions', 'curriculum_applicabilities', 'curriculum_authority_sources',
    'curriculum_releases', 'official_curriculum_nodes', 'achievement_standards',
    'competency_definitions', 'canonical_concepts', 'concept_edges',
    'learning_objectives', 'assessment_evidences', 'representations',
    'misconceptions', 'instructional_profiles'
  )
  and not exists (
    select 1 from pg_attribute a
    where a.attrelid = c.oid and a.attname = 'organization_id'
      and a.attnum > 0 and not a.attisdropped
  )
union all
select
  'RLS 미활성'::text,
  c.relname::text
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity
  and exists (
    select 1 from pg_attribute a
    where a.attrelid = c.oid and a.attname = 'organization_id'
      and a.attnum > 0 and not a.attisdropped
  )
union all
select
  '조직 격리 정책 없음'::text,
  c.relname::text
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and exists (
    select 1 from pg_attribute a
    where a.attrelid = c.oid and a.attname = 'organization_id'
      and a.attnum > 0 and not a.attisdropped
  )
  and c.relname not in (
    -- 서버 전용(기본 거부). 애플리케이션이 서비스 롤로만 접근한다.
    'jobs', 'outbox_events', 'idempotency_keys', 'schedule_leases',
    'kill_switches', 'audit_events'
  )
  -- 정책 이름이 아니라 **테넌트 판정 함수를 실제로 쓰는지**로 본다.
  -- 격리 정책의 이름은 하나가 아니다: *_org_isolation(전용 테넌트 테이블),
  -- *_scoped(organization_id nullable인 별칭·매핑). 이름으로 찾으면 후자를 놓친다.
  and not exists (
    select 1 from pg_policy p
    where p.polrelid = c.oid and p.polpermissive
      and pg_get_expr(p.polqual, p.polrelid) like '%auth_org_ids%'
  );


-- CHECK: I-02 게시·제출 후 불변 — 확정된 것을 덮어쓰지 않았는가
-- 근거: state-machines.md I-02, ADR-0008. 게시된 루트 버전과 제출된 답안은
--       사후 수정되지 않는다. updated_at이 확정 시각보다 뒤면 덮어쓴 것이다.
-- 여유 60초: 게시 트랜잭션 안에서 일어나는 후속 UPDATE(포인터 전환 등)를 허용한다.
select
  'route_versions 게시 후 수정'::text as issue,
  rv.id::text                          as object_id,
  rv.published_at                      as fixed_at,
  rv.updated_at                        as touched_at
from route_versions rv
where rv.status = 'published'
  and rv.published_at is not null
  and rv.updated_at > rv.published_at + interval '60 seconds'
union all
select
  'responses 제출 후 수정'::text,
  r.id::text,
  a.submitted_at,
  r.updated_at
from responses r
join attempts a on a.id = r.attempt_id
where a.submitted_at is not null
  and a.status in ('submitted', 'auto_graded', 'review_required', 'finalized')
  and r.updated_at > a.submitted_at + interval '60 seconds';


-- CHECK: I-03 학생 경로 구성 — 게시된 반 루트 버전 + 버전 있는 오버라이드
-- 근거: state-machines.md I-03, 원칙 3·4. 활성 오버라이드의 base는 반드시
--       존재하고 published여야 한다. 아니면 학생 경로를 계산할 수 없다.
select
  o.id::text                            as override_id,
  o.learner_id::text                    as learner_id,
  o.base_route_version_id::text         as base_route_version_id,
  coalesce(rv.status::text, '(없음)')   as base_status
from student_route_overrides o
left join route_versions rv on rv.id = o.base_route_version_id
where o.status = 'active'
  and (rv.id is null or rv.status <> 'published');


-- CHECK: I-04 오버라이드 격리 — 학생 오버라이드가 남의 루트를 건드리지 않는가
-- 근거: state-machines.md I-04. 오버라이드는 자기 base 버전 안에서만 닫혀야 한다.
--       재합류 지점이 다른 버전의 노드를 가리키면 반 루트를 가로질러 참조한 것이다.
select
  'rejoin_node가 base 버전 밖'::text as issue,
  o.id::text                          as override_id,
  o.base_route_version_id::text       as base_route_version_id,
  rn.route_version_id::text           as node_route_version_id
from student_route_overrides o
join route_nodes rn on rn.id = o.rejoin_node_id
where o.rejoin_node_id is not null
  and rn.route_version_id <> o.base_route_version_id
union all
select
  'base 버전이 다른 조직'::text,
  o.id::text,
  o.organization_id::text,
  rv.organization_id::text
from student_route_overrides o
join route_versions rv on rv.id = o.base_route_version_id
where rv.organization_id <> o.organization_id;


-- CHECK: I-05 과거 일정 보호 — 완료·취소 수업의 시각 정합
-- 근거: state-machines.md I-05. "과거를 재계산하지 않는다"는 이력이 없으면 직접
--       관측할 수 없다. 완료 처리의 시각 정합성으로 대리 검증하고, 실제 강제는
--       도메인 서비스와 속성 테스트가 담당한다(문서의 TEST 열).
select
  'completed인데 완료 시각 없음'::text as issue,
  s.id::text                            as session_id,
  s.session_date::text                  as session_date
from sessions s
where s.status = 'completed' and s.completed_at is null
union all
select
  '완료 시각이 수업 시작보다 이름'::text,
  s.id::text,
  s.session_date::text
from sessions s
where s.completed_at is not null and s.completed_at < s.starts_at
union all
select
  'cancelled인데 사유 없음'::text,
  s.id::text,
  s.session_date::text
from sessions s
where s.status = 'cancelled' and coalesce(s.cancelled_reason, '') = '';


-- CHECK: I-06 일정 하드 제약 — 시간 충돌이 DB에서 막히고 있는가
-- 근거: state-machines.md I-06, 마이그레이션 0001a 5장.
-- 교사·그룹 충돌은 EXCLUDE 제약이 막는다 — 제약 자체의 존재를 먼저 확인한다.
-- 학생 충돌은 DB 제약이 없으므로(그룹 소속을 거쳐야 판정 가능) 여기서 직접 검사한다.
select
  'EXCLUDE 제약 없음'::text as issue,
  x.conname::text            as detail
from (values ('sessions_teacher_no_overlap'), ('sessions_group_no_overlap')) as x(conname)
where not exists (select 1 from pg_constraint c where c.conname = x.conname)
union all
select
  '학습자 시간 충돌'::text,
  (s1.id::text || ' / ' || s2.id::text)
from sessions s1
join sessions s2
  on s1.organization_id = s2.organization_id
 and s1.id < s2.id
 and tstzrange(s1.starts_at, s1.ends_at) && tstzrange(s2.starts_at, s2.ends_at)
join learning_group_memberships m1
  on m1.learning_group_id = s1.learning_group_id and m1.status = 'active'
join learning_group_memberships m2
  on m2.learning_group_id = s2.learning_group_id and m2.status = 'active'
 and m2.learner_id = m1.learner_id
where s1.status in ('planned', 'confirmed', 'in_progress')
  and s2.status in ('planned', 'confirmed', 'in_progress');


-- CHECK: I-07 적격 문항만 평가에 포함 — 검수 완료본만 게시된 평가에 들어갔는가
-- 근거: state-machines.md I-07, 원칙 9.
-- 사후 격리(quarantined)는 위반이 아니다 — I-13이 과거 기록 보존을 요구한다.
-- 따라서 "격리된 적 없는데 승인된 적도 없는" 문항만 잡는다.
select
  aq.id::text            as assessment_question_id,
  aq.assessment_id::text as assessment_id,
  q.id::text             as question_id,
  q.review_status::text  as review_status
from assessment_questions aq
join assessment_instances ai on ai.id = aq.assessment_id
join question_versions qv on qv.id = aq.question_version_id
join questions q on q.id = qv.question_id
where ai.status in ('published', 'open', 'closed', 'grading', 'finalized')
  and aq.invalidated_at is null
  and q.quarantine_reason is null
  and q.review_status not in ('approved', 'published');


-- CHECK: I-08 평가 스냅샷 고정 — 게시 시점 내용이 그대로 보존되는가
-- 근거: state-machines.md I-08, ADR-0008.
-- assessment_questions.content_checksum은 게시 시 question_versions에서 복사한다
-- (apps/web/src/lib/domain/assessment.ts). 문항 버전은 불변이므로 둘은 항상 같아야
-- 한다. 다르면 스냅샷 또는 원본 중 하나가 훼손된 것이다.
select
  '스냅샷 체크섬 불일치'::text as issue,
  aq.id::text                   as assessment_question_id,
  aq.content_checksum           as snapshot_checksum,
  qv.content_checksum           as source_checksum
from assessment_questions aq
join question_versions qv on qv.id = aq.question_version_id
join assessment_instances ai on ai.id = aq.assessment_id
where ai.status in ('published', 'open', 'closed', 'grading', 'finalized')
  and aq.content_checksum <> qv.content_checksum
union all
select
  '게시 상태인데 게시 기록 없음'::text,
  ai.id::text,
  ai.status::text,
  coalesce(ai.published_by::text, '(null)')
from assessment_instances ai
where ai.status in ('published', 'open', 'closed', 'grading', 'finalized')
  and ai.published_at is null
union all
select
  '게시 상태인데 문항 스냅샷 0건'::text,
  ai.id::text,
  ai.status::text,
  '0'
from assessment_instances ai
where ai.status in ('published', 'open', 'closed', 'grading', 'finalized')
  and not exists (select 1 from assessment_questions aq where aq.assessment_id = ai.id);


-- CHECK: I-09 단일 제출 — 한 응시는 한 번만 제출된다
-- 근거: state-machines.md I-09. 상태와 시각이 어긋나면 제출 전이가 원자적이지 않았다.
select
  '제출 이후 상태인데 submitted_at 없음'::text as issue,
  a.id::text                                    as attempt_id,
  a.status::text                                as status
from attempts a
where a.status in ('submitted', 'auto_graded', 'review_required', 'finalized')
  and a.submitted_at is null
union all
select
  'finalized인데 finalized_at 없음'::text,
  a.id::text,
  a.status::text
from attempts a
where a.status = 'finalized' and a.finalized_at is null
union all
select
  '같은 평가·학습자에 진행 중 응시 2건 이상'::text,
  (a.assessment_id::text || ' / ' || a.learner_id::text),
  count(*)::text
from attempts a
where a.status = 'in_progress'
group by a.assessment_id, a.learner_id
having count(*) > 1;


-- CHECK: I-10 최종 채점 1건 = 증거 1건
-- 근거: state-machines.md I-10, 불변 조건 10. at-least-once 배달에서 중복 반영이
--       일어났는지, 확정되지 않은 결정이 숙련도에 새어 들어갔는지 본다.
select
  '채점 결정당 증거 중복'::text as issue,
  e.grade_decision_id::text      as grade_decision_id,
  e.concept_id::text             as concept_id,
  count(*)::text                 as evidence_count
from mastery_evidences e
where e.grade_decision_id is not null
group by e.grade_decision_id, e.concept_id
having count(*) > 1
union all
select
  '최종 아닌 결정이 증거로 반영'::text,
  e.grade_decision_id::text,
  e.concept_id::text,
  '1'
from mastery_evidences e
join grade_decisions d on d.id = e.grade_decision_id
where d.is_final = false
union all
select
  '답안당 최종 결정 2건 이상'::text,
  d.response_id::text,
  '-',
  count(*)::text
from grade_decisions d
where d.is_final = true
group by d.response_id
having count(*) > 1;


-- CHECK: I-11 숙련도 재현 가능 — 파생 결과가 원본 증거와 정합한가
-- 근거: state-machines.md I-11, 불변 조건 11.
-- policy_version_id는 활성 정책이 없으면 정당하게 NULL이다(recompute-mastery 참고).
-- 재현의 필수 입력은 evidence_cutoff_at이므로 그것만 필수로 본다.
-- 두 번째 검사는 읽기 모델 누락 탐지이며, scripts/rebuild-read-models.mjs가 고친다.
select
  'evidence_cutoff_at 없음'::text as issue,
  cm.id::text                      as concept_mastery_id,
  cm.learner_id::text              as learner_id,
  cm.concept_id::text              as concept_id
from concept_masteries cm
where cm.evidence_cutoff_at is null
union all
select
  '증거는 있는데 숙련도 행 없음'::text,
  '-',
  e.learner_id::text,
  e.concept_id::text
from mastery_evidences e
left join grade_decisions d on d.id = e.grade_decision_id
where (e.grade_decision_id is null or d.is_final = true)
  and not exists (
    select 1 from concept_masteries cm
    where cm.learner_id = e.learner_id and cm.concept_id = e.concept_id
  )
group by e.learner_id, e.concept_id;


-- CHECK: I-12 결정성 — 같은 입력·엔진·시드는 같은 결과 해시
-- 근거: state-machines.md I-12, ADR-0007. 재현 입력이 비어 있으면 결과를 검증할 수 없다.
select
  p.id::text     as proposal_id,
  p.status::text as status,
  case
    when p.input_hash is null then 'input_hash 없음'
    when p.engine_version is null then 'engine_version 없음'
    when p.seed is null then 'seed 없음'
    when p.output_hash is null then 'output_hash 없음'
    else 'result_revision_id 없음'
  end::text      as missing
from schedule_change_proposals p
where p.input_hash is null
   or p.engine_version is null
   or p.seed is null
   or (p.status in ('proposed', 'approved', 'applying', 'applied') and p.output_hash is null)
   or (p.status = 'applied' and p.result_revision_id is null);


-- CHECK: I-13 격리·권한 철회는 미래만 막고 과거를 지우지 않는다
-- 근거: state-machines.md I-13, ADR-0014. 격리·만료된 문항이 자동 출제 풀에 남아
--       있으면 "미래를 막는" 절반이 실패한 것이다.
select
  '격리된 문항이 자동 출제 가능'::text as issue,
  q.id::text                            as question_id,
  q.review_status::text                 as detail
from questions q
where (q.review_status = 'quarantined' or q.quarantine_reason is not null)
  and q.is_auto_assignable = true
union all
select
  '권한 만료·차단 문항이 자동 출제 가능'::text,
  q.id::text,
  cr.status::text
from questions q
join content_rights cr on cr.id = q.content_right_id
where q.is_auto_assignable = true
  and (cr.status in ('expired', 'blocked')
       or (cr.expires_on is not null and cr.expires_on < now()));


-- CHECK: I-14 시간 표현 — UTC 저장 + 계산에 쓴 시간대 ID 보존
-- 근거: state-machines.md I-14. timestamp without time zone이 하나라도 있으면
--       서머타임·시간대 변경에서 조용히 어긋난다.
select
  'timestamp without time zone 컬럼'::text as issue,
  (c.table_name || '.' || c.column_name)::text as detail
from information_schema.columns c
where c.table_schema = 'public'
  and c.data_type = 'timestamp without time zone'
union all
select
  '수업에 시간대 ID 없음'::text,
  s.id::text
from sessions s
where coalesce(s.timezone, '') = ''
union all
select
  '워크스페이스에 시간대 ID 없음'::text,
  o.id::text
from organizations o
where coalesce(o.timezone, '') = '';


-- CHECK: I-15 감사·학습 증거 불변 — append-only 강제가 살아 있는가
-- 근거: state-machines.md I-15, ADR-0015. 위반 시 즉시 SEV1.
-- 복원본에서 트리거가 빠지는 사고를 잡는 것이 이 검사의 목적이다.
-- 문서가 요구하는 대상은 audit_events·mastery_evidences·grade_decisions 셋이다
-- (ADR-0015 "같은 불변성을 mastery_evidences와 grade_decisions에도 적용한다").
-- progress_events는 마이그레이션 0001a가 추가로 보호한다.
select
  'append-only 트리거 없음'::text as issue,
  x.tbl::text                      as detail
from (values
  ('audit_events', 'audit_events_immutable'),
  ('mastery_evidences', 'mastery_evidences_immutable'),
  ('progress_events', 'progress_events_immutable'),
  ('grade_decisions', 'grade_decisions_immutable')
) as x(tbl, trg)
where not exists (
  select 1
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = x.tbl
    and t.tgname = x.trg and not t.tgisinternal
)
union all
select
  'forbid_mutation 함수 없음'::text,
  'public.forbid_mutation'::text
where not exists (
  select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'forbid_mutation'
);


-- CHECK: I-16 권위 소스 역추적 — 발행된 교육과정이 원문까지 되짚어지는가
-- 근거: state-machines.md I-16, ADR-0011, SLO O-12(목표 0건).
select
  'official_curriculum_nodes'::text as table_name,
  n.id::text                         as row_id,
  n.official_name                    as detail
from official_curriculum_nodes n
join curriculum_releases r on r.id = n.release_id
where r.status = 'published'
  and (
    n.source_id is null
    or not exists (
      select 1 from curriculum_authority_sources s
      where s.id = n.source_id and s.file_checksum is not null
    )
  )
union all
select
  'achievement_standards'::text,
  a.id::text,
  a.code
from achievement_standards a
join curriculum_releases r on r.id = a.release_id
where r.status = 'published'
  and (
    a.source_id is null
    or not exists (
      select 1 from curriculum_authority_sources s
      where s.id = a.source_id and s.file_checksum is not null
    )
  );


-- CHECK: I-17 선수 그래프 무순환 — 강한 선수 관계에 순환이 없는가
-- 근거: state-machines.md I-17, ADR-0011. 순환이 생기면 루트 검증이 종료하지 않는다.
-- 경로 길이 50에서 자른다 — 그보다 긴 순환은 이미 첫 반복에서 잡힌다.
with recursive prereq(root_id, current_id, path, is_cycle) as (
  select e.from_concept_id, e.to_concept_id,
         array[e.from_concept_id, e.to_concept_id], false
  from concept_edges e
  where e.kind = 'prerequisite' and e.status <> 'deprecated'
  union all
  select p.root_id, e.to_concept_id,
         p.path || e.to_concept_id, e.to_concept_id = any(p.path)
  from prereq p
  join concept_edges e
    on e.from_concept_id = p.current_id
   and e.kind = 'prerequisite'
   and e.status <> 'deprecated'
  where not p.is_cycle and array_length(p.path, 1) < 50
)
select
  root_id::text    as root_concept_id,
  current_id::text as repeated_concept_id,
  array_length(path, 1)::text as cycle_length
from prereq
where is_cycle;


-- CHECK: I-18 게시 콘텐츠 렌더 건전성 — 학생 화면에 깨진 수식이 없는가
-- 근거: state-machines.md I-18, ADR-0013, SLO O-11(목표 0건). 위반 시 SEV1.
select
  '미검증 수식이 게시 평가에 포함'::text as issue,
  me.id::text                             as expression_id,
  aq.assessment_id::text                  as assessment_id,
  me.parse_status::text                   as detail
from assessment_questions aq
join assessment_instances ai on ai.id = aq.assessment_id
join math_expressions me on me.question_version_id = aq.question_version_id
where ai.status in ('published', 'open', 'closed', 'grading', 'finalized')
  and aq.invalidated_at is null
  and (me.parse_status in ('pending', 'review_required', 'rejected')
       or me.normalized_latex is null)
union all
select
  '미검수 도형이 게시 평가에 포함'::text,
  da.id::text,
  aq.assessment_id::text,
  da.review_status
from assessment_questions aq
join assessment_instances ai on ai.id = aq.assessment_id
join diagram_assets da on da.question_version_id = aq.question_version_id
where ai.status in ('published', 'open', 'closed', 'grading', 'finalized')
  and aq.invalidated_at is null
  and da.review_status <> 'approved';


-- CHECK: I-19 수식 재현 가능 — 저장된 버전으로 다시 렌더할 수 있는가
-- 근거: state-machines.md I-19, ADR-0013. 렌더 버전 3종과 의미 지문이 있어야
--       web·PDF·HWPX가 같은 수식을 만든다.
select
  me.id::text            as expression_id,
  aq.assessment_id::text as assessment_id,
  case
    when me.normalizer_version is null then 'normalizer_version 없음'
    when me.katex_version is null then 'katex_version 없음'
    when me.semantic_fingerprint is null then 'semantic_fingerprint 없음'
    else 'render_hash 없음'
  end::text              as missing
from assessment_questions aq
join assessment_instances ai on ai.id = aq.assessment_id
join math_expressions me on me.question_version_id = aq.question_version_id
where ai.status in ('published', 'open', 'closed', 'grading', 'finalized')
  and aq.invalidated_at is null
  and (me.normalizer_version is null
       or me.katex_version is null
       or me.semantic_fingerprint is null
       or me.render_hash is null);


-- CHECK: I-20 제품 경계 — 비범위 도메인 데이터를 영속화하지 않는가
-- 근거: state-machines.md I-20, 골프롬프트 1A·24장. scripts/boundary-check.mjs가
--       소스에서 막고, 이 검사는 실제 DB에 남았는지를 본다. (boundary-allow: 탐지 규칙)
select
  '금지 컬럼 존재'::text                        as issue,
  (c.table_name || '.' || c.column_name)::text  as detail
from information_schema.columns c
where c.table_schema = 'public'
  and c.column_name ~ '(payment|invoice|tuition|payroll|guardian_contact|counseling_log|vehicle_route|attendance_ledger)' -- boundary-allow: 금지 컬럼 탐지 규칙 자체
union all
select
  '연동에 허용 필드 목록 없음'::text,
  ic.id::text
from integration_connections ic
where ic.status = 'connected'
  and (ic.allowed_fields is null or jsonb_array_length(ic.allowed_fields) = 0);


-- ============================================================
-- 보조 검사 R-01~R-08 — 복구·부분 병합 후 정합성
-- backup-recovery.md 5.1의 V-3·V-4·V-7·V-9·V-10에 대응한다.
-- ============================================================


-- CHECK: R-01 고아 참조 — 논리 FK가 가리키는 부모가 사라졌는가
-- 근거: backup-recovery.md V-3. 부분 병합(5.6)이 가장 깨뜨리기 쉬운 지점이다.
-- 일부 경로만 DB FK로 강제된다(마이그레이션 0001a 7장). 나머지는 여기서만 잡힌다.
select 'attempts.assessment_id'::text as fk, a.id::text as row_id
from attempts a
where not exists (select 1 from assessment_instances i where i.id = a.assessment_id)
union all
select 'responses.attempt_id', r.id::text
from responses r
where not exists (select 1 from attempts a where a.id = r.attempt_id)
union all
select 'responses.assessment_question_id', r.id::text
from responses r
where not exists (select 1 from assessment_questions q where q.id = r.assessment_question_id)
union all
select 'grade_decisions.response_id', d.id::text
from grade_decisions d
where not exists (select 1 from responses r where r.id = d.response_id)
union all
select 'assignments.assessment_id', g.id::text
from assignments g
where not exists (select 1 from assessment_instances i where i.id = g.assessment_id)
union all
select 'assignments.learner_id', g.id::text
from assignments g
where not exists (select 1 from learners l where l.id = g.learner_id)
union all
select 'assessment_questions.assessment_id', q.id::text
from assessment_questions q
where not exists (select 1 from assessment_instances i where i.id = q.assessment_id)
union all
select 'mastery_evidences.learner_id', e.id::text
from mastery_evidences e
where not exists (select 1 from learners l where l.id = e.learner_id)
union all
select 'mastery_evidences.grade_decision_id', e.id::text
from mastery_evidences e
where e.grade_decision_id is not null
  and not exists (select 1 from grade_decisions d where d.id = e.grade_decision_id)
union all
select 'concept_masteries.learner_id', cm.id::text
from concept_masteries cm
where not exists (select 1 from learners l where l.id = cm.learner_id)
union all
select 'sessions.learning_group_id', s.id::text
from sessions s
where not exists (select 1 from learning_groups g where g.id = s.learning_group_id)
union all
select 'sessions.schedule_revision_id', s.id::text
from sessions s
where s.schedule_revision_id is not null
  and not exists (select 1 from schedule_revisions r where r.id = s.schedule_revision_id)
union all
select 'learning_group_memberships.learner_id', m.id::text
from learning_group_memberships m
where not exists (select 1 from learners l where l.id = m.learner_id)
union all
select 'schedule_revisions.proposal_id', r.id::text
from schedule_revisions r
where r.proposal_id is not null
  and not exists (select 1 from schedule_change_proposals p where p.id = r.proposal_id)
union all
select 'route_plans.active_version_id', p.id::text
from route_plans p
where p.active_version_id is not null
  and not exists (select 1 from route_versions v where v.id = p.active_version_id)
union all
select 'route_nodes.route_version_id', n.id::text
from route_nodes n
where not exists (select 1 from route_versions v where v.id = n.route_version_id)
union all
select 'questions.current_version_id', q.id::text
from questions q
where q.current_version_id is not null
  and not exists (select 1 from question_versions v where v.id = q.current_version_id)
union all
select 'grading_exceptions.attempt_id', e.id::text
from grading_exceptions e
where not exists (select 1 from attempts a where a.id = e.attempt_id)
union all
select 'review_items.learner_id', i.id::text
from review_items i
where not exists (select 1 from learners l where l.id = i.learner_id)
union all
select 'retry_plans.failed_assessment_id', p.id::text
from retry_plans p
where not exists (select 1 from assessment_instances i where i.id = p.failed_assessment_id)
union all
select 'makeup_sessions.original_session_id', m.id::text
from makeup_sessions m
where not exists (select 1 from sessions s where s.id = m.original_session_id)
union all
select 'memberships.organization_id', m.id::text
from memberships m
where not exists (select 1 from organizations o where o.id = m.organization_id)
union all
select 'data_deletion_requests.learner_id', d.id::text
from data_deletion_requests d
where d.learner_id is not null
  and not exists (select 1 from learners l where l.id = d.learner_id);


-- CHECK: R-02 테넌시 정합 — 자식 행이 부모와 같은 조직에 있는가
-- 근거: I-01의 데이터 측면. organization_id는 있는데 부모와 값이 다르면
--       RLS는 통과하면서 조직 경계를 가로지르는 행이 만들어진다. RB-06 대상.
select 'attempts vs assessment_instances'::text as relation, a.id::text as row_id
from attempts a
join assessment_instances i on i.id = a.assessment_id
where a.organization_id <> i.organization_id
union all
select 'responses vs attempts', r.id::text
from responses r
join attempts a on a.id = r.attempt_id
where r.organization_id <> a.organization_id
union all
select 'grade_decisions vs responses', d.id::text
from grade_decisions d
join responses r on r.id = d.response_id
where d.organization_id <> r.organization_id
union all
select 'assessment_questions vs assessment_instances', q.id::text
from assessment_questions q
join assessment_instances i on i.id = q.assessment_id
where q.organization_id <> i.organization_id
union all
select 'assignments vs assessment_instances', g.id::text
from assignments g
join assessment_instances i on i.id = g.assessment_id
where g.organization_id <> i.organization_id
union all
select 'mastery_evidences vs learners', e.id::text
from mastery_evidences e
join learners l on l.id = e.learner_id
where e.organization_id <> l.organization_id
union all
select 'concept_masteries vs learners', cm.id::text
from concept_masteries cm
join learners l on l.id = cm.learner_id
where cm.organization_id <> l.organization_id
union all
select 'sessions vs learning_groups', s.id::text
from sessions s
join learning_groups g on g.id = s.learning_group_id
where s.organization_id <> g.organization_id
union all
select 'route_versions vs route_plans', v.id::text
from route_versions v
join route_plans p on p.id = v.route_plan_id
where v.organization_id <> p.organization_id
union all
select 'route_nodes vs route_versions', n.id::text
from route_nodes n
join route_versions v on v.id = n.route_version_id
where n.organization_id <> v.organization_id
union all
select 'learning_group_memberships vs learners', m.id::text
from learning_group_memberships m
join learners l on l.id = m.learner_id
where m.organization_id <> l.organization_id
union all
select 'data_deletion_requests vs learners', d.id::text
from data_deletion_requests d
join learners l on l.id = d.learner_id
where d.organization_id <> l.organization_id;


-- CHECK: R-03 채점 완결성 — 확정된 응시에 채점 결정이 있는가
-- 근거: backup-recovery.md V-5, RB-12. 확정(finalized)은 "채점이 끝났다"는 선언이므로
--       답안마다 최종 결정이 하나 있어야 한다.
select
  '확정 응시인데 채점 결정 없음'::text as issue,
  a.id::text                            as attempt_id,
  r.id::text                            as response_id
from attempts a
join responses r on r.attempt_id = a.id
where a.status = 'finalized'
  and not exists (
    select 1 from grade_decisions d where d.response_id = r.id and d.is_final = true
  )
union all
select
  '확정 응시인데 답안 0건'::text,
  a.id::text,
  '-'
from attempts a
where a.status = 'finalized'
  and not exists (select 1 from responses r where r.attempt_id = a.id);


-- CHECK: R-04 이벤트 사슬 — 배달 완료 이벤트가 소비자 작업을 만들었는가
-- 근거: ADR-0006, RB-04 V-8. dispatchOutbox가 delivered로 표시하기 전에
--       소비자별 작업을 같은 트랜잭션에서 넣는다. 하나라도 없으면 사슬이 끊겼다.
-- 라우팅 표는 packages/db/src/queue.ts의 EVENT_CONSUMERS와 **동기화해야 한다**.
-- 작업 멱등성 키 = '{topic}:{event_id}'.
with consumers(event_type, topic) as (
  values
    ('RoutePublished', 'schedule.materialize'),
    ('RoutePublished', 'readmodel.refresh'),
    ('SessionCompleted', 'schedule.recalculate'),
    ('SessionCompleted', 'readmodel.refresh'),
    ('LearningAvailabilityChanged', 'schedule.recalculate'),
    ('AssessmentPublished', 'notification.dispatch'),
    ('AttemptSubmitted', 'grading.auto'),
    ('GradeFinalized', 'mastery.update'),
    ('MasteryUpdated', 'review.plan'),
    ('MasteryUpdated', 'schedule.recalculate'),
    ('ScheduleProposalCreated', 'notification.dispatch'),
    ('ScheduleProposalApplied', 'notification.dispatch'),
    ('ContentApproved', 'readmodel.refresh'),
    ('CurriculumReleasePublished', 'curriculum.impact-analysis'),
    ('FormulaReviewRequired', 'notification.dispatch'),
    ('QuestionQuarantined', 'assessment.exclude-question'),
    ('QuestionQuarantined', 'notification.dispatch'),
    ('ContentRightsRevoked', 'content.rights-impact'),
    ('ContentRightsRevoked', 'notification.dispatch')
)
select
  e.id::text         as event_id,
  e.event_type       as event_type,
  c.topic            as missing_topic,
  e.delivered_at     as delivered_at
from outbox_events e
join consumers c on c.event_type = e.event_type
where e.status = 'delivered'
  and e.delivered_at is not null
  and not exists (
    select 1 from jobs j
    where j.topic = c.topic and j.idempotency_key = c.topic || ':' || e.id::text
  );


-- CHECK: R-05 활성 포인터 정합 — 지금 유효한 버전이 하나뿐이고 게시본을 가리키는가
-- 근거: backup-recovery.md V-4, RB-05 6장 V-4.
select
  '스코프당 활성 일정 리비전 2개 이상'::text as issue,
  (r.scope_type || ':' || r.scope_id::text)   as scope,
  count(*)::text                              as detail
from schedule_revisions r
where r.is_active = true
group by r.scope_type, r.scope_id
having count(*) > 1
union all
select
  '활성 리비전 없는 스코프에 수업 존재'::text,
  ('learning_group:' || s.learning_group_id::text),
  count(*)::text
from sessions s
where s.schedule_revision_id is not null
  and not exists (
    select 1 from schedule_revisions r
    where r.id = s.schedule_revision_id and r.is_active = true
  )
  and s.status in ('planned', 'confirmed')
group by s.learning_group_id
union all
select
  '활성 루트 버전이 published가 아님'::text,
  p.id::text,
  coalesce(v.status::text, '(없음)')
from route_plans p
left join route_versions v on v.id = p.active_version_id
where p.active_version_id is not null
  and (v.id is null or v.status <> 'published');


-- CHECK: R-06 시각 정합 — 시간이 거꾸로 흐른 행이 있는가
-- 근거: 복원본에서 가장 먼저 드러나는 손상 신호. 여유 5초는 트랜잭션 내
--       now() 고정과 클라이언트 시계 오차를 흡수한다.
select 'attempts.updated_at < created_at'::text as issue, a.id::text as row_id
from attempts a where a.updated_at < a.created_at - interval '5 seconds'
union all
select 'responses.updated_at < created_at', r.id::text
from responses r where r.updated_at < r.created_at - interval '5 seconds'
union all
select 'sessions.updated_at < created_at', s.id::text
from sessions s where s.updated_at < s.created_at - interval '5 seconds'
union all
select 'jobs.updated_at < created_at', j.id::text
from jobs j where j.updated_at < j.created_at - interval '5 seconds'
union all
select 'attempts.submitted_at < started_at', a.id::text
from attempts a
where a.started_at is not null and a.submitted_at is not null
  and a.submitted_at < a.started_at
union all
select 'attempts.finalized_at < submitted_at', a.id::text
from attempts a
where a.submitted_at is not null and a.finalized_at is not null
  and a.finalized_at < a.submitted_at
union all
select 'sessions.ends_at <= starts_at', s.id::text
from sessions s where s.ends_at <= s.starts_at
union all
select 'course_periods.ends_on < starts_on', c.id::text
from course_periods c where c.ends_on < c.starts_on
union all
select 'holidays.ends_on < starts_on', h.id::text
from holidays h where h.ends_on < h.starts_on
union all
select 'audit_events.created_at 미래', e.id::text
from audit_events e where e.created_at > now() + interval '5 minutes';


-- CHECK: R-07 큐 위생 — 작업 상태가 스스로 모순되지 않는가
-- 근거: RB-04 4-2·4-6, backup-recovery.md V-7. 복구 직후 lease 정리(RB-05 5.8)가
--       빠지면 running 상태로 굳은 작업이 남는다.
select
  'dead_lettered인데 사유 없음'::text as issue,
  j.id::text                           as job_id,
  j.topic                              as topic
from jobs j
where j.status = 'dead_lettered' and coalesce(j.last_error, '') = ''
union all
select
  'running인데 lease 1시간 이상 만료'::text,
  j.id::text,
  j.topic
from jobs j
where j.status = 'running'
  and (j.lease_expires_at is null or j.lease_expires_at < now() - interval '1 hour')
union all
select
  'succeeded인데 멱등 키 중복'::text,
  (j.topic || ':' || j.idempotency_key),
  count(*)::text
from jobs j
where j.status = 'succeeded' and j.idempotency_key is not null
group by j.topic, j.idempotency_key
having count(*) > 1
union all
select
  '재시도 한도를 넘겼는데 대기 상태'::text,
  j.id::text,
  j.topic
from jobs j
where j.status in ('queued', 'retry_scheduled') and j.attempts > j.max_attempts;


-- CHECK: R-08 append-only 테이블 위생 — 기록 자체가 앞뒤가 맞는가
-- 근거: I-15의 데이터 측면. 이 테이블들은 updated_at이 없으므로
--       "updated_at < created_at" 대신 사건 시각과 기록 시각의 정합을 본다.
select
  'mastery_evidences: 발생 시각이 기록보다 미래'::text as issue,
  e.id::text                                            as row_id
from mastery_evidences e
where e.occurred_at > e.created_at + interval '5 minutes'
union all
select
  'mastery_evidences: evidence_date와 occurred_at 불일치',
  e.id::text
from mastery_evidences e
where abs(extract(epoch from (e.occurred_at - e.evidence_date::timestamptz))) > 172800
union all
select
  'progress_events: 발생 시각이 기록보다 미래',
  p.id::text
from progress_events p
where p.occurred_at > p.created_at + interval '5 minutes'
union all
select
  'grade_decisions: 이전 버전 참조가 자기 자신',
  d.id::text
from grade_decisions d
where d.supersedes_id = d.id
union all
select
  'grade_decisions: 대체 대상이 다른 답안',
  d.id::text
from grade_decisions d
join grade_decisions prev on prev.id = d.supersedes_id
where prev.response_id <> d.response_id;


-- CHECK: R-09 개인정보 삭제 요청 — 접수한 것이 실제로 처리되었는가
-- 근거: ADR-0015 §5(처리 기한 영업일 10일)·§7(백업 만료일 고지),
--       docs/phase0/backup-recovery.md 10.2,
--       docs/runbooks/05-db-failure-pitr.md 5.9(PITR 후 재실행)
-- PITR로 되돌리면 지웠던 개인정보가 되살아난다. 복구 검증에서 이 검사가
-- 0행이 아니면 5.9의 재실행이 끝나지 않은 것이다.
select
  'completed인데 처리 시각 없음'::text as issue,
  d.id::text                            as request_id,
  d.status::text                        as status,
  d.due_on::text                        as due_on
from data_deletion_requests d
where d.status = 'completed' and d.executed_at is null
union all
select
  '처리 시각은 있는데 completed가 아님'::text,
  d.id::text,
  d.status::text,
  d.due_on::text
from data_deletion_requests d
where d.executed_at is not null and d.status <> 'completed'
union all
select
  'completed인데 백업 만료일 고지 없음'::text,
  d.id::text,
  d.status::text,
  d.due_on::text
from data_deletion_requests d
where d.status = 'completed' and d.backup_expires_on is null
union all
select
  '처리 기한이 지났는데 미처리'::text,
  d.id::text,
  d.status::text,
  d.due_on::text
from data_deletion_requests d
where d.status in ('received', 'processing') and d.due_on < current_date
union all
select
  'learner 대상인데 학습자가 지정되지 않음'::text,
  d.id::text,
  d.status::text,
  d.due_on::text
from data_deletion_requests d
where d.subject_type = 'learner' and d.learner_id is null;
