# 핵심 흐름 시퀀스 다이어그램

> 골프롬프트 2A(최소 시퀀스 다이어그램 대상 8종) 이행 문서.
> 관련: [api-contract.md](./api-contract.md) · [event-catalog.md](./event-catalog.md) · [state-machines.md](./state-machines.md)

## 참여자 표기

| 표기 | 실체 |
|---|---|
| `Web` | `apps/web` — Next.js Server Action 또는 Route Handler |
| `Core` | `packages/core` — 순수 도메인 (I/O 없음) |
| `DB` | PostgreSQL (Supabase). 트랜잭션 경계를 `BEGIN`/`COMMIT`으로 표기 |
| `Relay` | `apps/worker`의 Outbox 릴레이 |
| `W:<큐>` | `apps/worker`의 해당 큐 핸들러 |
| `Storage` | Supabase Storage |
| `AI` | AI·OCR 어댑터 (`mock` 또는 `anthropic`) |

---

## S-1. 반 루트 게시와 날짜별 수업 생성

```mermaid
sequenceDiagram
    autonumber
    actor T as 선생님
    participant Web
    participant Core
    participant DB
    participant Relay
    participant WS as W:schedule
    participant WR as W:default

    T->>Web: POST /routes/versions/{id}:preview-impact
    Web->>DB: 루트 버전 · 달력 · 그룹 소속 · 완료 진도 스냅샷 조회
    Web->>Core: buildScheduleInput(snapshot) → input_hash
    Web->>Core: simulate(input, engineVersion, seed)
    Core-->>Web: 영향 요약 (변경 반·학생·차시·테스트·종료일·적용 안 되는 잠금 구간)
    Web-->>T: 200 영향 미리보기 (부작용 없음)

    T->>Web: POST /routes/versions/{id}:publish<br/>If-Match: "7" · Idempotency-Key · X-Reauth-Token
    Web->>DB: BEGIN
    Web->>DB: idempotency_keys INSERT ON CONFLICT DO NOTHING
    Web->>DB: SELECT route_versions WHERE id AND version=7 FOR UPDATE
    alt version 불일치
        DB-->>Web: 0 rows
        Web-->>T: 409 VERSION_CONFLICT
    end
    Web->>Core: assertPublishable(routeVersion)
    Note over Core: status='ready' · 선수 공백 0 ·<br/>문항 수급 가능 · 커버리지 보고 존재
    Web->>DB: UPDATE route_versions SET status='published', published_at=now()
    Web->>DB: UPDATE route_versions SET status='superseded' WHERE id=이전활성
    Web->>DB: UPDATE route_plans SET active_version_id=$new (원자적 포인터 전환)
    Web->>DB: INSERT route_publications (impact_summary)
    Web->>DB: INSERT outbox_events (RoutePublished, aggregate_version=7)
    Web->>DB: INSERT audit_events (action='route.publish', before/after, permission_basis)
    Web->>DB: COMMIT
    Web-->>T: 200 "루트를 게시했습니다" + ETag: "8"

    Relay->>DB: SELECT outbox_events WHERE status='pending' ORDER BY (status,next_attempt_at,id) LIMIT 200
    Relay->>WS: RoutePublished 배달 (consumer=session-execution)
    WS->>DB: BEGIN
    WS->>DB: INSERT inbox_messages (consumer_name,event_id) — 중복이면 UNIQUE 위반 → skip
    WS->>DB: 달력 · 휴일 · 교사 가용 · 그룹 소속 스냅샷 조회
    WS->>Core: materializeSessions(routeVersion, calendar, baseline_at=now)
    Note over Core: 하드 제약 적용:<br/>휴일 · 수업 가능일 · 하루 학습량 상한<br/>완료·잠금 수업 제외
    Core-->>WS: planned sessions[]
    WS->>DB: INSERT sessions (status='planned') — EXCLUDE 제약이 교사·그룹 충돌 최종 차단
    alt EXCLUDE 위반
        DB-->>WS: 23P01 exclusion_violation
        WS->>DB: ROLLBACK
        WS->>DB: INSERT notifications (일정 충돌 · 권장 행동 · 기한)
        Note over WS: 부분 결과를 노출하지 않는다.<br/>이전 활성 일정 유지.
    end
    WS->>DB: COMMIT

    Relay->>WR: RoutePublished 배달 (consumer=notifier, read-model)
    WR->>DB: 오늘 운영실 읽기 모델 증분 갱신 + 담당 교사 알림
```

**계약 요약**

