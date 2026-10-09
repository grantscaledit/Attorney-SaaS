import { sql } from "drizzle-orm";
import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const AUDIT_ACTOR_TYPES = ["user", "system", "vendor", "anonymous"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

/**
 * Immutable, hash-chained audit log (spec Section 4).
 *
 * `seq`, `occurred_at`, `prev_hash` and `hash` are assigned by the
 * `audit_log_chain` BEFORE INSERT trigger (migration 0001). Application code
 * never sets them. UPDATE, DELETE and TRUNCATE are rejected by triggers.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Placeholder defaults; the trigger always overwrites these three columns.
    seq: bigint("seq", { mode: "number" }).notNull().unique().default(sql`0`),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorType: text("actor_type", { enum: AUDIT_ACTOR_TYPES }).notNull(),
    actorId: uuid("actor_id"),
    actorLabel: text("actor_label"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    metadata: jsonb("metadata"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull().default(""),
  },
  (t) => [
    index("audit_log_occurred_at_idx").on(t.occurredAt),
    index("audit_log_actor_id_idx").on(t.actorId),
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
    index("audit_log_action_idx").on(t.action),
  ],
);

export type AuditRow = typeof auditLog.$inferSelect;
