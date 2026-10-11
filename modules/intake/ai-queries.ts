import "server-only";
import { and, asc, count, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  aiRuns,
  approvals,
  conflictChecks,
  conflictHits,
  conflictParties,
  intakeRecords,
  referralPartners,
  referralsOut,
  users,
} from "@/db/schema";
import { assertCan, can, type Actor } from "@/lib/auth/can";
import { ESCALATION_LABELS, type EscalationReason } from "@/lib/ai/guard";
import { PRACTICE_MODULES, applicableQuestions, type Answers } from "@/practice";
import { conflictFlagsPending } from "@/modules/metrics/definitions";

/** Phase 2 additions to the lead page: intake record, A5 score, A6 check, drafts, referrals. */
export async function leadIntake(actor: Actor, leadId: string) {
  assertCan(actor, "leads.read");
  const db = getDb();
  const [record] = await db.select().from(intakeRecords).where(eq(intakeRecords.leadId, leadId));
  const area = record?.practiceArea ?? null;
  const answers = (record?.answers ?? {}) as Answers;
  const questions = area
    ? applicableQuestions(PRACTICE_MODULES[area], answers).map((q) => ({
        id: q.id,
        label: q.label,
        required: q.required,
        value: answers[q.id] ?? null,
      }))
    : [];

  const canConflicts = can(actor, "conflicts.read");
  const [check] = canConflicts
    ? await db
        .select()
        .from(conflictChecks)
        .where(eq(conflictChecks.leadId, leadId))
        .orderBy(desc(conflictChecks.createdAt))
        .limit(1)
    : [];
  const hits = check
    ? await db
        .select()
        .from(conflictHits)
        .where(eq(conflictHits.checkId, check.id))
        .orderBy(desc(conflictHits.similarity))
    : [];
  const [reviewer] = check?.reviewedBy
    ? await db.select({ name: users.name }).from(users).where(eq(users.id, check.reviewedBy))
    : [];

  const drafts = can(actor, "approvals.read")
    ? await db
        .select({
          id: approvals.id,
          automationId: approvals.automationId,
          kind: approvals.kind,
          status: approvals.status,
          title: approvals.title,
          createdAt: approvals.createdAt,
        })
        .from(approvals)
        .where(eq(approvals.leadId, leadId))
        .orderBy(desc(approvals.createdAt))
        .limit(20)
    : [];

  const partners = await db
    .select({
      id: referralPartners.id,
      name: referralPartners.name,
      handles: referralPartners.handles,
    })
    .from(referralPartners)
    .where(and(eq(referralPartners.active, true), isNull(referralPartners.deletedAt)))
    .orderBy(asc(referralPartners.name));
  const referred = await db
    .select({
      partner: referralPartners.name,
      sentAt: referralsOut.sentAt,
      createdAt: referralsOut.createdAt,
    })
    .from(referralsOut)
    .innerJoin(referralPartners, eq(referralPartners.id, referralsOut.partnerId))
    .where(eq(referralsOut.leadId, leadId));

  return {
    record: record
      ? {
          practiceArea: area,
          complete: record.complete,
          missing: record.missing,
          outOfScope: record.outOfScope,
          outOfScopeTopic: record.outOfScopeTopic,
          score: record.score,
          breakdown: record.scoreBreakdown as {
            urgency: number;
            value: number;
            fit: number;
            notes: string[];
          } | null,
          urgent: record.urgent,
          aiTurns: record.aiTurns,
          handedOffAt: record.handedOffAt,
          escalations: (record.escalationReasons as EscalationReason[]).map(
            (e) => ESCALATION_LABELS[e] ?? e,
          ),
        }
      : null,
    questions,
    conflict: check
      ? {
          id: check.id,
          status: check.status,
          names: check.names,
          createdAt: check.createdAt,
          reviewedBy: reviewer?.name ?? null,
          reviewedAt: check.reviewedAt,
          reviewNote: check.reviewNote,
          hits: hits.map((h) => ({
            id: h.id,
            queryName: h.queryName,
            matchedName: h.matchedName,
            matchedType: h.matchedType,
            role: h.role,
            similarity: h.similarity,
            reason: h.reason,
          })),
        }
      : null,
    canConflicts,
    drafts,
    partners,
    referred,
  };
}
export type LeadIntake = Awaited<ReturnType<typeof leadIntake>>;

/** Conflict checks waiting for a lawyer (Intake panel metric; defined in modules/metrics). */
export async function pendingConflicts(actor: Actor) {
  assertCan(actor, "conflicts.read");
  return conflictFlagsPending(getDb());
}

/** Names on the conflict list are client information: staff who work leads only, not billing. */
export async function listConflictParties(actor: Actor) {
  assertCan(actor, "conflicts.read");
  return getDb()
    .select()
    .from(conflictParties)
    .where(isNull(conflictParties.deletedAt))
    .orderBy(asc(conflictParties.name));
}

export async function listReferralPartners(actor: Actor) {
  assertCan(actor, "firm.settings.read");
  const db = getDb();
  const rows = await db
    .select()
    .from(referralPartners)
    .where(isNull(referralPartners.deletedAt))
    .orderBy(asc(referralPartners.name));
  const sent = await db
    .select({ partnerId: referralsOut.partnerId, n: count() })
    .from(referralsOut)
    .groupBy(referralsOut.partnerId);
  const by = new Map(sent.map((s) => [s.partnerId, s.n]));
  return rows.map((r) => ({ ...r, referrals: by.get(r.id) ?? 0 }));
}

/** Lawyers and their A5 routing profile (settings). */
export async function attorneyRouting(actor: Actor) {
  assertCan(actor, "users.read");
  return getDb()
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      practiceAreas: users.practiceAreas,
      ghlContactId: users.ghlContactId,
    })
    .from(users)
    .where(
      and(
        inArray(users.role, ["owner_attorney", "attorney"]),
        eq(users.status, "active"),
        isNull(users.deletedAt),
      ),
    )
    .orderBy(asc(users.name));
}

/** Model calls in the last 30 days, by purpose (rule 3: every call is logged with its cost). */
export async function aiUsage(actor: Actor) {
  assertCan(actor, "firm.settings.read");
  return getDb()
    .select({
      purpose: aiRuns.purpose,
      calls: count(),
      failed: sql<number>`count(*) filter (where ${aiRuns.status} <> 'succeeded')::int`,
      costUsd: sql<string>`coalesce(sum(${aiRuns.costUsd}), 0)::text`,
    })
    .from(aiRuns)
    .where(gt(aiRuns.createdAt, sql`now() - interval '30 days'`))
    .groupBy(aiRuns.purpose)
    .orderBy(asc(aiRuns.purpose));
}
