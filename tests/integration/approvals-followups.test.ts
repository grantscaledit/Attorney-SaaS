import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { approvals, leads, messages } from "@/db/schema";
import type { SessionUser } from "@/lib/commands/define";
import { runA8, runIntakeDaily } from "@/jobs/automations/followups";
import { sendMessageJob } from "@/jobs/messaging/send";
import { decideApproval } from "@/modules/approvals/commands/decide";
import { declineLead, DEADLINE_NOTICE } from "@/modules/intake/commands/followups";
import { inviteUser } from "@/modules/users/commands/invite";
import {
  installScriptedModel,
  removeModel,
  seedAppointment,
  seedInbound,
  seedLead,
  seedPendingApproval,
} from "./ai-kit";
import { configureGhlEnv, FakeGhl, prepareMessaging, RecordingQueue } from "./ghl-kit";
import { asUser, provisionTestFirm, run, withFreshDatabase } from "./helpers";

configureGhlEnv();
const { db } = withFreshDatabase();
let owner: SessionUser;
let attorney: SessionUser;
const ghl = new FakeGhl();
new RecordingQueue().install();
const DAY = 86_400_000;

async function approvalsFor(leadId: string) {
  return db().select().from(approvals).where(eq(approvals.leadId, leadId));
}

beforeAll(async () => {
  process.env.FIRM_TIER = "firm";
  ({ owner } = await provisionTestFirm());
  await prepareMessaging(owner);
  ghl.install();
  const r = (await run(inviteUser, asUser(owner), {
    name: "Avery Attorney",
    email: "avery@test-firm.example",
    role: "attorney",
  })) as { userId: string };
  attorney = {
    id: r.userId,
    email: "avery@test-firm.example",
    name: "Avery Attorney",
    role: "attorney",
    status: "active",
  };
});
afterEach(() => removeModel());

