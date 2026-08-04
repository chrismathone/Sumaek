# 장애 모드와 kill switch

> 골프롬프트 28장(장애 모드와 성능 저하 동작, 독립 kill switch 8종) 이행 문서.
> 관련: [architecture.md](./architecture.md) · [slo.md](./slo.md) · [backup-recovery.md](./backup-recovery.md) · [../runbooks/README.md](../runbooks/README.md)

---

## 1. 원칙

| # | 원칙 |
|---|---|
| 1 | **성능 저하는 기능 상실이 아니다.** 장애 시 "무엇을 못 하는가"보다 "무엇이 반드시 계속 되는가"를 먼저 정한다 |
| 2 | **쓰기를 성공으로 응답하지 않는다.** 커밋을 확인하지 못하면 실패로 응답한다. 200을 준 것은 반드시 살아 있어야 한다 |
| 3 | **부분 결과를 노출하지 않는다.** 불완전한 일정·산출물·채점은 사용자에게 보이지 않는다 |
| 4 | **kill switch를 켜도 수동 운영과 기존 확정 데이터 열람은 계속 가능하다** |
| 5 | 자동 복구를 시도하되, **자동 복구가 데이터를 바꾸는 경우에는 사람 승인**을 요구한다 |

---

## 2. 장애 모드 표

골프롬프트 28장 표 전체 + 각 항목의 탐지·자동 대응·수동 대응·런북.

### F-01 LLM·OCR 제공자 중단

| 항목 | 내용 |
|---|---|
| **반드시 유지할 동작** | 게시된 일정, 검수 완료 문제은행, 학생 응시, 수동 채점 |
| 구조적 이유 | AI는 `ai` 큐에서만 호출된다. 동기 명령 경로에 AI 의존이 없다. 게시된 콘텐츠는 스냅샷이라 재호출이 불필요하다 |
| 탐지 | `ai_provider_error_rate` > 20% (10분 창) 또는 연속 타임아웃 5회 |
| 자동 대응 | 공급자별 회로 차단기 OPEN(30초 → 지수 증가, 최대 5분). 신규 AI 작업은 `queued` 유지 + 지수 백오프. 대기열 예상 시간 표시 |
| 성능 저하 | 신규 반입·자동 해설 생성·자동 분류 중단 |
| 수동 대응 | `ai_provider:<name>` kill switch ON → 다른 공급자로 전환 또는 `mock`으로 폴백(개발·검증용) |
| 런북 | [RB-03](../runbooks/03-ai-ocr-outage-cost.md) |

### F-02 AI 품질 저하

| 항목 | 내용 |
|---|---|
| **반드시 유지할 동작** | 스키마·수학·신뢰도 검사 실패 결과는 **게시하지 않고 검수함으로 이동** |
| 구조적 이유 | AI 출력은 zod `.strict()` + 허용 목록 + 수학 검증 + 권한 검사를 통과해야 저장된다. 검증 실패는 경고가 아니라 **게시 차단 상태**다 |
| 탐지 | 검수 전환율 > 40% (1시간 창, 기준 22%) 또는 골드셋 정확도 하락 |
| 자동 대응 | 해당 모델 버전의 신규 작업 중단. `content_reviews` 생성 |
| 수동 대응 | 이전 모델 버전으로 롤백. 골드 데이터셋 재실행 후 승격 |
| 런북 | RB-03 |

### F-03 큐 적체·워커 종료

| 항목 | 내용 |
|---|---|
| **반드시 유지할 동작** | 접수 기록 보존, 예상 대기 시간 표시, 체크포인트 재개, **중복 산출물 금지** |
| 구조적 이유 | 작업은 DB `jobs` 행이다. 워커가 죽어도 lease가 만료되면 다른 워커가 이어받는다. `job_runs` 체크포인트로 실패 단계부터 재개하고, 멱등성 키가 중복 산출물을 막는다 |
| 탐지 | `queue_wait_exceeded`(`realtime` 60s / 기타 600s), 워커 heartbeat 60초 미수신 |
| 자동 대응 | lease 만료 후 재클레임. `realtime` 큐 우선순위 유지 |
| 성능 저하 | 비실시간 큐(`ai`·`default`) 처리 지연 |
| 수동 대응 | 워커 인스턴스 증설, 저우선 큐 일시 중단 |
| 런북 | [RB-04](../runbooks/04-queue-backlog-dlq.md) |