| 보장 | 근거 |
|---|---|
| 게시 후 루트 내용 불변 | `route_versions` UPDATE 트리거 (I-02) |
| 활성 버전 전환은 원자적 | 같은 트랜잭션의 포인터 UPDATE |
| 완료·잠금 수업 미변경 | `baseline_at` + `is_locked` 필터 (I-05) |
| 충돌 최종 차단 | `EXCLUDE USING gist` (I-06) |
| 중복 게시 방지 | `Idempotency-Key` + `If-Match` |

---

## S-2. 학습 불참 이벤트 수신과 미래 일정 변경안 승인

```mermaid
sequenceDiagram
    autonumber
    participant SIS as 외부 SIS
    participant Web
    participant DB
    participant Relay
    participant WP as W:schedule (planning-engine)
    participant Core
    actor T as 선생님

    SIS->>Web: POST /learning-availability-events<br/>Authorization: Bearer <service-token><br/>Idempotency-Key
    Web->>Web: zod .strict() 파싱
    alt 금지 계열 필드 포함 (payment/guardian_contact 등)
        Web-->>SIS: 400 FIELD_NOT_ALLOWED + SEV3 알림
    else 알 수 없는 필드만
        Web->>DB: UPDATE integration_connections SET discarded_field_count = +1
        Note over Web: 필드 폐기 후 처리 계속
    end
    Web->>DB: BEGIN
    Web->>DB: INSERT learning_availability_events<br/>UNIQUE (organization_id, source, external_event_id)
    alt 중복 수신
        DB-->>Web: 23505
        Web->>DB: ROLLBACK
        Web-->>SIS: 200 (멱등 — 기존 결과 재생)
    end
    Web->>DB: INSERT outbox_events (LearningAvailabilityChanged)
    Web->>DB: COMMIT
    Web-->>SIS: 202 Accepted

    Relay->>WP: LearningAvailabilityChanged (consumer=planning-engine)
    WP->>DB: INSERT inbox_messages (중복 차단)
    WP->>DB: INSERT compute_leases (scope=student, period) ON CONFLICT DO NOTHING
    alt lease 획득 실패
        WP->>DB: jobs 재등록 (run_after = now()+30s)
        Note over WP: 전역 잠금을 쓰지 않는다.<br/>범위 lease + 입력 버전 비교만.
    end
    WP->>DB: 불변 스냅샷 조립<br/>(루트 버전 · 달력 버전 · 그룹 소속 · 오버라이드 ·<br/>완료 진도 기준 시각 · 정책 버전 · 시간대 · 엔진 버전 · 시드)
    WP->>DB: INSERT schedule_change_proposals (status='calculating', input_hash)
    WP->>Core: recompute(input)
    Note over Core: 하드 제약: 휴일 · 잠금·완료 ·<br/>교사/그룹/학생 충돌 · 수업 가능일 · 일일 상한<br/>소프트: 선호 요일 · 균등 학습량 · 버퍼 ·<br/>목표일 · 기존 미래 일정 변경 최소화
    Core-->>WP: { diff, reason_codes, conflicts, output_hash }
    WP->>DB: UPDATE proposals SET status='proposed', output_hash, diff, reason_codes
    WP->>DB: INSERT outbox_events (ScheduleProposalCreated)
    WP->>DB: DELETE compute_leases

    Relay->>Web: ScheduleProposalCreated (consumer=notifier)
    Web->>DB: INSERT notifications (무엇이·왜·영향 대상·권장 행동·기한)

    T->>Web: GET /schedule/proposals/{id}
    Web-->>T: 변경 전/후 · 이유 코드 · 충돌 · 영향 학생 · 종료일 변화 ·<br/>잠금 때문에 바뀌지 않는 항목

    T->>Web: POST /schedule/proposals/{id}:apply<br/>{expected_input_hash, expected_output_hash}
    Web->>DB: 현재 원본으로 input_hash 재계산
    alt 해시 불일치 (그 사이 원본 변경)
        Web-->>T: 409 STALE_PROPOSAL {expected, actual}
        Note over T: 다시 계산해야 한다. 조용히 적용하지 않는다.
    end
    Web->>DB: 킬스위치 auto_schedule_recalc 확인
    Web->>DB: BEGIN
    Web->>DB: UPDATE proposals SET status='applying'
    Web->>DB: UPDATE/INSERT sessions (미래만 · baseline_at 이후)
    Note over DB: EXCLUDE 제약이 충돌 최종 차단.<br/>완료·잠금 행은 트리거가 UPDATE 거부.
    Web->>DB: UPDATE proposals SET status='applied'
    Web->>DB: INSERT outbox_events (ScheduleProposalApplied + rollback_token)
    Web->>DB: INSERT audit_events (자동 규칙 버전 포함)
    Web->>DB: COMMIT
    Web-->>T: 200 "변경 일정을 승인했습니다" + 되돌리기 토큰
```

