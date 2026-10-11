import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { PRACTICE_AREAS } from "./firm";

/*
 * Intake records (spec Section 10). GHL contacts, opportunities and
 * appointments are mirrored here by webhook and nightly reconciliation
 * (spec Section 2, "GHL boundary"); LexDesk is the system of record for leads.
 *
 * Rule 6: GHL contacts can carry a date of birth and SSN. Those fields are
 * never copied into these tables.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/** Imported rows record where they came from (spec Section 10). */
const imported = {
  source: text("source").notNull().default("ghl"),
  sourceId: text("source_id").notNull(),
};

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...imported,
    firstName: text("first_name"),
    lastName: text("last_name"),
    fullName: text("full_name"),
    email: text("email"),
    /** E.164 where GHL supplied it. */
    phone: text("phone"),
    companyName: text("company_name"),
    timezone: text("timezone"),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** GHL do-not-disturb: all channels. */
    dnd: boolean("dnd").notNull().default(false),
    dndSms: boolean("dnd_sms").notNull().default(false),
    dndEmail: boolean("dnd_email").notNull().default(false),
    dndCall: boolean("dnd_call").notNull().default(false),
    /** GHL's free-text source label, e.g. a form name. */
    ghlSource: text("ghl_source"),
    ghlAssignedTo: text("ghl_assigned_to"),
    ghlDateAdded: timestamp("ghl_date_added", { withTimezone: true }),
    ghlDateUpdated: timestamp("ghl_date_updated", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("contacts_source_idx").on(t.source, t.sourceId),
    index("contacts_phone_idx").on(t.phone),
    index("contacts_email_idx").on(sql`lower(${t.email})`),
  ],
);

export const CONSENT_CHANNELS = ["sms", "email"] as const;
export const CONSENT_STATUSES = ["granted", "revoked"] as const;

/**
 * Messaging consent history (spec Section 4: "Explicit SMS opt-in captured
 * with timestamp and source"). Append-only; the latest row per contact and
 * channel is the current state.
 */
export const consents = pgTable(
  "consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    channel: text("channel", { enum: CONSENT_CHANNELS }).notNull(),
    status: text("status", { enum: CONSENT_STATUSES }).notNull(),
    /** Why: "form_opt_in", "dnd_on", "dnd_off". */
    basis: text("basis").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    /** Pointer to the evidence, e.g. the webhook event id. Never message text. */
    evidence: jsonb("evidence"),
    ...timestamps,
  },
  (t) => [index("consents_contact_idx").on(t.contactId, t.channel, t.capturedAt)],
);

export const OPPORTUNITY_STATUSES = ["open", "won", "lost", "abandoned"] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...imported,
    contactId: uuid("contact_id").references(() => contacts.id),
    name: text("name"),
    pipelineId: text("pipeline_id"),
    pipelineStageId: text("pipeline_stage_id"),
    status: text("status", { enum: OPPORTUNITY_STATUSES }).notNull(),
    monetaryValue: numeric("monetary_value", { precision: 12, scale: 2 }),
    ghlAssignedTo: text("ghl_assigned_to"),
    ghlSource: text("ghl_source"),
    ghlDateAdded: timestamp("ghl_date_added", { withTimezone: true }),
    ghlDateUpdated: timestamp("ghl_date_updated", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("opportunities_source_idx").on(t.source, t.sourceId),
    index("opportunities_contact_idx").on(t.contactId),
  ],
);

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "consult_booked",
  "consult_held",
  "retained",
  "lost",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
/** A contact has at most one lead in these statuses at a time. */
export const OPEN_LEAD_STATUSES = [
  "new",
  "contacted",
  "consult_booked",
  "consult_held",
] as const satisfies readonly LeadStatus[];

export const LEAD_CHANNELS = ["call", "form", "chat", "email", "sms", "other"] as const;
export type LeadChannel = (typeof LEAD_CHANNELS)[number];

