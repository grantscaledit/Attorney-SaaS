import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { approvals, contacts, leads, type ApprovalStatus } from "@/db/schema";
import { assertCan, type Actor } from "@/lib/auth/can";

export async function pendingApprovalCount(actor: Actor): Promise<number> {
  assertCan(actor, "approvals.read");
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(approvals)
    .where(eq(approvals.status, "pending"));
  return r?.n ?? 0;
}

export type ApprovalListItem = Awaited<ReturnType<typeof listApprovals>>[number];

export async function listApprovals(
  actor: Actor,
  status: ApprovalStatus | "decided" = "pending",
  limit = 50,
) {
  assertCan(actor, "approvals.read");
  const where =
    status === "decided"
      ? inArray(approvals.status, ["approved", "rejected"])
      : eq(approvals.status, status);
  return getDb()
    .select({
      id: approvals.id,
      automationId: approvals.automationId,
      kind: approvals.kind,
      status: approvals.status,
      priority: approvals.priority,
      title: approvals.title,
      channel: approvals.channel,
      subject: approvals.subject,
      draftBody: approvals.draftBody,
      finalBody: approvals.finalBody,
      edited: approvals.edited,
      sources: approvals.sources,
      flags: approvals.flags,
      rejectReason: approvals.rejectReason,
      decidedAt: approvals.decidedAt,
      decidedBy: approvals.decidedBy,
      createdAt: approvals.createdAt,
      leadId: approvals.leadId,
      leadAssignedTo: leads.assignedUserId,
      contactName: contacts.fullName,
      contactPhone: contacts.phone,
    })
    .from(approvals)
    .leftJoin(leads, eq(leads.id, approvals.leadId))
    .leftJoin(contacts, eq(contacts.id, approvals.contactId))
    .where(where)
    .orderBy(
      ...(status === "pending"
        ? [sql`${approvals.priority} = 'urgent' desc`, approvals.createdAt]
        : [desc(approvals.decidedAt)]),
    )
    .limit(limit);
}

/** Spec Section 6 metrics: approval rate, edit rate and time in queue, by automation (30 days). */
export async function approvalMetrics(actor: Actor) {
  assertCan(actor, "approvals.read");
  return getDb()
    .select({
      automationId: approvals.automationId,
      decided: sql<number>`count(*) filter (where ${approvals.status} in ('approved','rejected') and ${approvals.decidedBy} is not null)::int`,
      approved: sql<number>`count(*) filter (where ${approvals.status} = 'approved' and ${approvals.decidedBy} is not null)::int`,
      edited: sql<number>`count(*) filter (where ${approvals.edited})::int`,
      rejected: sql<number>`count(*) filter (where ${approvals.status} = 'rejected')::int`,
      autoApproved: sql<number>`count(*) filter (where ${approvals.status} = 'approved' and ${approvals.decidedBy} is null and ${approvals.kind} = 'message')::int`,
      pending: sql<number>`count(*) filter (where ${approvals.status} = 'pending')::int`,
      medianMinutes: sql<
        number | null
      >`percentile_cont(0.5) within group (order by extract(epoch from ${approvals.decidedAt} - ${approvals.createdAt}) / 60) filter (where ${approvals.decidedBy} is not null)`,
    })
    .from(approvals)
    .where(
      and(
        sql`${approvals.createdAt} > now() - interval '30 days'`,
        sql`${approvals.status} <> 'superseded'`,
      ),
    )
    .groupBy(approvals.automationId)
    .orderBy(approvals.automationId);
}
