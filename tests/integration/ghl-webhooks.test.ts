import { generateKeyPairSync, sign } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  auditLog,
  calls,
  contacts,
  leads,
  messages,
  opportunities,
  webhookEvents,
} from "@/db/schema";
import type { SessionUser } from "@/lib/commands/define";
import { resetEnvCache } from "@/lib/env";
import { setGhlClientForTesting } from "@/lib/ghl/client";
import { setJobQueue } from "@/lib/jobs/queue";
import { processWebhookJob } from "@/jobs/ghl/process-webhook";
import { handleGhlWebhook } from "@/modules/ghl/ingest";
import {
  FakeGhl,
  RecordingQueue,
  TEST_LOCATION,
  configureGhlEnv,
  daytimeZone,
  ghlContactPayload,
  missedCallPayload,
  opportunityPayload,
  prepareMessaging,
  webhookRequest,
} from "./ghl-kit";
import { provisionTestFirm, withFreshDatabase } from "./helpers";

/*
 * Phase 1 acceptance criterion: "Replayed webhooks do not duplicate records."
 * Also: webhook authentication, isolation and sanitization (spec Sections 2, 4; rule 6).
 */

configureGhlEnv();
const { db } = withFreshDatabase();
let owner: SessionUser;
const ghl = new FakeGhl();
const queue = new RecordingQueue();

const countOf = async (
  t:
    | typeof contacts
    | typeof leads
    | typeof calls
    | typeof messages
    | typeof webhookEvents
    | typeof opportunities,
) => (await db().select({ n: count() }).from(t))[0]!.n;

/** Runs every queued webhook job, as the worker would. */
async function drain(): Promise<void> {
  for (const job of queue.take("ghl.webhook")) await processWebhookJob(String(job.eventId));
}

beforeAll(async () => {
  ({ owner } = await provisionTestFirm());
  await prepareMessaging(owner);
  ghl.install();
  queue.install();
});
afterAll(() => {
  setJobQueue(undefined);
  setGhlClientForTesting(undefined);
});

