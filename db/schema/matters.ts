import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { DOC_TYPES } from "../../practice/matter-types";
import { aiRuns, approvals } from "./ai";
import { users } from "./auth";
import { PRACTICE_AREAS } from "./firm";
import { contacts, leads } from "./intake";

/*
 * Phase 3: matters and documents (spec Sections 7 and 10). Free text written
 * by people or models is masked before it is stored (rule 6). Document files
 * live in the firm's bucket; only their keys and hashes are stored here.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/** Matter numbers: YYYY-NNNN, the counter never resets so numbers stay unique. */
export const matterNumberSeq = pgSequence("matter_number_seq", { startWith: 1 });

export const MATTER_STATUSES = ["open", "closed"] as const;

export const matters = pgTable(
  "matters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: text("number").notNull().unique(),
    title: text("title").notNull(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    leadId: uuid("lead_id").references(() => leads.id),
    practiceArea: text("practice_area", { enum: PRACTICE_AREAS }).notNull(),
    /** Key of a matter type in the practice module (practice/<area>/matters.ts). */
    matterType: text("matter_type").notNull(),
    stage: text("stage").notNull(),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status", { enum: MATTER_STATUSES }).notNull().default("open"),
    responsibleAttorneyId: uuid("responsible_attorney_id").references(() => users.id),
    assignedUserIds: uuid("assigned_user_ids")
      .array()
      .notNull()
      .default(sql`'{}'`),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** Date-only, firm time zone (B10). */
    retentionUntil: date("retention_until"),
    /** Last message to or from the client, or portal activity (B6). */
    lastClientContactAt: timestamp("last_client_contact_at", { withTimezone: true }),
    /** Latest B7 summary, masked. */
    summary: text("summary"),
    /** B7 timeline: [{ date, event, source: { type, id } }], masked. */
    summaryTimeline: jsonb("summary_timeline"),
    summaryUpdatedAt: timestamp("summary_updated_at", { withTimezone: true }),
    source: text("source").notNull().default("lexdesk"),
    sourceId: text("source_id"),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("matters_status_idx").on(t.status, t.stage),
    index("matters_contact_idx").on(t.contactId),
    index("matters_attorney_idx").on(t.responsibleAttorneyId),
    // One matter per lead: retaining twice must not open two.
    uniqueIndex("matters_lead_idx")
      .on(t.leadId)
      .where(sql`${t.leadId} is not null`),
  ],
);

export const PARTY_ROLES = [
  "client",
  "spouse",
  "co_owner",
  "adverse",
  "related",
  "decedent",
  "executor",
  "beneficiary",
] as const;

/** People and businesses on a matter. Adverse and related parties feed A6. */
export const matterParties = pgTable(
  "matter_parties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["person", "organization"] }).notNull(),
    role: text("role", { enum: PARTY_ROLES }).notNull(),
    contactId: uuid("contact_id").references(() => contacts.id),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("matter_parties_matter_idx").on(t.matterId),
    index("matter_parties_name_idx").on(sql`lower(${t.name})`),
  ],
);

export const TASK_STATUSES = ["open", "done", "cancelled"] as const;

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matterId: uuid("matter_id").references(() => matters.id),
    leadId: uuid("lead_id").references(() => leads.id),
    title: text("title").notNull(),
    detail: text("detail"),
    /** Date-only, firm time zone. */
    dueOn: date("due_on"),
    /** The date came from a document, not the firm's calendar: show the deadline notice. */
    dueFromDocument: boolean("due_from_document").notNull().default(false),
    assigneeId: uuid("assignee_id").references(() => users.id),
    status: text("status", { enum: TASK_STATUSES }).notNull().default("open"),
    priority: text("priority", { enum: ["urgent", "normal"] })
      .notNull()
      .default("normal"),
    automationId: text("automation_id"),
    /** One task per trigger for automation-created tasks. */
    dedupeKey: text("dedupe_key").unique(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by"),
    createdBy: uuid("created_by"),
    ...timestamps,
  },
  (t) => [
    index("tasks_matter_idx").on(t.matterId),
    index("tasks_open_idx")
      .on(t.assigneeId, t.dueOn)
      .where(sql`${t.status} = 'open'`),
  ],
);

/** Staff notes on a matter. Masked before storage. */
export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id),
    authorId: uuid("author_id").references(() => users.id),
    body: text("body").notNull(),
    ...timestamps,
  },
  (t) => [index("notes_matter_idx").on(t.matterId, t.createdAt)],
);

