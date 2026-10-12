import { randomUUID } from "node:crypto";
import { GhlClient, setGhlClientForTesting } from "@/lib/ghl/client";
import { setJobQueue, type JobQueue, type QueueName } from "@/lib/jobs/queue";
import { resetEnvCache } from "@/lib/env";
import type { SessionUser } from "@/lib/commands/define";
import { DEFAULT_TEMPLATES } from "@/lib/messaging/templates";
import {
  approveMessageTemplate,
  saveMessageTemplate,
} from "@/modules/messaging/commands/templates";
import { updateFirmSettings } from "@/modules/firm/commands/update-settings";
import { DEFAULT_AI_DISCLOSURE } from "@/modules/firm/schemas";
import { asUser, run } from "./helpers";

/*
 * GoHighLevel test kit: a fake GHL API (no network), webhook request builders
 * and payload factories shaped like GHL's documented events. All people and
 * numbers are synthetic (555-01xx, .test domains).
 */

export const TEST_LOCATION = "loc_test_firm";
export const TEST_SECRET = "test-webhook-secret-0123456789-abcdefghij";

export function configureGhlEnv(): void {
  process.env.GHL_WEBHOOK_SECRET = TEST_SECRET;
  process.env.GHL_LOCATION_ID = TEST_LOCATION;
  delete process.env.GHL_PRIVATE_TOKEN;
  resetEnvCache();
}

export type ApiCall = { method: string; path: string; query: URLSearchParams; body: unknown };

/** In-memory GHL: records every request and answers from fixtures. */
export class FakeGhl {
  readonly calls: ApiCall[] = [];
  contacts = new Map<string, Record<string, unknown>>();
  opportunities: Record<string, unknown>[] = [];
  calendars: { id: string; name: string }[] = [];
  events = new Map<string, Record<string, unknown>[]>();
  /** Next responses for POST /conversations/messages (status codes); default 200. */
  sendResponses: number[] = [];
  private sent = 0;

  readonly client = new GhlClient({
    token: "test-token",
    locationId: TEST_LOCATION,
    sleep: async () => {},
    fetch: async (url, init) => this.handle(url, init),
  });

  sends(): ApiCall[] {
    return this.calls.filter((c) => c.method === "POST" && c.path === "/conversations/messages");
  }

  private async handle(url: string, init: RequestInit): Promise<Response> {
    const u = new URL(url);
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    this.calls.push({
      method: init.method ?? "GET",
      path: u.pathname,
      query: u.searchParams,
      body,
    });
    const ok = (data: unknown) => Response.json(data, { status: 200 });

    if (init.method === "POST" && u.pathname === "/conversations/messages") {
      const status = this.sendResponses.shift() ?? 200;
      if (status !== 200) return Response.json({ message: "error" }, { status });
      this.sent += 1;
      return ok({
        conversationId: "conv_1",
        messageId: `ghl_msg_${this.sent}`,
        msg: "Message queued",
      });
    }
    const contact = u.pathname.match(/^\/contacts\/([^/]+)$/);
    if (contact && contact[1]) {
      const c = this.contacts.get(contact[1]);
      return c ? ok({ contact: c }) : Response.json({ message: "not found" }, { status: 404 });
    }
    if (u.pathname === "/contacts/") {
      const all = [...this.contacts.values()];
      const after = u.searchParams.get("startAfterId");
      const start = after ? all.findIndex((c) => c.id === after) + 1 : 0;
      const page = all.slice(start, start + 100);
      return ok({ contacts: page, meta: { total: all.length } });
    }
    if (u.pathname === "/opportunities/search") {
      return ok({ opportunities: this.opportunities, meta: { total: this.opportunities.length } });
    }
    if (u.pathname === "/calendars/") return ok({ calendars: this.calendars });
    if (u.pathname === "/calendars/events") {
      return ok({ events: this.events.get(u.searchParams.get("calendarId") ?? "") ?? [] });
    }
    return Response.json({ message: "unexpected" }, { status: 404 });
  }

  install(): this {
    setGhlClientForTesting(this.client);
    return this;
  }
}

/** Records enqueued jobs instead of sending them to pg-boss. */
export class RecordingQueue implements JobQueue {
  readonly jobs: { name: QueueName; data: Record<string, unknown>; startAfter?: Date }[] = [];
  async send(name: QueueName, data: Record<string, unknown>, options: { startAfter?: Date } = {}) {
    this.jobs.push({ name, data, startAfter: options.startAfter });
  }
  install(): this {
    setJobQueue(this);
    return this;
  }
  take(name: QueueName): Record<string, unknown>[] {
    const out = this.jobs.filter((j) => j.name === name).map((j) => j.data);
    this.jobs.splice(0, this.jobs.length, ...this.jobs.filter((j) => j.name !== name));
    return out;
  }
}