---

## S-3. 일일테스트 생성과 배정

```mermaid
sequenceDiagram
    autonumber
    participant Sched as W:스케줄러
    participant DB
    participant WA as W:schedule (assessment-generator)
    participant Core
    participant WRnd as W:render
    actor T as 선생님

    Sched->>DB: 다음 수업일의 daily_test 노드 조회
    Sched->>DB: INSERT jobs (job_type='assessment.generate',<br/>idempotency_key=H(org,group,student,kind,scheduled_on))
    Note over Sched,DB: UNIQUE (org, job_type, idempotency_key)<br/>→ 같은 요청이 여러 번 실행돼도 중복 테스트 없음

    WA->>DB: SELECT jobs ... FOR UPDATE SKIP LOCKED (queue='schedule')
    WA->>DB: INSERT assessment_instances (status='generating')
    WA->>DB: 블루프린트 · 정책 버전 조회
    WA->>DB: getMasterySnapshot(students, concepts, cutoff=now)
    WA->>DB: listEligibleQuestions(...)
    Note over WA,DB: eligible_question_versions 뷰:<br/>published AND publish_gate_status='passed'<br/>AND lifecycle='active' AND rights='allowed'<br/>AND valid_to >= today AND alignment approved
    WA->>Core: selectQuestions(blueprint, pool, mastery, seed)
    Note over Core: 구성 비율(정책): 오늘 학습 50% ·<br/>약점 30% · 오답·간격 복습 20%<br/>재출제 제한 · 난이도 분포 · 표상 다양성
    alt 문항 부족
        Core-->>WA: InsufficientQuestions{concept, required, available, blocked_by}
        WA->>DB: UPDATE assessment_instances SET status='review_required'
        WA->>DB: INSERT notifications (문제 부족 · 무엇을 검수하면 되는지)
        WA-->>T: 오늘 운영실 예외 업무함에 표시
    end
    Core-->>WA: 선정 문항 + selection_reason[]

    WA->>DB: BEGIN
    WA->>DB: INSERT assessment_questions<br/>(content_snapshot · answer_key_snapshot · rubric_snapshot ·<br/>max_score · concept_weights_snapshot · selection_reason ·<br/>renderer_version · katex_version · normalizer_version)
    WA->>DB: UPDATE assessment_instances SET status='draft', snapshot_hash=H(...)
    WA->>DB: COMMIT

    T->>WA: (검토) 문항 잠금·교체·순서·배점 변경
    T->>DB: UPDATE assessment_instances SET status='ready'

    T->>DB: POST /assessments/{id}:publish (If-Match)
    DB->>WRnd: 모든 문항의 math_render_artifacts 존재 확인
    alt 렌더 산출물 누락 또는 게이트 미통과
        DB-->>T: 422 RENDER_ARTIFACT_MISSING / PUBLISH_GATE_FAILED
    end
    DB->>DB: BEGIN → status='published' → INSERT outbox(AssessmentPublished) → COMMIT
    DB->>DB: INSERT assignments (학생별, delivery, due_at)
    Note over DB: 배정 후 스냅샷은 불변.<br/>이후 원본 문항이 바뀌어도 이 시험은 바뀌지 않는다.
```

---

## S-4. 학생 답안 임시 저장·제출·자동 채점

