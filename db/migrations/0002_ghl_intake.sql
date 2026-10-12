CREATE TABLE "sync_state" (
	"key" text PRIMARY KEY NOT NULL,
	"cursor" jsonb,
	"last_started_at" timestamp with time zone,
	"last_succeeded_at" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	"last_error" text,
	"stats" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'ghl' NOT NULL,
	"dedupe_key" text NOT NULL,
	"event_type" text NOT NULL,
	"auth_method" text NOT NULL,
	"location_id" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text DEFAULT 'ghl' NOT NULL,
	"source_id" text NOT NULL,
	"contact_id" uuid,
	"lead_id" uuid,
	"calendar_id" text,
	"title" text,
	"status" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"ghl_assigned_user_id" text,
	"ghl_date_updated" timestamp with time zone,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text DEFAULT 'ghl' NOT NULL,
	"source_id" text NOT NULL,
	"contact_id" uuid NOT NULL,
	"lead_id" uuid,
	"direction" text NOT NULL,
	"outcome" text NOT NULL,
	"ghl_status" text,
	"ghl_call_status" text,
	"duration_seconds" integer,
	"tracking_number" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"basis" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text DEFAULT 'ghl' NOT NULL,
	"source_id" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"full_name" text,
	"email" text,
	"phone" text,
	"company_name" text,
	"timezone" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"dnd" boolean DEFAULT false NOT NULL,
	"dnd_sms" boolean DEFAULT false NOT NULL,
	"dnd_email" boolean DEFAULT false NOT NULL,
	"dnd_call" boolean DEFAULT false NOT NULL,
	"ghl_source" text,
	"ghl_assigned_to" text,
	"ghl_date_added" timestamp with time zone,
	"ghl_date_updated" timestamp with time zone,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lead_touches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"origin" text NOT NULL,
	"channel" text NOT NULL,
	"source_label" text NOT NULL,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"referrer" text,
	"landing_url" text,
	"gclid" text,
	"fbclid" text,
	"tracking_number" text,
	"ghl_source" text,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_touches_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"status" text DEFAULT 'new' NOT NULL,
	"channel" text NOT NULL,
	"practice_area" text,
	"missed_call" boolean DEFAULT false NOT NULL,
	"first_inbound_at" timestamp with time zone NOT NULL,
	"first_response_at" timestamp with time zone,
	"first_human_response_at" timestamp with time zone,
	"consult_booked_at" timestamp with time zone,
	"consult_held_at" timestamp with time zone,
	"retained_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "leads_opportunity_id_unique" UNIQUE("opportunity_id")
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text DEFAULT 'ghl' NOT NULL,
	"source_id" text NOT NULL,
	"contact_id" uuid,
	"name" text,
	"pipeline_id" text,
	"pipeline_stage_id" text,
	"status" text NOT NULL,
	"monetary_value" numeric(12, 2),
	"ghl_assigned_to" text,
	"ghl_source" text,
	"ghl_date_added" timestamp with time zone,
	"ghl_date_updated" timestamp with time zone,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"key" text PRIMARY KEY NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"lead_id" uuid,
	"direction" text NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"automation_id" text,
	"template_key" text,
	"subject" text,
	"body" text,
	"idempotency_key" text,
	"scheduled_for" timestamp with time zone,
	"deferred_from" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"occurred_at" timestamp with time zone,
	"ghl_message_id" text,
	"suppressed_reason" text,
	"last_error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "messages_ghl_message_id_unique" UNIQUE("ghl_message_id")
);
--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "booking_url" text;--> statement-breakpoint
ALTER TABLE "firm_settings" ADD COLUMN "intake_form_url" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_touches" ADD CONSTRAINT "lead_touches_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_events_status_idx" ON "webhook_events" USING btree ("status","received_at") WHERE "webhook_events"."status" in ('pending', 'failed');--> statement-breakpoint
CREATE INDEX "webhook_events_received_at_idx" ON "webhook_events" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_source_idx" ON "appointments" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "appointments_lead_idx" ON "appointments" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "appointments_starts_at_idx" ON "appointments" USING btree ("starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_source_idx" ON "calls" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "calls_contact_idx" ON "calls" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX "calls_lead_idx" ON "calls" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "consents_contact_idx" ON "consents" USING btree ("contact_id","channel","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_source_idx" ON "contacts" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "contacts_phone_idx" ON "contacts" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "lead_touches_lead_idx" ON "lead_touches" USING btree ("lead_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_one_open_per_contact" ON "leads" USING btree ("contact_id") WHERE "leads"."status" in ('new', 'contacted', 'consult_booked', 'consult_held') and "leads"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "leads_first_inbound_idx" ON "leads" USING btree ("first_inbound_at");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_source_idx" ON "opportunities" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "opportunities_contact_idx" ON "opportunities" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "automation_runs_automation_idx" ON "automation_runs" USING btree ("automation_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_due_idx" ON "messages" USING btree ("scheduled_for") WHERE "messages"."status" in ('queued', 'sending');--> statement-breakpoint
CREATE INDEX "messages_contact_idx" ON "messages" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_lead_idx" ON "messages" USING btree ("lead_id");