describe("approval queue", () => {
  it("approving a message sends the approved text through the outbox", async () => {
    const l = await seedLead();
    const id = await seedPendingApproval(l.leadId, l.contactId);
    const r = (await run(decideApproval, asUser(owner), {
      approvalId: id,
      decision: "approve",
      body: "We can meet Tuesday at 10am or Wednesday at 2pm. Which works?",
    })) as { messages: { messageId: string }[] };
    await sendMessageJob(r.messages[0]!.messageId);
    const [m] = await db().select().from(messages).where(eq(messages.id, r.messages[0]!.messageId));
    expect(m).toMatchObject({
      status: "sent",
      approvalId: id,
      body: "We can meet Tuesday at 10am or Wednesday at 2pm. Which works?",
    });
    const [a] = await db().select().from(approvals).where(eq(approvals.id, id));
    expect(a).toMatchObject({
      status: "approved",
      edited: true,
      decidedBy: owner.id,
      messageId: m!.id,
    });
  });

  it("a rejection needs a reason and sends nothing", async () => {
    const l = await seedLead();
    const id = await seedPendingApproval(l.leadId, l.contactId);
    await expect(
      run(decideApproval, asUser(owner), { approvalId: id, decision: "reject", reason: "no" }),
    ).rejects.toMatchObject({ code: "validation" });
    await run(decideApproval, asUser(owner), {
      approvalId: id,
      decision: "reject",
      reason: "Tone is too casual",
    });
    const out = await db()
      .select()
      .from(messages)
      .where(and(eq(messages.contactId, l.contactId), eq(messages.direction, "outbound")));
    expect(out).toHaveLength(0);
    await expect(
      run(decideApproval, asUser(owner), { approvalId: id, decision: "approve" }),
    ).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("an attorney decides only on their own or unassigned leads", async () => {
    const mine = await seedLead({ assignedUserId: attorney.id });
    const theirs = await seedLead({ assignedUserId: owner.id });
    const a1 = await seedPendingApproval(mine.leadId, mine.contactId);
    const a2 = await seedPendingApproval(theirs.leadId, theirs.contactId);
    await run(decideApproval, asUser(attorney), {
      approvalId: a1,
      decision: "reject",
      reason: "Not needed now",
    });
    await expect(
      run(decideApproval, asUser(attorney), {
        approvalId: a2,
        decision: "reject",
        reason: "Not needed now",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("a message whose approval is withdrawn before sending is suppressed", async () => {
    const l = await seedLead();
    const id = await seedPendingApproval(l.leadId, l.contactId);
    const r = (await run(decideApproval, asUser(owner), {
      approvalId: id,
      decision: "approve",
    })) as { messages: { messageId: string }[] };
    await db().update(approvals).set({ status: "superseded" }).where(eq(approvals.id, id));
    await sendMessageJob(r.messages[0]!.messageId);
    const [m] = await db().select().from(messages).where(eq(messages.id, r.messages[0]!.messageId));
    expect(m).toMatchObject({ status: "suppressed", suppressedReason: "approval_withdrawn" });
  });
});

describe("A8 pre-consult brief", () => {
  it("drafts one brief per consult within 12 hours, with the deadline notice", async () => {
    installScriptedModel({});
    const l = await seedLead({
      status: "consult_booked",
      practiceArea: "tax",
      answers: { agency: "IRS", respond_by: "November 29, 2026", amount: "$12,400" },
    });
    const soon = await seedAppointment(l.leadId, l.contactId, new Date(Date.now() + 6 * 3600_000));
    const later = await seedLead({ status: "consult_booked" });
    await seedAppointment(later.leadId, later.contactId, new Date(Date.now() + 30 * 3600_000));
    await runA8();
    await runA8();
    const briefs = await db().select().from(approvals).where(eq(approvals.kind, "brief"));
    const mine = briefs.filter((b) => b.appointmentId === soon);
    expect(mine).toHaveLength(1);
    expect(briefs.some((b) => b.leadId === later.leadId)).toBe(false);
    const body = mine[0]!.draftBody;
    expect(body).toContain("Respond-by date: November 29, 2026");
    expect(body).toContain("Approximate amount: $12,400");
    expect(body).toContain(DEADLINE_NOTICE);
    expect(body).toContain("Do you have a copy of the notice?");
    expect(mine[0]!.channel).toBe("none");
  });

  it("still drafts a brief from records when no model is configured", async () => {
    const l = await seedLead({
      status: "consult_booked",
      practiceArea: "estate",
      answers: { matter: "planning" },
    });
    const appt = await seedAppointment(l.leadId, l.contactId, new Date(Date.now() + 3 * 3600_000));
    await runA8();
    const [b] = await db().select().from(approvals).where(eq(approvals.appointmentId, appt));
    expect(b!.draftBody).toContain("AI assistant is not configured");
    expect(b!.draftBody).toContain("Planning or probate: planning");
  });
});

describe("A10 nurture and A11 non-engagement", () => {
  it("enrols a consult not converted after 7 days and stops when the person replies", async () => {
    const l = await seedLead({
      status: "consult_held",
      consultHeldAt: new Date(Date.now() - 20 * DAY),
      inbound: null,
    });
    const fresh = await seedLead({
      status: "consult_held",
      consultHeldAt: new Date(Date.now() - 3 * DAY),
      inbound: null,
    });
    await runIntakeDaily();
    await runIntakeDaily();
    const queued = await db()
      .select()
      .from(messages)
      .where(eq(messages.leadId, l.leadId))
      .orderBy(messages.scheduledFor);
    expect(queued.map((m) => m.templateKey)).toEqual([
      "A10.day30.email",
      "A10.day60.email",
      "A10.day90.email",
    ]);
    expect(
      await db().select().from(messages).where(eq(messages.leadId, fresh.leadId)),
    ).toHaveLength(0);
    expect(queued[0]!.scheduledFor!.getTime()).toBeGreaterThan(Date.now() + 9 * DAY);
    // The person replies before day 30 comes round.
    await seedInbound(
      l.contactId,
      l.leadId,
      "Thanks, I'll call next week",
      "sms",
      new Date(Date.now() + 1000),
    );
    await db()
      .update(messages)
      .set({ scheduledFor: new Date() })
      .where(eq(messages.id, queued[0]!.id));
    await sendMessageJob(queued[0]!.id);
    const [m] = await db().select().from(messages).where(eq(messages.id, queued[0]!.id));
    expect(m).toMatchObject({ status: "suppressed", suppressedReason: "replied" });
  });

  it("stops nurture once the lead is retained", async () => {
    const l = await seedLead({
      status: "consult_held",
      consultHeldAt: new Date(Date.now() - 20 * DAY),
      inbound: null,
    });
    await runIntakeDaily();
    await db().update(leads).set({ status: "retained" }).where(eq(leads.id, l.leadId));
    const [first] = await db()
      .select()
      .from(messages)
      .where(and(eq(messages.leadId, l.leadId), eq(messages.templateKey, "A10.day30.email")));
    await db().update(messages).set({ scheduledFor: new Date() }).where(eq(messages.id, first!.id));
    await sendMessageJob(first!.id);
    const [m] = await db().select().from(messages).where(eq(messages.id, first!.id));
    expect(m).toMatchObject({ status: "suppressed", suppressedReason: "lead_closed" });
  });

  it("declining a lead closes it and drafts a letter that sends only on approval", async () => {
    const l = await seedLead({
      status: "consult_held",
      consultHeldAt: new Date(Date.now() - 2 * DAY),
      first: "Jordan",
    });
    await expect(
      run(declineLead, asUser({ ...owner, role: "paralegal" }), {
        leadId: l.leadId,
        note: "Not a fit",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await run(declineLead, asUser(owner), {
      leadId: l.leadId,
      note: "Conflict with an existing client",
    });
    const [lead] = await db().select().from(leads).where(eq(leads.id, l.leadId));
    expect(lead).toMatchObject({ status: "lost" });
    expect(lead!.declinedAt).not.toBeNull();
    const [letter] = await approvalsFor(l.leadId);
    expect(letter).toMatchObject({
      kind: "letter",
      channel: "email",
      status: "pending",
      automationId: "A11",
    });
    expect(letter!.draftBody).toContain("Dear Jordan");
    expect(letter!.draftBody).toContain("does not represent you");
    expect(
      await db()
        .select()
        .from(messages)
        .where(and(eq(messages.leadId, l.leadId), eq(messages.direction, "outbound"))),
    ).toHaveLength(0);
    const r = (await run(decideApproval, asUser(owner), {
      approvalId: letter!.id,
      decision: "approve",
    })) as { messages: { messageId: string }[] };
    await sendMessageJob(r.messages[0]!.messageId);
    const [m] = await db().select().from(messages).where(eq(messages.id, r.messages[0]!.messageId));
    expect(m).toMatchObject({
      status: "sent",
      channel: "email",
      subject: "Your enquiry with Test Firm",
    });
  });

  it("drafts a letter for a consult gone cold for 45 days, once, and approval closes the lead", async () => {
    const cold = await seedLead({
      status: "consult_held",
      consultHeldAt: new Date(Date.now() - 50 * DAY),
      inbound: null,
    });
    const replied = await seedLead({
      status: "consult_held",
      consultHeldAt: new Date(Date.now() - 50 * DAY),
      inbound: null,
    });
    await seedInbound(
      replied.contactId,
      replied.leadId,
      "Still thinking about it",
      "sms",
      new Date(Date.now() - 10 * DAY),
    );
    await runIntakeDaily();
    await runIntakeDaily();
    const letters = (await approvalsFor(cold.leadId)).filter((a) => a.kind === "letter");
    expect(letters).toHaveLength(1);
    expect(letters[0]!.draftBody).toContain("not heard from you");
    expect((await approvalsFor(replied.leadId)).filter((a) => a.kind === "letter")).toHaveLength(0);
    await run(decideApproval, asUser(owner), { approvalId: letters[0]!.id, decision: "approve" });
    const [lead] = await db().select().from(leads).where(eq(leads.id, cold.leadId));
    expect(lead!.status).toBe("lost");
  });
});
