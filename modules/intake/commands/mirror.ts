import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  appointments,
  calls,
  consents,
  contacts,
  leadTouches,
  leads,
  messages,
  opportunities,
  OPEN_LEAD_STATUSES,
  type ContactRow,
  type LeadChannel,
  type LeadRow,
  type LeadStatus,
  type OpportunityRow,
} from "@/db/schema";
import { mapPracticeArea } from "@/ghl/field-map";
import type { AuditSpec } from "@/lib/commands/define";
import type { CallFacts, FormFacts } from "@/lib/ghl/events";
import type { GhlAppointment, GhlContact, GhlOpportunity } from "@/lib/ghl/schemas";
import {
  sourceLabelFor,
  touchDedupeKey,
  touchFromGhlAttribution,
  type TouchInput,
} from "../attribution";

/*
 * Mirror of GHL contacts, opportunities and appointments, plus the lead
 * records LexDesk owns (spec Section 2). Called from audited commands only:
 * every function takes the command's transaction and returns the audit rows
 * and automation triggers its changes produce.
 *
 * Idempotency: every row is keyed by GHL's id (unique source/source_id), so
 * replaying an event, or reconciliation re-reading it, updates in place.
 * Concurrency: callers take lockContact() first, so events for one person
 * apply one at a time; unique indexes are the backstop.
 *
 * Audit rows name the fields that changed but never carry a client's name,
 * email or phone: the audit log is immutable (rule 2, rule 6).
 */

export type Trigger =
  | { automation: "A1"; callId: string; leadId: string; contactId: string }
  | { automation: "A2"; leadId: string; contactId: string }
  | { automation: "A7"; appointmentId: string }
  /** Runs after commit: it calls a model (jobs/automations/A3.ts). */
  | { automation: "A3"; leadId: string; messageId: string };

export type MirrorContext = {
  tx: Tx;
  /** Firm website host, so self-referrals count as direct traffic. */
  firmHost: string | null;
  /** F1 on: record attribution touches. */
  attribution: boolean;
  /** The webhook event or reconciliation run that caused the change. */
  cause: Record<string, string>;
};

export type MirrorResult = { audit: AuditSpec[]; triggers: Trigger[] };

const empty = (): MirrorResult => ({ audit: [], triggers: [] });

function merge(into: MirrorResult, from: MirrorResult): MirrorResult {
  into.audit.push(...from.audit);
  into.triggers.push(...from.triggers);
  return into;
}

/** Serializes all work for one GHL contact within this transaction. */
export async function lockContact(tx: Tx, ghlContactId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ghl-contact:${ghlContactId}`}))`);
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

type ContactValues = Omit<
  typeof contacts.$inferInsert,
  "id" | "createdAt" | "source" | "sourceId" | "lastSyncedAt"
>;

function contactValues(c: Partial<GhlContact>): ContactValues {
  const values: ContactValues = {};
  if (c.firstName !== undefined) values.firstName = c.firstName;
  if (c.lastName !== undefined) values.lastName = c.lastName;
  const full =
    c.name ?? c.contactName ?? ([c.firstName, c.lastName].filter(Boolean).join(" ") || null);
  if (full !== null || c.name !== undefined) values.fullName = full;
  if (c.email !== undefined) values.email = c.email?.toLowerCase() ?? null;
  if (c.phone !== undefined) values.phone = c.phone;
  if (c.companyName !== undefined) values.companyName = c.companyName;
  if (c.timezone !== undefined) values.timezone = c.timezone;
  if (c.tags !== undefined) values.tags = c.tags;
  if (c.source !== undefined) values.ghlSource = c.source;
  if (c.assignedTo !== undefined) values.ghlAssignedTo = c.assignedTo;
  if (c.dateAdded !== undefined) values.ghlDateAdded = c.dateAdded;
  if (c.dateUpdated !== undefined) values.ghlDateUpdated = c.dateUpdated;
  if (c.dnd !== undefined && c.dnd !== null) values.dnd = c.dnd;
  if (c.dndSettings) {
    const on = (s: { status: string | null } | null | undefined) => s?.status === "active";
    if (c.dndSettings.SMS !== undefined) values.dndSms = on(c.dndSettings.SMS);
    if (c.dndSettings.Email !== undefined) values.dndEmail = on(c.dndSettings.Email);
    if (c.dndSettings.Call !== undefined) values.dndCall = on(c.dndSettings.Call);
  }
  return values;
}

const PII_FIELDS = new Set(["firstName", "lastName", "fullName", "email", "phone", "companyName"]);

