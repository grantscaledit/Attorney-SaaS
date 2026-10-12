CREATE TABLE "calendar_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_feeds_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "calendar_feeds_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "deadline_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deadline_id" uuid NOT NULL,
	"threshold" smallint NOT NULL,
	"due_on" date NOT NULL,
	"recipient_id" uuid,
	"critical" boolean NOT NULL,
	"sms_message_id" uuid,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"escalated_at" timestamp with time zone,
	"escalated_to" uuid[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deadline_holidays" (
	"date" date PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deadline_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"practice_area" text NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"trigger" text NOT NULL,
	"offset" jsonb NOT NULL,
	"roll_forward" text NOT NULL,
	"severity" text NOT NULL,
	"matter_types" text[] NOT NULL,
	"notice_types" text[] DEFAULT '{}' NOT NULL,
	"condition" jsonb,
	"prefer_printed" boolean DEFAULT false NOT NULL,
	"recurring" text,
	"allows_tolling" boolean DEFAULT false NOT NULL,
	"seed_note" text,
	"seed_hash" text,
	"citation" text,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"verified_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deadline_rules_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "deadline_tolling" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deadline_id" uuid NOT NULL,
	"days" integer NOT NULL,
	"reason" text NOT NULL,
	"from_on" date,
	"to_on" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deadlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matter_id" uuid NOT NULL,
	"label" text NOT NULL,
	"due_on" date NOT NULL,
	"origin" text NOT NULL,
	"rule_id" uuid,
	"rule_version" integer,
	"rule_hash" text,
	"event_id" uuid,
	"document_id" uuid,
	"occurrence" smallint DEFAULT 0 NOT NULL,
	"computation" jsonb,
	"cross_check" jsonb,
	"severity" text NOT NULL,
	"owner_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"confirmed" boolean DEFAULT true NOT NULL,
	"rule_changed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"note" text,
	"dedupe_key" text,
	"due_changed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deadlines_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "matter_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matter_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"occurred_on" date NOT NULL,
	"notice_type" text,
	"flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"document_id" uuid,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matter_id" uuid NOT NULL,
	"label" text NOT NULL,
	"first_due_on" date NOT NULL,
	"day_of_month" smallint NOT NULL,
	"amount" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_plans_matter_id_unique" UNIQUE("matter_id")
);
--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_alerts" ADD CONSTRAINT "deadline_alerts_deadline_id_deadlines_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadlines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_alerts" ADD CONSTRAINT "deadline_alerts_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_rules" ADD CONSTRAINT "deadline_rules_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_tolling" ADD CONSTRAINT "deadline_tolling_deadline_id_deadlines_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadlines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_rule_id_deadline_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."deadline_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_event_id_matter_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."matter_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_events" ADD CONSTRAINT "matter_events_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_events" ADD CONSTRAINT "matter_events_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deadline_alerts_point_idx" ON "deadline_alerts" USING btree ("deadline_id","threshold","due_on");--> statement-breakpoint
CREATE INDEX "deadline_alerts_open_idx" ON "deadline_alerts" USING btree ("created_at") WHERE "deadline_alerts"."acknowledged_at" is null;--> statement-breakpoint
CREATE INDEX "deadline_rules_trigger_idx" ON "deadline_rules" USING btree ("trigger");--> statement-breakpoint
CREATE INDEX "deadline_tolling_deadline_idx" ON "deadline_tolling" USING btree ("deadline_id");--> statement-breakpoint
CREATE INDEX "deadlines_matter_idx" ON "deadlines" USING btree ("matter_id");--> statement-breakpoint
CREATE INDEX "deadlines_open_due_idx" ON "deadlines" USING btree ("due_on") WHERE "deadlines"."status" = 'open';--> statement-breakpoint
CREATE INDEX "deadlines_owner_idx" ON "deadlines" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "deadlines_rule_idx" ON "deadlines" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "matter_events_matter_idx" ON "matter_events" USING btree ("matter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "matter_events_document_idx" ON "matter_events" USING btree ("document_id","kind") WHERE "matter_events"."document_id" is not null and "matter_events"."deleted_at" is null;