```mermaid
sequenceDiagram
    autonumber
    actor S as 학생
    participant Web
    participant DB
    participant Storage
    participant Relay
    participant WG as W:realtime (채점)
    participant Core

    S->>Web: POST /attempts (시험 시작)
    Web->>DB: assignments 상태 · attempt_no <= max_attempts 확인
    Web->>Storage: 스냅샷 자산(도형·렌더 산출물) 프리로드 + 체크섬 검증
    alt 체크섬 불일치 또는 자산 누락
        Web-->>S: 422 SNAPSHOT_ASSET_CHECKSUM_MISMATCH
        Note over Web: 일부 문항이 깨진 채 시험을 시작시키지 않는다.<br/>교사·운영자에게 문항/렌더러 버전·오류 ID 알림.
    end
    Web->>DB: INSERT attempts (status='in_progress', client_seq_base)
    Web-->>S: 200 { attempt_id, client_seq_base, 문항 스냅샷 }

    loop 10초 배치 임시 저장
        S->>Web: PUT /attempts/{id}/responses/{aqId}<br/>{ client_seq: 42, payload }
        Web->>DB: UPDATE responses SET payload, client_seq=42<br/>WHERE ... AND client_seq < 42
        alt 영향 행 0 (다른 기기가 더 최신)
            Web-->>S: 409 STALE_CLIENT_SEQ { server_client_seq: 51 }
            S->>Web: GET 최신 답안 → 화면 갱신
        end
        Web-->>S: 200 { saved_at }
    end

    S->>Web: POST /attempts/{id}:submit (If-Match, Idempotency-Key)
    Web->>DB: BEGIN
    Web->>DB: UPDATE attempts SET status='submitted', submitted_at=now(), version=version+1<br/>WHERE id AND status='in_progress' AND version=$v
    alt 영향 행 0
        DB-->>Web: 0 rows
        Web->>DB: ROLLBACK
        Web-->>S: 409 ATTEMPT_ALREADY_SUBMITTED (같은 멱등 키면 원 응답 재생)
    end
    Web->>DB: INSERT outbox_events (AttemptSubmitted)
    Web->>DB: INSERT jobs (queue='realtime', job_type='grading.autograde',<br/>idempotency_key=attempt_id)
    Web->>DB: COMMIT
    Web-->>S: 200 "제출했습니다"
    Note over Web,DB: 접수 성공 = 이벤트 + 채점 작업이 같은 커밋에 존재.<br/>이후 워커가 죽어도 채점은 유실되지 않는다.

    WG->>DB: SELECT jobs FOR UPDATE SKIP LOCKED (queue='realtime', priority=100)
    WG->>DB: 킬스위치 auto_grading 확인
    alt kill switch ON
        WG->>DB: UPDATE jobs SET status='queued', run_after=now()+5m
        Note over WG: 수동 채점과 기존 확정 데이터 열람은 계속 가능
    end
    WG->>DB: responses + assessment_questions(스냅샷) 조회
    loop 문항별
        WG->>Core: grade(response, snapshot)
        Note over Core: 채점 계층<br/>1 객관식 정확 일치 (선택지 ID)<br/>2 단답형 정규화 비교<br/>3 분수·소수·부호·단위 정규화<br/>4 기호적 동치 검증 (안전 범위·가정 명시)<br/>5 복수 빈칸 부분 점수<br/>6 서술형 루브릭<br/>7 불확실 → 예외함
        Core-->>WG: { score, confidence, tier, rationale, normalized_answer }
    end
    WG->>DB: BEGIN
    WG->>DB: INSERT grade_decisions (version=1, is_current=true, decided_by='auto')
    alt 저신뢰 답안 존재
        WG->>DB: INSERT grading_exceptions (type, due_at)
        WG->>DB: UPDATE attempts SET status='review_required'
        Note over WG: 불확실한 자동 판정을 최종 점수·숙련도에<br/>즉시 반영하지 않는다.
    else 전부 확실
        WG->>DB: UPDATE attempts SET status='finalized', total_score
        WG->>DB: INSERT outbox_events (GradeFinalized)
    end
    WG->>DB: COMMIT
```

---

## S-5. 저신뢰 답안의 사람 검수와 재계산

