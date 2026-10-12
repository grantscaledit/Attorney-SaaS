import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { aiRuns, approvals, contacts, leads, OPEN_LEAD_STATUSES, referralsOut } from "@/db/schema";
import type { AuditSpec } from "@/lib/commands/define";
import { defineCommand } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";
import { queueApprovedMessage } from "@/modules/messaging/commands/outbox";
import type { QueuedMessage } from "@/modules/intake/commands/automations";

/**
 * Approve (optionally edited) or reject a queued draft (spec Section 6).
 * Rejections need a reason, which is kept for prompt evaluation. Approving a
 * message hands it to the outbox; briefs and escalations are only marked
 * reviewed.
 */
export const decideApproval = defineCommand({
  name: "approvals.decide",
  permission: "approvals.decide",
  input: z.discriminatedUnion("decision", [
    z.object({
      approvalId: z.uuid(),
      decision: z.literal("approve"),
      body: z.string().trim().min(1, "The message cannot be empty").max(10_000).optional(),
      subject: z.string().trim().max(200).optional(),
    }),
    z.object({
      approvalId: z.uuid(),
      decision: z.literal("reject"),
      reason: z
        .string()
        .trim()
        .min(5, "Say briefly what was wrong, so the drafts can be improved")
        .max(1000),
    }),
  ]),
  async run(ctx, input) {
    const [a] = await ctx.tx
      .select()
      .from(approvals)
      .where(eq(approvals.id, input.approvalId))
      .for("update");
    if (!a) throw new CommandError("not_found", "This item no longer exists.");
    if (a.status !== "pending") {
      throw new CommandError("invalid_state", `This item was already ${a.status}.`);
    }
    // Attorneys decide on their own leads and unassigned ones (spec Section 5).
    if (a.leadId) {
      const [lead] = await ctx.tx
        .select({ assigned: leads.assignedUserId })
        .from(leads)
        .where(eq(leads.id, a.leadId));
      ctx.authorize("approvals.decide", {
        resource: lead?.assigned
          ? { kind: "matter", responsibleAttorneyId: lead.assigned, assignedUserIds: [] }
          : undefined,
      });
    }
    const userId = ctx.principal.type === "user" ? ctx.principal.user.id : null;
    const now = new Date();
    const audit: AuditSpec[] = [];
    const queued: QueuedMessage[] = [];

    if (input.decision === "reject") {
      await ctx.tx
        .update(approvals)
        .set({
          status: "rejected",
          rejectReason: input.reason,
          decidedBy: userId,
          decidedAt: now,
          updatedAt: now,
        })
        .where(eq(approvals.id, a.id));
      audit.push({
        action: "approvals.rejected",
        entityType: "approval",
        entityId: a.id,
        after: { automationId: a.automationId, kind: a.kind, reason: input.reason },
      });
    } else {
      const body = input.body ?? a.draftBody;
      const subject = input.subject ?? a.subject;
      const edited = body !== a.draftBody || (subject ?? null) !== (a.subject ?? null);
      let messageId: string | null = null;
      if (a.channel !== "none" && a.contactId) {
        const [contact] = await ctx.tx.select().from(contacts).where(eq(contacts.id, a.contactId));
        if (!contact)
          throw new CommandError("not_found", "The contact for this message no longer exists.");
        const q = await queueApprovedMessage(ctx.tx, {
          approvalId: a.id,
          automationId: a.automationId,
          channel: a.channel,
          contact,
          leadId: a.leadId,
          subject,
          body,
        });
        messageId = q.messageId;
        queued.push({ messageId: q.messageId, status: q.status, scheduledFor: q.scheduledFor });
        audit.push(...q.audit);
        if (a.kind === "referral") {
          await ctx.tx
            .update(referralsOut)
            .set({ sentAt: now, updatedAt: now })
            .where(eq(referralsOut.approvalId, a.id));
        }
      }
      // A sent non-engagement letter closes a lead that went cold (A11); declined leads are already closed.
      if (a.automationId === "A11" && a.leadId) {
        const closed = await ctx.tx
          .update(leads)
          .set({ status: "lost", closedAt: now, updatedAt: now })
          .where(and(eq(leads.id, a.leadId), inArray(leads.status, [...OPEN_LEAD_STATUSES])))
          .returning({ id: leads.id });
        if (closed.length) {
          audit.push({
            action: "leads.closed",
            entityType: "lead",
            entityId: a.leadId,
            after: { status: "lost", reason: "non_engagement_letter" },
          });
        }
      }
      await ctx.tx
        .update(approvals)
        .set({
          status: "approved",
          finalBody: body,
          finalSubject: subject,
          edited,
          messageId,
          decidedBy: userId,
          decidedAt: now,
          updatedAt: now,
        })
        .where(eq(approvals.id, a.id));
      audit.unshift({
        action: edited ? "approvals.approved_with_edits" : "approvals.approved",
        entityType: "approval",
        entityId: a.id,
        before: edited ? { subject: a.subject, body: a.draftBody } : undefined,
        after: {
          automationId: a.automationId,
          kind: a.kind,
          edited,
          ...(edited ? { subject, body } : {}),
        },
      });
    }

    if (a.aiRunId) {
      const outcome =
        input.decision === "reject"
          ? "rejected"
          : input.body && input.body !== a.draftBody
            ? "edited"
            : "approved";
      await ctx.tx
        .update(aiRuns)
        .set({ reviewedBy: userId, reviewOutcome: outcome, reviewedAt: now, updatedAt: now })
        .where(eq(aiRuns.id, a.aiRunId));
    }
    const [first, ...rest] = audit;
    if (!first) throw new Error("decision produced no audit entry");
    return { result: { approvalId: a.id, messages: queued }, audit: [first, ...rest] };
  },
});
