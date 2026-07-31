# Phase 0 조사 — D:\edutrix · D:\ijw-calander

> 조사일: 2026-07-31. 읽기 전용 요약.

## 통합 관점 결론

- 두 프로젝트는 이미 서로 읽고 있다 (ijw가 edutrix Supabase 직접 조회 + 보강 귀속 휴리스틱 추측). 수맥에서는 **수업 실행 ↔ 진도 기록이 하나의 트랜잭션 경계**여야 한다는 실증.
- 재사용 가치 높은 덩어리는 4개: edutrix 컨테이너 이벤트 판정·속도 산식, ijw 학생 충돌 감지·교시 상수. 전부 순수 함수.
- **847 단일 순번 체계는 승계가 아니라 제거 대상** (골프롬프트 3장의 경고 실증).

## edutrix 이식 자산

- **컨테이너 이벤트 판정**: `lib/progress-analytics/container-detector.ts` — 순수 함수, JUMP_ERROR_THRESHOLD=20, CONTAINER_CAPACITY=20, 우선순위 jump_error→overlap→full→regression→forward
- **부분 유니크 인덱스 패턴**: `progress_tracking_math.sql:52-54` — `WHERE status='active'`로 학생×트랙당 활성 박스 1개 DB 강제 (수맥 schedule_revisions_active_uq에 이미 채택)
- **속도 산식 v3**: `speed-bucketing.ts:155-189` — 인접 리포트 간 positive delta 합산 / 결석 제외 수업일. v1(위치차·퇴행 왜곡)·v2(엔트리 수·빈도 오염) 폐기 이력 주석
- **트랙별 속도**: `progressAnalyticsActions.ts:254-299` — 분자·분모를 컨테이너 entries 단일 소스로 (풀스캔이라 집계로 재구현)
- **ingest 멱등성**: report_id 기준 존재 확인 (`progressContainerActions.ts:327-334`)
- **백분위 유틸**: `percentile.ts` 동점 평균 순위
- **current/ahead 분류**: "후행 없음" 결정 계승, 학년 문자열 비교는 노드 ID 비교로 재구현
- 휴일 데이터 2025~2027: `lib/holidays.ts:16` (ijw보다 품질 좋음)

## edutrix 결함 (회피 대상)

- **847 순번 5중 문제**: ① order 필드 847/847 전부 불일치 ② 대수 블록 2세대 혼입+chapter 번호 오류 ③ 초3~중2 약 400개가 2015 개정 정체 ④ 택일 과목(확통·기하) 직선 배치 ⑤ global_position에 커리큘럼 버전 참조 없음 → 재스크랩 시 과거 기록 의미 전체 변경. **소단원 텍스트만 데이터 추출, 체계는 버전드 노드 그래프로 대체**
- 진도 텍스트 4단 fallback 파서 (`findProgressPosition`) — 입력 단계에서 노드 ID를 받으면 불필요
- 예측 단위 불일치: 수업일 속도 × 달력일 → 주2회 학생 3.5배 과대 추정
- 과목별 테이블 물리 복제 (`en_` 접두사), RLS 전부 USING(true)
- events 테이블 UPDATE/DELETE 정책 미생성으로 불변성 확보한 기법은 계승 (수맥은 명시 트리거로 강화)

## ijw-calander 이식 자산

- **학생 시간충돌 감지**: `TimetableManager.tsx:73-140` — 순수 함수 + **테스트 222줄 20케이스** (`tests/components/scheduleConflicts.test.ts` — 경계 접촉 비충돌, 퇴원생 제외). 신규 충돌 엔진의 명세로 전용
- **교시/시간 상수**: `components/Timetable/constants.ts` — 수학 8교시 55분, 영어 10교시 40분 등 실운영값 + 레거시 변환 맵
- **부서×요일 주간 매트릭스** (WeekBlock) — 학원 특화 축, 구조 참고
- 연간 히트맵 (YearlyView) — 발상 참고
- enrollment 2단 audit(갱신형+불변형)·cancelledAt(예약취소≠삭제) 설계 의도

## ijw-calander 결함 (회피 대상)

- 반복 일정 = 문서 N개 물리 복제 (`useEventCrud.ts:53-137`) — 무한 반복·EXDATE·시리즈 수정 불가 → 수맥: 규칙 기반(캘린더 규칙 + 엔진 계산)
- **보강 도메인 모델 부재** (makeup 식별자 0건) — '특강/보강' 문자열 임시 enrollment, 결석과 연결 없음 → 수맥 makeup_sessions가 1급 개념
- 교사 충돌 검사가 day-periodId 완전일치만 — 과목 간 실제 겹침 미탐 → 수맥: tstzrange EXCLUDE (DB 강제)
- 예약 변경이 클라이언트 마운트 시 1회 적용 — 화면 안 열면 미적용 → 수맥: 워커
- studentId가 "이름_학교_학년" 복합 문자열 — 동명이인·전학 취약 → 수맥: UUID
- 휴일 하드코딩 2벌 불일치, 2031년 절벽, 음력 계산 없음
- 충돌 판정 표현 3종 분열 (문자열/분정수/슬롯키) → 수맥: 단일 엔진
