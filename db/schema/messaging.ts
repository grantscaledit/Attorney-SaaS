import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { contacts, leads } from "./intake";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const MESSAGE_CHANNELS = ["sms", "email", "chat", "other"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export const MESSAGE_STATUSES = [
  // outbound lifecycle
  "queued",
  "sending",
  "sent",
  "failed",
  /** A send was attempted but the outcome is unknown (crash mid-send). Never retried automatically. */
  "unknown",
  /** Not sent by rule: do-not-disturb, no consent, unapproved template, feature off. */
  "suppressed",
  /** Superseded before sending, e.g. an appointment was rescheduled. */
  "cancelled",
  /** Demo mode: recorded but never sent (rule 12). */
  "simulated",
  // inbound or staff-sent (seen via GHL webhooks)
  "received",
  "observed",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/**
 * Messages to and from contacts. LexDesk's own automated sends are an outbox:
 * a row is written first (unique `idempotency_key`), then a job sends it, so a
 * replayed trigger can never send twice.
 *
 * Inbound message bodies are not stored in Phase 1: they can contain
 * identifiers, and masking arrives with the AI layer in Phase 2 (rule 6).
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    leadId: uuid("lead_id").references(() => leads.id),
    direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
    channel: text("channel", { enum: MESSAGE_CHANNELS }).notNull(),
    status: text("status", { enum: MESSAGE_STATUSES }).notNull(),
    /** Automation that produced it (A1, A2, A7), or null for staff and inbound messages. */
    automationId: text("automation_id"),
    templateKey: text("template_key"),
    subject: text("subject"),
    /** Rendered outbound text from an approved template. Null for inbound. */
    body: text("body"),
    idempotencyKey: text("idempotency_key").unique(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    /** When a rule moved the send (quiet hours), the time originally due. */
    deferredFrom: timestamp("deferred_from", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** When the message happened, for inbound and staff-sent messages. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    ghlMessageId: text("ghl_message_id").unique(),
    suppressedReason: text("suppressed_reason"),
    lastError: text("last_error"),
    attempts: integer("attempts").notNull().default(0),
    /** Pointers only (appointment id, call id). Never message text. */
    context: jsonb("context"),
    ...timestamps,
  },
  (t) => [
    index("messages_due_idx")
      .on(t.scheduledFor)
      .where(sql`${t.status} in ('queued', 'sending')`),
    index("messages_contact_idx").on(t.contactId, t.createdAt),
    index("messages_lead_idx").on(t.leadId),
  ],
);

/**
 * Firm-approved text for automatic messages (spec Section 6, "Auto-send
 * allowed: pre-approved templates with variable slots only"). A template sends
 * only while `approved_at` is set; editing the text clears the approval.
 * Built-in defaults live in code and are never sent until the firm approves.
 */
export const messageTemplates = pgTable("message_templates", {
  key: text("key").primaryKey(),
  subject: text("subject"),
  body: text("body").notNull(),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  updatedBy: uuid("updated_by"),
  ...timestamps,
});

export const AUTOMATION_RUN_STATUSES = ["succeeded", "skipped", "failed"] as const;
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];

/**
 * One row per automation decision (spec Section 7: last run, success and
 * failure counts per automation). `detail` holds the reason, never content.
 */
export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: text("automation_id").notNull(),
    trigger: text("trigger").notNull(),
    status: text("status", { enum: AUTOMATION_RUN_STATUSES }).notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    detail: jsonb("detail"),
    ...timestamps,
  },
  (t) => [index("automation_runs_automation_idx").on(t.automationId, t.createdAt)],
);

export type MessageRow = typeof messages.$inferSelect;
export type MessageTemplateRow = typeof messageTemplates.$inferSelect;
export type AutomationRunRow = typeof automationRuns.$inferSelect;