export const DOCUMENT_STATUSES = ["stored", "processing", "processed", "failed"] as const;

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id),
    checklistItemId: uuid("checklist_item_id"),
    /** File name as uploaded, masked. */
    originalName: text("original_name").notNull(),
    /** Firm naming convention (B4). */
    displayName: text("display_name").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    sha256: text("sha256").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    docType: text("doc_type", { enum: DOC_TYPES }),
    docTypeConfidence: real("doc_type_confidence"),
    status: text("status", { enum: DOCUMENT_STATUSES }).notNull().default("stored"),
    pageCount: integer("page_count"),
    /** B4 quality flags, e.g. { illegiblePages: [3], incomplete: "page 2 of 4 missing" }. */
    flags: jsonb("flags"),
    ocrEngine: text("ocr_engine"),
    /** B8 output: a draft, never a final document. */
    isDraft: boolean("is_draft").notNull().default(false),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    uploadedVia: text("uploaded_via", { enum: ["staff", "portal", "system"] }).notNull(),
    /** Visible to the client in the portal. Client uploads always are. */
    sharedWithClient: boolean("shared_with_client").notNull().default(false),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("documents_matter_idx").on(t.matterId),
    index("documents_sha_idx").on(t.matterId, t.sha256),
  ],
);

/** Text read from a document (OCR or text layer), masked. Never logged (spec Section 2). */
export const documentTexts = pgTable("document_texts", {
  documentId: uuid("document_id")
    .primaryKey()
    .references(() => documents.id),
  maskedText: text("masked_text").notNull(),
  /** Identifier kinds masked, with counts. Never values. */
  maskedCounts: jsonb("masked_counts"),
  /** Mean OCR confidence 0-1, when the engine reports it. */
  confidence: real("confidence"),
  ...timestamps,
});

export const EXTRACTION_STATUSES = ["proposed", "confirmed", "corrected"] as const;

/** Structured fields read from a document (B3), masked, waiting for a person to confirm. */
export const documentExtractions = pgTable(
  "document_extractions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    kind: text("kind", { enum: ["tax_notice"] }).notNull(),
    fields: jsonb("fields").notNull(),
    /** Where each field came from: "parser", "model" or "both". */
    provenance: jsonb("provenance"),
    summary: text("summary"),
    aiRunId: uuid("ai_run_id").references(() => aiRuns.id),
    status: text("status", { enum: EXTRACTION_STATUSES }).notNull().default("proposed"),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("document_extractions_doc_idx").on(t.documentId, t.kind)],
);

export const CHECKLIST_STATUSES = ["requested", "received", "waived"] as const;

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id),
    key: text("key").notNull(),
    label: text("label").notNull(),
    hint: text("hint"),
    docType: text("doc_type", { enum: DOC_TYPES }).notNull(),
    required: boolean("required").notNull(),
    status: text("status", { enum: CHECKLIST_STATUSES }).notNull().default("requested"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    documentId: uuid("document_id"),
    /** B2: reminders sent (day 3, 7, 14) and the staff task after them. */
    remindersSent: integer("reminders_sent").notNull().default(0),
    lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("checklist_items_matter_key_idx").on(t.matterId, t.key)],
);

export const ENGAGEMENT_STATUSES = [
  "drafted",
  "approved",
  "sent",
  "signed",
  "declined",
  "withdrawn",
] as const;

/**
 * A9: one engagement letter per retained lead. The letter text waits in the
 * approval queue; signing goes through an e-sign adapter (`lib/esign`).
 */
export const engagements = pgTable(
  "engagements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    matterId: uuid("matter_id").references(() => matters.id),
    practiceArea: text("practice_area", { enum: PRACTICE_AREAS }).notNull(),
    matterType: text("matter_type").notNull(),
    feeTerms: text("fee_terms").notNull(),
    status: text("status", { enum: ENGAGEMENT_STATUSES }).notNull().default("drafted"),
    approvalId: uuid("approval_id").references(() => approvals.id),
    provider: text("provider").notNull(),
    signingUrl: text("signing_url"),
    envelopeId: text("envelope_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    remindersSent: integer("reminders_sent").notNull().default(0),
    createdBy: uuid("created_by"),
    ...timestamps,
  },
  (t) => [uniqueIndex("engagements_lead_idx").on(t.leadId)],
);

/** B9 questionnaires answered in the portal. Answers masked; ages, never dates of birth. */
export const questionnaires = pgTable(
  "questionnaires",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id),
    kind: text("kind", { enum: ["estate_planning"] }).notNull(),
    answers: jsonb("answers")
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text("status", { enum: ["in_progress", "submitted"] })
      .notNull()
      .default("in_progress"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("questionnaires_matter_kind_idx").on(t.matterId, t.kind)],
);

export type MatterRow = typeof matters.$inferSelect;
export type MatterPartyRow = typeof matterParties.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type DocumentExtractionRow = typeof documentExtractions.$inferSelect;
export type ChecklistItemRow = typeof checklistItems.$inferSelect;
export type EngagementRow = typeof engagements.$inferSelect;
export type QuestionnaireRow = typeof questionnaires.$inferSelect;
