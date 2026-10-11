import { and, eq, ne } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { approvals, type ApprovalKind, type ApprovalRow } from "@/db/schema";
import type { AuditSpec } from "@/lib/commands/define";

export type NewApproval = {
  automationId: string;
  kind: ApprovalKind;
  title: string;
  channel: "sms" | "email" | "chat" | "none";
  leadId?: string | null;
  contactId?: string | null;
  appointmentId?: string | null;
  subject?: string | null;
  draftBody: string;
  sources?: Record<string, unknown>;
  flags?: Record<string, unknown>;
  aiRunId?: string | null;
  priority?: "urgent" | "normal";
  dedupeKey: string;
  /** Pending items for the same lead and automation are superseded by this one (A3 keeps one live draft). */
  supersedePendingForLead?: boolean;
  /**
   * Firm policy approved it (A3 "auto_send_safe" after every guard passed).
   * Recorded as approved with no person, so the queue still shows why it went out.
   */
  autoApproved?: boolean;
};

/**
 * Adds a draft to the approval queue (spec Section 6). Idempotent on
 * `dedupeKey`. Called from inside the command that produced the draft.
 */
export async function createApproval(
  tx: Tx,
  a: NewApproval,
): Promise<{ row: ApprovalRow; created: boolean; audit: AuditSpec[] }> {
  const [existing] = await tx.select().from(approvals).where(eq(approvals.dedupeKey, a.dedupeKey));
  if (existing) return { row: existing, created: false, audit: [] };

  const audit: AuditSpec[] = [];
  if (a.supersedePendingForLead && a.leadId) {
    const old = await tx
      .update(approvals)
      .set({ status: "superseded", updatedAt: new Date() })
      .where(
        and(
          eq(approvals.leadId, a.leadId),
          eq(approvals.automationId, a.automationId),
          eq(approvals.status, "pending"),
          ne(approvals.dedupeKey, a.dedupeKey),
        ),
      )
      .returning({ id: approvals.id });
    for (const o of old) {
      audit.push({ action: "approvals.superseded", entityType: "approval", entityId: o.id });
    }
  }

  const [row] = await tx
    .insert(approvals)
    .values({
      automationId: a.automationId,
      kind: a.kind,
      title: a.title,
      channel: a.channel,
      leadId: a.leadId ?? null,
      contactId: a.contactId ?? null,
      appointmentId: a.appointmentId ?? null,
      subject: a.subject ?? null,
      draftBody: a.draftBody,
      sources: a.sources ?? null,
      flags: a.flags ?? null,
      aiRunId: a.aiRunId ?? null,
      priority: a.priority ?? "normal",
      dedupeKey: a.dedupeKey,
      ...(a.autoApproved
        ? {
            status: "approved" as const,
            finalBody: a.draftBody,
            finalSubject: a.subject ?? null,
            decidedAt: new Date(),
          }
        : {}),
    })
    .returning();
  if (!row) throw new Error("approval insert returned no row");
  audit.push({
    action: a.autoApproved ? "approvals.auto_approved" : "approvals.created",
    entityType: "approval",
    entityId: row.id,
    after: {
      automationId: row.automationId,
      kind: row.kind,
      channel: row.channel,
      priority: row.priority,
      flags: row.flags,
    },
    metadata: { leadId: row.leadId, aiRunId: row.aiRunId },
  });
  return { row, created: true, audit };
}
