CREATE TYPE "public"."deletion_request_status" AS ENUM('received', 'processing', 'completed', 'rejected');--> statement-breakpoint
CREATE TABLE "data_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject_type" text DEFAULT 'learner' NOT NULL,
	"learner_id" uuid,
	"requested_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" "deletion_request_status" DEFAULT 'received' NOT NULL,
	"due_on" date NOT NULL,
	"executed_at" timestamp with time zone,
	"executed_by" uuid,
	"backup_expires_on" date,
	"summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "deletion_requests_org_idx" ON "data_deletion_requests" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "deletion_requests_learner_idx" ON "data_deletion_requests" USING btree ("learner_id");