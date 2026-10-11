import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { PRACTICE_AREAS } from "./firm";
import { appointments, contacts, leads } from "./intake";
import { messages } from "./messaging";

/*
 * Phase 2: AI intake (spec Sections 6, 7 and 10). Every model call, every
 * draft that waits for a person, the intake record the assistant builds, and
 * the conflict pre-screen. Free text stored here has been through
 * lib/masking first (rule 6).
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const AI_RUN_STATUSES = [
  "succeeded",
  "refused",
  "invalid_output",
  "error",
  "not_configured",
] as const;
export type AiRunStatus = (typeof AI_RUN_STATUSES)[number];

/**
 * One row per LLM call (rule 3): prompt hash, model, tokens, cost, output and
 * reviewer. The prompt itself is not stored, only its hash; the output is
 * stored masked.
 */
export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purpose: text("purpose").notNull(),
    automationId: text("automation_id"),
    model: text("model").notNull(),
    /** The model that actually answered (differs after a refusal fallback). */
    servedModel: text("served_model"),
    promptHash: text("prompt_hash").notNull(),
    promptVersion: text("prompt_version").notNull(),
    status: text("status", { enum: AI_RUN_STATUSES }).notNull(),
    stopReason: text("stop_reason"),
    refusalCategory: text("refusal_category"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    latencyMs: integer("latency_ms"),
    /** Identifier kinds masked out of the prompt, with counts. Never values. */
    maskedCounts: jsonb("masked_counts"),
    output: jsonb("output"),
    error: text("error"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    reviewedBy: uuid("reviewed_by"),
    reviewOutcome: text("review_outcome"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("ai_runs_created_idx").on(t.createdAt),
    index("ai_runs_entity_idx").on(t.entityType, t.entityId),
  ],
);

export const APPROVAL_KINDS = ["message", "letter", "brief", "escalation", "referral"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];
export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "superseded"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/**
 * The approval queue (spec Section 6): substantive AI output waits here for a
 * person. Approving a message hands it to the outbox; rejecting needs a
 * reason, which feeds prompt evaluation.
 */
export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: text("automation_id").notNull(),
    kind: text("kind", { enum: APPROVAL_KINDS }).notNull(),
    status: text("status", { enum: APPROVAL_STATUSES }).notNull().default("pending"),
    priority: text("priority", { enum: ["urgent", "normal"] })
      .notNull()
      .default("normal"),
    /** What the reviewer is deciding, in a few words. */
    title: text("title").notNull(),
    channel: text("channel", { enum: ["sms", "email", "chat", "none"] }).notNull(),
    leadId: uuid("lead_id").references(() => leads.id),
    contactId: uuid("contact_id").references(() => contacts.id),
    appointmentId: uuid("appointment_id").references(() => appointments.id),
    subject: text("subject"),
    draftBody: text("draft_body").notNull(),
    finalBody: text("final_body"),
    finalSubject: text("final_subject"),
    edited: boolean("edited").notNull().default(false),
    /** The source data the draft used: pointers and masked excerpts. */
    sources: jsonb("sources"),
    /** Why this is queued: guard findings, escalation reasons. */
    flags: jsonb("flags"),
    aiRunId: uuid("ai_run_id").references(() => aiRuns.id),
    rejectReason: text("reject_reason"),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Outbox message created on approval. */
    messageId: uuid("message_id").references(() => messages.id),
    /** One draft per trigger: replays and re-runs find the existing item. */
    dedupeKey: text("dedupe_key").notNull().unique(),
    ...timestamps,
  },
  (t) => [
    index("approvals_pending_idx")
      .on(t.priority, t.createdAt)
      .where(sql`${t.status} = 'pending'`),
    index("approvals_lead_idx").on(t.leadId),
  ],
);

/**
 * The structured intake record A3 builds for a lead (answers masked), plus
 * A5's score and routing. One per lead.
 */
