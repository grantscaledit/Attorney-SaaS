import { z } from "zod";

/*
 * Zod schemas for everything LexDesk reads from GoHighLevel (rule 1). Field
 * names follow the official API docs (see lib/ghl/endpoints.ts for the source).
 * Unknown fields are stripped, so sensitive fields GHL may send (dateOfBirth,
 * ssn) never get past parsing.
 */

/** Trimmed string or null. GHL sends "", null or omits fields interchangeably. */
const text = z
  .string()
  .nullish()
  .transform((v) => {
    const t = v?.trim();
    return t ? t : null;
  });

/** ISO string, epoch millis or Date to Date; anything unparseable becomes null. */
export const ghlDate = z
  .union([z.string(), z.number(), z.date()])
  .nullish()
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  });

const tags = z
  .array(z.string())
  .nullish()
  .transform((v) => (v ?? []).map((t) => t.trim()).filter(Boolean));

const dndChannel = z.object({ status: text }).nullish();

/** docs: AttributionSource (contacts.json). Used for F1 first and last touch. */
export const ghlAttribution = z.object({
  url: text,
  campaign: text,
  utmSource: text,
  utmMedium: text,
  utmContent: text,
  referrer: text,
  campaignId: text,
  gclid: text,
  fbclid: text,
  medium: text,
  mediumId: text,
});
export type GhlAttribution = z.output<typeof ghlAttribution>;

/** Contact as sent in ContactCreate/Update/DndUpdate webhooks and GET /contacts/{id}. */
export const ghlContact = z.object({
  id: z.string().min(1),
  locationId: text,
  firstName: text,
  lastName: text,
  name: text,
  contactName: text,
  email: text,
  phone: text,
  companyName: text,
  timezone: text,
  tags,
  dnd: z.boolean().nullish(),
  dndSettings: z.object({ SMS: dndChannel, Email: dndChannel, Call: dndChannel }).nullish(),
  source: text,
  assignedTo: text,
  dateAdded: ghlDate,
  dateUpdated: ghlDate,
  attributionSource: ghlAttribution.nullish(),
  lastAttributionSource: ghlAttribution.nullish(),
});
export type GhlContact = z.output<typeof ghlContact>;

export const OPPORTUNITY_STATUS = z.enum(["open", "won", "lost", "abandoned"]);

/** Opportunity in Opportunity* webhooks and GET /opportunities/search results. */
export const ghlOpportunity = z.object({
  id: z.string().min(1),
  locationId: text,
  contactId: text,
  name: text,
  pipelineId: text,
  pipelineStageId: text,
  status: OPPORTUNITY_STATUS.catch("open"),
  monetaryValue: z.number().nullish(),
  assignedTo: text,
  source: text,
  dateAdded: ghlDate,
  createdAt: ghlDate,
  updatedAt: ghlDate,
  contact: z
    .object({
      id: z.string(),
      name: text,
      email: text,
      phone: text,
      companyName: text,
      tags,
    })
    .nullish(),
});
export type GhlOpportunity = z.output<typeof ghlOpportunity>;

export const APPOINTMENT_STATUS = z.enum([
  "new",
  "confirmed",
  "cancelled",
  "showed",
  "noshow",
  "invalid",
]);

/** Appointment in Appointment* webhooks and CalendarEventDTO from GET /calendars/events. */
export const ghlAppointment = z.object({
  id: z.string().min(1),
  locationId: text,
  calendarId: text,
  contactId: text,
  title: text,
  appointmentStatus: APPOINTMENT_STATUS.catch("new"),
  assignedUserId: text,
  startTime: ghlDate,
  endTime: ghlDate,
  dateAdded: ghlDate,
  dateUpdated: ghlDate,
});
export type GhlAppointment = z.output<typeof ghlAppointment>;

/**
 * InboundMessage / OutboundMessage webhook. For calls, `messageType` is "CALL"
 * and `status`/`callStatus` describe the outcome ("completed", "voicemail").
 * The message body is deliberately not parsed (rule 6, Phase 1).
 */
export const ghlMessageEvent = z.object({
  type: z.enum(["InboundMessage", "OutboundMessage"]),
  locationId: text,
  contactId: z.string().min(1),
  conversationId: text,
  messageId: text,
  messageType: text,
  direction: z.enum(["inbound", "outbound"]).catch("inbound"),
  status: text,
  callStatus: text,
  callDuration: z.number().nullish(),
  userId: text,
  dateAdded: ghlDate,
  /** Dialed firm number, when GHL includes it. VERIFY: not in the documented example. */
  to: text,
});
export type GhlMessageEvent = z.output<typeof ghlMessageEvent>;

// ---------------------------------------------------------------------------
// LexDesk workflow events. The snapshot's thin workflows (ghl/snapshot) post
// these with a Custom Webhook action. The shapes are ours; the merge fields
// that fill them are listed in ghl/snapshot/workflows.md (VERIFY in GHL).
// ---------------------------------------------------------------------------

export const lexdeskMissedCall = z.object({
  type: z.literal("LexDeskMissedCall"),
  locationId: text,
  contactId: z.string().min(1),
  /** Unique per call if the workflow can supply it; otherwise derived from contact and time. */
  callId: text,
  occurredAt: ghlDate,
  trackingNumber: text,
  firstName: text,
  lastName: text,
  phone: text,
  email: text,
});

const yesNo = z
  .union([z.boolean(), z.string()])
  .nullish()
  .transform((v) =>
    typeof v === "boolean"
      ? v
      : typeof v === "string"
        ? /^(true|yes|y|1|on|checked)$/i.test(v.trim())
        : false,
  );

export const lexdeskFormSubmitted = z.object({
  type: z.literal("LexDeskFormSubmitted"),
  locationId: text,
  contactId: z.string().min(1),
  submissionId: text,
  formName: text,
  occurredAt: ghlDate,
  firstName: text,
  lastName: text,
  phone: text,
  email: text,
  /** Practice area chosen on the form: free text mapped by ghl/field-map.ts. */
  practiceArea: text,
  /** The SMS consent checkbox (spec Section 4). */
  smsOptIn: yesNo,
  utmSource: text,
  utmMedium: text,
  utmCampaign: text,
  utmContent: text,
  utmTerm: text,
  referrer: text,
  pageUrl: text,
  gclid: text,
  fbclid: text,
});

// ---------------------------------------------------------------------------
// API responses
// ---------------------------------------------------------------------------

export const getContactResponse = z.object({ contact: ghlContact });

export const listContactsResponse = z.object({
  contacts: z.array(ghlContact),
  meta: z
    .object({
      total: z.number().nullish(),
      startAfterId: text,
      startAfter: z.number().nullish(),
      nextPageUrl: text,
    })
    .nullish(),
});

export const searchOpportunitiesResponse = z.object({
  opportunities: z.array(ghlOpportunity),
  meta: z
    .object({
      total: z.number().nullish(),
      startAfterId: text,
      startAfter: z.number().nullish(),
      nextPage: z.number().nullish(),
    })
    .nullish(),
});

export const listCalendarsResponse = z.object({
  calendars: z.array(z.object({ id: z.string(), name: text })),
});

export const listEventsResponse = z.object({ events: z.array(ghlAppointment) });

export const sendMessageResponse = z.object({
  conversationId: text,
  messageId: text,
  emailMessageId: text,
  msg: text,
});
export type SendMessageResult = z.output<typeof sendMessageResponse>;
