import type { CallOutcome } from "@/db/schema";
import { redact } from "@/lib/log/redact";
import {
  ghlAppointment,
  ghlContact,
  ghlMessageEvent,
  ghlOpportunity,
  lexdeskFormSubmitted,
  lexdeskMissedCall,
  type GhlAppointment,
  type GhlContact,
  type GhlOpportunity,
} from "./schemas";
import type { z } from "zod";

/*
 * Normalizes a stored webhook payload into one LexDesk event. Event names are
 * GHL's documented webhook types (docs/webhook events/*.md) plus LexDesk's
 * own workflow events. Anything else is kept in webhook_events and ignored.
 */

export type MessageChannelKind = "sms" | "email" | "chat" | "other";

export type CallFacts = {
  /** GHL message id of the call, or a derived id for workflow events. */
  sourceId: string;
  contactId: string;
  direction: "inbound" | "outbound";
  outcome: CallOutcome;
  ghlStatus: string | null;
  ghlCallStatus: string | null;
  durationSeconds: number | null;
  trackingNumber: string | null;
  occurredAt: Date;
};

export type FormFacts = z.output<typeof lexdeskFormSubmitted>;

export type GhlEvent =
  | { kind: "contact.upsert"; contact: GhlContact }
  | { kind: "contact.delete"; contactId: string }
  | { kind: "opportunity.upsert"; opportunity: GhlOpportunity }
  | { kind: "opportunity.delete"; opportunityId: string }
  | { kind: "appointment.upsert"; appointment: GhlAppointment }
  | { kind: "appointment.delete"; appointmentId: string }
  | {
      kind: "call";
      call: CallFacts;
      /** Name and number from a workflow event, used when the contact is not mirrored yet. */
      contactHint?: Partial<GhlContact>;
    }
  | {
      kind: "message";
      direction: "inbound" | "outbound";
      channel: MessageChannelKind;
      contactId: string;
      messageId: string | null;
      /** GHL user who sent it; set only when staff replied from GHL. */
      userId: string | null;
      occurredAt: Date;
    }
  | { kind: "form"; form: FormFacts }
  | { kind: "ignored"; reason: string };

const CONTACT_UPSERT = new Set([
  "ContactCreate",
  "ContactUpdate",
  "ContactDndUpdate",
  "ContactTagUpdate",
]);
const OPPORTUNITY_UPSERT = new Set([
  "OpportunityCreate",
  "OpportunityUpdate",
  "OpportunityStatusUpdate",
  "OpportunityStageUpdate",
  "OpportunityAssignedToUpdate",
  "OpportunityMonetaryValueUpdate",
]);

/**
 * Call outcome from GHL's `status` and `callStatus`. Documented values:
 * "completed" (answered) and "voicemail". Any other value on an inbound call
 * (no-answer, busy, missed, canceled, failed) is treated as missed.
 * VERIFY the full list of call statuses against a live sub-account.
 */
export function classifyCall(status: string | null, callStatus: string | null): CallOutcome {
  const s = (callStatus ?? status ?? "").toLowerCase();
  if (s === "completed" || s === "answered" || s === "in-progress") return "answered";
  if (s === "voicemail") return "voicemail";
  return "missed";
}

function channelOf(messageType: string | null): MessageChannelKind {
  const t = (messageType ?? "").toUpperCase();
  if (t === "SMS" || t === "TYPE_SMS") return "sms";
  if (t === "EMAIL" || t === "TYPE_EMAIL") return "email";
  if (t === "LIVE_CHAT" || t === "TYPE_LIVE_CHAT" || t === "WEBCHAT") return "chat";
  return "other";
}

const isCall = (messageType: string | null) => /^(TYPE_)?CALL$/i.test(messageType ?? "");

