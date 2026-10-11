import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  aiRuns,
  approvals,
  automationRuns,
  conflictChecks,
  contacts,
  intakeRecords,
  leads,
  messages,
  referralsOut,
} from "@/db/schema";
import { aiCall } from "@/lib/ai/call";
import type { SessionUser } from "@/lib/commands/define";
import { pendingA3, runA3 } from "@/jobs/automations/A3";
import { processWebhookJob } from "@/jobs/ghl/process-webhook";
import { handleGhlWebhook } from "@/modules/ghl/ingest";
import { a3Output } from "@/modules/intake/a3-prompt";
import { updateAiSettings } from "@/modules/firm/commands/ai-settings";
import { saveReferralPartner } from "@/modules/intake/commands/followups";
import { updateIntakeProfile } from "@/modules/users/commands/intake-profile";
import { a3Reply, installScriptedModel, removeModel, seedInbound, seedLead } from "./ai-kit";
import {
  configureGhlEnv,
  daytimeZone,
  FakeGhl,
  ghlContactPayload,
  prepareMessaging,
  RecordingQueue,
  TEST_LOCATION,
  webhookRequest,
} from "./ghl-kit";
import { asUser, provisionTestFirm, run, withFreshDatabase } from "./helpers";

/*
 * Phase 2 acceptance: "Advice-seeking prompts are blocked and escalated", and
 * the A3 rules around them: nothing substantive reaches the prospect without
 * the approval queue (rule 4), drafts that fail the guard or the classifier
 * are blocked (rule 5), and identifiers never reach the model (rule 6).
 */

configureGhlEnv();
const { db } = withFreshDatabase();
let owner: SessionUser;
const ghl = new FakeGhl();
const queue = new RecordingQueue().install();

const TAX_COMPLETE = [
  { questionId: "agency", value: "IRS" },
  { questionId: "notice_type", value: "CP2000" },
  { questionId: "notice_date", value: "September 30, 2026" },
  { questionId: "respond_by", value: "November 29, 2026" },
  { questionId: "tax_years", value: "2024" },
  { questionId: "taxpayer_type", value: "individual" },
  { questionId: "unfiled_returns", value: "no" },
  { questionId: "levy_or_lien", value: "no" },
];

async function approvalsFor(leadId: string) {
  return db()
    .select()
    .from(approvals)
    .where(eq(approvals.leadId, leadId))
    .orderBy(approvals.createdAt);
}
async function outbound(contactId: string) {
  return db()
    .select()
    .from(messages)
    .where(and(eq(messages.contactId, contactId), eq(messages.direction, "outbound")));
}
async function record(leadId: string) {
  const [r] = await db().select().from(intakeRecords).where(eq(intakeRecords.leadId, leadId));
  return r;
}
async function setMode(a3Mode: "review_all" | "auto_send_safe") {
  await run(updateAiSettings, asUser(owner), {
    a3Mode,
    feeTable: [{ service: "Initial consultation", fee: "$150" }],
  });
}

beforeAll(async () => {
  ({ owner } = await provisionTestFirm());
  await prepareMessaging(owner);
  ghl.install();
});
afterEach(async () => {
  removeModel();
  await setMode("review_all");
});

describe("lib/ai/call.ts", () => {
  it("masks identifiers before the model sees them and records the run", async () => {
    const model = installScriptedModel({ reply: () => ({ output: a3Reply() }) });
    const r = await aiCall({
      purpose: "test",
      promptVersion: "t1",
      tier: "standard",
      system: "You are a test.",
      messages: [
        {
          role: "user",
          content: "My SSN is 123-45-6789 and card 4111 1111 1111 1111, born 01/02/1980",
        },
      ],
      schema: a3Output,
    });
    expect(r.ok).toBe(true);
    const sent = JSON.stringify(model.requests);
    expect(sent).not.toMatch(/123-45-6789|4111 1111|1980/);
    expect(sent).toContain("[SSN ending 6789]");
    const [row] = await db().select().from(aiRuns).where(eq(aiRuns.id, r.runId));
    expect(row).toMatchObject({ status: "succeeded", purpose: "test", promptVersion: "t1" });
    expect(row!.promptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.maskedCounts).toMatchObject({ ssn: 1, card: 1, dob: 1 });
  });

  it("records refusals and invalid output as failed runs", async () => {
    installScriptedModel({ reply: () => ({ refuse: true }) });
    const refused = await aiCall({
      purpose: "t",
      promptVersion: "t",
      tier: "fast",
      system: "s",
      messages: [{ role: "user", content: "x" }],
      schema: a3Output,
    });
    expect(refused).toMatchObject({ ok: false, reason: "refused" });
    installScriptedModel({ reply: () => ({ output: { reply: "" } }) });
    const invalid = await aiCall({
      purpose: "t",
      promptVersion: "t",
      tier: "fast",
      system: "s",
      messages: [{ role: "user", content: "x" }],
      schema: a3Output,
    });
    expect(invalid).toMatchObject({ ok: false, reason: "invalid_output" });
    removeModel();
    const none = await aiCall({
      purpose: "t",
      promptVersion: "t",
      tier: "fast",
      system: "s",
      messages: [{ role: "user", content: "x" }],
      schema: a3Output,
    });
    expect(none).toMatchObject({ ok: false, reason: "not_configured" });
    const statuses = await db()
      .select({ s: aiRuns.status })
      .from(aiRuns)
      .where(eq(aiRuns.purpose, "t"));
    expect(statuses.map((x) => x.s).sort()).toEqual([
      "invalid_output",
      "not_configured",
      "refused",
    ]);
  });
});