function changedFields(before: ContactRow, values: ContactValues): string[] {
  return (Object.keys(values) as (keyof ContactValues)[]).filter((k) => {
    const a = before[k as keyof ContactRow];
    const b = values[k];
    if (a instanceof Date || b instanceof Date) {
      return (a as Date | null)?.getTime() !== (b as Date | null | undefined)?.getTime();
    }
    return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
  });
}

function contactAuditView(row: ContactRow, changed: string[]) {
  return {
    ghlContactId: row.sourceId,
    dnd: row.dnd,
    dndSms: row.dndSms,
    dndEmail: row.dndEmail,
    changedFields: changed.map((f) => (PII_FIELDS.has(f) ? `${f} (value not logged)` : f)),
  };
}

/**
 * Creates or updates the mirrored contact. Partial input (a workflow event's
 * name and phone) only fills what it has. An update older than the stored
 * GHL `dateUpdated` is ignored, so out-of-order deliveries cannot regress data.
 */
export async function upsertContact(
  ctx: MirrorContext,
  c: Partial<GhlContact> & { id: string },
): Promise<{ row: ContactRow; created: boolean; result: MirrorResult }> {
  const { tx } = ctx;
  const values = contactValues(c);
  const [existing] = await tx
    .select()
    .from(contacts)
    .where(and(eq(contacts.source, "ghl"), eq(contacts.sourceId, c.id)))
    .for("update");

  if (!existing) {
    const [row] = await tx
      .insert(contacts)
      .values({ ...values, source: "ghl", sourceId: c.id })
      .returning();
    if (!row) throw new Error("contact insert returned no row");
    return {
      row,
      created: true,
      result: {
        audit: [
          {
            action: "intake.contact_mirrored",
            entityType: "contact",
            entityId: row.id,
            after: contactAuditView(row, Object.keys(values)),
            metadata: ctx.cause,
          },
        ],
        triggers: [],
      },
    };
  }

  if (
    existing.ghlDateUpdated &&
    values.ghlDateUpdated &&
    values.ghlDateUpdated.getTime() < existing.ghlDateUpdated.getTime()
  ) {
    return { row: existing, created: false, result: empty() };
  }

  const changed = changedFields(existing, values);
  const revived = existing.deletedAt !== null;
  if (changed.length === 0 && !revived) {
    await tx.update(contacts).set({ lastSyncedAt: new Date() }).where(eq(contacts.id, existing.id));
    return { row: existing, created: false, result: empty() };
  }

  const [row] = await tx
    .update(contacts)
    .set({ ...values, deletedAt: null, lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(eq(contacts.id, existing.id))
    .returning();
  if (!row) throw new Error("contact update returned no row");

  const result: MirrorResult = {
    audit: [
      {
        action: "intake.contact_updated",
        entityType: "contact",
        entityId: row.id,
        before: contactAuditView(existing, []),
        after: contactAuditView(row, changed),
        metadata: ctx.cause,
      },
    ],
    triggers: [],
  };

  // Do-not-disturb switched on for texts: record the revocation (spec Section 4).
  const smsOff = (r: ContactRow) => r.dnd || r.dndSms;
  const emailOff = (r: ContactRow) => r.dnd || r.dndEmail;
  for (const [channel, was, now] of [
    ["sms", smsOff(existing), smsOff(row)],
    ["email", emailOff(existing), emailOff(row)],
  ] as const) {
    if (!was && now) {
      await tx.insert(consents).values({
        contactId: row.id,
        channel,
        status: "revoked",
        basis: "dnd_on",
        capturedAt: c.dateUpdated ?? new Date(),
        evidence: ctx.cause,
      });
      result.audit.push({
        action: "intake.consent_revoked",
        entityType: "contact",
        entityId: row.id,
        after: { channel, basis: "dnd_on" },
        metadata: ctx.cause,
      });
    }
  }
  return { row, created: false, result };
}

/** The mirrored contact for a GHL id, created from whatever the event carried if it is new. */
export async function ensureContact(
  ctx: MirrorContext,
  ghlContactId: string,
  hint: Partial<GhlContact> = {},
): Promise<{ row: ContactRow; result: MirrorResult }> {
  const [existing] = await ctx.tx
    .select()
    .from(contacts)
    .where(and(eq(contacts.source, "ghl"), eq(contacts.sourceId, ghlContactId)));
  if (existing) {
    // Fill gaps only; webhook hints never overwrite mirrored data.
    const fill: Partial<GhlContact> & { id: string } = { id: ghlContactId };
    let gaps = false;
    for (const k of ["firstName", "lastName", "email", "phone"] as const) {
      if (!existing[k] && hint[k]) {
        fill[k] = hint[k];
        gaps = true;
      }
    }
    if (!gaps) return { row: existing, result: empty() };
    const { row, result } = await upsertContact(ctx, fill);
    return { row, result };
  }
  const { row, result } = await upsertContact(ctx, { ...hint, id: ghlContactId });
  return { row, result };
}

export async function deleteContact(
  ctx: MirrorContext,
  ghlContactId: string,
): Promise<MirrorResult> {
  const [row] = await ctx.tx
    .update(contacts)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(contacts.source, "ghl"),
        eq(contacts.sourceId, ghlContactId),
        isNull(contacts.deletedAt),
      ),
    )
    .returning({ id: contacts.id });
  if (!row) return empty();
  return {
    audit: [
      {
        action: "intake.contact_deleted_in_ghl",
        entityType: "contact",
        entityId: row.id,
        metadata: { ...ctx.cause, ghlContactId },
      },
    ],
    triggers: [],
  };
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

const STATUS_ORDER: Record<LeadStatus, number> = {
  new: 0,
  contacted: 1,
  consult_booked: 2,
  consult_held: 3,
  retained: 4,
  lost: 4,
};

/** Moves a lead forward through the funnel; never backwards, never out of a closed state. */
export function advancedStatus(current: LeadStatus, target: LeadStatus): LeadStatus {
  if (current === "retained" || current === "lost") return current;
  return STATUS_ORDER[target] > STATUS_ORDER[current] ? target : current;
}

export async function findOpenLead(tx: Tx, contactId: string): Promise<LeadRow | undefined> {
  const [lead] = await tx
    .select()
    .from(leads)
    .where(
      and(
        eq(leads.contactId, contactId),
        inArray(leads.status, [...OPEN_LEAD_STATUSES]),
        isNull(leads.deletedAt),
      ),
    )
    .for("update");
  return lead;
}

function leadAuditView(l: LeadRow) {
  return {
    status: l.status,
    channel: l.channel,
    practiceArea: l.practiceArea,
    missedCall: l.missedCall,
    opportunityId: l.opportunityId,
    firstInboundAt: l.firstInboundAt,
    firstResponseAt: l.firstResponseAt,
    consultBookedAt: l.consultBookedAt,
    retainedAt: l.retainedAt,
    closedAt: l.closedAt,
  };
}

/** The contact's open lead, or a new one for this enquiry. */
export async function openOrCreateLead(
  ctx: MirrorContext,
  contact: ContactRow,
  init: {
    channel: LeadChannel;
    at: Date;
    missedCall?: boolean;
    practiceArea?: LeadRow["practiceArea"];
    opportunityId?: string | null;
  },
): Promise<{ lead: LeadRow; created: boolean; result: MirrorResult }> {
  const open = await findOpenLead(ctx.tx, contact.id);
  if (open) return { lead: open, created: false, result: empty() };

  const [lead] = await ctx.tx
    .insert(leads)
    .values({
      contactId: contact.id,
      channel: init.channel,
      firstInboundAt: init.at,
      missedCall: init.missedCall ?? false,
      practiceArea: init.practiceArea ?? null,
      opportunityId: init.opportunityId ?? null,
    })
    .returning();
  if (!lead) throw new Error("lead insert returned no row");
  return {
    lead,
    created: true,
    result: {
      audit: [
        {
          action: "intake.lead_created",
          entityType: "lead",
          entityId: lead.id,
          after: leadAuditView(lead),
          metadata: { ...ctx.cause, contactId: contact.id },
        },
      ],
      triggers: [],
    },
  };
}

type LeadPatch = Partial<
  Pick<
    LeadRow,
    | "status"
    | "practiceArea"
    | "opportunityId"
    | "firstResponseAt"
    | "firstHumanResponseAt"
    | "consultBookedAt"
    | "consultHeldAt"
    | "retainedAt"
    | "closedAt"
  >
>;

export async function patchLead(
  ctx: MirrorContext,
  lead: LeadRow,
  patch: LeadPatch,
  action = "intake.lead_updated",
): Promise<{ lead: LeadRow; result: MirrorResult }> {
  const changed = (Object.keys(patch) as (keyof LeadPatch)[]).filter((k) => {
    const a = lead[k];
    const b = patch[k];
    if (a instanceof Date || b instanceof Date) {
      return (a as Date | null)?.getTime() !== (b as Date | null | undefined)?.getTime();
    }
    return a !== b;
  });
  if (changed.length === 0) return { lead, result: empty() };
  const [after] = await ctx.tx
    .update(leads)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(leads.id, lead.id))
    .returning();
  if (!after) throw new Error("lead update returned no row");
  return {
    lead: after,
    result: {
      audit: [
        {
          action,
          entityType: "lead",
          entityId: lead.id,
          before: leadAuditView(lead),
          after: leadAuditView(after),
          metadata: ctx.cause,
        },
      ],
      triggers: [],
    },
  };
}

