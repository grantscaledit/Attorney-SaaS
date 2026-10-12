import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appointments,
  automationRuns,
  consents,
  contacts,
  leadTouches,
  leads,
  messages,
  opportunities,
  webhookEvents,
} from "@/db/schema";
import type { SessionUser } from "@/lib/commands/define";
import { setGhlClientForTesting } from "@/lib/ghl/client";
import { setJobQueue } from "@/lib/jobs/queue";
import { reconcileGhl } from "@/jobs/ghl/reconcile";
import { processWebhookJob } from "@/jobs/ghl/process-webhook";
import { sendMessageJob } from "@/jobs/messaging/send";
import { sweep } from "@/jobs/system/sweep";
import { handleGhlWebhook } from "@/modules/ghl/ingest";
import { setFeatureEnabled } from "@/modules/firm/commands/set-feature";
import { saveMessageTemplate } from "@/modules/messaging/commands/templates";
import {
  FakeGhl,
  RecordingQueue,
  TEST_LOCATION,
  appointmentPayload,
  configureGhlEnv,
  daytimeZone,
  formPayload,
  ghlContactPayload,
  missedCallPayload,
  nightZone,
  opportunityPayload,
  prepareMessaging,
  webhookRequest,
} from "./ghl-kit";
import { asUser, provisionTestFirm, run, withFreshDatabase } from "./helpers";

configureGhlEnv();
const { db } = withFreshDatabase();
let owner: SessionUser;
const ghl = new FakeGhl();
const queue = new RecordingQueue();

async function deliver(payload: unknown): Promise<void> {
  const res = await handleGhlWebhook(webhookRequest(payload));
  expect(res.status).toBe(200);
  for (const job of queue.take("ghl.webhook")) await processWebhookJob(String(job.eventId));
}

async function contactBySource(id: string) {
  const [c] = await db().select().from(contacts).where(eq(contacts.sourceId, id));
  return c!;
}

