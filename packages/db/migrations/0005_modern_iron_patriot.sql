CREATE TABLE "learner_schedule_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"learning_group_id" uuid NOT NULL,
	"schedule_revision_id" uuid,
	"session_id" uuid,
	"item_date" date NOT NULL,
	"timezone" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"planned_node_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"matches_group" boolean DEFAULT false NOT NULL,
	"is_rejoin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "learner_schedule_items_learner_idx" ON "learner_schedule_items" USING btree ("organization_id","learner_id","item_date");--> statement-breakpoint
CREATE INDEX "learner_schedule_items_session_idx" ON "learner_schedule_items" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "learner_schedule_items_revision_idx" ON "learner_schedule_items" USING btree ("schedule_revision_id");