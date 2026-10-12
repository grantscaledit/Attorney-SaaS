import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import {
  approvals,
  conflictChecks,
  contacts,
  engagements,
  firmSettings,
  leads,
  OPEN_LEAD_STATUSES,
  PRACTICE_AREAS,
  users,
} from "@/db/schema";
import type { AuditSpec, Principal } from "@/lib/commands/define";
import { defineCommand } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";
import { requireSystem } from "@/lib/commands/system";
import { env } from "@/lib/env";
import { createApproval } from "@/modules/approvals/commands/create";
import {
  automationEnabled,
  queueAutomatedMessage,
  recordAutomationRun,
} from "@/modules/messaging/commands/outbox";
import type { QueuedMessage } from "@/modules/intake/commands/automations";
import { matterType } from "@/practice";
import { DEFAULT_ENGAGEMENT_TEMPLATE, renderEngagement } from "../engagement";
import { openMatterTx } from "./matters";

/*
 * A9 engagement letter draft and chase (spec Section 7): attorney marks
 * "retain", the letter is drafted from the firm's template, the attorney
 * approves it, it goes out with the e-sign link, and reminders follow on days
 * 2, 4 and 7 until it is signed. Signing opens the matter (B1).
 */

const actorId = (p: Principal): string | null => (p.type === "user" ? p.user.id : null);

/** No engagement before a lawyer has cleared the conflict pre-screen. */
async function assertConflictsCleared(tx: Tx, leadId: string): Promise<AuditSpec[]> {
  const [check] = await tx
    .select({ status: conflictChecks.status })
    .from(conflictChecks)
    .where(eq(conflictChecks.leadId, leadId))
    .orderBy(desc(conflictChecks.createdAt))
    .limit(1);
  if (check?.status === "cleared") return [];
  if (check?.status === "conflict") {
    throw new CommandError(
      "invalid_state",
      "A conflict was recorded for this lead. The firm cannot engage.",
    );
  }
  throw new CommandError(
    "invalid_state",
    check
      ? "Clear the conflict pre-screen on the lead page before engaging."
      : "Run and clear the conflict pre-screen on the lead page before engaging.",
  );
}

