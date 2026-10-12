import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { RuleOffset } from "../../practice/deadline-rules";
import { SEVERITIES } from "../../practice/deadline-rules";
import { users } from "./auth";
import { PRACTICE_AREAS } from "./firm";
import { documents, matters } from "./matters";

/*
 * Phase 4: deadlines (spec Sections 7 C1-C7, 8 and 10). Deadlines are
 * date-only values in the firm's time zone (rule 10) and advisory (rule 7):
 * every screen that shows one says to verify it against the source document.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/**
 * The firm's copy of each deadline rule. Rows start from the product seeds in
 * practice/<area>/deadlines.ts, unverified. The engine computes only from a
 * row whose verification covers its current parameters (verified_hash).
 */
export const deadlineRules = pgTable(
  "deadline_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(),
    practiceArea: text("practice_area", { enum: PRACTICE_AREAS }).notNull(),
    label: text("label").notNull(),
    description: text("description").notNull(),
    trigger: text("trigger").notNull(),
    offset: jsonb("offset").$type<RuleOffset>().notNull(),
    rollForward: text("roll_forward", { enum: ["next_business_day", "none"] }).notNull(),
    severity: text("severity", { enum: SEVERITIES }).notNull(),
    matterTypes: text("matter_types").array().notNull(),
    noticeTypes: text("notice_types")
      .array()
      .notNull()
      .default(sql`'{}'`),
    condition: jsonb("condition").$type<{ flag: string; equals: boolean } | null>(),
    preferPrinted: boolean("prefer_printed").notNull().default(false),
    recurring: text("recurring", { enum: ["annual"] }),
    allowsTolling: boolean("allows_tolling").notNull().default(false),
    /** Where the seed value came from. */
    seedNote: text("seed_note"),
    /** Hash of the product seed this row started from, to show when the product seed changes. */
    seedHash: text("seed_hash"),
    /** The statute, rule or publication the attorney checked. Required to verify. */
    citation: text("citation"),
    active: boolean("active").notNull().default(true),
    version: integer("version").notNull().default(1),
    verifiedBy: uuid("verified_by").references(() => users.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /** ruleHash() of the parameters as verified. */
    verifiedHash: text("verified_hash"),
    ...timestamps,
  },
  (t) => [index("deadline_rules_trigger_idx").on(t.trigger)],
);

/**
 * Trigger events recorded on a matter: a notice date, a date of death,
 * letters granted. C1 computes deadlines from them.
 */
export const matterEvents = pgTable(
  "matter_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id),
    kind: text("kind").notNull(),
    /** Date-only, firm time zone. */
    occurredOn: date("occurred_on").notNull(),
    noticeType: text("notice_type"),
    flags: jsonb("flags")
      .$type<Record<string, boolean>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** The document the date was read from (B3). */
    documentId: uuid("document_id").references(() => documents.id),
    note: text("note"),
    createdBy: uuid("created_by"),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("matter_events_matter_idx").on(t.matterId),
    // One event of a kind per document (B3 re-runs update it).
    uniqueIndex("matter_events_document_idx")
      .on(t.documentId, t.kind)
      .where(sql`${t.documentId} is not null and ${t.deletedAt} is null`),
  ],
);

export const DEADLINE_ORIGINS = ["rule", "document", "manual", "schedule"] as const;
export type DeadlineOrigin = (typeof DEADLINE_ORIGINS)[number];
export const DEADLINE_STATUSES = ["open", "done", "cancelled"] as const;