/** Records the first reply to a lead (automated acknowledgement or a person). */
export async function noteResponse(
  ctx: MirrorContext,
  lead: LeadRow,
  at: Date,
  byPerson: boolean,
): Promise<{ lead: LeadRow; result: MirrorResult }> {
  if (at.getTime() < lead.firstInboundAt.getTime()) return { lead, result: empty() };
  const patch: LeadPatch = {};
  if (!lead.firstResponseAt || at < lead.firstResponseAt) patch.firstResponseAt = at;
  if (byPerson && (!lead.firstHumanResponseAt || at < lead.firstHumanResponseAt)) {
    patch.firstHumanResponseAt = at;
  }
  const status = advancedStatus(lead.status, "contacted");
  if (status !== lead.status) patch.status = status;
  return patchLead(ctx, lead, patch, "intake.lead_responded");
}

// ---------------------------------------------------------------------------
// F1 attribution touches
// ---------------------------------------------------------------------------

export async function recordTouches(
  ctx: MirrorContext,
  lead: LeadRow,
  touches: TouchInput[],
): Promise<MirrorResult> {
  if (!ctx.attribution || touches.length === 0) return empty();
  const rows = touches.map((t) => ({
    leadId: lead.id,
    occurredAt: t.occurredAt,
    origin: t.origin,
    channel: t.channel,
    sourceLabel: sourceLabelFor(t, ctx.firmHost),
    utmSource: t.utmSource ?? null,
    utmMedium: t.utmMedium ?? null,
    utmCampaign: t.utmCampaign ?? null,
    utmContent: t.utmContent ?? null,
    utmTerm: t.utmTerm ?? null,
    referrer: t.referrer ?? null,
    landingUrl: t.landingUrl ?? null,
    gclid: t.gclid ?? null,
    fbclid: t.fbclid ?? null,
    trackingNumber: t.trackingNumber ?? null,
    ghlSource: t.ghlSource ?? null,
    dedupeKey: touchDedupeKey(lead.id, t),
  }));
  const inserted = await ctx.tx
    .insert(leadTouches)
    .values(rows)
    .onConflictDoNothing({ target: leadTouches.dedupeKey })
    .returning({
      id: leadTouches.id,
      sourceLabel: leadTouches.sourceLabel,
      origin: leadTouches.origin,
    });
  if (inserted.length === 0) return empty();
  return {
    audit: [
      {
        action: "intake.attribution_recorded",
        entityType: "lead",
        entityId: lead.id,
        after: { touches: inserted.map((t) => ({ origin: t.origin, source: t.sourceLabel })) },
        metadata: ctx.cause,
      },
    ],
    triggers: [],
  };
}