```mermaid
sequenceDiagram
    autonumber
    actor G as 채점자
    participant Web
    participant DB
    participant Relay
    participant WM as W:realtime (mastery-engine)
    participant WP as W:schedule (planning-engine)
    participant Core

    G->>Web: GET /grading/exceptions?status=open
    Web-->>G: 예외 목록 (유형 · 기한 · 학생 · 문항)

    G->>Web: GET /grading/exceptions/{id}
    Web->>DB: 학생 원본 답안 · 인식된 답 · 문항 원본 · 정답·해설 ·<br/>자동 채점 결과 · 신뢰도·근거 · 풀이 이력 ·<br/>같은 문항 응답 분포
    Web-->>G: 나란히 비교 화면

    alt 정답·오답 확정 또는 부분 점수
        G->>Web: POST /grading/exceptions/{id}:resolve<br/>{ decision: 'partial', score: 3, reason }
        Web->>DB: BEGIN
        Web->>DB: UPDATE grade_decisions SET is_current=false WHERE response_id=$1
        Web->>DB: INSERT grade_decisions (version=2, is_current=true,<br/>decided_by='reviewer', correction_reason)
        Note over DB: 완료 상태를 과거로 되돌리지 않는다.<br/>새 GradeDecision 버전을 만든다.
        Web->>DB: UPDATE grading_exceptions SET status='resolved'
        Web->>DB: 남은 예외 0건이면 UPDATE attempts SET status='finalized'
        Web->>DB: INSERT outbox_events (GradeFinalized, correction_of=[v1 id])
        Web->>DB: INSERT audit_events (before/after · 사유 · 권한 근거)
        Web->>DB: COMMIT
    else 문항 오류 의심
        G->>Web: POST /grading/exceptions/{id}:escalate → 콘텐츠 검수함 이관
        Note over Web: 이후 S-8 문항 격리 흐름으로 연결
    end

    Relay->>WM: GradeFinalized (consumer=mastery-engine)
    WM->>DB: INSERT inbox_messages (중복 차단)
    WM->>DB: INSERT mastery_evidences<br/>UNIQUE (grade_decision_id, canonical_concept_id)
    Note over WM,DB: 정정이면 이전 증거를 삭제하지 않고<br/>상쇄 증거(evidence_kind='correction') 추가
    WM->>DB: SELECT mastery_policy_versions WHERE status='active'
    WM->>Core: computeMastery(evidences, cutoff, policy)
    Note over Core: 정답률 · 난이도 · 최근성 · 힌트 · 재시도 ·<br/>표상 다양성 · 서로 다른 학습일 · 지연 확인 · 전이<br/>→ 점 추정 + 불확실성 + 차원별 상태
    Core-->>WM: { state, point_estimate, uncertainty, computed_hash }
    WM->>DB: UPSERT concept_masteries (policy_version_id, evidence_cutoff_at, computed_hash)
    WM->>DB: INSERT review_items (간격 복습 예정일)
    WM->>DB: INSERT outbox_events (MasteryUpdated + reason_codes)

    Relay->>WP: MasteryUpdated (consumer=planning-engine)
    WP->>Core: 숙련도 하락 · 선수 결손 여부 판정
    alt 필수 선수 결손
        WP->>DB: INSERT schedule_change_proposals (보충 노드 삽입 preview)
        Note over WP: 다음 핵심 개념 전에 배치.<br/>단순 실수와 개념 오개념은 다른 개입.<br/>복습 예산을 넘겨 새 진도를 영구히 밀지 않는다.
        WP->>DB: INSERT outbox_events (ScheduleProposalCreated)
    end
    Note over Web,WP: 점수 · 숙련도 · 복습 일정 · 재시험 · 리포트가<br/>모두 재계산되고 변경 전후가 감사 로그에 남는다.
```

---

## S-6. 확인테스트 미통과와 보충 경로 생성

```mermaid
sequenceDiagram
    autonumber
    participant WM as W:realtime (mastery-engine)
    participant DB
    participant Relay
    participant WP as W:schedule (planning-engine)
    participant Core
    participant WA as W:schedule (assessment-generator)
    actor T as 선생님
    actor S as 학생

    Note over WM: S-4/S-5에서 확인테스트가 finalized 됨
    WM->>DB: assessment_blueprints.pass_rules 조회
    WM->>Core: evaluateCheckpoint(scores, conceptMasteries, passRules)
    Note over Core: 통과 조건 = 통과 점수 AND<br/>필수 개념별 최소 숙련도.<br/>한 번의 실패를 전체 과정 실패로 해석하지 않는다.
    Core-->>WM: { passed: false, failed_concepts: [...], reason_codes }
    WM->>DB: INSERT outbox_events (MasteryUpdated, reason_codes=['CHECKPOINT_FAILED'])

    Relay->>WP: MasteryUpdated
    WP->>DB: 학생 루트(반 루트 + 오버라이드) · 달력 · 남은 학습량 조회
    WP->>Core: planRemediation(failedConcepts, conceptGraph, calendar, budget)
    Note over Core: 개인 분기 생성 규칙<br/>· 생성 이유 · 목표 · 시작 조건 · 성공 조건<br/>· 최대 기간 · 반 재합류 지점<br/>· 반 공통 수업 유지, 분기 길이 최소화<br/>· 재합류 전 확인할 증거 명시
    Core-->>WP: { override(diff), retry_plan, proposal }
    WP->>DB: BEGIN
    WP->>DB: INSERT student_route_overrides<br/>(override_kind='retest_relearn', diff, start/success_condition,<br/>max_duration_days, rejoin_node_id, status='draft')
    Note over DB: 반 루트와 다른 학생 계획은 건드리지 않는다 (I-04)
    WP->>DB: INSERT retry_plans (attempt_limit, earliest_on, deadline_on, pass_condition)
    WP->>DB: INSERT schedule_change_proposals (status='proposed', diff, reason_codes)
    WP->>DB: INSERT outbox_events (ScheduleProposalCreated)
    WP->>DB: COMMIT

    Relay->>T: 알림: "확인테스트 미통과 · 보충 경로 제안"<br/>(무엇이·왜·영향 대상·권장 행동·기한)
    T->>DB: GET 제안 상세 — 변경 전/후 · 교육적 이유 · 영향 학생 · 종료일
    T->>DB: POST /schedule/proposals/{id}:apply {expected_*_hash}
    DB->>DB: BEGIN → student_route_overrides status='active' →<br/>sessions 보충 차시 생성 → proposals status='applied' →<br/>outbox(ScheduleProposalApplied) → COMMIT

    Relay->>WA: ScheduleProposalApplied
    WA->>DB: 재시험 assessment_instances 생성 (kind='retest')
    Note over WA: 재시험은 동일 문항 재노출이 아니라<br/>같은 목표의 동등 문항으로 구성.<br/>공통 앵커 + 개인 적응 문항 구조.
    WA->>DB: INSERT assignments (학생, earliest_on 이후)

    S->>DB: /learn/today — 보충 학습 + 재시험 일정 표시
    Note over S: 재시험 통과 시 rejoin_node_id에서 반 공통 경로에 재합류.<br/>통과 전에는 다음 개념이 해제되지 않는다.
```