### F-04 일정 재계산 실패

| 항목 | 내용 |
|---|---|
| **반드시 유지할 동작** | **이전 활성 일정 유지**, 부분 결과 비노출, 원인·영향·재시도 정보 제공 |
| 구조적 이유 | 새 일정 리비전을 완성·검증한 뒤 활성 포인터를 원자적으로 교체한다. `applying` 중 실패하면 포인터가 바뀌지 않는다 |
| 탐지 | `schedule_recalc_failure` > 5% (1시간 창), `mass_schedule_change` > 5,000건/시간 |
| 자동 대응 | `schedule_change_proposals.status='failed'` + `failure_reason` 저장. 이전 활성 유지 |
| 수동 대응 | `auto_schedule_recalc` kill switch ON. 수동 일정 편집은 계속 가능 |
| 런북 | [RB-02](../runbooks/02-mass-wrong-schedule.md) |

### F-05 데이터베이스 장애

| 항목 | 내용 |
|---|---|
| **반드시 유지할 동작** | **쓰기를 성공으로 응답하지 않는다.** 성공 응답한 제출의 일반 장애 유실 0 |
| 구조적 이유 | 단일 진실 공급원. 큐를 업무 기록 저장소로 쓰지 않는다. 커밋 확인 전에는 200을 주지 않는다 |
| 탐지 | `db_connection_saturation` > 85%, `db_replication_lag` > 30s, 커밋 실패율 > 0.1% |
| 자동 대응 | 커넥션 풀 백프레셔, 503 `SERVICE_DEGRADED` + `Retry-After`. 읽기는 가능하면 계속 |
| 성능 저하 | 전 쓰기 중단. 조회는 캐시·읽기 모델로 제한 운영 |
| 수동 대응 | Supabase 승격·PITR. RPO 5분 / RTO 60분 |
| 런북 | [RB-05](../runbooks/05-db-failure-pitr.md) |

### F-06 캐시·검색 장애

| 항목 | 내용 |
|---|---|
| **반드시 유지할 동작** | 느린 기준 데이터 조회로 제한 운영, **권한 우회 금지** |
| 구조적 이유 | 읽기 모델·검색 인덱스는 파생 계층이다. 원본 조회로 폴백한다. **권한 검사는 캐시 성공 여부에 의존하지 않는다** |
| 탐지 | 읽기 모델 갱신 지연 > 300s, 검색 쿼리 오류율 > 10% |
| 자동 대응 | 원본 직접 조회 폴백. 화면에 `계산 중` + `마지막 반영 시각` 표시 |
| 성능 저하 | 오늘 운영실 p95 1.5s → 최대 5s 허용, 전역 검색 일시 비활성 |
| 수동 대응 | 읽기 모델 재생성 (`TRUNCATE` + 재빌드 스크립트) |
| 런북 | RB-04 |

### F-07 객체 스토리지 장애

| 항목 | 내용 |
|---|---|
| **반드시 유지할 동작** | **원본과 산출물의 완전 저장 전 게시 금지**, 손상 파일 격리 |
| 구조적 이유 | 게시 게이트가 필수 렌더 산출물 존재와 체크섬 일치를 요구한다. 게시된 것은 이미 완결 상태다 |
| 탐지 | Storage 5xx > 5% (5분 창), 체크섬 불일치 > 0 |
| 자동 대응 | 업로드·출력 작업 재시도. 체크섬 불일치 파일은 `quarantined` |
| 성능 저하 | 신규 업로드·출력 중단. 이미 CDN 캐시된 응시 자산은 계속 제공 |
| 수동 대응 | `document_export` kill switch ON. 응시는 유지 |
| 런북 | [RB-11](../runbooks/11-document-export-failure.md) |

### F-08 알림 제공자 장애