/** GHL's own first and last attribution for the contact, when the API returned it. */
function attributionTouches(c: GhlContact | null, lead: LeadRow): TouchInput[] {
  if (!c) return [];
  const out: TouchInput[] = [];
  if (c.attributionSource) {
    out.push(
      touchFromGhlAttribution(
        c.attributionSource,
        c.dateAdded ?? lead.firstInboundAt,
        "ghl_first_attribution",
        lead.channel,
      ),
    );
  }
  if (c.lastAttributionSource) {
    out.push(
      touchFromGhlAttribution(
        c.lastAttributionSource,
        lead.firstInboundAt,
        "ghl_last_attribution",
        lead.channel,
      ),
    );
  }
  for (const t of out) t.ghlSource = c.source;
  return out;
}

// ---------------------------------------------------------------------------
// Calls (A1 trigger)
// ---------------------------------------------------------------------------

/**
 * Records a call once (keyed by GHL's message id). An inbound call opens a
 * lead if the caller has none; an unanswered one triggers A1.
 */
export async function recordCall(
  ctx: MirrorContext,
  call: CallFacts,
  enrichment: { contact: GhlContact | null; hint?: Partial<GhlContact> },
): Promise<MirrorResult> {
  const result = empty();
  const ensured = enrichment.contact
    ? await upsertContact(ctx, enrichment.contact)
    : await ensureContact(ctx, call.contactId, enrichment.hint);
  merge(result, ensured.result);
  const contact = ensured.row;

  const [inserted] = await ctx.tx
    .insert(calls)
    .values({
      source: "ghl",
      sourceId: call.sourceId,
      contactId: contact.id,
      direction: call.direction,
      outcome: call.outcome,
      ghlStatus: call.ghlStatus,
      ghlCallStatus: call.ghlCallStatus,
      durationSeconds: call.durationSeconds,
      trackingNumber: call.trackingNumber,
      occurredAt: call.occurredAt,
    })
    .onConflictDoNothing({ target: [calls.source, calls.sourceId] })
    .returning();
  // A replay of a call already recorded changes nothing and triggers nothing.
  if (!inserted) return result;

  let lead: LeadRow | undefined;
  if (call.direction === "inbound") {
    const opened = await openOrCreateLead(ctx, contact, {
      channel: "call",
      at: call.occurredAt,
      missedCall: call.outcome !== "answered",
    });
    merge(result, opened.result);
    lead = opened.lead;
    if (opened.created) {
      merge(
        result,
        await recordTouches(ctx, lead, [
          {
            occurredAt: call.occurredAt,
            origin: "call",
            channel: "call",
            trackingNumber: call.trackingNumber,
            ghlSource: contact.ghlSource,
          },
          ...attributionTouches(enrichment.contact, lead),
        ]),
      );
    }
    if (call.outcome === "answered") {
      // Somebody picked up: that is the firm's first response.
      merge(result, (await noteResponse(ctx, lead, call.occurredAt, true)).result);
    }
  } else {
    lead = await findOpenLead(ctx.tx, contact.id);
    if (lead && call.outcome === "answered") {
      merge(result, (await noteResponse(ctx, lead, call.occurredAt, true)).result);
    }
  }

  if (lead) {
    await ctx.tx.update(calls).set({ leadId: lead.id }).where(eq(calls.id, inserted.id));
  }
  result.audit.push({
    action: "intake.call_recorded",
    entityType: "call",
    entityId: inserted.id,
    after: {
      direction: inserted.direction,
      outcome: inserted.outcome,
      durationSeconds: inserted.durationSeconds,
      leadId: lead?.id ?? null,
    },
    metadata: ctx.cause,
  });
  if (call.direction === "inbound" && call.outcome !== "answered" && lead) {
    result.triggers.push({
      automation: "A1",
      callId: inserted.id,
      leadId: lead.id,
      contactId: contact.id,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Messages seen in GHL (inbound replies, staff replies)
// ---------------------------------------------------------------------------

export async function recordMessage(
  ctx: MirrorContext,
  m: {
    direction: "inbound" | "outbound";
    channel: "sms" | "email" | "chat" | "other";
    contactId: string;
    messageId: string | null;
    userId: string | null;
    occurredAt: Date;
    body?: string | null;
  },
  enrichment: { contact: GhlContact | null },
): Promise<MirrorResult> {
  const result = empty();
  // An outbound message LexDesk itself sent comes back as an OutboundMessage event.
  if (m.messageId) {
    const [ours] = await ctx.tx
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.ghlMessageId, m.messageId));
    if (ours) return result;
  }

  const ensured = enrichment.contact
    ? await upsertContact(ctx, enrichment.contact)
    : await ensureContact(ctx, m.contactId);
  merge(result, ensured.result);
  const contact = ensured.row;

  let lead: LeadRow | undefined;
  let createdLead = false;
  if (m.direction === "inbound") {
    const channel: LeadChannel =
      m.channel === "chat"
        ? "chat"
        : m.channel === "email"
          ? "email"
          : m.channel === "sms"
            ? "sms"
            : "other";
    const opened = await openOrCreateLead(ctx, contact, { channel, at: m.occurredAt });
    merge(result, opened.result);
    lead = opened.lead;
    createdLead = opened.created;
    if (createdLead) {
      merge(
        result,
        await recordTouches(ctx, lead, [
          { occurredAt: m.occurredAt, origin: "message", channel, ghlSource: contact.ghlSource },
          ...attributionTouches(enrichment.contact, lead),
        ]),
      );
    }
  } else {
    lead = await findOpenLead(ctx.tx, contact.id);
    if (lead) {
      // userId is set when a person sent it from GHL; otherwise it was a GHL workflow.
      merge(result, (await noteResponse(ctx, lead, m.occurredAt, m.userId !== null)).result);
    }
  }

  const [row] = await ctx.tx
    .insert(messages)
    .values({
      contactId: contact.id,
      leadId: lead?.id ?? null,
      direction: m.direction,
      channel: m.channel,
      status: m.direction === "inbound" ? "received" : "observed",
      occurredAt: m.occurredAt,
      // Masked at ingestion (lib/ghl/events.ts).
      body: m.body ?? null,
      ghlMessageId: m.messageId,
      context: m.userId ? { ghlUserId: m.userId } : null,
    })
    .onConflictDoNothing({ target: messages.ghlMessageId })
    .returning({ id: messages.id });
  if (row) {
    result.audit.push({
      action: m.direction === "inbound" ? "intake.message_received" : "intake.message_observed",
      entityType: "message",
      entityId: row.id,
      after: { channel: m.channel, leadId: lead?.id ?? null, byStaff: m.userId !== null },
      metadata: ctx.cause,
    });
  }
  // Chat and email enquiries get A2.
  if (createdLead && lead && (lead.channel === "chat" || lead.channel === "email")) {
    result.triggers.push({ automation: "A2", leadId: lead.id, contactId: contact.id });
  }
  // Inbound texts and chats from an open lead go to the intake assistant (A3).
  if (
    row &&
    lead &&
    m.direction === "inbound" &&
    (m.channel === "sms" || m.channel === "chat") &&
    m.body
  ) {
    result.triggers.push({ automation: "A3", leadId: lead.id, messageId: row.id });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Web forms (A2 trigger, consent, F1)
// ---------------------------------------------------------------------------

export async function recordForm(
  ctx: MirrorContext,
  form: FormFacts,
  enrichment: { contact: GhlContact | null },
): Promise<MirrorResult> {
  const result = empty();
  const at = form.occurredAt ?? new Date();
  const ensured = enrichment.contact
    ? await upsertContact(ctx, enrichment.contact)
    : await ensureContact(ctx, form.contactId, {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone,
      });
  merge(result, ensured.result);
  const contact = ensured.row;

  const practiceArea = mapPracticeArea(form.practiceArea);
  const opened = await openOrCreateLead(ctx, contact, { channel: "form", at, practiceArea });
  merge(result, opened.result);
  let lead = opened.lead;
  if (!opened.created && practiceArea && !lead.practiceArea) {
    const patched = await patchLead(ctx, lead, { practiceArea });
    lead = patched.lead;
    merge(result, patched.result);
  }

  merge(
    result,
    await recordTouches(ctx, lead, [
      {
        occurredAt: at,
        origin: "form",
        channel: "form",
        utmSource: form.utmSource,
        utmMedium: form.utmMedium,
        utmCampaign: form.utmCampaign,
        utmContent: form.utmContent,
        utmTerm: form.utmTerm,
        referrer: form.referrer,
        landingUrl: form.pageUrl,
        gclid: form.gclid,
        fbclid: form.fbclid,
        ghlSource: form.formName,
      },
      ...(opened.created ? attributionTouches(enrichment.contact, lead) : []),
    ]),
  );

  if (form.smsOptIn) {
    const evidence = {
      ...ctx.cause,
      ...(form.submissionId ? { submissionId: form.submissionId } : {}),
    };
    const [already] = await ctx.tx
      .select({ id: consents.id })
      .from(consents)
      .where(
        and(
          eq(consents.contactId, contact.id),
          eq(consents.channel, "sms"),
          eq(consents.basis, "form_opt_in"),
          eq(consents.capturedAt, at),
        ),
      );
    if (!already) {
      await ctx.tx.insert(consents).values({
        contactId: contact.id,
        channel: "sms",
        status: "granted",
        basis: "form_opt_in",
        capturedAt: at,
        evidence,
      });
      result.audit.push({
        action: "intake.consent_granted",
        entityType: "contact",
        entityId: contact.id,
        after: { channel: "sms", basis: "form_opt_in", capturedAt: at.toISOString() },
        metadata: ctx.cause,
      });
    }
  }

  if (opened.created) {
    result.triggers.push({ automation: "A2", leadId: lead.id, contactId: contact.id });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Opportunities (GHL pipeline) and lead outcomes
// ---------------------------------------------------------------------------

export async function upsertOpportunity(
  ctx: MirrorContext,
  o: GhlOpportunity,
): Promise<MirrorResult> {
  const result = empty();
  let contact: ContactRow | null = null;
  if (o.contactId) {
    const ensured = await ensureContact(ctx, o.contactId, {
      name: o.contact?.name ?? null,
      email: o.contact?.email ?? null,
      phone: o.contact?.phone ?? null,
      companyName: o.contact?.companyName ?? null,
    });
    merge(result, ensured.result);
    contact = ensured.row;
  }

  const updatedAt = o.updatedAt ?? null;
  const values = {
    contactId: contact?.id ?? null,
    name: o.name,
    pipelineId: o.pipelineId,
    pipelineStageId: o.pipelineStageId,
    status: o.status,
    monetaryValue:
      o.monetaryValue === null || o.monetaryValue === undefined ? null : o.monetaryValue.toFixed(2),
    ghlAssignedTo: o.assignedTo,
    ghlSource: o.source,
    ghlDateAdded: o.dateAdded ?? o.createdAt,
    ghlDateUpdated: updatedAt,
  };

  const [existing] = await ctx.tx
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.source, "ghl"), eq(opportunities.sourceId, o.id)))
    .for("update");

  let row: OpportunityRow;
  if (!existing) {
    const [created] = await ctx.tx
      .insert(opportunities)
      .values({ ...values, source: "ghl", sourceId: o.id })
      .returning();
    if (!created) throw new Error("opportunity insert returned no row");
    row = created;
    result.audit.push({
      action: "intake.opportunity_mirrored",
      entityType: "opportunity",
      entityId: row.id,
      after: { ghlOpportunityId: o.id, status: row.status, stageId: row.pipelineStageId },
      metadata: ctx.cause,
    });
  } else {
    if (existing.ghlDateUpdated && updatedAt && updatedAt < existing.ghlDateUpdated) return result;
    const statusChanged = existing.status !== values.status;
    const stageChanged = existing.pipelineStageId !== values.pipelineStageId;
    const valueChanged = existing.monetaryValue !== values.monetaryValue;
    const [updated] = await ctx.tx
      .update(opportunities)
      .set({ ...values, deletedAt: null, lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(opportunities.id, existing.id))
      .returning();
    if (!updated) throw new Error("opportunity update returned no row");
    row = updated;
    if (statusChanged || stageChanged || valueChanged || existing.deletedAt) {
      result.audit.push({
        action: "intake.opportunity_updated",
        entityType: "opportunity",
        entityId: row.id,
        before: {
          status: existing.status,
          stageId: existing.pipelineStageId,
          value: existing.monetaryValue,
        },
        after: { status: row.status, stageId: row.pipelineStageId, value: row.monetaryValue },
        metadata: ctx.cause,
      });
    }
  }

  if (!contact) return result;

  // Link the opportunity to the enquiry it belongs to.
  let [lead] = await ctx.tx
    .select()
    .from(leads)
    .where(and(eq(leads.opportunityId, row.id), isNull(leads.deletedAt)))
    .for("update");
  if (!lead) {
    const open = await findOpenLead(ctx.tx, contact.id);
    if (open && !open.opportunityId) {
      const linked = await patchLead(ctx, open, { opportunityId: row.id });
      lead = linked.lead;
      merge(result, linked.result);
    } else if (!open && row.status === "open") {
      const opened = await openOrCreateLead(ctx, contact, {
        channel: "other",
        at: row.ghlDateAdded ?? new Date(),
        opportunityId: row.id,
      });
      lead = opened.lead;
      merge(result, opened.result);
    }
  }
  if (!lead) return result;

  // Retained and lost come from the opportunity's outcome until matters exist (Phase 3).
  if (row.status === "won" && lead.status !== "retained") {
    const at = row.ghlDateUpdated ?? new Date();
    merge(
      result,
      (
        await patchLead(
          ctx,
          lead,
          { status: "retained", retainedAt: at, closedAt: at },
          "intake.lead_retained",
        )
      ).result,
    );
  } else if (
    (row.status === "lost" || row.status === "abandoned") &&
    lead.status !== "lost" &&
    lead.status !== "retained"
  ) {
    merge(
      result,
      (
        await patchLead(
          ctx,
          lead,
          { status: "lost", closedAt: row.ghlDateUpdated ?? new Date() },
          "intake.lead_lost",
        )
      ).result,
    );
  }
  return result;
}

export async function deleteOpportunity(
  ctx: MirrorContext,
  ghlOpportunityId: string,
): Promise<MirrorResult> {
  const [row] = await ctx.tx
    .update(opportunities)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(opportunities.source, "ghl"),
        eq(opportunities.sourceId, ghlOpportunityId),
        isNull(opportunities.deletedAt),
      ),
    )
    .returning({ id: opportunities.id });
  if (!row) return empty();
  return {
    audit: [
      {
        action: "intake.opportunity_deleted_in_ghl",
        entityType: "opportunity",
        entityId: row.id,
        metadata: { ...ctx.cause, ghlOpportunityId },
      },
    ],
    triggers: [],
  };
}

// ---------------------------------------------------------------------------
// Appointments (A7 trigger)
// ---------------------------------------------------------------------------

export async function upsertAppointment(
  ctx: MirrorContext,
  a: GhlAppointment,
): Promise<MirrorResult> {
  const result = empty();
  if (!a.startTime) return result;
  let contact: ContactRow | null = null;
  if (a.contactId) {
    const ensured = await ensureContact(ctx, a.contactId);
    merge(result, ensured.result);
    contact = ensured.row;
  }

  const [existing] = await ctx.tx
    .select()
    .from(appointments)
    .where(and(eq(appointments.source, "ghl"), eq(appointments.sourceId, a.id)))
    .for("update");
  if (existing?.ghlDateUpdated && a.dateUpdated && a.dateUpdated < existing.ghlDateUpdated) {
    return result;
  }

  // Attach to the open enquiry, or to the latest lead (a no-show can follow a closed lead).
  let lead: LeadRow | undefined;
  if (contact) {
    lead = await findOpenLead(ctx.tx, contact.id);
    if (!lead && existing?.leadId) {
      [lead] = await ctx.tx.select().from(leads).where(eq(leads.id, existing.leadId)).for("update");
    }
    if (!lead && a.appointmentStatus !== "cancelled" && a.appointmentStatus !== "invalid") {
      [lead] = await ctx.tx
        .select()
        .from(leads)
        .where(and(eq(leads.contactId, contact.id), isNull(leads.deletedAt)))
        .orderBy(desc(leads.firstInboundAt))
        .limit(1)
        .for("update");
    }
  }

  const values = {
    contactId: contact?.id ?? null,
    leadId: lead?.id ?? existing?.leadId ?? null,
    calendarId: a.calendarId,
    title: a.title,
    status: a.appointmentStatus,
    startsAt: a.startTime,
    endsAt: a.endTime,
    ghlAssignedUserId: a.assignedUserId,
    ghlDateUpdated: a.dateUpdated,
  };

  let id: string;
  let relevantChange: boolean;
  if (!existing) {
    const [row] = await ctx.tx
      .insert(appointments)
      .values({ ...values, source: "ghl", sourceId: a.id })
      .returning();
    if (!row) throw new Error("appointment insert returned no row");
    id = row.id;
    relevantChange = true;
    result.audit.push({
      action: "intake.appointment_mirrored",
      entityType: "appointment",
      entityId: id,
      after: { status: row.status, startsAt: row.startsAt, leadId: row.leadId },
      metadata: ctx.cause,
    });
  } else {
    id = existing.id;
    relevantChange =
      existing.status !== values.status ||
      existing.startsAt.getTime() !== values.startsAt.getTime() ||
      existing.deletedAt !== null ||
      existing.leadId !== values.leadId;
    await ctx.tx
      .update(appointments)
      .set({ ...values, deletedAt: null, lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(appointments.id, id));
    if (relevantChange) {
      result.audit.push({
        action: "intake.appointment_updated",
        entityType: "appointment",
        entityId: id,
        before: { status: existing.status, startsAt: existing.startsAt },
        after: { status: values.status, startsAt: values.startsAt, leadId: values.leadId },
        metadata: ctx.cause,
      });
    }
  }

  if (lead) {
    const patch: LeadPatch = {};
    if (a.appointmentStatus !== "cancelled" && a.appointmentStatus !== "invalid") {
      if (!lead.consultBookedAt) patch.consultBookedAt = a.dateAdded ?? new Date();
      const s = advancedStatus(lead.status, "consult_booked");
      if (s !== lead.status) patch.status = s;
    }
    if (a.appointmentStatus === "showed") {
      if (!lead.consultHeldAt) patch.consultHeldAt = a.startTime;
      const s = advancedStatus(patch.status ?? lead.status, "consult_held");
      if (s !== lead.status) patch.status = s;
    }
    merge(result, (await patchLead(ctx, lead, patch)).result);
  }

  if (relevantChange) result.triggers.push({ automation: "A7", appointmentId: id });
  return result;
}

export async function deleteAppointment(
  ctx: MirrorContext,
  ghlAppointmentId: string,
): Promise<MirrorResult> {
  const [row] = await ctx.tx
    .update(appointments)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(appointments.source, "ghl"),
        eq(appointments.sourceId, ghlAppointmentId),
        isNull(appointments.deletedAt),
      ),
    )
    .returning({ id: appointments.id });
  if (!row) return empty();
  return {
    audit: [
      {
        action: "intake.appointment_deleted_in_ghl",
        entityType: "appointment",
        entityId: row.id,
        metadata: ctx.cause,
      },
    ],
    // A7 cancels the pending reminders for a deleted appointment.
    triggers: [{ automation: "A7", appointmentId: row.id }],
  };
}

/** Attach GHL attribution to the contact's open lead (ContactCreate after the call or form). */
export async function attachContactAttribution(
  ctx: MirrorContext,
  contact: ContactRow,
  ghl: GhlContact,
): Promise<MirrorResult> {
  if (!ghl.attributionSource && !ghl.lastAttributionSource) return empty();
  const lead = await findOpenLead(ctx.tx, contact.id);
  if (!lead) return empty();
  return recordTouches(ctx, lead, attributionTouches(ghl, lead));
}