export const draftEngagement = defineCommand({
  name: "engagements.draft",
  permission: "leads.retain",
  input: z.object({
    leadId: z.uuid(),
    practiceArea: z.enum(PRACTICE_AREAS),
    matterType: z.string().min(1).max(60),
    feeTerms: z.string().trim().min(10, "Describe the fee terms the client will sign").max(4_000),
    signingUrl: z
      .url()
      .refine((u) => u.startsWith("https://"), "The signing link must start with https://"),
    provider: z.string().min(1).max(30),
    envelopeId: z.string().max(200).nullable(),
  }),
  async run(ctx, input) {
    const tx = ctx.tx;
    const [lead] = await tx.select().from(leads).where(eq(leads.id, input.leadId)).for("update");
    if (!lead) throw new CommandError("not_found", "Lead not found.");
    ctx.authorize("leads.retain", {
      resource: lead.assignedUserId
        ? { kind: "matter", responsibleAttorneyId: lead.assignedUserId, assignedUserIds: [] }
        : undefined,
    });
    if (!(OPEN_LEAD_STATUSES as readonly string[]).includes(lead.status)) {
      throw new CommandError("invalid_state", `This lead is already ${lead.status}.`);
    }
    const t = matterType(input.practiceArea, input.matterType);
    if (!t)
      throw new CommandError("validation", "Some fields need attention.", {
        matterType: ["Choose a matter type for this practice area."],
      });
    await assertConflictsCleared(tx, lead.id);

    const [existing] = await tx
      .select()
      .from(engagements)
      .where(eq(engagements.leadId, lead.id))
      .for("update");
    if (existing && existing.status !== "withdrawn") {
      throw new CommandError(
        "conflict",
        `An engagement letter for this lead is already ${existing.status}.`,
      );
    }
    const [contact] = await tx.select().from(contacts).where(eq(contacts.id, lead.contactId));
    const [firm] = await tx
      .select({ name: firmSettings.displayName, template: firmSettings.engagementTemplate })
      .from(firmSettings)
      .where(eq(firmSettings.id, 1));
    const attorneyId = lead.assignedUserId ?? actorId(ctx.principal);
    const [attorney] = attorneyId
      ? await tx.select({ name: users.name }).from(users).where(eq(users.id, attorneyId))
      : [];
    const letter = renderEngagement(firm?.template?.trim() || DEFAULT_ENGAGEMENT_TEMPLATE, {
      clientName: contact?.fullName ?? contact?.companyName,
      firmName: firm?.name,
      attorneyName: attorney?.name,
      matterDescription: t.label,
      feeTerms: input.feeTerms,
      date: new Intl.DateTimeFormat("en-US", {
        timeZone: env().FIRM_TIMEZONE,
        dateStyle: "long",
      }).format(new Date()),
      signingUrl: input.signingUrl,
    });

    const now = new Date();
    const values = {
      leadId: lead.id,
      contactId: lead.contactId,
      practiceArea: input.practiceArea,
      matterType: t.key,
      feeTerms: input.feeTerms,
      status: "drafted" as const,
      provider: input.provider,
      signingUrl: input.signingUrl,
      envelopeId: input.envelopeId,
      sentAt: null,
      signedAt: null,
      remindersSent: 0,
      createdBy: actorId(ctx.principal),
      updatedAt: now,
    };
    const [e] = existing
      ? await tx.update(engagements).set(values).where(eq(engagements.id, existing.id)).returning()
      : await tx.insert(engagements).values(values).returning();
    const approval = await createApproval(tx, {
      automationId: "A9",
      kind: "letter",
      title: `Engagement letter: ${contact?.fullName ?? "client"} (${t.label})`,
      channel: "email",
      leadId: lead.id,
      contactId: lead.contactId,
      subject: `Engagement letter from ${firm?.name ?? "the firm"}`,
      draftBody: letter.text,
      flags: {
        notes: [
          ...(firm?.template?.trim()
            ? []
            : [
                "Product default template: review the terms for this client. Set the firm's own template in Settings > Engagement letter.",
              ]),
          ...letter.missing.map((f) => `Missing: ${f}`),
          ...(contact?.email ? [] : ["No email address on file: approving will not send."]),
        ],
      },
      sources: { feeTerms: input.feeTerms, signingUrl: input.signingUrl, provider: input.provider },
      dedupeKey: `A9:${e!.id}:${randomUUID()}`,
    });
    await tx
      .update(engagements)
      .set({ approvalId: approval.row.id })
      .where(eq(engagements.id, e!.id));
    return {
      result: { engagementId: e!.id, approvalId: approval.row.id },
      audit: [
        {
          action: "engagements.drafted",
          entityType: "engagement",
          entityId: e!.id,
          after: {
            leadId: lead.id,
            practiceArea: input.practiceArea,
            matterType: t.key,
            provider: input.provider,
          },
        },
        ...approval.audit,
      ],
    };
  },
});

/** Called from approvals.decide: an approved A9 letter is sent; a rejected one goes back to the attorney. */
export async function onEngagementDecision(
  tx: Tx,
  approvalId: string,
  approved: boolean,
): Promise<AuditSpec[]> {
  const [e] = await tx
    .select()
    .from(engagements)
    .where(eq(engagements.approvalId, approvalId))
    .for("update");
  if (!e || e.status !== "drafted") return [];
  const now = new Date();
  await tx
    .update(engagements)
    .set(
      approved
        ? { status: "sent", sentAt: now, updatedAt: now }
        : { status: "withdrawn", updatedAt: now },
    )
    .where(eq(engagements.id, e.id));
  return [
    {
      action: approved ? "engagements.sent" : "engagements.returned",
      entityType: "engagement",
      entityId: e.id,
      before: { status: e.status },
      after: { status: approved ? "sent" : "withdrawn" },
    },
  ];
}

