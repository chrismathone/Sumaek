-- ============================================================
-- 0019a — workspace_kind에 'platform' 추가 (ADR-0020 1단계 앞쪽)
--
-- **이 파일은 값만 더한다.** 값을 쓰는 일(플랫폼 조직 행 만들기)은
-- 0019b가 한다. 나누는 이유는 PostgreSQL이 막기 때문이다 —
-- migrate.ts가 마이그레이션 하나를 sql.begin으로 감싸는데, 같은
-- 트랜잭션에서 새 enum 값을 쓰면 17.6이 이렇게 거부한다:
--
--   ERROR: unsafe use of new value "platform" of enum type workspace_kind
--
-- 한 파일에 몰면 배포가 그 자리에서 죽는다. (2026-08-05 실측)
-- ============================================================

alter type workspace_kind add value if not exists 'platform';
