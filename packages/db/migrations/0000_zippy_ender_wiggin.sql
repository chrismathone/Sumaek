CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'system', 'automation', 'operator');--> statement-breakpoint
CREATE TYPE "public"."integration_kind" AS ENUM('sis', 'lms', 'erp_adapter');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('connected', 'paused', 'error', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'program_director', 'teacher', 'grader', 'content_manager', 'content_reviewer', 'student');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'suspended', 'left');--> statement-breakpoint
CREATE TYPE "public"."scope_kind" AS ENUM('all', 'learning_group', 'student');--> statement-breakpoint
CREATE TYPE "public"."workspace_kind" AS ENUM('organization', 'personal');--> statement-breakpoint
CREATE TYPE "public"."workspace_status" AS ENUM('active', 'suspended', 'archived');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'waiting_review', 'succeeded', 'failed_retryable', 'retry_scheduled', 'failed_final', 'dead_lettered', 'cancel_requested', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'delivering', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."availability_event_kind" AS ENUM('learner_absence', 'learner_unavailable', 'group_cancelled');--> statement-breakpoint
CREATE TYPE "public"."availability_event_status" AS ENUM('received', 'applied', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."course_period_status" AS ENUM('draft', 'active', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."group_membership_status" AS ENUM('active', 'left');--> statement-breakpoint
CREATE TYPE "public"."holiday_kind" AS ENUM('national', 'academy', 'school_exam', 'vacation');--> statement-breakpoint
CREATE TYPE "public"."learner_status" AS ENUM('active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."learning_group_status" AS ENUM('planned', 'operating', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."makeup_session_status" AS ENUM('proposed', 'confirmed', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('planned', 'confirmed', 'in_progress', 'completed', 'cancelled', 'makeup_planned');--> statement-breakpoint
CREATE TYPE "public"."authority_source_review" AS ENUM('registered', 'verified', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."concept_edge_kind" AS ENUM('part_of', 'prerequisite', 'soft_prerequisite', 'extends', 'special_case_of', 'equivalent_to', 'contrasts_with', 'represented_by', 'misconception_of', 'assessed_by', 'transfer_to');--> statement-breakpoint
CREATE TYPE "public"."concept_status" AS ENUM('draft', 'reviewed', 'active', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."curriculum_release_status" AS ENUM('imported', 'parsed', 'mapped', 'expert_review', 'validated', 'published', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."curriculum_version_status" AS ENUM('draft', 'active', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."edge_provenance" AS ENUM('human', 'ai_suggested', 'imported');--> statement-breakpoint
CREATE TYPE "public"."mapping_relation_type" AS ENUM('covers', 'partially_covers', 'extends_beyond', 'aligned_content');--> statement-breakpoint
CREATE TYPE "public"."official_node_kind" AS ENUM('school_level', 'grade_band', 'subject', 'domain', 'content_element');--> statement-breakpoint
CREATE TYPE "public"."content_right_status" AS ENUM('draft', 'under_review', 'usable', 'restricted', 'expired', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."duplicate_kind" AS ENUM('exact_file', 'exact_text', 'numeric_variant', 'semantic_similar', 'same_source_rescan');--> statement-breakpoint
CREATE TYPE "public"."ingestion_status" AS ENUM('uploaded', 'extracting', 'review_required', 'approved', 'rejected', 'quarantined', 'published');--> statement-breakpoint
CREATE TYPE "public"."math_parse_status" AS ENUM('pending', 'parsed', 'normalized', 'render_validated', 'review_required', 'corrected', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."question_kind" AS ENUM('multiple_choice', 'short_answer', 'multi_blank', 'essay');--> statement-breakpoint
CREATE TYPE "public"."question_review_status" AS ENUM('draft', 'extracting', 'review_required', 'formula_review_required', 'layout_review_required', 'approved', 'rejected', 'quarantined', 'published');--> statement-breakpoint
CREATE TYPE "public"."render_artifact_status" AS ENUM('queued', 'rendering', 'format_validation', 'ready', 'review_required', 'failed');--> statement-breakpoint
CREATE TYPE "public"."render_target" AS ENUM('web', 'mobile', 'print_css', 'pdf', 'hwpx');--> statement-breakpoint
CREATE TYPE "public"."override_kind" AS ENUM('temporary_advance', 'absence_makeup', 'remediation', 'retest_relearn', 'book_substitution', 'permanent_individual', 'rejoin', 'skip', 'deadline_change');--> statement-breakpoint
CREATE TYPE "public"."override_status" AS ENUM('active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('calculating', 'proposed', 'approved', 'rejected', 'applying', 'applied', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."route_kind" AS ENUM('workspace_template', 'grade_template', 'group_route', 'learner_route', 'special_route');--> statement-breakpoint
CREATE TYPE "public"."route_node_kind" AS ENUM('concept_lesson', 'problem_solving', 'book_range', 'homework', 'daily_test', 'confirmation_test', 'wrong_answer_review', 'remediation', 'cumulative_review', 'buffer', 'break', 'custom');--> statement-breakpoint
CREATE TYPE "public"."route_status" AS ENUM('draft', 'validating', 'needs_fix', 'publishable', 'published', 'superseded', 'archived');--> statement-breakpoint
CREATE TYPE "public"."assessment_purpose" AS ENUM('diagnostic', 'formative', 'confirmation', 'cumulative_review', 'transfer', 'summative', 'retest');--> statement-breakpoint
CREATE TYPE "public"."assessment_status" AS ENUM('generating', 'draft', 'ready', 'review_required', 'published', 'open', 'closed', 'grading', 'finalized', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('assigned', 'notified', 'reassigned', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."attempt_status" AS ENUM('not_started', 'in_progress', 'submitted', 'auto_graded', 'review_required', 'finalized', 'invalidated');--> statement-breakpoint
CREATE TYPE "public"."grade_decision_source" AS ENUM('auto_exact', 'auto_normalized', 'auto_equivalence', 'auto_rubric_ai', 'human', 'regrade');--> statement-breakpoint
CREATE TYPE "public"."grading_exception_kind" AS ENUM('low_confidence_ocr', 'multiple_valid_answers', 'format_mismatch', 'essay_partial', 'answer_explanation_conflict', 'question_error_suspected', 'scan_missing', 'identity_unresolved', 'resubmission_required', 'regrade_required');--> statement-breakpoint
CREATE TYPE "public"."grading_exception_status" AS ENUM('open', 'assigned', 'reviewing', 'resolved', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."mastery_state" AS ENUM('no_evidence', 'exploring', 'partial', 'stable', 'transfer_confirmed', 'recheck_needed');--> statement-breakpoint
CREATE TYPE "public"."retry_plan_status" AS ENUM('planned', 'in_progress', 'passed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."review_item_status" AS ENUM('scheduled', 'presented', 'completed', 'skipped', 'expired');--> statement-breakpoint
CREATE TYPE "public"."import_job_status" AS ENUM('uploaded', 'previewing', 'preview_ready', 'applying', 'partially_applied', 'applied', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('unread', 'read', 'in_progress', 'done', 'snoozed');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('draft', 'generating', 'review_required', 'approved', 'exported', 'failed', 'archived');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"reason" text,
	"before" jsonb,
	"after" jsonb,
	"rule_version" text,
	"trace_id" text,
	"access_grant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "integration_kind" NOT NULL,
	"name" text NOT NULL,
	"status" "integration_status" DEFAULT 'connected' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allowed_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_sync_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"resource" text NOT NULL,
	"cursor" text,
	"last_status" text DEFAULT 'ok' NOT NULL,
	"last_error" text,
	"issue_count" jsonb DEFAULT '0'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" NOT NULL,
	"token_hash" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"accepted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kill_switches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"reason" text,
	"changed_by" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"scope_kind" "scope_kind" NOT NULL,
	"scope_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"invited_by" uuid,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" "workspace_kind" DEFAULT 'organization' NOT NULL,
	"status" "workspace_status" DEFAULT 'active' NOT NULL,
	"timezone" text DEFAULT 'Asia/Seoul' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"default_organization_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"organization_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_organization_id_operation_idempotency_key_pk" PRIMARY KEY("organization_id","operation","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "inbox_events" (
	"consumer_name" text NOT NULL,
	"event_id" uuid NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_events_consumer_name_event_id_pk" PRIMARY KEY("consumer_name","event_id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"topic" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"idempotency_key" text,
	"lease_expires_at" timestamp with time zone,
	"worker_id" text,
	"checkpoint" jsonb,
	"last_error" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"aggregate_version" integer NOT NULL,
	"event_type" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"correlation_id" uuid,
	"causation_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"academic_year" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" "course_period_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"course_period_id" uuid,
	"kind" "holiday_kind" NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"learning_group_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"user_id" uuid,
	"curriculum_version_id" uuid,
	"grade_level" text,
	"status" "learner_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_availability_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "availability_event_kind" NOT NULL,
	"learner_id" uuid,
	"learning_group_id" uuid,
	"session_id" uuid,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"reason" text,
	"status" "availability_event_status" DEFAULT 'received' NOT NULL,
	"schedule_proposal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_group_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"learning_group_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"joined_on" date NOT NULL,
	"left_on" date,
	"status" "group_membership_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"course_period_id" uuid NOT NULL,
	"name" text NOT NULL,
	"course_name" text,
	"curriculum_version_id" uuid,
	"home_teacher_user_id" uuid,
	"assessment_policy_id" uuid,
	"status" "learning_group_status" DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "makeup_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"original_session_id" uuid NOT NULL,
	"learner_id" uuid,
	"makeup_session_id" uuid,
	"status" "makeup_session_status" DEFAULT 'proposed' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"learning_group_id" uuid NOT NULL,
	"teacher_user_id" uuid,
	"session_date" date NOT NULL,
	"timezone" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "session_status" DEFAULT 'planned' NOT NULL,
	"schedule_revision_id" uuid,
	"planned_node_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actual_progress" jsonb,
	"teacher_note" text,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
	"completed_at" timestamp with time zone,
	"cancelled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "achievement_standards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"curriculum_version_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"official_node_id" uuid NOT NULL,
	"code" text NOT NULL,
	"statement" text NOT NULL,
	"commentary" text,
	"source_id" uuid,
	"source_location" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_evidences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"objective_id" uuid NOT NULL,
	"description" text NOT NULL,
	"observable_via" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canonical_concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"curriculum_version_id" uuid,
	"school_level" text,
	"grade_band" text,
	"domain_name" text,
	"status" "concept_status" DEFAULT 'draft' NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competency_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"curriculum_version_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "concept_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_concept_id" uuid NOT NULL,
	"to_concept_id" uuid NOT NULL,
	"kind" "concept_edge_kind" NOT NULL,
	"rationale" text,
	"required_depth" text,
	"can_teach_concurrently" boolean,
	"applies_to" jsonb,
	"provenance" "edge_provenance" DEFAULT 'human' NOT NULL,
	"confidence" numeric(4, 3),
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"consensus_level" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"status" "concept_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curriculum_applicabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"curriculum_version_id" uuid NOT NULL,
	"academic_year" integer NOT NULL,
	"school_level" text NOT NULL,
	"grade_band" text NOT NULL,
	"subject_code" text DEFAULT 'math' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curriculum_authority_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_name" text NOT NULL,
	"publisher_name" text NOT NULL,
	"notice_number" text,
	"original_url" text NOT NULL,
	"file_checksum" text,
	"acquired_at" timestamp with time zone,
	"effective_from" date,
	"effective_to" date,
	"applies_to" text,
	"review_status" "authority_source_review" DEFAULT 'registered' NOT NULL,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curriculum_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"official_type" text NOT NULL,
	"official_id" uuid NOT NULL,
	"internal_type" text NOT NULL,
	"internal_id" uuid NOT NULL,
	"relation_type" "mapping_relation_type" NOT NULL,
	"confidence" numeric(4, 3),
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_id" uuid,
	"provenance" "edge_provenance" DEFAULT 'human' NOT NULL,
	"created_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"valid_from" date,
	"valid_to" date,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "concept_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curriculum_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"curriculum_version_id" uuid NOT NULL,
	"release_number" integer NOT NULL,
	"status" "curriculum_release_status" DEFAULT 'imported' NOT NULL,
	"validation_report" jsonb,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curriculum_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" "curriculum_version_status" DEFAULT 'draft' NOT NULL,
	"primary_source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instructional_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concept_id" uuid NOT NULL,
	"progression_stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"teaching_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"examples" jsonb,
	"non_examples" jsonb,
	"tool_guidance" jsonb,
	"status" "concept_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_objectives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concept_id" uuid NOT NULL,
	"statement" text NOT NULL,
	"dimensions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"success_evidence" jsonb,
	"allowed_tools" jsonb,
	"expected_minutes" integer,
	"status" "concept_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "misconceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concept_id" uuid NOT NULL,
	"name" text NOT NULL,
	"error_pattern" text NOT NULL,
	"confused_with_concept_id" uuid,
	"detection_evidence" jsonb,
	"remediation_strategy" jsonb,
	"applies_to" jsonb,
	"source_note" text,
	"status" "concept_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "official_curriculum_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"curriculum_version_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"parent_id" uuid,
	"kind" "official_node_kind" NOT NULL,
	"official_name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source_id" uuid,
	"source_location" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "representations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concept_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"example" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"source_system" text NOT NULL,
	"alias_text" text NOT NULL,
	"concept_id" uuid NOT NULL,
	"confidence" numeric(4, 3),
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_editions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"isbn" text,
	"edition_label" text NOT NULL,
	"published_year" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"publisher_id" uuid,
	"title" text NOT NULL,
	"school_level" text,
	"grade_band" text,
	"curriculum_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"reviewer_id" uuid,
	"decision" text,
	"notes" text,
	"checklist" jsonb,
	"decided_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_rights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"book_edition_id" uuid,
	"rights_holder" text,
	"evidence_ref" text,
	"allowed_uses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allowed_scope" text,
	"expires_on" timestamp with time zone,
	"status" "content_right_status" DEFAULT 'draft' NOT NULL,
	"status_changed_by" uuid,
	"status_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diagram_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"question_version_id" uuid,
	"structure" jsonb,
	"svg_path" text,
	"svg_checksum" text,
	"original_crop_path" text,
	"alt_text" text,
	"view_box" text,
	"modifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sanitize_report" jsonb,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"format" "render_target" NOT NULL,
	"layout_options" jsonb,
	"status" "render_artifact_status" DEFAULT 'queued' NOT NULL,
	"storage_path" text,
	"checksum" text,
	"renderer_version" text,
	"validation_report" jsonb,
	"failure_reason" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duplicate_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "duplicate_kind" NOT NULL,
	"members" jsonb NOT NULL,
	"resolution" jsonb,
	"resolved_by" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "formula_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"expression_id" uuid NOT NULL,
	"question_id" uuid,
	"diagnosis" jsonb NOT NULL,
	"resolution" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_to" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "math_expressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"question_version_id" uuid,
	"block_ref" text,
	"raw_source" text NOT NULL,
	"normalized_latex" text,
	"display_mode" text DEFAULT 'inline' NOT NULL,
	"semantic_fingerprint" text,
	"parse_status" "math_parse_status" DEFAULT 'pending' NOT NULL,
	"parse_errors" jsonb,
	"unsupported_commands" jsonb,
	"repair_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"normalizer_version" text,
	"katex_version" text,
	"macro_policy_version" text,
	"render_hash" text,
	"visual_baseline_id" uuid,
	"review_status" text,
	"reviewer" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "math_normalization_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"expression_id" uuid NOT NULL,
	"normalizer_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"output_hash" text NOT NULL,
	"applied_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"semantic_risk" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "math_render_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"target" "render_target" NOT NULL,
	"status" "render_artifact_status" DEFAULT 'queued' NOT NULL,
	"storage_path" text,
	"checksum" text,
	"renderer_version" text,
	"validation_report" jsonb,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publishers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_alignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"weight" numeric(4, 3) DEFAULT '1' NOT NULL,
	"confidence" numeric(4, 3),
	"provenance" text DEFAULT 'human' NOT NULL,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"question_version_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_path" text NOT NULL,
	"checksum" text NOT NULL,
	"alt_text" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"body" jsonb NOT NULL,
	"choices" jsonb,
	"answer" jsonb,
	"explanation" jsonb,
	"rubric" jsonb,
	"points" numeric(6, 2),
	"expected_seconds" integer,
	"difficulty" jsonb,
	"question_type_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_checksum" text NOT NULL,
	"extraction" jsonb,
	"created_by" uuid,
	"change_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"current_version_id" uuid,
	"kind" "question_kind" NOT NULL,
	"review_status" "question_review_status" DEFAULT 'draft' NOT NULL,
	"source_file_id" uuid,
	"source_page_id" uuid,
	"book_edition_id" uuid,
	"printed_number" text,
	"content_right_id" uuid,
	"source_coords" jsonb,
	"is_auto_assignable" boolean DEFAULT false NOT NULL,
	"quarantine_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"book_edition_id" uuid,
	"storage_path" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"checksum" text NOT NULL,
	"page_count" integer,
	"status" "ingestion_status" DEFAULT 'uploaded' NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"scan_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_file_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"image_path" text,
	"image_checksum" text,
	"preprocessing" jsonb,
	"ocr_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"learner_id" uuid,
	"learning_group_id" uuid,
	"session_id" uuid,
	"route_node_id" uuid,
	"kind" text NOT NULL,
	"detail" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"route_version_id" uuid NOT NULL,
	"from_node_id" uuid NOT NULL,
	"to_node_id" uuid NOT NULL,
	"kind" text DEFAULT 'sequence' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"route_version_id" uuid NOT NULL,
	"kind" "route_node_kind" NOT NULL,
	"title" text NOT NULL,
	"sort_order" integer NOT NULL,
	"concept_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"objective_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"book_edition_id" uuid,
	"page_range" jsonb,
	"expected_minutes" integer,
	"instruction_plan" jsonb,
	"homework" jsonb,
	"blueprint_id" uuid,
	"completion_criteria" jsonb,
	"auto_adjust_policy" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "route_kind" NOT NULL,
	"name" text NOT NULL,
	"learning_group_id" uuid,
	"learner_id" uuid,
	"course_period_id" uuid,
	"curriculum_version_id" uuid,
	"source_template_id" uuid,
	"status" "route_status" DEFAULT 'draft' NOT NULL,
	"active_version_id" uuid,
	"target_end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"route_plan_id" uuid NOT NULL,
	"route_version_id" uuid NOT NULL,
	"impact_summary" jsonb,
	"published_by" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scheduled_for" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "route_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"route_plan_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" "route_status" DEFAULT 'draft' NOT NULL,
	"validation_report" jsonb,
	"curriculum_release_id" uuid,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"change_summary" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_change_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_ref" uuid,
	"status" "proposal_status" DEFAULT 'calculating' NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"engine_version" text NOT NULL,
	"seed" text NOT NULL,
	"cutoff_at" timestamp with time zone NOT NULL,
	"diff" jsonb,
	"reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conflicts" jsonb,
	"output_hash" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"result_revision_id" uuid,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_leases" (
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"holder_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"proposal_id" uuid,
	"is_active" boolean DEFAULT false NOT NULL,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_route_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"base_route_version_id" uuid NOT NULL,
	"kind" "override_kind" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "override_status" DEFAULT 'active' NOT NULL,
	"path_type" text,
	"reason" text NOT NULL,
	"goal" text,
	"start_condition" jsonb,
	"success_condition" jsonb,
	"max_duration_days" integer,
	"rejoin_node_id" uuid,
	"delta" jsonb NOT NULL,
	"created_by" uuid,
	"effective_from" date,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_blueprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"policy_id" uuid,
	"purpose" "assessment_purpose" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"curriculum_version_id" uuid,
	"spec" jsonb NOT NULL,
	"anchor_spec" jsonb,
	"grading_split" jsonb,
	"accessibility_checks" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"blueprint_id" uuid,
	"policy_id" uuid,
	"policy_version" integer,
	"purpose" "assessment_purpose" NOT NULL,
	"title" text NOT NULL,
	"learning_group_id" uuid,
	"learner_id" uuid,
	"scheduled_date" date,
	"route_node_id" uuid,
	"status" "assessment_status" DEFAULT 'generating' NOT NULL,
	"generation_seed" text,
	"generation_context" jsonb,
	"ai_involvement" jsonb,
	"time_limit_minutes" integer,
	"total_points" numeric(8, 2),
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"purpose" "assessment_purpose" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"pool_weights" jsonb NOT NULL,
	"question_count" integer NOT NULL,
	"time_limit_minutes" integer,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"passing_rules" jsonb,
	"attempt_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"automation_level" text DEFAULT 'approve_first' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"question_version_id" uuid NOT NULL,
	"content_checksum" text NOT NULL,
	"sort_order" integer NOT NULL,
	"points" numeric(6, 2) NOT NULL,
	"answer_snapshot" jsonb NOT NULL,
	"rubric_snapshot" jsonb,
	"concept_weights" jsonb NOT NULL,
	"selection_reason" text NOT NULL,
	"is_anchor" boolean DEFAULT false NOT NULL,
	"invalidated_at" timestamp with time zone,
	"invalidated_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"mode" text DEFAULT 'online' NOT NULL,
	"status" "assignment_status" DEFAULT 'assigned' NOT NULL,
	"due_at" timestamp with time zone,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"attempt_no" integer DEFAULT 1 NOT NULL,
	"status" "attempt_status" DEFAULT 'not_started' NOT NULL,
	"started_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"preflight_report" jsonb,
	"client_sequence" integer DEFAULT 0 NOT NULL,
	"total_score" numeric(8, 2),
	"max_score" numeric(8, 2),
	"finalized_at" timestamp with time zone,
	"invalidated_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grade_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"response_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source" "grade_decision_source" NOT NULL,
	"is_correct" boolean,
	"score" numeric(6, 2),
	"max_score" numeric(6, 2),
	"rubric_breakdown" jsonb,
	"confidence" numeric(4, 3),
	"rationale" jsonb,
	"is_final" boolean DEFAULT false NOT NULL,
	"decided_by" uuid,
	"grader_version" text,
	"supersedes_id" uuid,
	"change_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grading_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"response_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"kind" "grading_exception_kind" NOT NULL,
	"status" "grading_exception_status" DEFAULT 'open' NOT NULL,
	"auto_result" jsonb,
	"assigned_to" uuid,
	"resolution" jsonb,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"assessment_question_id" uuid NOT NULL,
	"answer" jsonb,
	"saved_sequence" integer DEFAULT 0 NOT NULL,
	"saved_at" timestamp with time zone,
	"work_artifacts" jsonb,
	"hint_used" integer DEFAULT 0 NOT NULL,
	"elapsed_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "concept_masteries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"state" "mastery_state" DEFAULT 'no_evidence' NOT NULL,
	"point_estimate" numeric(4, 3),
	"uncertainty" numeric(4, 3),
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"distinct_days" integer DEFAULT 0 NOT NULL,
	"last_evidence_at" timestamp with time zone,
	"dimensions" jsonb,
	"next_check" jsonb,
	"policy_version_id" uuid,
	"evidence_cutoff_at" timestamp with time zone,
	"teacher_override" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mastery_evidences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"grade_decision_id" uuid,
	"kind" text NOT NULL,
	"signal" jsonb NOT NULL,
	"mapping_confidence" numeric(4, 3),
	"evidence_date" date NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mastery_policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"applies_to" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"spec" jsonb NOT NULL,
	"algorithm_version" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"activated_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retry_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"failed_assessment_id" uuid NOT NULL,
	"failed_attempt_id" uuid,
	"remediation_override_id" uuid,
	"retry_assessment_id" uuid,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"max_attempts" integer,
	"scheduled_on" date,
	"status" "retry_plan_status" DEFAULT 'planned' NOT NULL,
	"unlock_targets" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_response_id" uuid,
	"question_id" uuid,
	"due_on" date NOT NULL,
	"interval_days" integer,
	"status" "review_item_status" DEFAULT 'scheduled' NOT NULL,
	"completed_at" timestamp with time zone,
	"outcome" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_ref" text,
	"file_checksum" text,
	"status" "import_job_status" DEFAULT 'uploaded' NOT NULL,
	"preview_report" jsonb,
	"result_counts" jsonb,
	"created_by" uuid NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" jsonb NOT NULL,
	"link_path" text,
	"related_type" text,
	"related_id" uuid,
	"group_key" text,
	"status" "notification_status" DEFAULT 'unread' NOT NULL,
	"assigned_to" uuid,
	"due_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"operator_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"disclosed_to_owner" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid,
	"data_window" jsonb NOT NULL,
	"status" "report_status" DEFAULT 'draft' NOT NULL,
	"content" jsonb,
	"generated_by" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"export_refs" jsonb,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_events_org_created_idx" ON "audit_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_identities_uq" ON "external_identities" USING btree ("organization_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "external_identities_target_idx" ON "external_identities" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "integration_connections_org_idx" ON "integration_connections" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_sync_cursors_uq" ON "integration_sync_cursors" USING btree ("connection_id","resource");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_uq" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_org_email_idx" ON "invitations" USING btree ("organization_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "kill_switches_scope_key_uq" ON "kill_switches" USING btree ("organization_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_scopes_uq" ON "membership_scopes" USING btree ("membership_id","scope_kind","scope_id");--> statement-breakpoint
CREATE INDEX "membership_scopes_org_idx" ON "membership_scopes" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_uq" ON "memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_uq" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idempotency_expires_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "jobs_poll_idx" ON "jobs" USING btree ("status","run_at","priority");--> statement-breakpoint
CREATE INDEX "jobs_topic_status_idx" ON "jobs" USING btree ("topic","status");--> statement-breakpoint
CREATE INDEX "jobs_org_idx" ON "jobs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_uq" ON "jobs" USING btree ("topic","idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE INDEX "outbox_status_next_idx" ON "outbox_events" USING btree ("status","next_attempt_at","id");--> statement-breakpoint
CREATE INDEX "outbox_aggregate_idx" ON "outbox_events" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE INDEX "calendar_rules_subject_idx" ON "calendar_rules" USING btree ("organization_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "course_periods_org_idx" ON "course_periods" USING btree ("organization_id","academic_year");--> statement-breakpoint
CREATE INDEX "holidays_org_range_idx" ON "holidays" USING btree ("organization_id","starts_on","ends_on");--> statement-breakpoint
CREATE INDEX "learners_org_idx" ON "learners" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "learners_org_user_uq" ON "learners" USING btree ("organization_id","user_id") WHERE user_id is not null;--> statement-breakpoint
CREATE INDEX "availability_events_org_idx" ON "learning_availability_events" USING btree ("organization_id","status","starts_on");--> statement-breakpoint
CREATE INDEX "availability_events_learner_idx" ON "learning_availability_events" USING btree ("organization_id","learner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lg_memberships_active_uq" ON "learning_group_memberships" USING btree ("learning_group_id","learner_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "lg_memberships_learner_idx" ON "learning_group_memberships" USING btree ("organization_id","learner_id");--> statement-breakpoint
CREATE INDEX "learning_groups_org_idx" ON "learning_groups" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "learning_groups_teacher_idx" ON "learning_groups" USING btree ("organization_id","home_teacher_user_id");--> statement-breakpoint
CREATE INDEX "makeup_sessions_org_idx" ON "makeup_sessions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "makeup_sessions_original_idx" ON "makeup_sessions" USING btree ("original_session_id");--> statement-breakpoint
CREATE INDEX "sessions_group_starts_idx" ON "sessions" USING btree ("organization_id","learning_group_id","starts_at");--> statement-breakpoint
CREATE INDEX "sessions_teacher_starts_idx" ON "sessions" USING btree ("organization_id","teacher_user_id","starts_at");--> statement-breakpoint
CREATE INDEX "sessions_date_idx" ON "sessions" USING btree ("organization_id","session_date");--> statement-breakpoint
CREATE UNIQUE INDEX "achievement_standards_release_code_uq" ON "achievement_standards" USING btree ("release_id","code");--> statement-breakpoint
CREATE INDEX "achievement_standards_node_idx" ON "achievement_standards" USING btree ("official_node_id");--> statement-breakpoint
CREATE INDEX "assessment_evidences_objective_idx" ON "assessment_evidences" USING btree ("objective_id");--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_concepts_slug_uq" ON "canonical_concepts" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "canonical_concepts_band_idx" ON "canonical_concepts" USING btree ("grade_band","status");--> statement-breakpoint
CREATE INDEX "competency_defs_release_idx" ON "competency_definitions" USING btree ("release_id");--> statement-breakpoint
CREATE UNIQUE INDEX "concept_edges_uq" ON "concept_edges" USING btree ("from_concept_id","to_concept_id","kind");--> statement-breakpoint
CREATE INDEX "concept_edges_to_idx" ON "concept_edges" USING btree ("to_concept_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "curriculum_applicability_uq" ON "curriculum_applicabilities" USING btree ("academic_year","school_level","grade_band","subject_code");--> statement-breakpoint
CREATE INDEX "authority_sources_review_idx" ON "curriculum_authority_sources" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX "curriculum_mappings_official_idx" ON "curriculum_mappings" USING btree ("official_type","official_id");--> statement-breakpoint
CREATE INDEX "curriculum_mappings_internal_idx" ON "curriculum_mappings" USING btree ("internal_type","internal_id");--> statement-breakpoint
CREATE INDEX "curriculum_mappings_org_idx" ON "curriculum_mappings" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "curriculum_releases_uq" ON "curriculum_releases" USING btree ("curriculum_version_id","release_number");--> statement-breakpoint
CREATE UNIQUE INDEX "curriculum_versions_code_uq" ON "curriculum_versions" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "instructional_profiles_concept_uq" ON "instructional_profiles" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "learning_objectives_concept_idx" ON "learning_objectives" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "misconceptions_concept_idx" ON "misconceptions" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "official_nodes_release_idx" ON "official_curriculum_nodes" USING btree ("release_id","parent_id");--> statement-breakpoint
CREATE INDEX "official_nodes_version_idx" ON "official_curriculum_nodes" USING btree ("curriculum_version_id","kind");--> statement-breakpoint
CREATE INDEX "representations_concept_idx" ON "representations" USING btree ("concept_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_aliases_uq" ON "source_aliases" USING btree ("organization_id","source_system","alias_text");--> statement-breakpoint
CREATE INDEX "source_aliases_concept_idx" ON "source_aliases" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "book_editions_book_idx" ON "book_editions" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "books_org_idx" ON "books" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "content_reviews_subject_idx" ON "content_reviews" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "content_reviews_org_status_idx" ON "content_reviews" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "content_rights_org_status_idx" ON "content_rights" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "content_rights_edition_idx" ON "content_rights" USING btree ("book_edition_id");--> statement-breakpoint
CREATE INDEX "diagram_assets_qv_idx" ON "diagram_assets" USING btree ("question_version_id");--> statement-breakpoint
CREATE INDEX "document_exports_subject_idx" ON "document_exports" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "document_exports_org_status_idx" ON "document_exports" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "duplicate_groups_org_idx" ON "duplicate_groups" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "formula_reviews_org_status_idx" ON "formula_reviews" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "math_expressions_qv_idx" ON "math_expressions" USING btree ("question_version_id");--> statement-breakpoint
CREATE INDEX "math_expressions_status_idx" ON "math_expressions" USING btree ("organization_id","parse_status");--> statement-breakpoint
CREATE INDEX "math_norm_runs_expr_idx" ON "math_normalization_runs" USING btree ("expression_id");--> statement-breakpoint
CREATE INDEX "render_artifacts_subject_idx" ON "math_render_artifacts" USING btree ("subject_type","subject_id","target");--> statement-breakpoint
CREATE INDEX "render_artifacts_status_idx" ON "math_render_artifacts" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "publishers_org_name_uq" ON "publishers" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "question_alignments_uq" ON "question_alignments" USING btree ("question_id","concept_id");--> statement-breakpoint
CREATE INDEX "question_alignments_concept_idx" ON "question_alignments" USING btree ("organization_id","concept_id");--> statement-breakpoint
CREATE INDEX "question_assets_qv_idx" ON "question_assets" USING btree ("question_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "question_versions_uq" ON "question_versions" USING btree ("question_id","version_number");--> statement-breakpoint
CREATE INDEX "question_versions_org_idx" ON "question_versions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "questions_org_status_idx" ON "questions" USING btree ("organization_id","review_status");--> statement-breakpoint
CREATE INDEX "questions_org_assignable_idx" ON "questions" USING btree ("organization_id","is_auto_assignable");--> statement-breakpoint
CREATE INDEX "questions_source_idx" ON "questions" USING btree ("source_file_id");--> statement-breakpoint
CREATE INDEX "source_files_org_idx" ON "source_files" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "source_files_org_checksum_uq" ON "source_files" USING btree ("organization_id","checksum");--> statement-breakpoint
CREATE UNIQUE INDEX "source_pages_uq" ON "source_pages" USING btree ("source_file_id","page_number");--> statement-breakpoint
CREATE INDEX "progress_events_learner_idx" ON "progress_events" USING btree ("organization_id","learner_id","occurred_at");--> statement-breakpoint
CREATE INDEX "progress_events_group_idx" ON "progress_events" USING btree ("organization_id","learning_group_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "route_dependencies_uq" ON "route_dependencies" USING btree ("from_node_id","to_node_id");--> statement-breakpoint
CREATE INDEX "route_dependencies_version_idx" ON "route_dependencies" USING btree ("route_version_id");--> statement-breakpoint
CREATE INDEX "route_nodes_version_idx" ON "route_nodes" USING btree ("route_version_id","sort_order");--> statement-breakpoint
CREATE INDEX "route_plans_org_idx" ON "route_plans" USING btree ("organization_id","kind","status");--> statement-breakpoint
CREATE INDEX "route_plans_group_idx" ON "route_plans" USING btree ("learning_group_id");--> statement-breakpoint
CREATE INDEX "route_publications_plan_idx" ON "route_publications" USING btree ("route_plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "route_versions_uq" ON "route_versions" USING btree ("route_plan_id","version_number");--> statement-breakpoint
CREATE INDEX "route_versions_org_idx" ON "route_versions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "proposals_org_status_idx" ON "schedule_change_proposals" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "proposals_scope_idx" ON "schedule_change_proposals" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_leases_uq" ON "schedule_leases" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_revisions_uq" ON "schedule_revisions" USING btree ("scope_type","scope_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_revisions_active_uq" ON "schedule_revisions" USING btree ("scope_type","scope_id") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "overrides_learner_idx" ON "student_route_overrides" USING btree ("organization_id","learner_id","status");--> statement-breakpoint
CREATE INDEX "overrides_base_version_idx" ON "student_route_overrides" USING btree ("base_route_version_id");--> statement-breakpoint
CREATE INDEX "blueprints_org_idx" ON "assessment_blueprints" USING btree ("organization_id","purpose");--> statement-breakpoint
CREATE INDEX "assessments_org_status_idx" ON "assessment_instances" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "assessments_group_date_idx" ON "assessment_instances" USING btree ("organization_id","learning_group_id","scheduled_date");--> statement-breakpoint
CREATE UNIQUE INDEX "assessments_idempotent_uq" ON "assessment_instances" USING btree ("organization_id","learning_group_id","learner_id","scheduled_date","purpose") WHERE status <> 'cancelled' and scheduled_date is not null;--> statement-breakpoint
CREATE INDEX "assessment_policies_org_idx" ON "assessment_policies" USING btree ("organization_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_policies_ver_uq" ON "assessment_policies" USING btree ("organization_id","name","version");--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_questions_uq" ON "assessment_questions" USING btree ("assessment_id","sort_order");--> statement-breakpoint
CREATE INDEX "assessment_questions_question_idx" ON "assessment_questions" USING btree ("question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_uq" ON "assignments" USING btree ("assessment_id","learner_id");--> statement-breakpoint
CREATE INDEX "assignments_learner_idx" ON "assignments" USING btree ("organization_id","learner_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_uq" ON "attempts" USING btree ("assessment_id","learner_id","attempt_no");--> statement-breakpoint
CREATE INDEX "attempts_learner_idx" ON "attempts" USING btree ("organization_id","learner_id");--> statement-breakpoint
CREATE INDEX "attempts_status_idx" ON "attempts" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "grade_decisions_uq" ON "grade_decisions" USING btree ("response_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "grade_decisions_final_uq" ON "grade_decisions" USING btree ("response_id") WHERE is_final = true;--> statement-breakpoint
CREATE INDEX "grading_exceptions_org_idx" ON "grading_exceptions" USING btree ("organization_id","status","due_at");--> statement-breakpoint
CREATE INDEX "grading_exceptions_attempt_idx" ON "grading_exceptions" USING btree ("attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "responses_uq" ON "responses" USING btree ("attempt_id","assessment_question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "concept_masteries_uq" ON "concept_masteries" USING btree ("learner_id","concept_id");--> statement-breakpoint
CREATE INDEX "concept_masteries_org_state_idx" ON "concept_masteries" USING btree ("organization_id","state");--> statement-breakpoint
CREATE INDEX "mastery_evidences_learner_concept_idx" ON "mastery_evidences" USING btree ("organization_id","learner_id","concept_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mastery_evidences_decision_uq" ON "mastery_evidences" USING btree ("grade_decision_id","concept_id") WHERE grade_decision_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "mastery_policies_uq" ON "mastery_policy_versions" USING btree ("organization_id","name","version");--> statement-breakpoint
CREATE INDEX "retry_plans_learner_idx" ON "retry_plans" USING btree ("organization_id","learner_id","status");--> statement-breakpoint
CREATE INDEX "review_items_learner_due_idx" ON "review_items" USING btree ("organization_id","learner_id","status","due_on");--> statement-breakpoint
CREATE INDEX "import_jobs_org_idx" ON "import_jobs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "notifications_org_status_due_idx" ON "notifications" USING btree ("organization_id","status","due_at");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_user_id","status");--> statement-breakpoint
CREATE INDEX "operator_grants_org_idx" ON "operator_access_grants" USING btree ("organization_id","expires_at");--> statement-breakpoint
CREATE INDEX "reports_org_idx" ON "reports" USING btree ("organization_id","kind","status");--> statement-breakpoint
CREATE INDEX "reports_subject_idx" ON "reports" USING btree ("subject_type","subject_id");