---

## S-7. `mathg-gen` 원본 업로드부터 문제은행 게시

```mermaid
sequenceDiagram
    autonumber
    actor C as 콘텐츠 관리자
    participant Web
    participant Storage
    participant DB
    participant WAI as W:ai
    participant AI
    participant WRnd as W:render
    participant Core
    actor R as 콘텐츠 검수자

    C->>Web: POST /content/sources (multipart)
    Web->>Web: 실제 MIME·파일 서명 검사 (확장자 신뢰 안 함)
    Web->>Web: 크기 200MB · 페이지 1,500 · 해상도 · 압축률 한도
    alt 한도 초과 또는 서명 불일치
        Web-->>C: 413 FILE_TOO_LARGE / 415 MIME_SIGNATURE_MISMATCH
    end
    Web->>Storage: PUT {organization_id}/sources/{sha256}.pdf
    Web->>DB: INSERT source_files (sha256 UNIQUE, status='uploaded')
    alt 같은 sha256 이미 존재
        DB-->>Web: 23505 → 기존 원본 반환 (재업로드 방지)
    end
    Web-->>C: 201 { source_file_id }

    C->>Web: POST /content/sources/{id}:ingest
    Web->>DB: content_rights.status 확인
    alt rights <> 'allowed'
        Web-->>C: 422 RIGHTS_NOT_ALLOWED
        Note over Web: 사용 권한이 확인되지 않은 원본은<br/>파이프라인에 들어가지 않는다.
    end
    Web->>DB: 조직 AI 예산 확인 (일 USD 20 기본)
    alt 예산 100% 초과
        Web-->>C: 429 BUDGET_EXCEEDED
    end
    Web->>DB: INSERT jobs (queue='ai', idempotency_key=<br/>H(org, sha256, book_edition_id, pipeline_version, step))
    Web-->>C: 202 { job_id }

    WAI->>DB: FOR UPDATE SKIP LOCKED (queue='ai', 조직 동시 한도 3)
    WAI->>WAI: 악성코드 검사 + 샌드박스 변환
    alt 악성·손상·체크섬 불일치
        WAI->>DB: UPDATE source_files SET status='quarantined'
        WAI->>DB: SEV2 알림. 재시도 금지.
    end
    loop 페이지 단위 체크포인트
        WAI->>Storage: 페이지 렌더링 · 회전 보정 → 이미지 저장
        WAI->>AI: OCR + 문항 영역 탐지
        Note over WAI,AI: PDF·이미지 안의 지시문은 데이터로만 처리.<br/>OCR 텍스트가 시스템 프롬프트·도구 호출·<br/>URL 접근·권한을 바꿀 수 없다.<br/>AI는 제한된 구조화 스키마만 출력.
        AI-->>WAI: 구조화 JSON
        WAI->>Core: zod .strict() 검증 + 허용 목록 검사
        alt 스키마 위반
            WAI->>DB: UPDATE jobs SET status='waiting_review'
        end
        WAI->>DB: INSERT source_pages, questions, question_versions(status='extracting')
        WAI->>DB: INSERT structured_content_blocks, math_expressions(raw_source)
        WAI->>DB: INSERT job_runs (step, model_version, prompt_version, tokens, cost_cents)
    end

    WAI->>WRnd: 수식 파이프라인 작업 등록 (queue='render')
    WRnd->>Core: 무손실 복구 → 토큰화·균형 검사 → 허용 목록 검증
    WRnd->>Core: normalize() + 멱등성 검증 normalize(normalize(x))=normalize(x)
    alt 의미 변경 가능 보정 발생
        WRnd->>DB: INSERT formula_reviews (severity='block')
        WRnd->>DB: INSERT outbox_events (FormulaReviewRequired)
        Note over WRnd: 게시 파이프라인에서는 실패로 처리.<br/>저작 화면에서만 제안으로 제공.
    end
    WRnd->>Core: KaTeX 서버 사전 파싱 (throwOnError:false만 믿지 않고 오류 수집)
    WRnd->>Core: HTML+MathML 생성 → render_hash
    WRnd->>WRnd: 시각 회귀 (web 1280 · mobile 360 · print A4)
    WRnd->>WRnd: PDF 변환 → 텍스트 레이어·클리핑·페이지 경계 검사
    WRnd->>WRnd: HWPX 변환 → XML 스키마·수식 객체 수·폭/높이/기준선
    WRnd->>DB: INSERT math_render_artifacts × 3 target
    WRnd->>DB: INSERT outbox_events (RenderArtifactValidated × 3)

    WAI->>AI: 정답·해설 연결 또는 생성 → 독립 재풀이·수식 검증으로 교차 확인
    WAI->>AI: 교육과정·개념·난이도·유형 분류 (canonical concept 매핑 제안)
    WAI->>Core: 중복 탐지 (파일 해시 · 정규화 본문·수식 · 숫자 변형 · 의미 유사)
    WAI->>DB: INSERT duplicate_groups (자동 병합하지 않음)
    WAI->>DB: INSERT content_reviews (저신뢰 OCR · 권한 · 정답 검증)
    WAI->>DB: UPDATE question_versions SET status='review_required'

    R->>Web: GET /app/content/formula-review
    Note over R,Web: 한 작업 안에서 비교:<br/>원본 페이지 크롭 · 구조화 블록 · 원본 LaTeX ·<br/>정규화 diff · KaTeX 웹 렌더 · 모바일 폭 ·<br/>PDF 페이지 · HWPX 렌더
    R->>Web: POST /content/formula-reviews/{id}:resolve<br/>{ resolution: 'approve_lossless' | 'manual_fix' |<br/>'reocr' | 'use_crop' | 'quarantine' }
    Web->>DB: UPDATE math_expressions SET review_status='approved'

    R->>Web: POST /content/questions/{id}:publish
    Web->>DB: 게시 게이트 10조건 평가
    Note over Web,DB: 미닫힌 구분자 0 · 불균형 괄호 0 ·<br/>허용 안 된 명령 0 · katex-error/원시 LaTeX 0 ·<br/>의미 변경 보정 0 또는 승인 · 참조 누락 0 ·<br/>모바일·인쇄 잘림 0 · PDF·HWP 실패 0 ·<br/>의미 지문 불일치 0 · 스크린리더 대체 누락 0
    alt 게이트 실패
        Web-->>R: 422 PUBLISH_GATE_FAILED { 실패 항목 · 오류 위치 · 추천 수정안 }
    end
    Web->>DB: BEGIN → question_versions status='published',<br/>publish_gate_status='passed' → outbox(ContentApproved) → COMMIT
    Note over DB: 이제 자동 출제 풀(eligible_question_versions)에 진입
```

