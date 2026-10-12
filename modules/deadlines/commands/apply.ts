import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "@/db/client";
import {
  deadlineHolidays,
  deadlineRules,
  deadlineTolling,
  deadlines,
  documentExtractions,
  matterEvents,
  matters,
  tasks,
  users,
  type DeadlineRow,
  type MatterEventRow,
  type MatterRow,
} from "@/db/schema";
import type { AuditSpec } from "@/lib/commands/define";
import { eventDef } from "@/practice";
import { computeDue, rulesForEvent } from "../engine";
import { formatDate } from "../date-math";
import { stateOf, type RuleWithRow } from "../rules";

/*
 * C1 inside a command's transaction: turn a matter's trigger event into
 * deadlines using the firm's verified rules. Unverified rules compute
 * nothing; the owner attorney gets a task to verify them instead. When the
 * event came from a document that prints its own date, the printed date is
 * the deadline and the rule's date is recorded beside it as a cross-check.
 */

export async function loadRules(db: DbOrTx): Promise<RuleWithRow[]> {
  const rows = await db.select().from(deadlineRules).orderBy(asc(deadlineRules.key));
  return rows.map(stateOf);
}

export async function loadHolidays(db: DbOrTx): Promise<Set<string>> {
  const rows = await db.select({ d: deadlineHolidays.date }).from(deadlineHolidays);
  return new Set(rows.map((r) => r.d));
}

export async function tollingDaysFor(db: DbOrTx, deadlineId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`coalesce(sum(${deadlineTolling.days}), 0)::int` })
    .from(deadlineTolling)
    .where(and(eq(deadlineTolling.deadlineId, deadlineId), isNull(deadlineTolling.deletedAt)));
  return r?.n ?? 0;
}

/** Active owner attorneys, oldest first. They verify rules and receive escalations. */
export async function ownerAttorneys(db: DbOrTx): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(
      and(eq(users.role, "owner_attorney"), eq(users.status, "active"), isNull(users.deletedAt)),
    )
    .orderBy(asc(users.createdAt));
}

export function ruleDedupe(eventId: string, ruleId: string, occurrence: number): string {
  return `C1:${eventId}:${ruleId}:${occurrence}`;
}

export type ApplyOutcome = {
  computed: number;
  recomputed: number;
  cancelled: number;
  unverified: string[];
  audit: AuditSpec[];
};

type Ctx = {
  holidays: Set<string>;
  rules: RuleWithRow[];
  actorId: string | null;
  /** Dates read from a document no person has confirmed yet. */
  confirmed: boolean;
};

export async function applyContext(tx: Tx, actorId: string | null, confirmed = true): Promise<Ctx> {
  return { holidays: await loadHolidays(tx), rules: await loadRules(tx), actorId, confirmed };
}

/**
 * Bring the deadlines computed from one event in line with the rules as they
 * stand. Idempotent: running it twice changes nothing.
 */