export function webhookRequest(
  payload: unknown,
  opts: { secret?: string | null; headers?: Record<string, string>; raw?: string } = {},
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": "198.51.100.7",
    ...opts.headers,
  };
  const secret = opts.secret === undefined ? TEST_SECRET : opts.secret;
  if (secret !== null) headers["x-lexdesk-webhook-secret"] = secret;
  return new Request("http://localhost:3000/api/webhooks/ghl", {
    method: "POST",
    headers,
    body: opts.raw ?? JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Payload factories (documented GHL event shapes)
// ---------------------------------------------------------------------------

export function ghlContactPayload(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    locationId: TEST_LOCATION,
    firstName: "Dana",
    lastName: "Whitfield",
    name: "Dana Whitfield",
    email: `${id}@example.test`,
    phone: "+12145550142",
    source: "website form",
    dateAdded: "2026-10-01T15:00:00.000Z",
    dateOfBirth: "1980-02-03",
    tags: [],
    ...extra,
  };
}

export function missedCallPayload(
  contactId: string,
  messageId = `call_${randomUUID()}`,
  extra: Record<string, unknown> = {},
) {
  return {
    type: "InboundMessage",
    locationId: TEST_LOCATION,
    attachments: ["https://example.test/voicemail.mp3"],
    contactId,
    conversationId: `conv_${contactId}`,
    dateAdded: new Date().toISOString(),
    direction: "inbound",
    messageType: "CALL",
    messageId,
    status: "voicemail",
    callStatus: "voicemail",
    ...extra,
  };
}

export function formPayload(contactId: string, extra: Record<string, unknown> = {}) {
  return {
    type: "LexDeskFormSubmitted",
    locationId: TEST_LOCATION,
    contactId,
    submissionId: `sub_${randomUUID()}`,
    formName: "Website contact form",
    occurredAt: new Date().toISOString(),
    firstName: "Lena",
    lastName: "Okafor",
    email: `${contactId}@example.test`,
    phone: "+14695550188",
    practiceArea: "IRS notice / tax problem",
    smsOptIn: "true",
    utmSource: "google",
    utmMedium: "cpc",
    utmCampaign: "irs-notices",
    pageUrl: "https://firm.example.test/tax",
    gclid: "test-gclid",
    ...extra,
  };
}

export function appointmentPayload(
  id: string,
  contactId: string,
  startsAt: Date,
  status = "confirmed",
  type = "AppointmentCreate",
) {
  return {
    type,
    locationId: TEST_LOCATION,
    appointment: {
      id,
      calendarId: "cal_consults",
      contactId,
      title: "Initial consultation",
      appointmentStatus: status,
      startTime: startsAt.toISOString(),
      endTime: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
      dateAdded: new Date().toISOString(),
      dateUpdated: new Date().toISOString(),
      notes: "Caller mentioned a levy notice",
    },
  };
}

export function opportunityPayload(
  id: string,
  contactId: string,
  status = "open",
  type = "OpportunityCreate",
) {
  return {
    type,
    locationId: TEST_LOCATION,
    id,
    contactId,
    name: "Tax resolution enquiry",
    pipelineId: "pipe_intake",
    pipelineStageId: "stage_new",
    monetaryValue: 3500,
    status,
    source: "website form",
    dateAdded: new Date().toISOString(),
  };
}

/** The firm approves every default template and sets the links they need. */
export async function prepareMessaging(owner: SessionUser): Promise<void> {
  await run(updateFirmSettings, asUser(owner), {
    legalName: "Test Firm PLLC",
    displayName: "Test Firm",
    phone: "(214) 555-0100",
    website: "https://firm.example.test",
    bookingUrl: "https://book.example.test/consult",
    intakeFormUrl: "https://forms.example.test/intake",
    practiceAreas: ["tax", "business", "estate"],
    aiDisclosureText: DEFAULT_AI_DISCLOSURE,
    attorneysSeeFinancials: false,
    ipAllowlist: [],
  });
  for (const t of DEFAULT_TEMPLATES) {
    const subject = "subject" in t ? t.subject : undefined;
    // Saving the default text first resets any edit a test made.
    await run(saveMessageTemplate, asUser(owner), { key: t.key, body: t.body, subject });
    await run(approveMessageTemplate, asUser(owner), {
      key: t.key,
      body: t.body,
      subject: "subject" in t ? t.subject : null,
    });
  }
}

/**
 * A time zone where it is currently early afternoon, so quiet hours
 * (8am-9pm recipient time) never defer a test message whatever the clock says.
 * Etc/GMT zones use inverted signs: Etc/GMT+5 is UTC-5.
 */
export function daytimeZone(now = new Date()): string {
  const target = 13;
  let offset = target - now.getUTCHours();
  if (offset > 14) offset -= 24;
  if (offset < -12) offset += 24;
  if (offset === 0) return "Etc/GMT";
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

/** A time zone where it is currently 2 or 3am. */
export function nightZone(now = new Date()): string {
  const target = 2;
  let offset = target - now.getUTCHours();
  if (offset > 14) offset -= 24;
  if (offset < -12) offset += 24;
  if (offset === 0) return "Etc/GMT";
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}