---

## S-8. 문항 오류·권한 철회 후 격리와 영향 분석

```mermaid
sequenceDiagram
    autonumber
    actor T as 선생님 / 콘텐츠 관리자
    participant Web
    participant DB
    participant Relay
    participant WC as W:default (content-gatekeeper)
    participant WA as W:schedule (assessment-generator)
    participant WT as W:realtime (attempt-processor)
    participant Storage
    actor D as 수학 프로그램 책임자

    alt 경로 A — 문항 오류 신고
        T->>Web: POST /content/questions/{id}:quarantine<br/>{ reason: 'answer_key_error', detail } + X-Reauth-Token
    else 경로 B — 사용 권한 철회
        T->>Web: POST /content/rights/{id}:suspend<br/>{ reason: 'publisher_request' } + X-Reauth-Token
        Web->>DB: UPDATE content_rights SET status='suspended'
        Web->>DB: INSERT outbox_events (ContentRightsRevoked)
        Relay->>WC: ContentRightsRevoked
        WC->>DB: 해당 판본 전 문항 조회 → 각각 quarantine 명령
    end

    Web->>DB: BEGIN
    Web->>DB: UPDATE questions SET lifecycle='quarantined', quarantine_reason
    Web->>DB: 영향 집계 조회
    Note over Web,DB: pending_assessment_ids (미완료 — 즉시 제외)<br/>published_assessment_ids (게시됨 — 영향 분석)<br/>completed_attempt_count · affected_student_count
    Web->>DB: INSERT outbox_events (QuestionQuarantined + impact)
    Web->>DB: INSERT audit_events
    Web->>DB: COMMIT
    Web-->>T: 200 "문항을 격리했습니다" + 영향 요약

    Relay->>WC: QuestionQuarantined (consumer=content-gatekeeper)
    WC->>DB: 자동 출제 풀에서 제외 (뷰가 자동 반영)
    WC->>Storage: 활성 서명 URL 폐기
    WC->>DB: document_exports 캐시 산출물 삭제 (메타·체크섬은 보존)
    Note over WC,DB: 만료·중지 시 신규 배정 · 캐시 ·<br/>인쇄 파일 · 활성 다운로드 링크를 모두 차단

    Relay->>WA: QuestionQuarantined (consumer=assessment-generator)
    loop 미완료 평가
        WA->>DB: 해당 문항 제외 → 대체 문항 재선정
        alt 대체 문항 없음
            WA->>DB: UPDATE assessment_instances SET status='review_required'
            WA->>DB: INSERT notifications (문항 부족)
        else
            WA->>DB: 문항 교체 후 재게시 (새 snapshot_hash)
        end
    end
    Note over WA,DB: 이미 게시된 평가의 스냅샷은 변경하지 않는다.<br/>완료된 응시는 조용히 바뀌지 않는다.

    Relay->>WT: QuestionQuarantined (consumer=attempt-processor)
    WT->>DB: 완료 응시 영향 목록 생성 (자동 재채점하지 않음)
    WT->>DB: INSERT notifications (재채점 결정 필요, 담당=수학 프로그램 책임자)

    D->>Web: POST /assessments/{id}:regrade-impact (부작용 없음)
    Web->>DB: 영향 분석 계산
    Web-->>D: 영향 학생 수 · 점수 변화 분포 · 숙련도 변화 ·<br/>확인테스트 통과 여부 변경 · 재계산될 일정 수

    D->>Web: POST /assessments/{id}:regrade + X-Reauth-Token
    Web->>DB: INSERT jobs (queue='realtime', job_type='grading.regrade',<br/>idempotency_key=H(assessment_id, question_version_id, decision_version))
    Web-->>D: 202 { job_id }

    loop 영향 응시별
        WT->>DB: BEGIN
        WT->>DB: UPDATE grade_decisions SET is_current=false
        WT->>DB: INSERT grade_decisions (version+1, decided_by='reprocess', correction_reason)
        WT->>DB: UPDATE attempts SET total_score
        WT->>DB: INSERT outbox_events (GradeFinalized, correction_of=[...])
        WT->>DB: COMMIT
    end
    Note over WT,DB: 과거 감사·응시 기록을 삭제하지 않는다 (I-13).<br/>점수·출처 식별 기록은 보존 정책에 따라 유지.

    Relay->>WT: GradeFinalized (재채점) → mastery-engine → 숙련도·복습·재시험·일정 연쇄 재계산
    Note over D: 격리 해제는 재검수 후:<br/>quarantined → review_required → approved → published
```

