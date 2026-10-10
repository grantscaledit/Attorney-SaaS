import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, calls, contacts, leads, messages } from "@/db/schema";
import type { SessionUser } from "@/lib/commands/define";
import { setGhlClientForTesting } from "@/lib/ghl/client";
import { setJobQueue } from "@/lib/jobs/queue";
import { startJobs } from "@/jobs/runtime";
import { handleGhlWebhook } from "@/modules/ghl/ingest";
import {
  FakeGhl,
  configureGhlEnv,
  daytimeZone,
  ghlContactPayload,
  missedCallPayload,
  prepareMessaging,
  webhookRequest,
} from "./ghl-kit";
import { provisionTestFirm, withFreshDatabase } from "./helpers";

/*
 * Phase 1 acceptance criterion: "A missed call produces a text and a lead in
 * under 60 seconds."
 *
 * End to end through the real pieces: the webhook route handler, the
 * webhook_events table, pg-boss (started exactly as the worker starts it),
 * processing, A1, the outbox and the send job. Only GHL's HTTP API is faked.
 */

configureGhlEnv();
const { db, url } = withFreshDatabase();

let owner: SessionUser;
let boss: PgBoss;
const ghl = new FakeGhl();

async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("A1: missed call to text and lead", () => {
  beforeAll(async () => {
    ({ owner } = await provisionTestFirm());
    await prepareMessaging(owner);
    ghl.install();
    boss = await startJobs({
      connectionString: url(),
      timezone: "America/Chicago",
      schedules: false,
      pollingIntervalSeconds: 0.5,
    });
  });

  afterAll(async () => {
    await boss?.stop({ graceful: false, timeout: 2_000 });
    setJobQueue(undefined);
    setGhlClientForTesting(undefined);
  });

  it("texts the caller and opens a lead in under 60 seconds", async () => {
    const contactId = "ghl_contact_missed_1";
    ghl.contacts.set(contactId, ghlContactPayload(contactId, { timezone: daytimeZone() }));

    const started = Date.now();
    const res = await handleGhlWebhook(webhookRequest(missedCallPayload(contactId, "call_msg_1")));
    expect(res.status).toBe(200);

    const sent = await waitFor(async () => {
      const [m] = await db().select().from(messages).where(eq(messages.automationId, "A1"));
      return m?.status === "sent" ? m : undefined;
    }, 60_000);
    const elapsedMs = Date.now() - started;

    expect(elapsedMs).toBeLessThan(60_000);
    // The SMS went to GHL for this contact, with the booking link.
    const [send] = ghl.sends();
    expect(send?.body).toMatchObject({ type: "SMS", contactId });
    expect((send?.body as { message: string }).message).toContain(
      "https://book.example.test/consult",
    );
    expect(sent.ghlMessageId).toBe("ghl_msg_1");

    // A lead exists for the caller, flagged as a missed call, with the text as its first response.
    const [contact] = await db().select().from(contacts).where(eq(contacts.sourceId, contactId));
    const [lead] = await db().select().from(leads).where(eq(leads.contactId, contact!.id));
    expect(lead).toMatchObject({ channel: "call", missedCall: true, status: "contacted" });
    expect(lead!.firstResponseAt).not.toBeNull();
    expect(lead!.firstHumanResponseAt).toBeNull();
    const [call] = await db().select().from(calls).where(eq(calls.sourceId, "call_msg_1"));
    expect(call).toMatchObject({ outcome: "voicemail", leadId: lead!.id });

    // Rule 6: the contact's date of birth never reached our tables or the stored payload.
    const stored = JSON.stringify(await db().select().from(contacts));
    expect(stored).not.toContain("1980-02-03");

    // The whole path is in the audit log.
    const actions = (await db().select({ a: auditLog.action }).from(auditLog)).map((r) => r.a);
    for (const a of [
      "ghl.webhook_received",
      "ghl.webhook_processed",
      "intake.lead_created",
      "intake.call_recorded",
      "automations.A1_ran",
      "messaging.queued",
      "messaging.send_started",
      "messaging.sent",
    ]) {
      expect(actions, a).toContain(a);
    }
    console.info(`missed call to text: ${elapsedMs} ms`);
  }, 70_000);
});