export function normalizeGhlEvent(payload: Record<string, unknown>): GhlEvent {
  const type = typeof payload.type === "string" ? payload.type : "";

  if (CONTACT_UPSERT.has(type)) {
    const c = ghlContact.safeParse(payload);
    return c.success
      ? { kind: "contact.upsert", contact: c.data }
      : { kind: "ignored", reason: `invalid ${type}` };
  }
  if (type === "ContactDelete") {
    return typeof payload.id === "string"
      ? { kind: "contact.delete", contactId: payload.id }
      : { kind: "ignored", reason: "ContactDelete without id" };
  }
  if (OPPORTUNITY_UPSERT.has(type)) {
    const o = ghlOpportunity.safeParse(payload);
    return o.success
      ? { kind: "opportunity.upsert", opportunity: o.data }
      : { kind: "ignored", reason: `invalid ${type}` };
  }
  if (type === "OpportunityDelete") {
    return typeof payload.id === "string"
      ? { kind: "opportunity.delete", opportunityId: payload.id }
      : { kind: "ignored", reason: "OpportunityDelete without id" };
  }
  if (type === "AppointmentCreate" || type === "AppointmentUpdate") {
    const a = ghlAppointment.safeParse(payload.appointment);
    return a.success && a.data.startTime
      ? { kind: "appointment.upsert", appointment: a.data }
      : { kind: "ignored", reason: `invalid ${type}` };
  }
  if (type === "AppointmentDelete") {
    const appt = payload.appointment as { id?: unknown } | undefined;
    return typeof appt?.id === "string"
      ? { kind: "appointment.delete", appointmentId: appt.id }
      : { kind: "ignored", reason: "AppointmentDelete without id" };
  }
  if (type === "InboundMessage" || type === "OutboundMessage") {
    const m = ghlMessageEvent.safeParse(payload);
    if (!m.success) return { kind: "ignored", reason: `invalid ${type}` };
    const e = m.data;
    const occurredAt = e.dateAdded ?? new Date();
    if (isCall(e.messageType)) {
      if (!e.messageId) return { kind: "ignored", reason: "call without messageId" };
      return {
        kind: "call",
        call: {
          sourceId: e.messageId,
          contactId: e.contactId,
          direction: e.direction,
          outcome: classifyCall(e.status, e.callStatus),
          ghlStatus: e.status,
          ghlCallStatus: e.callStatus,
          durationSeconds: e.callDuration ?? null,
          trackingNumber: e.direction === "inbound" ? e.to : null,
          occurredAt,
        },
      };
    }
    return {
      kind: "message",
      direction: e.direction,
      channel: channelOf(e.messageType),
      contactId: e.contactId,
      messageId: e.messageId,
      userId: e.userId,
      occurredAt,
    };
  }
  if (type === "LexDeskMissedCall") {
    const m = lexdeskMissedCall.safeParse(payload);
    if (!m.success) return { kind: "ignored", reason: "invalid LexDeskMissedCall" };
    const e = m.data;
    const occurredAt = e.occurredAt ?? new Date();
    return {
      kind: "call",
      call: {
        // Without a call id, one missed call per contact per minute.
        sourceId: e.callId ?? `workflow:${e.contactId}:${occurredAt.toISOString().slice(0, 16)}`,
        contactId: e.contactId,
        direction: "inbound",
        outcome: "missed",
        ghlStatus: null,
        ghlCallStatus: null,
        durationSeconds: null,
        trackingNumber: e.trackingNumber,
        occurredAt,
      },
      contactHint: {
        id: e.contactId,
        firstName: e.firstName,
        lastName: e.lastName,
        phone: e.phone,
        email: e.email,
      },
    };
  }
  if (type === "LexDeskFormSubmitted") {
    const f = lexdeskFormSubmitted.safeParse(payload);
    return f.success
      ? { kind: "form", form: f.data }
      : { kind: "ignored", reason: "invalid LexDeskFormSubmitted" };
  }
  return { kind: "ignored", reason: type ? `unhandled event type ${type}` : "no event type" };
}

/** Keys removed from stored payloads: free text that can carry identifiers (rule 6). */
const DROP_KEYS = new Set([
  "body",
  "html",
  "message",
  "attachments",
  "customFields",
  "notes",
  "description",
]);

function strip(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => strip(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (DROP_KEYS.has(k)) continue;
    out[k] = strip(v, depth + 1);
  }
  return out;
}

/**
 * The form of a payload that is safe to keep in webhook_events: message and
 * note text, custom field values and attachments removed; dates of birth, SSNs
 * and other known sensitive keys redacted. Normalization reads only fields
 * that survive this.
 */
export function sanitizeWebhookPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return redact(strip(payload)) as Record<string, unknown>;
}