---

## 시퀀스별 검증 대응표

각 시퀀스가 어떤 테스트로 지켜지는지.

| 시퀀스 | 통합 테스트 | 동시성 테스트 | 속성 테스트 |
|---|---|---|---|
| S-1 | 루트 게시 후 날짜별 수업 생성 | 두 교사 동시 게시 → 409 하나 | 잠금·완료 수업 불변 |
| S-2 | 불참 이벤트 후 미래 일정 제안 | 같은 외부 이벤트 10회 → 1건 | 하드 제약 위반 0 / stale preview apply 거부 |
| S-3 | 테스트 생성·배정 | 같은 (학생, 날짜, 유형) 동시 생성 → 1건 | 같은 시드·입력 → 같은 문항 집합 |
| S-4 | 응시·제출·채점 | 같은 답안 제출 10회 → 1회 반영 | 다중 기기 client_seq 단조성 |
| S-5 | 예외 해결 후 숙련도 재계산 | GradeFinalized 중복·역순 배달 | 숙련도 재현성 (computed_hash) |
| S-6 | 미통과 → 보충 경로 → 재합류 | — | 오버라이드가 반 루트·타 학생 불변 |
| S-7 | OCR → 정규화 → 게이트 → 게시 | 워커 중단·재시작 시 중복 산출물 0 | 정규화 멱등성·결정성 |
| S-8 | 격리 + 재채점 영향 분석 | 격리와 평가 게시 경합 | 과거 기록 행 수 불변 |