| 항목 | 내용 |
|---|---|
| **반드시 유지할 동작** | 앱 내부 업무함 전체. 알림만 별도 재시도 |
| 구조적 이유 | 알림은 Outbox 소비자다. 업무함은 원본 테이블(`notifications`) 조회이며 외부 발송과 무관하다 |
| 탐지 | `notification_provider_down` 발송 실패율 > 30% (15분 창) |
| 자동 대응 | 발송 작업 재시도(최대 3회, 지수 백오프). 실패해도 `notifications` 행은 생성 완료 |
| 수동 대응 | `external_notification` kill switch ON. 업무함으로만 운영 |
| 런북 | [RB-13](../runbooks/13-notification-provider-outage.md) |

### F-09 중복·지연·역순 이벤트

| 항목 | 내용 |
|---|---|
| **반드시 유지할 동작** | **상태 중복 반영 금지, 최신 상태의 역행 금지** |
| 구조적 이유 | ① `inbox_messages (consumer_name, event_id)` UNIQUE가 중복 차단 ② 소비자가 `last_applied_version`을 두고 `aggregate_version` 역행 이벤트를 `skipped_stale`로 무시 ③ 논리적 중복은 DB 고유 제약이 최종 차단 |
| 탐지 | `inbox_skipped_stale_rate` > 5%, `sumaek_event_lag_seconds` p99 > 300s |
| 자동 대응 | 중복·역순은 조용히 무시(기록은 남김). 지연은 재시도 |
| 수동 대응 | 소비자 재생(replay) — 멱등하므로 안전 |
| 런북 | RB-04 |

### F-10 권한·사용권 만료

| 항목 | 내용 |
|---|---|
| **반드시 유지할 동작** | 신규 출제·링크 차단, **과거 감사·점수의 무단 삭제 금지** |
| 구조적 이유 | `eligible_question_versions` 뷰가 `content_rights.status='allowed'`를 요구한다. 격리는 `lifecycle` 전환일 뿐 과거 행을 지우지 않는다(불변 I-13) |
| 탐지 | `rights_expiry_impact` — `ContentRightsRevoked`로 영향받는 미완료 평가 > 0 |
| 자동 대응 | 자동 출제 풀 제외, 서명 URL 폐기, 캐시 산출물 삭제(메타 보존), 미완료 평가 문항 교체 |
| 성능 저하 | 해당 판본 기반 신규 출제 불가 |
| 수동 대응 | 대체 문항 확보 또는 블루프린트 조정 |
| 런북 | [RB-08](../runbooks/08-content-rights-emergency-stop.md) |

### F-11 악성 파일·프롬프트 인젝션

| 항목 | 내용 |
|---|---|
| **반드시 유지할 동작** | 샌드박스 격리, **내부망·도구·권한에 영향 없음** |
| 구조적 이유 | 파일 변환·OCR 전처리는 샌드박스에서 실행되며 내부망·메타데이터 서비스 접근이 차단된다. AI는 도구 호출 권한이 없고 구조화 스키마만 출력한다 |
| 탐지 | `malicious_upload` — `source_files.status='quarantined'` 신규 > 0. 스키마 밖 AI 출력 > 0 |
| 자동 대응 | 원본 격리, 재시도 금지, 파이프라인 중단 |
| 수동 대응 | 업로더 계정 검토, 조직 알림 |
| 런북 | [RB-07](../runbooks/07-account-takeover-malicious-upload.md) |

### F-12 KaTeX·정규화기 업그레이드 회귀

| 항목 | 내용 |
|---|---|
| **반드시 유지할 동작** | **승격 중단, 이전 렌더러 유지, 게시 스냅샷 불변** |
| 구조적 이유 | 게시 스냅샷에 `renderer_version`·`katex_version`·`normalizer_version`이 고정되어 있다. 재렌더는 저장된 버전으로 수행하므로 업그레이드가 기존 시험을 바꾸지 못한다 |
| 탐지 | `render_regression` — 골든 회귀 실패 > 0. `formula_broken_in_student_view` > 0 |
| 자동 대응 | 카나리 승격 중단, 이전 버전으로 트래픽 복귀 |
| 수동 대응 | `formula_auto_repair` kill switch ON(새 보정 규칙만 중단). 렌더러 버전 롤백 |
| 런북 | [RB-10](../runbooks/10-formula-render-rollback.md) |