export async function applyEvent(
  tx: Tx,
  m: MatterRow,
  ev: MatterEventRow,
  c: Ctx,
): Promise<ApplyOutcome> {
  const out: ApplyOutcome = { computed: 0, recomputed: 0, cancelled: 0, unverified: [], audit: [] };
  const now = new Date();
  const existing = await tx
    .select()
    .from(deadlines)
    .where(and(eq(deadlines.eventId, ev.id), eq(deadlines.origin, "rule")));

  const cancel = async (d: DeadlineRow, reason: string) => {
    if (d.status !== "open") return;
    await tx
      .update(deadlines)
      .set({ status: "cancelled", updatedAt: now, version: d.version + 1, note: reason })
      .where(eq(deadlines.id, d.id));
    out.cancelled++;
    out.audit.push({
      action: "deadlines.cancelled",
      entityType: "deadline",
      entityId: d.id,
      before: { status: d.status, dueOn: d.dueOn },
      after: { status: "cancelled" },
      metadata: { reason, matterId: m.id },
    });
  };

  if (ev.deletedAt || m.status !== "open") {
    for (const d of existing) await cancel(d, ev.deletedAt ? "event removed" : "matter closed");
    return out;
  }

  const applicable = rulesForEvent(c.rules, m, {
    kind: ev.kind,
    noticeType: ev.noticeType,
    flags: ev.flags,
  });
  const [printed] = ev.documentId
    ? await tx
        .select()
        .from(deadlines)
        .where(
          and(
            eq(deadlines.documentId, ev.documentId),
            eq(deadlines.origin, "document"),
            ne(deadlines.status, "cancelled"),
          ),
        )
    : [];

  const keep = new Set<string>();
  for (const rule of applicable) {
    // A printed date governs; the rule only cross-checks it (spec Section 8).
    if (rule.preferPrinted && printed) {
      const r = computeDue(rule, { triggerOn: ev.occurredOn, holidays: c.holidays });
      if (!r.ok) {
        // A rule the firm switched off is a decision, not a gap: no verification task.
        if (r.reason !== "inactive") out.unverified.push(rule.id);
        continue;
      }
      const crossCheck = {
        ruleId: rule.id,
        ruleLabel: rule.label,
        dueOn: r.dueOn,
        matches: r.dueOn === printed.dueOn,
      };
      const prev = printed.crossCheck;
      if (
        !prev ||
        prev.ruleId !== crossCheck.ruleId ||
        prev.dueOn !== crossCheck.dueOn ||
        prev.matches !== crossCheck.matches
      ) {
        await tx
          .update(deadlines)
          .set({
            crossCheck,
            severity: rule.severity,
            updatedAt: now,
            version: printed.version + 1,
          })
          .where(eq(deadlines.id, printed.id));
        out.audit.push({
          action: "deadlines.cross_checked",
          entityType: "deadline",
          entityId: printed.id,
          after: crossCheck,
          metadata: { matterId: m.id, ruleKey: rule.key },
        });
      }
      if (!crossCheck.matches && printed.status === "open") {
        await tx
          .insert(tasks)
          .values({
            matterId: m.id,
            title: `Check the deadline: the printed date (${formatDate(printed.dueOn)}) differs from the ${rule.label} rule (${formatDate(r.dueOn)})`,
            detail:
              "The printed date is used. Confirm it against the notice and the rule before relying on either.",
            assigneeId: printed.ownerId ?? m.responsibleAttorneyId,
            priority: "urgent",
            automationId: "C1",
            dedupeKey: `C1:mismatch:${printed.id}:${rule.id}:${r.dueOn}:${printed.dueOn}`,
          })
          .onConflictDoNothing();
      }
      continue;
    }

    const first = await computeOccurrence(tx, m, ev, rule, 0, c, out);
    if (first) keep.add(first);
    if (rule.recurring === "annual") {
      // Later occurrences already created by C3 stay while the rule applies.
      for (const d of existing.filter((x) => x.ruleId === rule.id && x.occurrence > 0)) {
        const id = await computeOccurrence(tx, m, ev, rule, d.occurrence, c, out);
        if (id) keep.add(id);
      }
    }
  }

  // Deadlines whose rule no longer applies (the notice number changed) or is no longer verified.
  for (const d of existing) {
    if (keep.has(d.id) || d.status !== "open") continue;
    const stillApplies = applicable.some((r) => r.id === d.ruleId);
    if (!stillApplies) await cancel(d, "rule no longer applies to the event");
  }

  if (out.unverified.length > 0)
    out.audit.push(...(await askToVerify(tx, m, ev, out.unverified, c)));
  return out;
}

/** Compute or recompute one occurrence. Returns the deadline id, or null when the rule refused. */
export async function computeOccurrence(
  tx: Tx,
  m: MatterRow,
  ev: MatterEventRow,
  rule: RuleWithRow,
  occurrence: number,
  c: Ctx,
  out: ApplyOutcome,
): Promise<string | null> {
  const now = new Date();
  const dedupeKey = ruleDedupe(ev.id, rule.id, occurrence);
  const [prev] = await tx.select().from(deadlines).where(eq(deadlines.dedupeKey, dedupeKey));
  const tolling = prev ? await tollingDaysFor(tx, prev.id) : 0;
  const r = computeDue(rule, {
    triggerOn: ev.occurredOn,
    holidays: c.holidays,
    tollingDays: tolling,
    occurrence,
  });
  if (!r.ok) {
    if (r.reason !== "inactive") out.unverified.push(rule.id);
    // The date stays as computed under the earlier verification, flagged for review.
    if (prev && prev.status === "open" && !prev.ruleChanged) {
      await tx
        .update(deadlines)
        .set({ ruleChanged: true, updatedAt: now, version: prev.version + 1 })
        .where(eq(deadlines.id, prev.id));
      out.audit.push({
        action: "deadlines.rule_unverified",
        entityType: "deadline",
        entityId: prev.id,
        metadata: { ruleKey: rule.key, reason: r.reason, matterId: m.id },
      });
    }
    return prev?.id ?? null;
  }
  const hash = rule.verifiedHash!;
  if (!prev) {
    const [row] = await tx
      .insert(deadlines)
      .values({
        matterId: m.id,
        label: rule.label,
        dueOn: r.dueOn,
        origin: "rule",
        ruleId: rule.id,
        ruleVersion: rule.row.version,
        ruleHash: hash,
        eventId: ev.id,
        occurrence,
        computation: r.steps,
        severity: rule.severity,
        ownerId: m.responsibleAttorneyId,
        confirmed: c.confirmed,
        dedupeKey,
        createdBy: c.actorId,
      })
      .returning();
    out.computed++;
    out.audit.push({
      action: "deadlines.computed",
      entityType: "deadline",
      entityId: row!.id,
      after: { dueOn: r.dueOn, ruleKey: rule.key, ruleVersion: rule.row.version, steps: r.steps },
      metadata: { matterId: m.id, eventId: ev.id, automationId: "C1" },
    });
    return row!.id;
  }
  if (prev.status === "cancelled") {
    // The rule applies again (an event restored or corrected): reopen it.
    await tx
      .update(deadlines)
      .set({
        status: "open",
        dueOn: r.dueOn,
        ruleHash: hash,
        ruleVersion: rule.row.version,
        computation: r.steps,
        severity: rule.severity,
        ruleChanged: false,
        confirmed: c.confirmed,
        dueChangedAt: prev.dueOn !== r.dueOn ? now : prev.dueChangedAt,
        version: prev.version + 1,
        updatedAt: now,
      })
      .where(eq(deadlines.id, prev.id));
    out.recomputed++;
    out.audit.push({
      action: "deadlines.recomputed",
      entityType: "deadline",
      entityId: prev.id,
      before: { status: prev.status, dueOn: prev.dueOn },
      after: { status: "open", dueOn: r.dueOn, steps: r.steps },
      metadata: { matterId: m.id, ruleKey: rule.key },
    });
    return prev.id;
  }
  const moved = prev.dueOn !== r.dueOn;
  const changed =
    moved ||
    prev.ruleHash !== hash ||
    prev.ruleChanged ||
    prev.severity !== rule.severity ||
    prev.confirmed !== c.confirmed;
  if (changed && prev.status === "open") {
    await tx
      .update(deadlines)
      .set({
        dueOn: r.dueOn,
        ruleHash: hash,
        ruleVersion: rule.row.version,
        computation: r.steps,
        severity: rule.severity,
        label: rule.label,
        ruleChanged: false,
        confirmed: c.confirmed,
        dueChangedAt: moved ? now : prev.dueChangedAt,
        version: prev.version + 1,
        updatedAt: now,
      })
      .where(eq(deadlines.id, prev.id));
    out.recomputed++;
    out.audit.push({
      action: "deadlines.recomputed",
      entityType: "deadline",
      entityId: prev.id,
      before: { dueOn: prev.dueOn, ruleVersion: prev.ruleVersion },
      after: { dueOn: r.dueOn, ruleVersion: rule.row.version, steps: r.steps },
      metadata: { matterId: m.id, ruleKey: rule.key },
    });
  }
  return prev.id;
}