async function messagesFor(contactId: string) {
  return db()
    .select()
    .from(messages)
    .where(eq(messages.contactId, contactId))
    .orderBy(messages.createdAt);
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

describe("A2 instant lead response and F1 attribution", () => {
  it("a web form opens a lead, records consent and source, and sends email and SMS acknowledgements", async () => {
    ghl.contacts.set(
      "c_form",
      ghlContactPayload("c_form", { timezone: daytimeZone(), firstName: "Lena" }),
    );
    await deliver(formPayload("c_form"));
    const c = await contactBySource("c_form");
    const [lead] = await db().select().from(leads).where(eq(leads.contactId, c.id));
    expect(lead).toMatchObject({ channel: "form", practiceArea: "tax", status: "contacted" });

    const sent = (await messagesFor(c.id)).sort((a, b) =>
      a.templateKey!.localeCompare(b.templateKey!),
    );
    expect(sent.map((m) => [m.templateKey, m.status])).toEqual([
      ["A2.email", "sent"],
      ["A2.sms", "sent"],
    ]);
    expect(sent[0]!.subject).toBe("We received your enquiry");
    expect(sent[0]!.body).toContain("Hi Lena,");
    const emailCall = ghl.sends().find((s) => (s.body as { type: string }).type === "Email");
    expect((emailCall!.body as { html: string }).html).toContain("<p>Hi Lena,</p>");

    const [consent] = await db().select().from(consents).where(eq(consents.contactId, c.id));
    expect(consent).toMatchObject({ channel: "sms", status: "granted", basis: "form_opt_in" });

    const touches = await db().select().from(leadTouches).where(eq(leadTouches.leadId, lead!.id));
    expect(touches.find((t) => t.origin === "form")).toMatchObject({
      sourceLabel: "google_ads",
      utmCampaign: "irs-notices",
      gclid: "test-gclid",
    });
  });

  it("without SMS consent only the email goes out", async () => {
    ghl.contacts.set(
      "c_form_noconsent",
      ghlContactPayload("c_form_noconsent", { timezone: daytimeZone() }),
    );
    await deliver(formPayload("c_form_noconsent", { smsOptIn: false }));
    const c = await contactBySource("c_form_noconsent");
    const sent = (await messagesFor(c.id)).sort((a, b) =>
      a.templateKey!.localeCompare(b.templateKey!),
    );
    expect(sent.map((m) => [m.templateKey, m.status, m.suppressedReason])).toEqual([
      ["A2.email", "sent", null],
      ["A2.sms", "suppressed", "no_sms_consent"],
    ]);
  });

  it("a staff reply from GHL records the first human response", async () => {
    const c = await contactBySource("c_form_noconsent");
    await deliver({
      type: "OutboundMessage",
      locationId: TEST_LOCATION,
      contactId: "c_form_noconsent",
      messageType: "SMS",
      direction: "outbound",
      messageId: "staff_reply_1",
      userId: "ghl_user_jordan",
      dateAdded: new Date().toISOString(),
    });
    const [lead] = await db().select().from(leads).where(eq(leads.contactId, c.id));
    expect(lead!.firstHumanResponseAt).not.toBeNull();
    expect(lead!.firstResponseAt!.getTime()).toBeLessThanOrEqual(
      lead!.firstHumanResponseAt!.getTime(),
    );
  });
});

describe("message rules", () => {
  it("do-not-disturb suppresses the text-back", async () => {
    ghl.contacts.set(
      "c_dnd",
      ghlContactPayload("c_dnd", {
        timezone: daytimeZone(),
        dnd: false,
        dndSettings: { SMS: { status: "active" } },
      }),
    );
    await deliver(missedCallPayload("c_dnd"));
    const [m] = await messagesFor((await contactBySource("c_dnd")).id);
    expect(m).toMatchObject({ status: "suppressed", suppressedReason: "dnd" });
  });

  it("quiet hours defer the text-back to 8am recipient time", async () => {
    ghl.contacts.set("c_night", ghlContactPayload("c_night", { timezone: nightZone() }));
    await deliver(missedCallPayload("c_night"));
    const [m] = await messagesFor((await contactBySource("c_night")).id);
    expect(m!.status).toBe("queued");
    expect(m!.deferredFrom).not.toBeNull();
    const hours = (m!.scheduledFor!.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(4);
    expect(hours).toBeLessThan(7);
    expect(queue.take("messaging.send")).toEqual([{ messageId: m!.id }]);
  });

  it("an edited (unapproved) template never sends", async () => {
    await run(saveMessageTemplate, asUser(owner), {
      key: "A1.sms",
      body: "{{firmName}}: sorry we missed you. Book at {{bookingUrl}}. Reply STOP to opt out.",
    });
    ghl.contacts.set(
      "c_unapproved",
      ghlContactPayload("c_unapproved", { timezone: daytimeZone() }),
    );
    await deliver(missedCallPayload("c_unapproved"));
    const [m] = await messagesFor((await contactBySource("c_unapproved")).id);
    expect(m).toMatchObject({ status: "suppressed", suppressedReason: "template_not_approved" });
  });

  it("an automation switched off by the firm sends nothing", async () => {
    await run(setFeatureEnabled, asUser(owner), {
      flag: "automation.A1",
      enabled: false,
      reason: "test",
    });
    ghl.contacts.set("c_off", ghlContactPayload("c_off", { timezone: daytimeZone() }));
    await deliver(missedCallPayload("c_off"));
    const [m] = await messagesFor((await contactBySource("c_off")).id);
    expect(m).toMatchObject({ status: "suppressed", suppressedReason: "feature_off" });
    await run(setFeatureEnabled, asUser(owner), { flag: "automation.A1", enabled: true });
  });

  it("a send GHL rate-limits is retried; a 5xx is recorded as unknown and never resent", async () => {
    await prepareMessaging(owner);
    ghl.contacts.set("c_retry", ghlContactPayload("c_retry", { timezone: daytimeZone() }));
    ghl.sendResponses = [429, 429, 429, 429, 429];
    await deliver(missedCallPayload("c_retry"));
    let [m] = await messagesFor((await contactBySource("c_retry")).id);
    expect(m).toMatchObject({ status: "queued", attempts: 1 });
    expect(m!.scheduledFor!.getTime()).toBeGreaterThan(Date.now());

    ghl.sendResponses = [503];
    await db().update(messages).set({ scheduledFor: new Date() }).where(eq(messages.id, m!.id));
    await sendMessageJob(m!.id);
    [m] = await messagesFor((await contactBySource("c_retry")).id);
    expect(m).toMatchObject({ status: "unknown", attempts: 2 });
    expect(await sendMessageJob(m!.id)).toBe("skipped");
  });
});

describe("A7 consult booking and reminders", () => {
  const start = () => new Date(Date.now() + 3 * 86_400_000);

  it("a booked consult gets a confirmation now and reminders at 24h and 2h before", async () => {
    ghl.contacts.set("c_consult", ghlContactPayload("c_consult", { timezone: daytimeZone() }));
    await deliver(formPayload("c_consult", { smsOptIn: false }));
    const startsAt = start();
    await deliver(appointmentPayload("appt_1", "c_consult", startsAt));
    const c = await contactBySource("c_consult");
    const a7 = (await messagesFor(c.id))
      .filter((m) => m.automationId === "A7")
      .sort((a, b) => a.templateKey!.localeCompare(b.templateKey!));
    expect(a7.map((m) => [m.templateKey, m.status])).toEqual([
      ["A7.confirmation.sms", "sent"],
      ["A7.reminder_24h.sms", "queued"],
      ["A7.reminder_2h.sms", "queued"],
    ]);
    expect(a7.find((m) => m.templateKey === "A7.confirmation.sms")!.body).toContain(
      "https://forms.example.test/intake",
    );
    const [lead] = await db().select().from(leads).where(eq(leads.contactId, c.id));
    expect(lead).toMatchObject({ status: "consult_booked" });
    expect(lead!.consultBookedAt).not.toBeNull();
  });

  it("a reschedule cancels the old reminders and confirms the new time", async () => {
    const newStart = new Date(start().getTime() + 86_400_000);
    await deliver({
      ...appointmentPayload("appt_1", "c_consult", newStart, "confirmed", "AppointmentUpdate"),
      webhookId: "wh_resched",
    });
    const c = await contactBySource("c_consult");
    const a7 = (await messagesFor(c.id)).filter((m) => m.automationId === "A7");
    expect(
      a7
        .filter((m) => m.status === "cancelled")
        .map((m) => m.templateKey)
        .sort(),
    ).toEqual(["A7.reminder_24h.sms", "A7.reminder_2h.sms"]);
    expect(a7.filter((m) => m.status === "queued")).toHaveLength(2);
    expect(
      a7.filter((m) => m.templateKey === "A7.confirmation.sms" && m.status === "sent"),
    ).toHaveLength(2);
  });

  it("a no-show sends a rebooking text and schedules a follow-up that a new booking cancels", async () => {
    const c = await contactBySource("c_consult");
    await deliver({
      ...appointmentPayload(
        "appt_1",
        "c_consult",
        new Date(Date.now() - 3_600_000),
        "noshow",
        "AppointmentUpdate",
      ),
      webhookId: "wh_noshow",
    });
    let a7 = (await messagesFor(c.id)).filter((m) => m.automationId === "A7");
    expect(a7.find((m) => m.templateKey === "A7.no_show.sms")?.status).toBe("sent");
    const followup = a7.find((m) => m.templateKey === "A7.no_show_followup.sms")!;
    expect(followup.status).toBe("queued");
    expect(
      a7.filter((m) => m.templateKey?.startsWith("A7.reminder") && m.status === "queued"),
    ).toHaveLength(0);

    // They book again; when the follow-up comes due it is cancelled instead of sent.
    await deliver(appointmentPayload("appt_2", "c_consult", start()));
    await db()
      .update(messages)
      .set({ scheduledFor: new Date() })
      .where(eq(messages.id, followup.id));
    expect(await sendMessageJob(followup.id)).toBe("skipped");
    a7 = (await messagesFor(c.id)).filter((m) => m.id === followup.id);
    expect(a7[0]).toMatchObject({ status: "cancelled", suppressedReason: "rebooked" });
  });

  it("a cancelled consult cancels its pending reminders", async () => {
    const c = await contactBySource("c_consult");
    const startsAt = (
      await db().select().from(appointments).where(eq(appointments.sourceId, "appt_2"))
    )[0]!.startsAt;
    await deliver({
      ...appointmentPayload("appt_2", "c_consult", startsAt, "cancelled", "AppointmentUpdate"),
      webhookId: "wh_cancel",
    });
    const pending = (await messagesFor(c.id)).filter(
      (m) =>
        m.automationId === "A7" &&
        m.status === "queued" &&
        (m.context as { appointmentId?: string }).appointmentId,
    );
    const appt2 = (
      await db().select().from(appointments).where(eq(appointments.sourceId, "appt_2"))
    )[0]!;
    expect(
      pending.filter((m) => (m.context as { appointmentId: string }).appointmentId === appt2.id),
    ).toHaveLength(0);
  });

  it("a showed consult moves the lead to consult held; a won opportunity to retained", async () => {
    ghl.contacts.set("c_won", ghlContactPayload("c_won", { timezone: daytimeZone() }));
    await deliver(formPayload("c_won", { smsOptIn: false }));
    await deliver(opportunityPayload("opp_won", "c_won"));
    await deliver(
      appointmentPayload("appt_won", "c_won", new Date(Date.now() - 86_400_000), "showed"),
    );
    let [lead] = await db()
      .select()
      .from(leads)
      .where(eq(leads.contactId, (await contactBySource("c_won")).id));
    expect(lead).toMatchObject({ status: "consult_held" });
    await deliver({
      ...opportunityPayload("opp_won", "c_won", "won", "OpportunityStatusUpdate"),
      webhookId: "wh_won",
    });
    [lead] = await db()
      .select()
      .from(leads)
      .where(eq(leads.contactId, (await contactBySource("c_won")).id));
    expect(lead).toMatchObject({ status: "retained" });
    expect(lead!.retainedAt).not.toBeNull();
  });
});

describe("nightly reconciliation", () => {
  it("fills in what webhooks missed, and a second run changes nothing", async () => {
    ghl.contacts.set(
      "c_missed_webhook",
      ghlContactPayload("c_missed_webhook", { timezone: daytimeZone() }),
    );
    ghl.opportunities = [
      {
        id: "opp_recon",
        contactId: "c_missed_webhook",
        name: "Estate planning",
        status: "open",
        pipelineId: "pipe_intake",
        pipelineStageId: "stage_new",
        monetaryValue: 2500,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    ghl.calendars = [{ id: "cal_consults", name: "Consultations" }];
    ghl.events.set("cal_consults", [
      appointmentPayload("appt_recon", "c_missed_webhook", new Date(Date.now() + 5 * 86_400_000))
        .appointment,
    ]);

    const first = await reconcileGhl(ghl.client);
    expect(first.ok).toBe(true);
    expect(first.stats.changes).toBeGreaterThan(0);
    expect(
      await db().select().from(opportunities).where(eq(opportunities.sourceId, "opp_recon")),
    ).toHaveLength(1);
    const [appt] = await db()
      .select()
      .from(appointments)
      .where(eq(appointments.sourceId, "appt_recon"));
    expect(appt?.leadId).not.toBeNull();
    // A7 ran for the appointment the webhook never delivered.
    const reminders = await db()
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.automationId, "A7"),
          sql`${messages.context}->>'appointmentId' = ${appt!.id}`,
        ),
      );
    expect(reminders.length).toBeGreaterThan(0);

    const second = await reconcileGhl(ghl.client);
    expect(second).toMatchObject({ ok: true, stats: { changes: 0 } });
  });

  it("records a failed run when GHL is not connected", async () => {
    const r = await reconcileGhl(null);
    expect(r.ok).toBe(false);
  });
});

describe("sweep", () => {
  it("processes a webhook whose job was lost and sends messages that came due", async () => {
    ghl.contacts.set("c_lost_job", ghlContactPayload("c_lost_job", { timezone: daytimeZone() }));
    const res = await handleGhlWebhook(
      webhookRequest(missedCallPayload("c_lost_job", "call_lost_job")),
    );
    expect(res.status).toBe(200);
    queue.take("ghl.webhook"); // the job is lost
    await db()
      .update(webhookEvents)
      .set({ receivedAt: new Date(Date.now() - 60_000) })
      .where(eq(webhookEvents.status, "pending"));
    const r = await sweep();
    expect(r.webhooks).toBeGreaterThanOrEqual(1);
    const [m] = await messagesFor((await contactBySource("c_lost_job")).id);
    expect(m?.status).toBe("sent");
  });

  it("marks a send interrupted mid-flight as unknown, never resending", async () => {
    ghl.contacts.set("c_stale", ghlContactPayload("c_stale", { timezone: nightZone() }));
    await deliver(missedCallPayload("c_stale"));
    const [m] = await messagesFor((await contactBySource("c_stale")).id);
    await db()
      .update(messages)
      .set({ status: "sending", updatedAt: new Date(Date.now() - 11 * 60_000) })
      .where(eq(messages.id, m!.id));
    const before = ghl.sends().length;
    await sweep();
    const [after] = await messagesFor((await contactBySource("c_stale")).id);
    expect(after?.status).toBe("unknown");
    expect(ghl.sends().length).toBe(before);
    const runs = await db().select().from(automationRuns).where(eq(automationRuns.entityId, m!.id));
    expect(runs.map((r) => r.status)).toContain("failed");
  });
});