### F-13 PDF·HWP 출력 워커 장애

| 항목 | 내용 |
|---|---|
| **반드시 유지할 동작** | **온라인 응시는 유지.** 출력은 대기·재시도, 불완전 파일 비노출 |
| 구조적 이유 | 응시는 게시 스냅샷의 web 렌더 산출물을 쓴다. PDF·HWPX는 별도 `render` 큐이며 응시 경로에 없다 |
| 탐지 | `export_failure_rate` > 10% (1시간 창) |
| 자동 대응 | 재시도(최대 4회). `format_validation` 실패는 `review_required` |
| 수동 대응 | `document_export` kill switch ON |
| 런북 | RB-11 |

### F-14 교육과정 권위 소스 일시 접근 불가

| 항목 | 내용 |
|---|---|
| **반드시 유지할 동작** | **마지막 검증 릴리스는 읽기 전용 유지**, 새 릴리스 발행만 차단 |
| 구조적 이유 | 릴리스는 원자적 발행 스냅샷이다. 활성 릴리스는 DB에 있고 외부 접근이 필요 없다 |
| 탐지 | 소스 수집 실패 3회 연속 또는 체크섬 불일치 |
| 자동 대응 | `curriculum_authority_sources.review_status` 유지, 수집 작업 재시도 |
| 수동 대응 | `curriculum_release_publish` kill switch ON |
| 런북 | [RB-09](../runbooks/09-curriculum-mapping-rollback.md) |

---

## 3. 추가 장애 모드 (수맥 특화)

골프롬프트 표 외에 아키텍처상 반드시 정의해야 하는 항목.

### F-15 잘못된 자동 채점

| 항목 | 내용 |
|---|---|
| **반드시 유지할 동작** | 답안 원본과 채점 이력 보존. 재채점은 새 `grade_decisions` 버전 |
| 탐지 | `autograde_accuracy_drop` — 골드셋 < 99.99%. `grading_exception_rate` > 15% |
| 자동 대응 | 없음 (자동으로 점수를 바꾸지 않는다) |
| 수동 대응 | `auto_grading` kill switch ON → 수동 채점 전환. 영향 분석 후 재채점 승인 |
| 런북 | [RB-12](../runbooks/12-wrong-autograding-reprocess.md) |

### F-16 교차 테넌트 노출 의심

| 항목 | 내용 |
|---|---|
| **반드시 유지할 동작** | 즉시 격리보다 **증거 보존이 우선**. 감사 로그는 절대 손상하지 않는다 |
| 탐지 | `cross_tenant_suspicion` — RLS 위반 예외 또는 불변 I-01 위반 > 0 |
| 자동 대응 | 해당 요청 차단 + SEV1 알림. 자동 데이터 삭제 금지 |
| 수동 대응 | 영향 범위 확정 → 법률 검토 → 통지 |
| 런북 | [RB-06](../runbooks/06-cross-tenant-exposure.md) |

### F-17 시험 시간대 전면 장애

| 항목 | 내용 |
|---|---|
| **반드시 유지할 동작** | 이미 접수된 답안 유실 0. 응시 중 학생의 로컬 임시 저장 보존 |
| 구조적 이유 | 클라이언트는 저장 실패 시 로컬(IndexedDB)에 보관하고 재연결 시 `client_seq`로 재전송한다. 중복 전송은 CAS로 1회만 반영된다 |
| 탐지 | `exam_submit_failure_spike`, `exam_start_failure_spike` |
| 자동 대응 | 클라이언트 재시도(지수 백오프, 최대 10분). 마감 시각 자동 연장 제안 |
| 수동 대응 | 시험 마감 연장, 필요 시 응시 무효화 후 재배정 |
| 런북 | [RB-01](../runbooks/01-exam-start-submit-failure.md) |

### F-18 배포 실패·마이그레이션 롤백