describe("webhook authentication and storage", () => {
  it("rejects requests without credentials, with a wrong secret, or a bad signature", async () => {
    const payload = ghlContactPayload("c_auth", { type: "ContactCreate" });
    expect((await handleGhlWebhook(webhookRequest(payload, { secret: null }))).status).toBe(401);
    expect(
      (await handleGhlWebhook(webhookRequest(payload, { secret: "wrong-secret" }))).status,
    ).toBe(401);
    expect(
      (
        await handleGhlWebhook(
          webhookRequest(payload, {
            secret: null,
            headers: { "x-wh-signature": "bm90LWEtc2lnbmF0dXJl" },
          }),
        )
      ).status,
    ).toBe(401);
    expect(await countOf(webhookEvents)).toBe(0);
  });

  it("accepts a delivery signed with GHL's key (x-wh-signature, RSA SHA-256)", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.GHL_WEBHOOK_PUBLIC_KEY = publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    resetEnvCache();
    try {
      const raw = JSON.stringify({
        ...ghlContactPayload("c_signed"),
        type: "ContactCreate",
        webhookId: "wh_signed_1",
      });
      const signature = sign("sha256", Buffer.from(raw), privateKey).toString("base64");
      const res = await handleGhlWebhook(
        webhookRequest(null, { raw, secret: null, headers: { "x-wh-signature": signature } }),
      );
      expect(res.status).toBe(200);
      const [event] = await db()
        .select()
        .from(webhookEvents)
        .where(eq(webhookEvents.dedupeKey, "ghl:webhook:wh_signed_1"));
      expect(event).toMatchObject({
        authMethod: "signature",
        eventType: "ContactCreate",
        status: "pending",
      });
      // Tampering with one byte breaks the signature.
      const tampered = raw.replace("Dana", "Dina");
      const bad = await handleGhlWebhook(
        webhookRequest(null, {
          raw: tampered,
          secret: null,
          headers: { "x-wh-signature": signature },
        }),
      );
      expect(bad.status).toBe(401);
    } finally {
      delete process.env.GHL_WEBHOOK_PUBLIC_KEY;
      resetEnvCache();
    }
  });

  it("rejects another sub-account's events and malformed bodies", async () => {
    const other = {
      ...ghlContactPayload("c_other"),
      type: "ContactCreate",
      locationId: "loc_someone_else",
    };
    expect((await handleGhlWebhook(webhookRequest(other))).status).toBe(403);
    expect((await handleGhlWebhook(webhookRequest(null, { raw: "not json" }))).status).toBe(400);
    expect((await handleGhlWebhook(webhookRequest(null, { raw: "[1,2]" }))).status).toBe(400);
  });

  it("stores the payload without dates of birth, message text or custom field values (rule 6)", async () => {
    const payload = {
      ...ghlContactPayload("c_sanitize", {
        customFields: [{ id: "cf_ssn", value: "123-45-6789" }],
        ssn: "123456789",
      }),
      type: "ContactCreate",
    };
    await handleGhlWebhook(webhookRequest(payload));
    await handleGhlWebhook(
      webhookRequest({
        type: "InboundMessage",
        locationId: TEST_LOCATION,
        contactId: "c_sanitize",
        messageType: "SMS",
        direction: "inbound",
        messageId: "sms_sanitize_1",
        body: "my ssn is 123-45-6789",
        dateAdded: new Date().toISOString(),
      }),
    );
    const stored = JSON.stringify(
      await db().select({ p: webhookEvents.payload }).from(webhookEvents),
    );
    expect(stored).not.toContain("123-45-6789");
    expect(stored).not.toContain("123456789");
    expect(stored).not.toContain("1980-02-03");
    expect(stored).not.toContain("my ssn");
    expect(stored).toContain("[REDACTED]");
  });

  it("returns 404 in demo mode (rule 12)", async () => {
    process.env.DEMO_MODE = "true";
    process.env.GHL_LOCATION_ID = "";
    resetEnvCache();
    try {
      const res = await handleGhlWebhook(
        webhookRequest({ ...ghlContactPayload("c_demo"), type: "ContactCreate" }),
      );
      expect(res.status).toBe(404);
    } finally {
      process.env.DEMO_MODE = "false";
      configureGhlEnv();
    }
  });
});