export const deadlines = pgTable(
  "deadlines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id),
    label: text("label").notNull(),
    /** Date-only, firm time zone. */
    dueOn: date("due_on").notNull(),
    /**
     * rule: computed by C1 from a verified rule. document: printed on a
     * document. manual: entered by staff. schedule: a payment plan date (C5).
     */
    origin: text("origin", { enum: DEADLINE_ORIGINS }).notNull(),
    ruleId: uuid("rule_id").references(() => deadlineRules.id),
    /** Rule version and hash the date was computed from. */
    ruleVersion: integer("rule_version"),
    ruleHash: text("rule_hash"),
    eventId: uuid("event_id").references(() => matterEvents.id),
    documentId: uuid("document_id").references(() => documents.id),
    /** Annual rules (C3): which year's occurrence, from 0. */
    occurrence: smallint("occurrence").notNull().default(0),
    /** How the date was reached: steps shown on screen. */
    computation: jsonb("computation").$type<string[]>(),
    /**
     * A verified rule's date for a deadline taken from a document:
     * { ruleId, ruleLabel, dueOn, matches }. Recorded only as a cross-check.
     */
    crossCheck: jsonb("cross_check").$type<{
      ruleId: string;
      ruleLabel: string;
      dueOn: string;
      matches: boolean;
    } | null>(),
    severity: text("severity", { enum: SEVERITIES }).notNull(),
    ownerId: uuid("owner_id").references(() => users.id),
    status: text("status", { enum: DEADLINE_STATUSES }).notNull().default("open"),
    /** A document date nobody has confirmed yet (B3 before review). */
    confirmed: boolean("confirmed").notNull().default(true),
    /** The rule changed after this date was computed: it needs re-verification. */
    ruleChanged: boolean("rule_changed").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by"),
    note: text("note"),
    /** One deadline per source (rule and event, document, schedule date). */
    dedupeKey: text("dedupe_key").unique(),
    /** Last time the due date moved (C7: changed in the last 7 days). */
    dueChangedAt: timestamp("due_changed_at", { withTimezone: true }),
    /** Bumped on every change, for calendar subscribers (C6). */
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by"),
    ...timestamps,
  },
  (t) => [
    index("deadlines_matter_idx").on(t.matterId),
    index("deadlines_open_due_idx")
      .on(t.dueOn)
      .where(sql`${t.status} = 'open'`),
    index("deadlines_owner_idx").on(t.ownerId),
    index("deadlines_rule_idx").on(t.ruleId),
  ],
);

/** Days added to a tolling-capable deadline (C5, collection statute), entered by staff with a reason. */
export const deadlineTolling = pgTable(
  "deadline_tolling",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deadlineId: uuid("deadline_id")
      .notNull()
      .references(() => deadlines.id),
    days: integer("days").notNull(),
    reason: text("reason").notNull(),
    fromOn: date("from_on"),
    toOn: date("to_on"),
    createdBy: uuid("created_by"),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("deadline_tolling_deadline_idx").on(t.deadlineId)],
);

/**
 * C2 alerts: one per deadline per alert point (30, 14, 7, 3, 1, 0 days).
 * Critical alerts nobody acknowledges escalate to the owner attorney.
 */
export const deadlineAlerts = pgTable(
  "deadline_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deadlineId: uuid("deadline_id")
      .notNull()
      .references(() => deadlines.id),
    threshold: smallint("threshold").notNull(),
    dueOn: date("due_on").notNull(),
    recipientId: uuid("recipient_id").references(() => users.id),
    critical: boolean("critical").notNull(),
    /** The attorney's text (3, 1 and 0 days), through the outbox. */
    smsMessageId: uuid("sms_message_id"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: uuid("acknowledged_by"),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    escalatedTo: uuid("escalated_to")
      .array()
      .notNull()
      .default(sql`'{}'`),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("deadline_alerts_point_idx").on(t.deadlineId, t.threshold, t.dueOn),
    index("deadline_alerts_open_idx")
      .on(t.createdAt)
      .where(sql`${t.acknowledgedAt} is null`),
  ],
);

/**
 * C5: an installment agreement's payment schedule, entered by staff from the
 * agreement. Payment dates are tracked as "schedule" deadlines, a few ahead.
 */
export const paymentPlans = pgTable("payment_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  matterId: uuid("matter_id")
    .notNull()
    .unique()
    .references(() => matters.id),
  label: text("label").notNull(),
  /** Date-only: the first payment. */
  firstDueOn: date("first_due_on").notNull(),
  /** Day of the month each payment is due (clamped in short months). */
  dayOfMonth: smallint("day_of_month").notNull(),
  /** Monthly amount as written in the agreement, for the tracker. */
  amount: text("amount"),
  status: text("status", { enum: ["active", "ended"] })
    .notNull()
    .default("active"),
  createdBy: uuid("created_by"),
  ...timestamps,
});

/** Days the firm treats as holidays when a rule rolls a date forward. Entered by the owner attorney. */
export const deadlineHolidays = pgTable("deadline_holidays", {
  date: date("date").primaryKey(),
  label: text("label").notNull(),
  createdBy: uuid("created_by"),
  ...timestamps,
});

/**
 * C6: a private calendar feed per person. The token is shown once; only its
 * hash is stored. Feed events carry the matter number and deadline label,
 * never client names.
 */
export const calendarFeeds = pgTable("calendar_feeds", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  ...timestamps,
});

export type DeadlineRuleRow = typeof deadlineRules.$inferSelect;
export type MatterEventRow = typeof matterEvents.$inferSelect;
export type DeadlineRow = typeof deadlines.$inferSelect;
export type DeadlineAlertRow = typeof deadlineAlerts.$inferSelect;
export type PaymentPlanRow = typeof paymentPlans.$inferSelect;
export type DeadlineTollingRow = typeof deadlineTolling.$inferSelect;