| 항목 | 내용 |
|---|---|
| **반드시 유지할 동작** | 롤링 중 구·신 버전 하위 호환. 데이터 손실 0 |
| 구조적 이유 | DB 변경은 `확장 → 백필 → 전환 → 검증 → 구 구조 제거` 5단계다. 각 단계가 구·신 버전 양쪽에서 동작한다 |
| 탐지 | `deploy_slo_breach` — 배포 후 15분 내 SLO 위반 또는 불변 위반 |
| 자동 대응 | 카나리·블루그린 자동 롤백 |
| 수동 대응 | 마이그레이션 역방향 스크립트 실행(각 마이그레이션에 필수 첨부) |
| 런북 | [RB-14](../runbooks/14-deploy-migration-rollback.md) |

### F-19 학생 하루가 차단되어 완주 불가

> [ADR-0017](../adr/0017-learner-day-and-session-completion.md)이 정의한 상태. **아직 구현 전**(T1.2·T2.4·T4.4).

| 항목 | 내용 |
|---|---|
| **반드시 유지할 동작** | 학생이 **왜** 막혔는지 알고, 교사가 **무엇을 고치면** 풀리는지 안다. 조용히 「할 일 없음」으로 보이지 않는다 |
| 구조적 이유 | `learner_day_plan_items.blocked_reason`은 게시 준비도 게이트와 **같은 코드 레지스트리**를 쓴다. 교사가 게시 전에 보는 사유와 학생이 당일 만나는 사유가 같은 말이라야 복구 링크를 이을 수 있다 |
| 대표 사유 | `material_missing` · `no_questions` · `rights_expired` · `account_unlinked` · `assessment_generation_failed` |
| 탐지 | `blocked_day_plan_rate` — 오늘 계획 중 `status='blocked'` 비율. 반 단위로 1건이라도 있으면 교사 현황판에 노출 |
| 자동 대응 | 없다. **차단을 자동으로 면제로 바꾸지 않는다** — 그러면 자료 미게시 사고가 「면제 처리됨」으로 위장된다(ADR-0017 §2) |
| 수동 대응 | 사유별 복구(자료 연결·문항 추가·사용권 갱신·계정 연결·평가 재생성) 후 재투영. 필수에서 뺄 판단이면 교사가 명시적으로 `exempted` |
| 주의 | **선택 항목의 차단은 완주를 막지 않는다.** 학생에게 알리되 하루는 끝낼 수 있다 |

### F-20 자동 평가 생성 실패

> [ADR-0018](../adr/0018-daily-plan-projection-and-assessment-scheduler.md) §4~§5. **생산자·핸들러·실패 판정은 T3.2·T3.3이 구현했다. 남은 것은 E-17 발행과 교사 알림·수동 복구(T3.4)** — 지금 실패는 `jobs`에 `failed_final`로만 남는다.

| 항목 | 내용 |
|---|---|
| **반드시 유지할 동작** | 실패가 **성공처럼 게시·배정되지 않는다.** 빈 평가를 학생에게 내보내지 않는다 |
| 구조적 이유 | 재시도 가능(`transient_db`)과 불가(`insufficient_questions`·`no_policy`·`no_session`·`rights_expired`)를 오류 코드로 가른다. E-17은 **재시도가 모두 소진된 뒤에만** 발행한다 — 일시 장애로 교사에게 알림을 쏘지 않기 위해서다 |
| 탐지 | `assessment_generation_lag` — 수업 시작 N시간 전인데 `published` 평가가 없는 `sessions` 수. `jobs` DLQ 유입률 |
| 자동 대응 | 지수 백오프 재시도(`attempt_count >= 8`이면 `failed`). 학생 화면에서는 해당 항목이 `blocked`로 남는다(F-19와 연결) |
| 수동 대응 | 교사가 `/app/tests`에서 재실행 — **같은 멱등 키**를 쓴다. 문항 부족이면 준비도 화면으로 이동해 문항을 채운다 |
| kill switch | `auto_assessment_generation`(T3.2가 더한 키)이 꺼져 있으면 생산자가 작업을 만들지 않고, 이미 만든 작업은 큐에 보존해 재개 후 실행한다(작업을 버리지 않는다) |
| ~~⚠ 선행 결함~~ **해소** | `assessments_idempotent_uq`가 반 공통 평가의 중복을 막지 못했다(G-15). `0018a`의 부분 유니크가 그 경우를 덮어 「재시도해도 1건」이 성립한다 |