describe("A3 intake assistant", () => {
  it("blocks and escalates an advice-seeking message without calling the model", async () => {
    const model = installScriptedModel({});
    const l = await seedLead({
      inbound: "Should I just ignore the IRS letter? Do I have to pay it?",
    });
    await runA3(l.leadId, l.messageId!);
    expect(model.requests).toHaveLength(0);
    const [a] = await approvalsFor(l.leadId);
    expect(a).toMatchObject({ kind: "escalation", status: "pending", channel: "none" });
    expect(a!.title).toContain("Asked for legal advice");
    expect((await record(l.leadId))!.handedOffAt).not.toBeNull();
    // The person gets only the pre-approved hand-off text.
    const out = await outbound(l.contactId);
    expect(out.map((m) => m.templateKey)).toEqual(["A3.handoff.sms"]);
    expect(out[0]!.status).toBe("sent");
    // Later messages do not restart the assistant.
    const next = await seedInbound(l.contactId, l.leadId, "Hello?");
    await runA3(l.leadId, next);
    expect(model.requests).toHaveLength(0);
  });

  it("escalates urgent situations, scores the lead urgent and pages the attorney", async () => {
    // The owner's alert phone is a GHL contact.
    const [staff] = await db()
      .insert(contacts)
      .values({
        sourceId: "ghl_owner_phone",
        fullName: "Olivia Owner",
        phone: "+12145550111",
        timezone: daytimeZone(),
      })
      .returning();
    await run(updateIntakeProfile, asUser(owner), {
      userId: owner.id,
      practiceAreas: ["tax"],
      ghlContactId: staff!.sourceId,
    });
    installScriptedModel({});
    const l = await seedLead({
      inbound: "The IRS sent a levy notice and they are garnishing my wages",
    });
    await runA3(l.leadId, l.messageId!);
    const [a] = await approvalsFor(l.leadId);
    expect(a).toMatchObject({ kind: "escalation", priority: "urgent" });
    const r = await record(l.leadId);
    expect(r!.urgent).toBe(true);
    expect(r!.escalationReasons).toEqual(expect.arrayContaining(["levy", "garnishment"]));
    const [lead] = await db().select().from(leads).where(eq(leads.id, l.leadId));
    expect(lead!.assignedUserId).toBe(owner.id);
    const alerts = await outbound(staff!.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ templateKey: "A5.urgent.sms", status: "sent" });
    // The alert carries no client details.
    expect(alerts[0]!.body).not.toContain(l.contactId);
    expect(alerts[0]!.body).not.toMatch(/Pat|Tester|levy notice/);
  });

  it("queues every reply for review in review_all mode, with the AI disclosure first", async () => {
    installScriptedModel({
      reply: () => ({ output: a3Reply({ answers: [{ questionId: "agency", value: "IRS" }] }) }),
    });
    const l = await seedLead({ inbound: "I got a letter about my taxes" });
    await runA3(l.leadId, l.messageId!);
    const [a] = await approvalsFor(l.leadId);
    expect(a).toMatchObject({ kind: "message", status: "pending", channel: "sms" });
    expect(a!.draftBody).toMatch(/^This firm uses an AI assistant/);
    expect(a!.draftBody).toContain("Which agency sent the notice?");
    expect(await outbound(l.contactId)).toHaveLength(0);
    expect((await record(l.leadId))!.answers).toEqual({ agency: "IRS" });
  });

  it("sends a safe question automatically in auto_send_safe mode, through the outbox", async () => {
    await setMode("auto_send_safe");
    installScriptedModel({});
    const l = await seedLead({ inbound: "I got a letter about my taxes" });
    await runA3(l.leadId, l.messageId!);
    const [a] = await approvalsFor(l.leadId);
    expect(a).toMatchObject({ status: "approved", decidedBy: null });
    const out = await outbound(l.contactId);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ approvalId: a!.id, status: "sent", automationId: "A3" });
    expect(ghl.sends().at(-1)!.body).toMatchObject({ type: "SMS", message: a!.draftBody });
  });

  it("blocks a draft that gives advice even in auto mode", async () => {
    await setMode("auto_send_safe");
    installScriptedModel({
      reply: () => ({
        output: a3Reply({
          reply: "You should not pay that yet; you will likely win on appeal.",
          replyType: "acknowledge",
        }),
      }),
    });
    const l = await seedLead({ inbound: "I got a CP2000" });
    await runA3(l.leadId, l.messageId!);
    const list = await approvalsFor(l.leadId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "escalation", status: "pending" });
    expect(list[0]!.draftBody).toContain("not sent");
    expect((list[0]!.flags as { findings: string[] }).findings).toEqual(
      expect.arrayContaining(["advice"]),
    );
    // Only the hand-off template reached the person.
    expect((await outbound(l.contactId)).map((m) => m.templateKey)).toEqual(["A3.handoff.sms"]);
  });

  it("blocks a draft the classifier flags, and treats a failed classifier as not safe", async () => {
    await setMode("auto_send_safe");
    installScriptedModel({
      classify: () => ({
        output: {
          givesAdvice: false,
          predictsOutcome: false,
          quotesFee: false,
          claimsRepresentation: true,
          describesTheirLegalSituation: false,
        },
      }),
    });
    const flagged = await seedLead({ inbound: "Can you take my case?" });
    await runA3(flagged.leadId, flagged.messageId!);
    expect((await approvalsFor(flagged.leadId))[0]).toMatchObject({ kind: "escalation" });

    installScriptedModel({ classify: () => ({ throw: "classifier down" }) });
    const unknown = await seedLead({ inbound: "I got a letter about my taxes" });
    await runA3(unknown.leadId, unknown.messageId!);
    const [a] = await approvalsFor(unknown.leadId);
    // Not blocked, but not sent automatically either.
    expect(a).toMatchObject({ kind: "message", status: "pending" });
    expect(await outbound(unknown.contactId)).toHaveLength(0);
  });

  it("completes the intake record, then scores (A5) and runs the conflict pre-screen (A6)", async () => {
    installScriptedModel({
      reply: () => ({
        output: a3Reply({
          answers: TAX_COMPLETE,
          replyType: "offer_times",
          reply: "Thank you. Would Tuesday at 10am work for a consultation?",
        }),
      }),
    });
    const l = await seedLead({
      inbound: "IRS CP2000 for 2024, dated Sept 30, respond by Nov 29. Just me, all returns filed.",
    });
    await runA3(l.leadId, l.messageId!);
    const r = await record(l.leadId);
    expect(r).toMatchObject({ complete: true, practiceArea: "tax", missing: [] });
    expect(r!.score).toBeGreaterThan(0);
    const checks = await db()
      .select()
      .from(conflictChecks)
      .where(eq(conflictChecks.leadId, l.leadId));
    expect(checks).toHaveLength(1);
    expect(checks[0]!.status).toBe("awaiting_review");
  });

  it("offers real free slots from the consult calendar", async () => {
    await run(updateAiSettings, asUser(owner), {
      a3Mode: "review_all",
      consultCalendarId: "cal_consult",
      feeTable: [],
    });
    const soon = new Date(Date.now() + 2 * 86_400_000);
    ghl.freeSlots.set("cal_consult", [soon.toISOString().replace("Z", "+00:00")]);
    const model = installScriptedModel({});
    const l = await seedLead({ inbound: "I need to book a time about my tax notice" });
    await runA3(l.leadId, l.messageId!);
    expect(model.requests[0]!.system).toContain("Consultation times you may offer");
    expect(ghl.calls.some((c) => c.path === "/calendars/cal_consult/free-slots")).toBe(true);
  });

  it("drafts a referral to a matching partner when the enquiry is out of scope (A12)", async () => {
    await run(saveReferralPartner, asUser(owner), {
      name: "Fran Family",
      organization: "Family Law Group",
      handles: "family law, divorce, custody",
      phone: "(214) 555-0123",
    });
    await run(saveReferralPartner, asUser(owner), {
      name: "Cris Defense",
      handles: "criminal defense, DWI",
    });
    installScriptedModel({
      reply: () => ({
        output: a3Reply({
          practiceArea: "other",
          outOfScopeTopic: "divorce and child custody",
          replyType: "acknowledge",
          reply: "Thank you. Someone from the firm will follow up.",
        }),
      }),
    });
    const l = await seedLead({ inbound: "I need help with my divorce" });
    await runA3(l.leadId, l.messageId!);
    const list = await approvalsFor(l.leadId);
    const referral = list.find((a) => a.kind === "referral");
    expect(referral).toBeDefined();
    expect(referral!.title).toContain("Fran Family");
    expect(referral!.draftBody).toContain("(214) 555-0123");
    expect(referral!.draftBody).toContain("does not represent you");
    const [out] = await db().select().from(referralsOut).where(eq(referralsOut.leadId, l.leadId));
    expect(out).toMatchObject({ approvalId: referral!.id, sentAt: null });
    expect((await record(l.leadId))!.outOfScope).toBe(true);
  });

  it("is idempotent: a replayed job changes nothing and calls no model", async () => {
    const model = installScriptedModel({});
    const l = await seedLead({ inbound: "I got a letter about my taxes" });
    await runA3(l.leadId, l.messageId!);
    await runA3(l.leadId, l.messageId!);
    expect(model.requests.filter((r) => !r.system.startsWith("You review"))).toHaveLength(1);
    expect(await approvalsFor(l.leadId)).toHaveLength(1);
    expect((await record(l.leadId))!.aiTurns).toBe(1);
  });

  it("without a model, records a skip and leaves the conversation to staff", async () => {
    removeModel();
    const l = await seedLead({ inbound: "I got a letter about my taxes" });
    await runA3(l.leadId, l.messageId!);
    expect(await approvalsFor(l.leadId)).toHaveLength(0);
    const [r] = await db()
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.entityId, l.messageId!));
    expect(r).toMatchObject({
      automationId: "A3",
      status: "skipped",
      detail: { reason: "ai_not_configured" },
    });
  });

  it("answers only the newest of several quick messages", async () => {
    const model = installScriptedModel({});
    const l = await seedLead({ inbound: "Hi" });
    const second = await seedInbound(
      l.contactId,
      l.leadId,
      "I got a tax notice",
      "sms",
      new Date(Date.now() + 1000),
    );
    await runA3(l.leadId, l.messageId!);
    expect(model.requests).toHaveLength(0);
    await runA3(l.leadId, second);
    const transcript = model.requests[0]!.messages[0]!.content;
    expect(transcript).toContain("Prospect: Hi");
    expect(transcript).toContain("Prospect: I got a tax notice");
  });

  it("an inbound text webhook queues A3 after commit, and the sweep recovers a lost job", async () => {
    installScriptedModel({});
    ghl.contacts.set("c_a3_hook", ghlContactPayload("c_a3_hook", { timezone: daytimeZone() }));
    const res = await handleGhlWebhook(
      webhookRequest({
        type: "InboundMessage",
        locationId: TEST_LOCATION,
        contactId: "c_a3_hook",
        messageType: "SMS",
        direction: "inbound",
        messageId: "sms_a3_hook_1",
        body: "Hi, I got a notice from the IRS. My SSN is 123-45-6789.",
        dateAdded: new Date().toISOString(),
      }),
    );
    expect(res.status).toBe(200);
    for (const job of queue.take("ghl.webhook")) await processWebhookJob(String(job.eventId));
    const jobs = queue.take("automation.A3");
    expect(jobs).toHaveLength(1);
    const { leadId, messageId } = jobs[0] as { leadId: string; messageId: string };
    const [m] = await db().select().from(messages).where(eq(messages.id, messageId));
    expect(m!.body).toContain("[SSN ending 6789]");

    // The job was lost: the sweep finds the message once it is two minutes old.
    expect((await pendingA3(10)).map((p) => p.messageId)).not.toContain(messageId);
    await db()
      .update(messages)
      .set({ createdAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(messages.id, messageId));
    expect((await pendingA3(10)).map((p) => p.messageId)).toContain(messageId);
    await runA3(leadId, messageId);
    expect((await pendingA3(10)).map((p) => p.messageId)).not.toContain(messageId);
    expect(await approvalsFor(leadId)).toHaveLength(1);
  });
});