/** LexDesk owns leads (spec Section 2). One row per enquiry, not per person. */
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    opportunityId: uuid("opportunity_id")
      .unique()
      .references(() => opportunities.id),
    status: text("status", { enum: LEAD_STATUSES }).notNull().default("new"),
    /** How the person first reached the firm for this enquiry. */
    channel: text("channel", { enum: LEAD_CHANNELS }).notNull(),
    practiceArea: text("practice_area", { enum: PRACTICE_AREAS }),
    /** Set when the first contact was a call nobody answered (A1). */
    missedCall: boolean("missed_call").notNull().default(false),
    firstInboundAt: timestamp("first_inbound_at", { withTimezone: true }).notNull(),
    /** First reply of any kind, including an automated acknowledgement. */
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    /** First reply by a person (call, SMS or email sent from GHL by staff). */
    firstHumanResponseAt: timestamp("first_human_response_at", { withTimezone: true }),
    consultBookedAt: timestamp("consult_booked_at", { withTimezone: true }),
    consultHeldAt: timestamp("consult_held_at", { withTimezone: true }),
    retainedAt: timestamp("retained_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** Attorney responsible for the enquiry (A5 routing). */
    assignedUserId: uuid("assigned_user_id"),
    /** An attorney marked the enquiry declined (A11). */
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Concurrent webhooks for the same person must not open two leads.
    uniqueIndex("leads_one_open_per_contact")
      .on(t.contactId)
      .where(
        sql`${t.status} in ('new', 'contacted', 'consult_booked', 'consult_held') and ${t.deletedAt} is null`,
      ),
    index("leads_first_inbound_idx").on(t.firstInboundAt),
    index("leads_status_idx").on(t.status),
  ],
);

/**
 * F1 source attribution: every marketing touch we learn about for a lead.
 * First and last touch are the earliest and latest rows (spec: "first and last
 * touch stored").
 */
export const leadTouches = pgTable(
  "lead_touches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    /** Where we learned of the touch: "ghl_first_attribution", "form", "call"... */
    origin: text("origin").notNull(),
    channel: text("channel", { enum: LEAD_CHANNELS }).notNull(),
    /** Normalized source label for reporting: "google_ads", "website", "referral"... */
    sourceLabel: text("source_label").notNull(),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmContent: text("utm_content"),
    utmTerm: text("utm_term"),
    referrer: text("referrer"),
    landingUrl: text("landing_url"),
    gclid: text("gclid"),
    fbclid: text("fbclid"),
    /** The firm number that was dialed (call tracking). */
    trackingNumber: text("tracking_number"),
    ghlSource: text("ghl_source"),
    /** Replays and reconciliation produce the same key, so a touch is stored once. */
    dedupeKey: text("dedupe_key").notNull().unique(),
    ...timestamps,
  },
  (t) => [index("lead_touches_lead_idx").on(t.leadId, t.occurredAt)],
);

export const CALL_OUTCOMES = ["answered", "voicemail", "missed"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...imported,
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    leadId: uuid("lead_id").references(() => leads.id),
    direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
    outcome: text("outcome", { enum: CALL_OUTCOMES }).notNull(),
    ghlStatus: text("ghl_status"),
    ghlCallStatus: text("ghl_call_status"),
    durationSeconds: integer("duration_seconds"),
    trackingNumber: text("tracking_number"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("calls_source_idx").on(t.source, t.sourceId),
    index("calls_contact_idx").on(t.contactId, t.occurredAt),
    index("calls_lead_idx").on(t.leadId),
  ],
);

export const APPOINTMENT_STATUSES = [
  "new",
  "confirmed",
  "cancelled",
  "showed",
  "noshow",
  "invalid",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...imported,
    contactId: uuid("contact_id").references(() => contacts.id),
    leadId: uuid("lead_id").references(() => leads.id),
    calendarId: text("calendar_id"),
    title: text("title"),
    status: text("status", { enum: APPOINTMENT_STATUSES }).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    ghlAssignedUserId: text("ghl_assigned_user_id"),
    ghlDateUpdated: timestamp("ghl_date_updated", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("appointments_source_idx").on(t.source, t.sourceId),
    index("appointments_lead_idx").on(t.leadId),
    index("appointments_starts_at_idx").on(t.startsAt),
  ],
);

export type ContactRow = typeof contacts.$inferSelect;
export type OpportunityRow = typeof opportunities.$inferSelect;
export type LeadRow = typeof leads.$inferSelect;
export type LeadTouchRow = typeof leadTouches.$inferSelect;
export type CallRow = typeof calls.$inferSelect;
export type AppointmentRow = typeof appointments.$inferSelect;