---

## 4. Kill switch 8종

### 4.1 정의

| # | 키 | 중지되는 것 | **중지해도 반드시 되는 것** | 기본 |
|---|---|---|---|---|
| K-1 | `auto_schedule_recalc` | 일정 변경안 자동 생성·자동 적용 | 수동 일정 편집, 기존 활성 일정 조회·운영, preview 수동 생성, 승인된 제안의 수동 적용 | OFF |
| K-2 | `auto_question_publish` | 문항 자동 게시(검수 통과 후 자동 전환) | 수동 게시, 문제은행 조회, 이미 게시된 문항의 출제 | OFF |
| K-3 | `auto_grading` | 자동 채점 워커 실행 | 답안 제출·저장, 수동 채점, 채점 예외 처리, 기존 확정 점수 조회 | OFF |
| K-4 | `curriculum_release_publish` | 교육과정 릴리스 발행 | 활성 릴리스 읽기, 개념 그래프 탐색, 매핑 검수 작업 | OFF |
| K-5 | `formula_auto_repair` | 무손실 자동 보정 규칙 적용 | 수식 파싱·KaTeX 검증, 수동 수정, 이미 정규화된 수식 렌더 | OFF |
| K-6 | `document_export` | PDF·HWPX 출력 작업 | 온라인 응시, 웹 미리보기, 이미 생성된 산출물 다운로드 | OFF |
| K-7 | `external_notification` | 외부 알림 발송(이메일 등) | 앱 내 업무함 전체, 알림 생성·조회·처리 | OFF |
| K-8 | `ai_provider:<name>` | 해당 공급자 호출 (`ai_provider:anthropic`) | 게시된 콘텐츠, 검수 완료 문제은행, 응시, 수동 채점, 다른 공급자 | OFF |

### 4.2 구현