/** One task per rule and matter: a trigger is waiting on a rule nobody has verified. */
async function askToVerify(
  tx: Tx,
  m: MatterRow,
  ev: MatterEventRow,
  ruleIds: string[],
  c: Ctx,
): Promise<AuditSpec[]> {
  const [owner] = await ownerAttorneys(tx);
  const label = eventDef(m.practiceArea, ev.kind)?.label ?? ev.kind;
  const audit: AuditSpec[] = [];
  for (const id of [...new Set(ruleIds)]) {
    const rule = c.rules.find((r) => r.id === id)!;
    const inserted = await tx
      .insert(tasks)
      .values({
        matterId: m.id,
        title: `Verify the deadline rule "${rule.label}" (Settings > Deadline rules)`,
        detail: `${m.number} has a ${label.toLowerCase()} of ${formatDate(ev.occurredOn)}. No deadline is computed from this rule until it is verified.`,
        assigneeId: owner?.id ?? null,
        priority: "urgent",
        automationId: "C1",
        dedupeKey: `C1:verify:${rule.id}:${m.id}`,
      })
      .onConflictDoNothing()
      .returning({ id: tasks.id });
    if (inserted.length > 0) {
      audit.push({
        action: "deadlines.rule_verification_requested",
        entityType: "deadline_rule",
        entityId: rule.id,
        metadata: { matterId: m.id, eventId: ev.id, ruleKey: rule.key },
      });
    }
  }
  return audit;
}

/** Re-apply every live event that a set of rules (or all rules) could compute from. */
export async function recomputeEvents(
  tx: Tx,
  filter: { triggers?: string[] },
  actorId: string | null,
): Promise<ApplyOutcome> {
  const total: ApplyOutcome = {
    computed: 0,
    recomputed: 0,
    cancelled: 0,
    unverified: [],
    audit: [],
  };
  const c = await applyContext(tx, actorId);
  const rows = await tx
    .select({ ev: matterEvents, m: matters })
    .from(matterEvents)
    .innerJoin(matters, eq(matters.id, matterEvents.matterId))
    .where(
      and(
        isNull(matterEvents.deletedAt),
        eq(matters.status, "open"),
        isNull(matters.deletedAt),
        filter.triggers ? inArray(matterEvents.kind, filter.triggers) : undefined,
      ),
    );
  for (const { ev, m } of rows) {
    const confirmed = await eventConfirmed(tx, ev);
    const o = await applyEvent(tx, m, ev, { ...c, confirmed });
    total.computed += o.computed;
    total.recomputed += o.recomputed;
    total.cancelled += o.cancelled;
    total.unverified.push(...o.unverified);
    total.audit.push(...o.audit);
  }
  return total;
}

/** An event read from a document is confirmed once a person confirmed the extraction. */
export async function eventConfirmed(db: DbOrTx, ev: MatterEventRow): Promise<boolean> {
  if (!ev.documentId) return true;
  const [ex] = await db
    .select({ status: documentExtractions.status })
    .from(documentExtractions)
    .where(eq(documentExtractions.documentId, ev.documentId));
  return ex ? ex.status !== "proposed" : true;
}