export const intakeRecords = pgTable("intake_records", {
  leadId: uuid("lead_id")
    .primaryKey()
    .references(() => leads.id),
  practiceArea: text("practice_area", { enum: PRACTICE_AREAS }),
  /** Practice-module answers keyed by question id. Masked. */
  answers: jsonb("answers")
    .notNull()
    .default(sql`'{}'::jsonb`),
  /** Required question ids still unanswered. */
  missing: text("missing")
    .array()
    .notNull()
    .default(sql`'{}'`),
  complete: boolean("complete").notNull().default(false),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  /** Outside the firm's practice areas (A12). */
  outOfScope: boolean("out_of_scope").notNull().default(false),
  outOfScopeTopic: text("out_of_scope_topic"),
  /** A5 */
  score: integer("score"),
  scoreBreakdown: jsonb("score_breakdown"),
  urgent: boolean("urgent").notNull().default(false),
  /** A3 conversation state */
  aiTurns: integer("ai_turns").notNull().default(0),
  disclosureSentAt: timestamp("disclosure_sent_at", { withTimezone: true }),
  handedOffAt: timestamp("handed_off_at", { withTimezone: true }),
  escalationReasons: text("escalation_reasons")
    .array()
    .notNull()
    .default(sql`'{}'`),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  ...timestamps,
});

export const CONFLICT_ROLES = ["client", "adverse", "related"] as const;
export type ConflictRole = (typeof CONFLICT_ROLES)[number];

/**
 * People and organizations the firm must check new matters against: current
 * and former clients, adverse parties and related parties. Firm-maintained
 * until matters exist (Phase 3), then also fed from matter parties.
 */
export const conflictParties = pgTable(
  "conflict_parties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["person", "organization"] }).notNull(),
    role: text("role", { enum: CONFLICT_ROLES }).notNull(),
    matterReference: text("matter_reference"),
    notes: text("notes"),
    source: text("source").notNull().default("manual"),
    createdBy: uuid("created_by"),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("conflict_parties_name_idx").on(sql`lower(${t.name})`)],
);

export const CONFLICT_CHECK_STATUSES = ["awaiting_review", "cleared", "conflict"] as const;

/** A6 run for a lead. Never auto-clears: every check waits for a person. */
export const conflictChecks = pgTable(
  "conflict_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    status: text("status", { enum: CONFLICT_CHECK_STATUSES }).notNull().default("awaiting_review"),
    names: text("names").array().notNull(),
    hitCount: integer("hit_count").notNull(),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    /** Same names checked again produce the same key. */
    dedupeKey: text("dedupe_key").notNull().unique(),
    ...timestamps,
  },
  (t) => [index("conflict_checks_lead_idx").on(t.leadId)],
);

export const conflictHits = pgTable(
  "conflict_hits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checkId: uuid("check_id")
      .notNull()
      .references(() => conflictChecks.id),
    queryName: text("query_name").notNull(),
    matchedType: text("matched_type", { enum: ["contact", "conflict_party"] }).notNull(),
    matchedId: uuid("matched_id").notNull(),
    matchedName: text("matched_name").notNull(),
    role: text("role").notNull(),
    similarity: real("similarity").notNull(),
    reason: text("reason").notNull(),
    ...timestamps,
  },
  (t) => [index("conflict_hits_check_idx").on(t.checkId)],
);

/** The firm's referral list (A12). */
export const referralPartners = pgTable("referral_partners", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  organization: text("organization"),
  /** Free-text areas they take, e.g. "family law", "criminal defense". */
  handles: text("handles")
    .array()
    .notNull()
    .default(sql`'{}'`),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  active: boolean("active").notNull().default(true),
  ...timestamps,
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/** Where an out-of-scope lead was referred (A12: "Track where it went"). */
export const referralsOut = pgTable(
  "referrals_out",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => referralPartners.id),
    approvalId: uuid("approval_id").references(() => approvals.id),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("referrals_out_lead_partner_idx").on(t.leadId, t.partnerId)],
);

export type AiRunRow = typeof aiRuns.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;
export type IntakeRecordRow = typeof intakeRecords.$inferSelect;
export type ConflictPartyRow = typeof conflictParties.$inferSelect;
export type ConflictCheckRow = typeof conflictChecks.$inferSelect;
export type ConflictHitRow = typeof conflictHits.$inferSelect;
export type ReferralPartnerRow = typeof referralPartners.$inferSelect;