```sql
CREATE TABLE kill_switches (
  key         text PRIMARY KEY,
  enabled     boolean NOT NULL DEFAULT false,
  enabled_by  uuid,
  reason      text,
  enabled_at  timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

전환:

```bash
pnpm --filter @su-maek/db kill-switch enable auto_grading --reason "RB-12 SEV1" --actor ops@example.com
pnpm --filter @su-maek/db kill-switch disable auto_grading --actor ops@example.com
pnpm --filter @su-maek/db kill-switch list
```

또는 SQL:

```sql
UPDATE kill_switches
SET enabled = true, enabled_by = $1, reason = $2, enabled_at = now(), updated_at = now()
WHERE key = $3;
```

### 4.3 사용 규약

| # | 규약 |
|---|---|
| 1 | 전환은 **즉시 반영**된다. 워커·web은 5초 캐시로 읽고, 캐시 실패 시 **안전 방향(kill switch ON으로 간주)** 으로 동작한다 |
| 2 | 전환 시 `audit_events`에 `action='ops.kill_switch'` 기록이 자동 생성된다 |
| 3 | ON인 kill switch가 있으면 **오늘 운영실 상단에 상시 배너**로 표시한다. 조용히 켜둔 채 잊는 것을 막는다 |
| 4 | 관련 API는 `403 KILL_SWITCH_ENABLED` + `message`에 사유와 재개 예정 시각을 담는다 |
| 5 | 큐에 있던 작업은 삭제하지 않는다. `queued` 상태로 `run_after`를 미루고 대기한다 |
| 6 | 재개 시 대기 작업이 한꺼번에 몰리지 않도록 `run_after`에 0~600초 지터를 준다 |
| 7 | kill switch는 **조직 단위가 아니라 전역**이다. 조직별 제어가 필요하면 `feature_flags`를 쓴다 |
| 8 | 전환 권한은 워크스페이스 소유자 + 재인증. 운영자는 break-glass 경로 |

### 4.4 장애 모드 → kill switch 매핑

| 장애 | 1차 kill switch | 2차 |
|---|---|---|
| F-01 AI 공급자 중단 | `ai_provider:<name>` | — |
| F-02 AI 품질 저하 | `ai_provider:<name>` | `auto_question_publish` |
| F-03 큐 적체 | `ai_provider:<name>` (저우선 부하 제거) | `document_export` |
| F-04 일정 재계산 실패 | `auto_schedule_recalc` | — |
| F-05 DB 장애 | — (kill switch로 해결 불가) | 전체 쓰기 차단은 배포 레벨 |
| F-06 캐시·검색 장애 | — | — |
| F-07 스토리지 장애 | `document_export` | `auto_question_publish` |
| F-08 알림 장애 | `external_notification` | — |
| F-10 권한 만료 | `auto_question_publish` | — |
| F-11 악성 업로드 | `ai_provider:<name>` | `auto_question_publish` |
| F-12 렌더러 회귀 | `formula_auto_repair` | `auto_question_publish`, `document_export` |
| F-13 출력 워커 장애 | `document_export` | — |
| F-14 권위 소스 불가 | `curriculum_release_publish` | — |
| F-15 잘못된 자동 채점 | `auto_grading` | — |
| F-16 교차 테넌트 의심 | — (증거 보존 우선) | 필요 시 조직 `suspended` |

---

## 5. 성능 저하 매트릭스

각 컴포넌트가 죽었을 때 **기능별로** 무엇이 되는가.

| 기능 | 정상 | web만 살아있음 | worker 중단 | AI 중단 | 렌더 워커 중단 | Storage 중단 | DB 쓰기 불가 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 로그인·조회 | ● | ● | ● | ● | ● | ● | ● |
| 오늘 운영실 | ● | ● | ◐ 지연 표시 | ● | ● | ● | ● |
| 수업 시작·종료·진도 기록 | ● | ● | ● | ● | ● | ● | ✕ |
| 답안 임시 저장 | ● | ● | ● | ● | ● | ● | ✕ |
| **답안 제출** | ● | ● | ● | ● | ● | ● | ✕ |
| 자동 채점 | ● | ✕ | ✕ 대기 | ● | ● | ● | ✕ |
| 수동 채점 | ● | ● | ● | ● | ● | ● | ✕ |
| 시험 시작(스냅샷 로드) | ● | ● | ● | ● | ● | ◐ CDN 캐시분만 | ● 읽기만 |
| 일정 재계산 | ● | ✕ 대기 | ✕ 대기 | ● | ● | ● | ✕ |
| 기존 일정 조회·운영 | ● | ● | ● | ● | ● | ● | ● |
| 루트 게시 | ● | ● | ● | ● | ● | ● | ✕ |
| 자동 출제 | ● | ✕ 대기 | ✕ 대기 | ● | ● | ● | ✕ |
| 문제은행 조회 | ● | ● | ● | ● | ● | ◐ 이미지 제외 | ● |
| 콘텐츠 반입 | ● | ✕ 대기 | ✕ 대기 | ✕ 대기 | ✕ 대기 | ✕ | ✕ |
| 수식 검증 | ● | ✕ 대기 | ✕ 대기 | ● | ✕ 대기 | ● | ✕ |
| PDF·HWPX 출력 | ● | ✕ 대기 | ✕ 대기 | ● | ✕ 대기 | ✕ | ✕ |
| 교육과정 조회 | ● | ● | ● | ● | ● | ● | ● |
| 교육과정 릴리스 발행 | ● | ● | ● | ● | ● | ● | ✕ |
| 숙련도 조회 | ● | ● | ◐ 지연 | ● | ● | ● | ● |
| 숙련도 갱신 | ● | ✕ 대기 | ✕ 대기 | ● | ● | ● | ✕ |
| 알림 발송 | ● | ✕ 대기 | ✕ 대기 | ● | ● | ● | ✕ |
| 앱 내 업무함 | ● | ● | ◐ 신규 생성 지연 | ● | ● | ● | ● |
| 리포트 생성 | ● | ✕ 대기 | ✕ 대기 | ● | ● | ✕ | ✕ |

`●` 정상 / `◐` 성능 저하(명시적 표시) / `✕ 대기` 접수는 되고 처리는 지연(유실 없음) / `✕` 불가

**"✕ 대기"와 "✕"의 차이가 핵심이다.** 접수된 것은 반드시 처리된다. 접수할 수 없으면 성공으로 응답하지 않는다.

---

## 6. 자동 복구 동작

| 대상 | 자동 복구 | 사람 승인 필요 |
|---|---|---|
| 워커 프로세스 종료 | 프로세스 재시작 + lease 만료 후 재클레임 | 불필요 |
| 작업 일시 실패 (408·429·5xx) | 지수 백오프 재시도 | 불필요 |
| 회로 차단기 OPEN | half-open 프로브 후 자동 CLOSE | 불필요 |
| 읽기 모델 지연 | 증분 갱신 재시도 | 불필요 |
| 읽기 모델 손상 | — | **필요** (재빌드는 사람이 시작) |
| DLQ 재처리 | — | **필요** |
| 일정 재계산 실패 | 재계산 재시도 1회 | **적용은 필요** |
| 채점 오류 발견 | — | **필요** (재채점은 사람 승인) |
| 문항 격리 후 대체 | 자동 문항 교체 시도 | 대체 실패 시 **필요** |
| DB 승격·PITR | — | **필요** |
| 렌더러 롤백 | 카나리 자동 중단 | 전면 롤백은 **필요** |

**원칙**: 자동 복구가 **데이터를 바꾸는 경우**에는 사람 승인을 요구한다. 재시도·재시작처럼 같은 결과를 다시 만드는 것은 자동으로 한다.

---

## 7. 카오스 테스트 계획

각 실험 전에 **기대되는 성능 저하, 알림, 자동 복구 시간, 지켜야 할 데이터 불변식, 수동 대응**을 정의하고 실제 결과를 기록한다.

| # | 실험 | 기대 성능 저하 | 기대 알림 | 자동 복구 목표 | 지킬 불변식 |
|---|---|---|---|---|---|
| CH-01 | 처리 중 워커 `SIGKILL` | `realtime` 큐 대기 증가 | `queue_wait_exceeded` 60s | lease 만료(큐별) 후 재클레임 | 중복 산출물 0, I-10 |
| CH-02 | 이벤트 중복 10배 주입 | 없음 | 없음 | 즉시 | I-10, `skipped_duplicate` 기록 |
| CH-03 | 이벤트 역순 주입 | 없음 | `inbox_skipped_stale_rate` | 즉시 | 상태 역행 0 |
| CH-04 | AI 공급자 429 100% | 반입 중단 | `ai_provider_error_rate` | 회로 차단기 CLOSE 후 자동 | 게시 스냅샷 불변 |
| CH-05 | AI 공급자 느린 응답(60s) | 반입 지연 | `queue_wait_exceeded` | 타임아웃 후 재시도 | 실시간 채점 SLO 유지 |
| CH-06 | DB 주 노드 장애 + 승격 | 전 쓰기 중단 | `db_connection_saturation` | RTO 60분 | 성공 응답 제출 유실 0 |
| CH-07 | 읽기 모델 전체 삭제 | 오늘 운영실 지연 | 읽기 모델 갱신 지연 | 재빌드(수동) | 권한 우회 0 |
| CH-08 | Storage 5xx 100% | 업로드·출력 중단 | Storage 오류율 | 복구 후 자동 재시도 | 불완전 파일 게시 0 |
| CH-09 | Storage 손상 파일 주입 | 해당 원본 격리 | `malicious_upload` | — | 체크섬 불일치 격리 |
| CH-10 | 네트워크 분할(worker↔DB) | 작업 처리 중단 | 워커 heartbeat | 재연결 후 자동 | lease 중복 처리 0 |
| CH-11 | 디스크 부족 | 쓰기 실패 | `db_connection_saturation` | 파티션 정리(수동) | 200 응답 후 유실 0 |
| CH-12 | 구·신 버전 동시 배포 | 없음 | 없음 | — | 계약 하위 호환 |
| CH-13 | 사용권 대량 철회(1만 문항) | 신규 출제 제한 | `rights_expiry_impact` | — | I-13 과거 기록 불변 |
| CH-14 | 렌더러 버전 강제 회귀 주입 | 카나리 중단 | `render_regression` | 자동 트래픽 복귀 | 게시 스냅샷 불변 |

실행 주기: CH-01~CH-05, CH-12는 **매 릴리스**. 나머지는 **분기 1회**.
