CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"automation_id" text,
	"model" text NOT NULL,
	"served_model" text,
	"prompt_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"status" text NOT NULL,
	"stop_reason" text,
	"refusal_category" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_read_tokens" integer,
	"cost_usd" numeric(10, 6),
	"latency_ms" integer,
	"masked_counts" jsonb,
	"output" jsonb,
	"error" text,
	"entity_type" text,
	"entity_id" text,
	"reviewed_by" uuid,
	"review_outcome" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"title" text NOT NULL,
	"channel" text NOT NULL,
	"lead_id" uuid,
	"contact_id" uuid,
	"appointment_id" uuid,
	"subject" text,
	"draft_body" text NOT NULL,
	"final_body" text,
	"final_subject" text,
	"edited" boolean DEFAULT false NOT NULL,
	"sources" jsonb,
	"flags" jsonb,
	"ai_run_id" uuid,
	"reject_reason" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"message_id" uuid,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "conflict_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"status" text DEFAULT 'awaiting_review' NOT NULL,
	"names" text[] NOT NULL,
	"hit_count" integer NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conflict_checks_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "conflict_hits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_id" uuid NOT NULL,
	"query_name" text NOT NULL,
	"matched_type" text NOT NULL,
	"matched_id" uuid NOT NULL,
	"matched_name" text NOT NULL,
	"role" text NOT NULL,
	"similarity" real NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conflict_parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"role" text NOT NULL,
	"matter_reference" text,
	"notes" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "intake_records" (
	"lead_id" uuid PRIMARY KEY NOT NULL,
	"practice_area" text,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"missing" text[] DEFAULT '{}' NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"out_of_scope" boolean DEFAULT false NOT NULL,
	"out_of_scope_topic" text,
	"score" integer,
	"score_breakdown" jsonb,
	"urgent" boolean DEFAULT false NOT NULL,
	"ai_turns" integer DEFAULT 0 NOT NULL,
	"disclosure_sent_at" timestamp with time zone,
	"handed_off_at" timestamp with time zone,
	"escalation_reasons" text[] DEFAULT '{}' NOT NULL,
	"escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"organization" text,
	"handles" text[] DEFAULT '{}' NOT NULL,
	"phone" text,
	"email" text,
	"website" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "referrals_out" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"approval_id" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ghl_contact_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "practice_areas" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "a3_mode" text DEFAULT 'review_all' NOT NULL;--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "consult_calendar_id" text;--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "fee_table" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "assigned_user_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "declined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "approval_id" uuid;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_checks" ADD CONSTRAINT "conflict_checks_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_hits" ADD CONSTRAINT "conflict_hits_check_id_conflict_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."conflict_checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_records" ADD CONSTRAINT "intake_records_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals_out" ADD CONSTRAINT "referrals_out_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals_out" ADD CONSTRAINT "referrals_out_partner_id_referral_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."referral_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals_out" ADD CONSTRAINT "referrals_out_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_runs_created_idx" ON "ai_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_runs_entity_idx" ON "ai_runs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "approvals_pending_idx" ON "approvals" USING btree ("priority","created_at") WHERE "approvals"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "approvals_lead_idx" ON "approvals" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "conflict_checks_lead_idx" ON "conflict_checks" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "conflict_hits_check_idx" ON "conflict_hits" USING btree ("check_id");--> statement-breakpoint
CREATE INDEX "conflict_parties_name_idx" ON "conflict_parties" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_out_lead_partner_idx" ON "referrals_out" USING btree ("lead_id","partner_id");