export const markEngagementSigned = defineCommand({
  name: "engagements.mark_signed",
  permission: "leads.retain",
  input: z.object({ engagementId: z.uuid(), responsibleAttorneyId: z.uuid().optional() }),
  async run(ctx, input) {
    const [e] = await ctx.tx
      .select()
      .from(engagements)
      .where(eq(engagements.id, input.engagementId))
      .for("update");
    if (!e) throw new CommandError("not_found", "Engagement not found.");
    if (e.status !== "sent")
      throw new CommandError(
        "invalid_state",
        `This letter is ${e.status}; only a sent letter can be marked signed.`,
      );
    const now = new Date();
    await ctx.tx
      .update(engagements)
      .set({ status: "signed", signedAt: now, updatedAt: now })
      .where(eq(engagements.id, e.id));
    const opened = await openMatterTx(
      ctx,
      {
        leadId: e.leadId,
        practiceArea: e.practiceArea,
        matterType: e.matterType,
        responsibleAttorneyId: input.responsibleAttorneyId ?? null,
      },
      actorId(ctx.principal),
    );
    await recordAutomationRun(ctx.tx, {
      automationId: "A9",
      trigger: "signed",
      status: "succeeded",
      entityType: "engagement",
      entityId: e.id,
      detail: { matterId: opened.matter.id },
    });
    return {
      result: { matterId: opened.matter.id, number: opened.matter.number, portal: opened.portal },
      audit: [
        {
          action: "engagements.signed",
          entityType: "engagement",
          entityId: e.id,
          before: { status: e.status },
          after: { status: "signed", matterId: opened.matter.id },
        },
        ...opened.audit,
      ],
    };
  },
});

export const withdrawEngagement = defineCommand({
  name: "engagements.withdraw",
  permission: "leads.retain",
  input: z.object({ engagementId: z.uuid(), reason: z.string().trim().min(3).max(1_000) }),
  async run(ctx, input) {
    const [e] = await ctx.tx
      .select()
      .from(engagements)
      .where(eq(engagements.id, input.engagementId))
      .for("update");
    if (!e) throw new CommandError("not_found", "Engagement not found.");
    if (e.status === "signed" || e.status === "withdrawn")
      throw new CommandError("invalid_state", `This letter is already ${e.status}.`);
    const now = new Date();
    await ctx.tx
      .update(engagements)
      .set({ status: "withdrawn", updatedAt: now })
      .where(eq(engagements.id, e.id));
    if (e.approvalId) {
      await ctx.tx
        .update(approvals)
        .set({ status: "superseded", updatedAt: now })
        .where(and(eq(approvals.id, e.approvalId), inArray(approvals.status, ["pending"])));
    }
    return {
      result: { withdrawn: true },
      audit: [
        {
          action: "engagements.withdrawn",
          entityType: "engagement",
          entityId: e.id,
          before: { status: e.status },
          after: { status: "withdrawn", reason: input.reason },
        },
      ],
    };
  },
});

export const A9_REMINDER_DAYS = [2, 4, 7] as const;
const DAY = 86_400_000;

/** Daily: reminders for sent, unsigned letters. */
export const sendEngagementReminders = defineCommand({
  name: "engagements.remind",
  permission: "leads.write",
  input: z.object({ engagementId: z.uuid() }),
  async run(ctx, input) {
    requireSystem(ctx);
    const [e] = await ctx.tx
      .select()
      .from(engagements)
      .where(eq(engagements.id, input.engagementId))
      .for("update");
    const audit: AuditSpec[] = [];
    const queued: QueuedMessage[] = [];
    if (
      e?.status === "sent" &&
      e.sentAt &&
      e.signingUrl &&
      (await automationEnabled(ctx.tx, "A9"))
    ) {
      const due = A9_REMINDER_DAYS.filter(
        (d) => Date.now() - e.sentAt!.getTime() >= d * DAY,
      ).length;
      const [contact] = await ctx.tx.select().from(contacts).where(eq(contacts.id, e.contactId));
      for (let step = e.remindersSent; step < due && contact; step++) {
        const day = A9_REMINDER_DAYS[step]!;
        const q = await queueAutomatedMessage(ctx.tx, {
          automationId: "A9",
          templateKey: "A9.reminder.email",
          contact,
          leadId: e.leadId,
          idempotencyKey: `A9:${e.id}:day${day}`,
          dueAt: new Date(),
          // A reminder that falls more than two days behind is skipped, not sent late.
          notAfter: new Date(e.sentAt.getTime() + (day + 2) * DAY),
          values: { signingUrl: e.signingUrl },
          context: { onlyWhileEngagementSent: e.id },
        });
        audit.push(...q.audit);
        queued.push({ messageId: q.messageId, status: q.status, scheduledFor: q.scheduledFor });
      }
      if (due > e.remindersSent) {
        await ctx.tx
          .update(engagements)
          .set({ remindersSent: due, updatedAt: new Date() })
          .where(eq(engagements.id, e.id));
      }
    }
    return {
      result: { messages: queued },
      audit: [
        {
          action: "engagements.reminders_checked",
          entityType: "engagement",
          entityId: input.engagementId,
          metadata: { queued: queued.length },
        },
        ...audit,
      ],
    };
  },
});
