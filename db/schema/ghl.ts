import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const WEBHOOK_EVENT_STATUSES = ["pending", "processed", "ignored", "failed"] as const;
export type WebhookEventStatus = (typeof WEBHOOK_EVENT_STATUSES)[number];

/** How an inbound webhook proved it came from GHL (ADR 0006). */
export const WEBHOOK_AUTH_METHODS = ["shared_secret", "signature", "demo"] as const;
export type WebhookAuthMethod = (typeof WEBHOOK_AUTH_METHODS)[number];

/**
 * Every inbound webhook, written before any processing (spec Section 2: "write
 * raw payload to webhook_events, return 200, process in a job").
 *
 * `dedupe_key` is GHL's webhookId when present, otherwise a SHA-256 of the
 * body, so a replayed delivery is stored once. The payload is stored with
 * sensitive keys (date of birth, SSN and similar) redacted (rule 6).
 */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull().default("ghl"),
    dedupeKey: text("dedupe_key").notNull().unique(),
    eventType: text("event_type").notNull(),
    authMethod: text("auth_method", { enum: WEBHOOK_AUTH_METHODS }).notNull(),
    locationId: text("location_id"),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status", { enum: WEBHOOK_EVENT_STATUSES }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    index("webhook_events_status_idx")
      .on(t.status, t.receivedAt)
      .where(sql`${t.status} in ('pending', 'failed')`),
    index("webhook_events_received_at_idx").on(t.receivedAt),
  ],
);

/** Cursor and outcome of each sync process (nightly reconciliation). */
export const syncState = pgTable("sync_state", {
  key: text("key").primaryKey(),
  cursor: jsonb("cursor"),
  lastStartedAt: timestamp("last_started_at", { withTimezone: true }),
  lastSucceededAt: timestamp("last_succeeded_at", { withTimezone: true }),
  lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
  lastError: text("last_error"),
  stats: jsonb("stats"),
  ...timestamps,
});

export type WebhookEventRow = typeof webhookEvents.$inferSelect;
export type SyncStateRow = typeof syncState.$inferSelect;