describe("replayed webhooks do not duplicate records", () => {
  beforeEach(async () => {
    await drain();
  });

  it("the same delivery replayed sequentially and concurrently is stored and applied once", async () => {
    const contactId = "c_replay";
    ghl.contacts.set(contactId, ghlContactPayload(contactId, { timezone: daytimeZone() }));
    const payload = missedCallPayload(contactId, "call_replay_1", { webhookId: "wh_replay_1" });
    const eventsBefore = await countOf(webhookEvents);
    const sendsBefore = ghl.calls.filter((c) => c.path === "/conversations/messages").length;

    for (let i = 0; i < 3; i++) {
      expect((await handleGhlWebhook(webhookRequest(payload))).status).toBe(200);
    }
    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () => handleGhlWebhook(webhookRequest(payload))),
    );
    expect(concurrent.every((r) => r.status === 200)).toBe(true);
    // Processing the same event twice (a duplicated job) is also harmless.
    const jobs = queue.take("ghl.webhook");
    expect(jobs).toHaveLength(1);
    await Promise.all([
      processWebhookJob(String(jobs[0]!.eventId)),
      processWebhookJob(String(jobs[0]!.eventId)),
    ]);

    expect((await countOf(webhookEvents)) - eventsBefore).toBe(1);
    const [contact] = await db().select().from(contacts).where(eq(contacts.sourceId, contactId));
    expect(await db().select().from(leads).where(eq(leads.contactId, contact!.id))).toHaveLength(1);
    expect(await db().select().from(calls).where(eq(calls.sourceId, "call_replay_1"))).toHaveLength(
      1,
    );
    expect(
      await db().select().from(messages).where(eq(messages.contactId, contact!.id)),
    ).toHaveLength(1);
    expect(ghl.calls.filter((c) => c.path === "/conversations/messages").length - sendsBefore).toBe(
      1,
    );

    const dupes = await db()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "ghl.webhook_duplicate"));
    expect(dupes.length).toBe(7);
  });

  it("a redelivery with a new webhookId (or a reworded body) still creates no new records", async () => {
    const contactId = "c_redelivery";
    ghl.contacts.set(contactId, ghlContactPayload(contactId, { timezone: daytimeZone() }));
    const sendsBefore = ghl.calls.filter((c) => c.path === "/conversations/messages").length;
    const base = missedCallPayload(contactId, "call_redelivery_1");
    await handleGhlWebhook(webhookRequest({ ...base, webhookId: "wh_a" }));
    await handleGhlWebhook(webhookRequest({ ...base, webhookId: "wh_b" }));
    await handleGhlWebhook(webhookRequest({ ...base, webhookId: "wh_c", callDuration: 0 }));
    await drain();

    const [contact] = await db().select().from(contacts).where(eq(contacts.sourceId, contactId));
    expect(await db().select().from(leads).where(eq(leads.contactId, contact!.id))).toHaveLength(1);
    expect(
      await db().select().from(calls).where(eq(calls.sourceId, "call_redelivery_1")),
    ).toHaveLength(1);
    expect(
      await db().select().from(messages).where(eq(messages.contactId, contact!.id)),
    ).toHaveLength(1);
    expect(ghl.calls.filter((c) => c.path === "/conversations/messages").length - sendsBefore).toBe(
      1,
    );
  });

  it("a second missed call within 24 hours opens no second lead and sends no second text", async () => {
    const contactId = "c_redelivery";
    await handleGhlWebhook(webhookRequest(missedCallPayload(contactId, "call_redelivery_2")));
    await drain();
    const [contact] = await db().select().from(contacts).where(eq(contacts.sourceId, contactId));
    expect(await db().select().from(leads).where(eq(leads.contactId, contact!.id))).toHaveLength(1);
    const texts = await db().select().from(messages).where(eq(messages.contactId, contact!.id));
    expect(texts.map((m) => m.status).sort()).toEqual(["sent", "suppressed"]);
    expect(texts.find((m) => m.status === "suppressed")?.suppressedReason).toBe("recent_text_back");
  });

  it("opportunity and contact replays update in place, and older updates never overwrite newer ones", async () => {
    const contactId = "c_opps";
    const create = { ...opportunityPayload("opp_1", contactId), webhookId: "wh_opp_create" };
    for (let i = 0; i < 3; i++) await handleGhlWebhook(webhookRequest(create));
    await handleGhlWebhook(
      webhookRequest({
        ...opportunityPayload("opp_1", contactId, "won", "OpportunityStatusUpdate"),
        webhookId: "wh_opp_won",
      }),
    );
    await handleGhlWebhook(
      webhookRequest({
        ...opportunityPayload("opp_1", contactId, "won", "OpportunityStatusUpdate"),
        webhookId: "wh_opp_won_again",
      }),
    );
    await drain();
    expect(
      await db().select().from(opportunities).where(eq(opportunities.sourceId, "opp_1")),
    ).toHaveLength(1);
    const [contact] = await db().select().from(contacts).where(eq(contacts.sourceId, contactId));
    const leadRows = await db().select().from(leads).where(eq(leads.contactId, contact!.id));
    expect(leadRows).toHaveLength(1);
    expect(leadRows[0]).toMatchObject({ status: "retained" });

    const newer = {
      ...ghlContactPayload("c_order"),
      type: "ContactUpdate",
      firstName: "Newer",
      dateUpdated: "2026-10-05T12:00:00Z",
    };
    const older = {
      ...ghlContactPayload("c_order"),
      type: "ContactUpdate",
      firstName: "Older",
      dateUpdated: "2026-10-04T12:00:00Z",
    };
    await handleGhlWebhook(webhookRequest(newer));
    await drain();
    await handleGhlWebhook(webhookRequest(older));
    await drain();
    const [c] = await db().select().from(contacts).where(eq(contacts.sourceId, "c_order"));
    expect(c?.firstName).toBe("Newer");
  });
});
