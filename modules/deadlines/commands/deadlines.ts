import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  deadlineAlerts,
  deadlineTolling,
  deadlines,
  matterEvents,
  paymentPlans,
  users,
  type DeadlineRow,
  type MatterEventRow,
  type MatterRow,
} from "@/db/schema";
import type { AuditSpec, CommandContext, Principal } from "@/lib/commands/define";
import { defineCommand } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";
import { can } from "@/lib/auth/can";
import { maskText } from "@/lib/masking";
import { automationEnabled } from "@/modules/messaging/commands/outbox";
import { firmToday, lockMatter, scopeOf } from "@/modules/matters/scope";
import { eventsFor, SEVERITIES } from "@/practice";
import {
  applyContext,
  applyEvent,
  computeOccurrence,
  eventConfirmed,
  loadRules,
  type ApplyOutcome,
} from "./apply";
import { cancelFuturePayments, topUpPayments } from "./schedule";

/*
 * Deadlines on a matter: trigger events (C1), manual deadlines, completion,
 * owners, alert acknowledgement (C2), tolling and payment plans (C5).
 * Everything checks deadlines.write on the matter's scope.
 */

const actorId = (p: Principal): string | null => (p.type === "user" ? p.user.id : null);

async function matterFor(ctx: CommandContext, matterId: string): Promise<MatterRow> {
  const m = await lockMatter(ctx.tx, matterId);
  ctx.authorize("deadlines.write", { resource: await scopeOf(ctx.tx, m) });
  return m;
}

async function lockDeadline(ctx: CommandContext, id: string) {
  const [d] = await ctx.tx.select().from(deadlines).where(eq(deadlines.id, id));
  if (!d) throw new CommandError("not_found", "Deadline not found.");
  const m = await matterFor(ctx, d.matterId);
  const [locked] = await ctx.tx.select().from(deadlines).where(eq(deadlines.id, id)).for("update");
  return { d: locked!, m };
}

function openOnly(m: MatterRow) {
  if (m.status !== "open") throw new CommandError("invalid_state", "This matter is closed.");
}

function noFuture(date: string, what: string) {
  if (date > firmToday())
    throw new CommandError("validation", `The ${what} cannot be in the future.`, {
      occurredOn: [`The ${what} cannot be in the future.`],
    });
}

async function runC1(ctx: CommandContext, m: MatterRow, ev: MatterEventRow): Promise<ApplyOutcome> {
  if (!(await automationEnabled(ctx.tx, "C1")))
    return { computed: 0, recomputed: 0, cancelled: 0, unverified: [], audit: [] };
  const c = await applyContext(ctx.tx, actorId(ctx.principal), await eventConfirmed(ctx.tx, ev));
  return applyEvent(ctx.tx, m, ev, c);
}

const eventInput = z.object({
  kind: z.string().min(2).max(60),
  occurredOn: z.iso.date(),
  noticeType: z.string().trim().max(40).nullable().default(null),
  flags: z.record(z.string().max(40), z.boolean()).default({}),
  note: z.string().trim().max(1_000).nullable().default(null),
});

function checkEvent(m: MatterRow, input: z.output<typeof eventInput>) {
  const def = eventsFor(m.practiceArea, m.matterType).find((e) => e.key === input.kind);
  if (!def)
    throw new CommandError("validation", "That event does not apply to this type of matter.");
  const allowed = new Set((def.flags ?? []).map((f) => f.key));
  for (const k of Object.keys(input.flags))
    if (!allowed.has(k)) throw new CommandError("validation", `Unknown flag ${k}.`);
  noFuture(input.occurredOn, def.label.toLowerCase());
  return {
    noticeType: def.asksNoticeType ? input.noticeType || null : null,
    flags: input.flags,
    note: input.note ? maskText(input.note).text : null,
  };
}

/** C1: record a trigger event; verified rules turn it into deadlines. */
export const recordEvent = defineCommand({
  name: "deadlines.record_event",
  permission: "deadlines.write",
  input: eventInput.extend({ matterId: z.uuid() }),
  async run(ctx, input) {
    const m = await matterFor(ctx, input.matterId);
    openOnly(m);
    const v = checkEvent(m, input);
    const [ev] = await ctx.tx
      .insert(matterEvents)
      .values({
        matterId: m.id,
        kind: input.kind,
        occurredOn: input.occurredOn,
        ...v,
        createdBy: actorId(ctx.principal),
      })
      .returning();
    const out = await runC1(ctx, m, ev!);
    return {
      result: { eventId: ev!.id, computed: out.computed, unverified: out.unverified.length },
      audit: [
        {
          action: "deadlines.event_recorded",
          entityType: "matter_event",
          entityId: ev!.id,
          after: {
            kind: ev!.kind,
            occurredOn: ev!.occurredOn,
            noticeType: ev!.noticeType,
            flags: ev!.flags,
          },
          metadata: { matterId: m.id },
        },
        ...out.audit,
      ],
    };
  },
});

async function lockEvent(ctx: CommandContext, eventId: string) {
  const [ev] = await ctx.tx
    .select()
    .from(matterEvents)
    .where(and(eq(matterEvents.id, eventId), isNull(matterEvents.deletedAt)));
  if (!ev) throw new CommandError("not_found", "Event not found.");
  const m = await matterFor(ctx, ev.matterId);
  return { ev, m };
}

export const updateEvent = defineCommand({
  name: "deadlines.update_event",
  permission: "deadlines.write",
  input: eventInput.omit({ kind: true }).extend({ eventId: z.uuid() }),
  async run(ctx, input) {
    const { ev, m } = await lockEvent(ctx, input.eventId);
    openOnly(m);
    const v = checkEvent(m, { ...input, kind: ev.kind });
    const [after] = await ctx.tx
      .update(matterEvents)
      .set({ occurredOn: input.occurredOn, ...v, updatedAt: new Date() })
      .where(eq(matterEvents.id, ev.id))
      .returning();
    const out = await runC1(ctx, m, after!);
    return {
      result: { recomputed: out.recomputed, computed: out.computed },
      audit: [
        {
          action: "deadlines.event_updated",
          entityType: "matter_event",
          entityId: ev.id,
          before: { occurredOn: ev.occurredOn, noticeType: ev.noticeType, flags: ev.flags },
          after: {
            occurredOn: after!.occurredOn,
            noticeType: after!.noticeType,
            flags: after!.flags,
          },
          metadata: { matterId: m.id },
        },
        ...out.audit,
      ],
    };
  },
});

/** Removing an event cancels the deadlines computed from it. */
export const removeEvent = defineCommand({
  name: "deadlines.remove_event",
  permission: "deadlines.write",
  input: z.object({ eventId: z.uuid(), reason: z.string().trim().min(3).max(500) }),
  async run(ctx, input) {
    const { ev, m } = await lockEvent(ctx, input.eventId);
    const [after] = await ctx.tx
      .update(matterEvents)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(matterEvents.id, ev.id))
      .returning();
    const c = await applyContext(ctx.tx, actorId(ctx.principal));
    const out = await applyEvent(ctx.tx, m, after!, c);
    return {
      result: { cancelled: out.cancelled },
      audit: [
        {
          action: "deadlines.event_removed",
          entityType: "matter_event",
          entityId: ev.id,
          before: { kind: ev.kind, occurredOn: ev.occurredOn },
          metadata: { matterId: m.id, reason: input.reason },
        },
        ...out.audit,
      ],
    };
  },
});

/** The owner must be staff who can see the matter, or they could not act on the alert. */
async function checkOwner(ctx: CommandContext, m: MatterRow, ownerId: string | null) {
  if (!ownerId) return;
  const [u] = await ctx.tx
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users)
    .where(and(eq(users.id, ownerId), isNull(users.deletedAt)));
  const ok =
    u &&
    ["owner_attorney", "attorney", "paralegal"].includes(u.role) &&
    can(u, "deadlines.write", { resource: await scopeOf(ctx.tx, m) });
  if (!ok)
    throw new CommandError(
      "validation",
      "The owner must be an active attorney or paralegal who works on this matter.",
    );
}

/** A deadline entered by staff from the firm's own reading (origin "manual"). */
export const addDeadline = defineCommand({
  name: "deadlines.add",
  permission: "deadlines.write",
  input: z.object({
    matterId: z.uuid(),
    label: z.string().trim().min(3).max(160),
    dueOn: z.iso.date(),
    severity: z.enum(SEVERITIES),
    ownerId: z.uuid().nullable(),
    note: z.string().trim().max(1_000).nullable().default(null),
  }),
  async run(ctx, input) {
    const m = await matterFor(ctx, input.matterId);
    openOnly(m);
    await checkOwner(ctx, m, input.ownerId);
    const [d] = await ctx.tx
      .insert(deadlines)
      .values({
        matterId: m.id,
        label: maskText(input.label).text,
        dueOn: input.dueOn,
        origin: "manual",
        severity: input.severity,
        ownerId: input.ownerId,
        note: input.note ? maskText(input.note).text : null,
        createdBy: actorId(ctx.principal),
      })
      .returning();
    return {
      result: { deadlineId: d!.id },
      audit: [
        {
          action: "deadlines.added",
          entityType: "deadline",
          entityId: d!.id,
          after: { label: d!.label, dueOn: d!.dueOn, severity: d!.severity, ownerId: d!.ownerId },
          metadata: { matterId: m.id },
        },
      ],
    };
  },
});

/** Moves a manual or printed date. Rule-computed dates move only through their event or rule. */
export const moveDeadline = defineCommand({
  name: "deadlines.move",
  permission: "deadlines.write",
  input: z.object({
    deadlineId: z.uuid(),
    dueOn: z.iso.date(),
    reason: z.string().trim().min(3).max(500),
  }),
  async run(ctx, input) {
    const { d, m } = await lockDeadline(ctx, input.deadlineId);
    openOnly(m);
    if (d.origin === "rule")
      throw new CommandError(
        "invalid_state",
        "This date is computed from a rule. Correct the trigger event, or add a manual deadline.",
      );
    if (d.status !== "open") throw new CommandError("invalid_state", "This deadline is not open.");
    if (d.dueOn === input.dueOn) throw new CommandError("validation", "Nothing changed.");
    const now = new Date();
    await ctx.tx
      .update(deadlines)
      .set({
        dueOn: input.dueOn,
        dueChangedAt: now,
        confirmed: true,
        crossCheck: d.crossCheck
          ? { ...d.crossCheck, matches: d.crossCheck.dueOn === input.dueOn }
          : null,
        version: d.version + 1,
        updatedAt: now,
      })
      .where(eq(deadlines.id, d.id));
    return {
      result: { moved: true },
      audit: [
        {
          action: "deadlines.moved",
          entityType: "deadline",
          entityId: d.id,
          before: { dueOn: d.dueOn },
          after: { dueOn: input.dueOn, reason: input.reason },
          metadata: { matterId: m.id },
        },
      ],
    };
  },
});

export const setDeadlineStatus = defineCommand({
  name: "deadlines.set_status",
  permission: "deadlines.write",
  input: z.object({
    deadlineId: z.uuid(),
    status: z.enum(["open", "done", "cancelled"]),
    note: z.string().trim().max(500).nullable().default(null),
  }),
  async run(ctx, input) {
    const { d, m } = await lockDeadline(ctx, input.deadlineId);
    if (d.status === input.status) throw new CommandError("validation", "Nothing changed.");
    if (input.status === "cancelled" && d.origin === "rule")
      throw new CommandError(
        "invalid_state",
        "A rule-computed deadline cannot be cancelled by hand. Remove or correct its trigger event, or mark it done.",
      );
    if (input.status === "cancelled" && !input.note)
      throw new CommandError("validation", "Say why the deadline is cancelled.", {
        note: ["Say why the deadline is cancelled."],
      });
    const now = new Date();
    const done = input.status === "done";
    await ctx.tx
      .update(deadlines)
      .set({
        status: input.status,
        completedAt: done ? now : null,
        completedBy: done ? actorId(ctx.principal) : null,
        note: input.note ? maskText(input.note).text : d.note,
        version: d.version + 1,
        updatedAt: now,
      })
      .where(eq(deadlines.id, d.id));
    if (input.status !== "open") {
      // A closed deadline needs no more attention.
      await ctx.tx
        .update(deadlineAlerts)
        .set({ acknowledgedAt: now, acknowledgedBy: actorId(ctx.principal), updatedAt: now })
        .where(and(eq(deadlineAlerts.deadlineId, d.id), isNull(deadlineAlerts.acknowledgedAt)));
    }
    return {
      result: { status: input.status },
      audit: [
        {
          action: `deadlines.${input.status === "open" ? "reopened" : input.status}`,
          entityType: "deadline",
          entityId: d.id,
          before: { status: d.status },
          after: { status: input.status, note: input.note },
          metadata: { matterId: m.id },
        },
      ],
    };
  },
});

export const assignDeadline = defineCommand({
  name: "deadlines.assign",
  permission: "deadlines.write",
  input: z.object({ deadlineId: z.uuid(), ownerId: z.uuid().nullable() }),
  async run(ctx, input) {
    const { d, m } = await lockDeadline(ctx, input.deadlineId);
    await checkOwner(ctx, m, input.ownerId);
    if (d.ownerId === input.ownerId) throw new CommandError("validation", "Nothing changed.");
    await ctx.tx
      .update(deadlines)
      .set({ ownerId: input.ownerId, version: d.version + 1, updatedAt: new Date() })
      .where(eq(deadlines.id, d.id));
    return {
      result: { ownerId: input.ownerId },
      audit: [
        {
          action: "deadlines.assigned",
          entityType: "deadline",
          entityId: d.id,
          before: { ownerId: d.ownerId },
          after: { ownerId: input.ownerId },
          metadata: { matterId: m.id },
        },
      ],
    };
  },
});

/** C2: someone has seen the alert. Stops escalation. */
export const acknowledgeAlerts = defineCommand({
  name: "deadlines.acknowledge_alerts",
  permission: "deadlines.write",
  input: z.object({ deadlineId: z.uuid() }),
  async run(ctx, input) {
    const { d, m } = await lockDeadline(ctx, input.deadlineId);
    const now = new Date();
    const rows = await ctx.tx
      .update(deadlineAlerts)
      .set({ acknowledgedAt: now, acknowledgedBy: actorId(ctx.principal), updatedAt: now })
      .where(and(eq(deadlineAlerts.deadlineId, d.id), isNull(deadlineAlerts.acknowledgedAt)))
      .returning({ id: deadlineAlerts.id, threshold: deadlineAlerts.threshold });
    if (rows.length === 0)
      throw new CommandError("invalid_state", "There is no alert to acknowledge.");
    return {
      result: { acknowledged: rows.length },
      audit: [
        {
          action: "deadlines.alerts_acknowledged",
          entityType: "deadline",
          entityId: d.id,
          after: { alerts: rows.map((r) => r.threshold) },
          metadata: { matterId: m.id, automationId: "C2" },
        },
      ],
    };
  },
});

// ----------------------------------------------------------------- C5 --

async function recomputeTolled(ctx: CommandContext, d: DeadlineRow, m: MatterRow) {
  const [ev] = await ctx.tx.select().from(matterEvents).where(eq(matterEvents.id, d.eventId!));
  const rules = await loadRules(ctx.tx);
  const rule = rules.find((r) => r.id === d.ruleId);
  const c = await applyContext(ctx.tx, actorId(ctx.principal));
  const out: ApplyOutcome = { computed: 0, recomputed: 0, cancelled: 0, unverified: [], audit: [] };
  if (ev && rule) await computeOccurrence(ctx.tx, m, ev, rule, d.occurrence, c, out);
  return out;
}

async function tollable(ctx: CommandContext, deadlineId: string) {
  const { d, m } = await lockDeadline(ctx, deadlineId);
  if (d.origin !== "rule" || !d.eventId)
    throw new CommandError("invalid_state", "Tolling applies to rule-computed dates only.");
  const rules = await loadRules(ctx.tx);
  if (!rules.find((r) => r.id === d.ruleId)?.allowsTolling)
    throw new CommandError("invalid_state", "This rule does not allow tolling.");
  return { d, m };
}

/** C5: days added to the collection statute for a tolling event (bankruptcy, offer pending...). */
export const addTolling = defineCommand({
  name: "deadlines.add_tolling",
  permission: "deadlines.write",
  input: z
    .object({
      deadlineId: z.uuid(),
      days: z.number().int().min(1).max(10_000),
      reason: z.string().trim().min(3).max(300),
      fromOn: z.iso.date().nullable().default(null),
      toOn: z.iso.date().nullable().default(null),
    })
    .refine((v) => !v.fromOn || !v.toOn || v.fromOn <= v.toOn, {
      message: "The period ends before it starts.",
      path: ["toOn"],
    }),
  async run(ctx, input) {
    const { d, m } = await tollable(ctx, input.deadlineId);
    const [t] = await ctx.tx
      .insert(deadlineTolling)
      .values({
        deadlineId: d.id,
        days: input.days,
        reason: maskText(input.reason).text,
        fromOn: input.fromOn,
        toOn: input.toOn,
        createdBy: actorId(ctx.principal),
      })
      .returning();
    const out = await recomputeTolled(ctx, d, m);
    return {
      result: { tollingId: t!.id },
      audit: [
        {
          action: "deadlines.tolling_added",
          entityType: "deadline",
          entityId: d.id,
          after: { days: t!.days, reason: t!.reason, fromOn: t!.fromOn, toOn: t!.toOn },
          metadata: { matterId: m.id, automationId: "C5" },
        },
        ...out.audit,
      ],
    };
  },
});

export const removeTolling = defineCommand({
  name: "deadlines.remove_tolling",
  permission: "deadlines.write",
  input: z.object({ tollingId: z.uuid() }),
  async run(ctx, input) {
    const [t] = await ctx.tx
      .select()
      .from(deadlineTolling)
      .where(and(eq(deadlineTolling.id, input.tollingId), isNull(deadlineTolling.deletedAt)));
    if (!t) throw new CommandError("not_found", "Tolling entry not found.");
    const { d, m } = await tollable(ctx, t.deadlineId);
    await ctx.tx
      .update(deadlineTolling)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(deadlineTolling.id, t.id));
    const out = await recomputeTolled(ctx, d, m);
    return {
      result: { removed: true },
      audit: [
        {
          action: "deadlines.tolling_removed",
          entityType: "deadline",
          entityId: d.id,
          before: { days: t.days, reason: t.reason },
          metadata: { matterId: m.id, automationId: "C5" },
        },
        ...out.audit,
      ],
    };
  },
});

/** C5: an installment agreement's payment schedule. Replaces an existing plan on the matter. */
export const setPaymentPlan = defineCommand({
  name: "deadlines.set_payment_plan",
  permission: "deadlines.write",
  input: z.object({
    matterId: z.uuid(),
    label: z.string().trim().min(3).max(80).default("Installment agreement"),
    firstDueOn: z.iso.date(),
    dayOfMonth: z.number().int().min(1).max(31),
    amount: z
      .string()
      .trim()
      .regex(/^\$?[\d,]+(\.\d{2})?$/, "Enter an amount such as $450.00")
      .nullable()
      .default(null),
  }),
  async run(ctx, input) {
    const m = await matterFor(ctx, input.matterId);
    openOnly(m);
    if (m.practiceArea !== "tax")
      throw new CommandError("invalid_state", "Payment plans are tracked on tax matters.");
    const [prev] = await ctx.tx
      .select()
      .from(paymentPlans)
      .where(eq(paymentPlans.matterId, m.id))
      .for("update");
    const today = firmToday();
    const audit: AuditSpec[] = [];
    if (prev) audit.push(...(await cancelFuturePayments(ctx.tx, prev, today)));
    const values = {
      label: input.label,
      firstDueOn: input.firstDueOn,
      dayOfMonth: input.dayOfMonth,
      amount: input.amount,
      status: "active" as const,
      updatedAt: new Date(),
    };
    const [plan] = prev
      ? await ctx.tx
          .update(paymentPlans)
          .set(values)
          .where(eq(paymentPlans.id, prev.id))
          .returning()
      : await ctx.tx
          .insert(paymentPlans)
          .values({ ...values, matterId: m.id, createdBy: actorId(ctx.principal) })
          .returning();
    audit.push(...(await topUpPayments(ctx.tx, plan!, today, actorId(ctx.principal))));
    return {
      result: { planId: plan!.id },
      audit: [
        {
          action: prev ? "deadlines.payment_plan_changed" : "deadlines.payment_plan_set",
          entityType: "payment_plan",
          entityId: plan!.id,
          before: prev
            ? {
                firstDueOn: prev.firstDueOn,
                dayOfMonth: prev.dayOfMonth,
                amount: prev.amount,
                status: prev.status,
              }
            : undefined,
          after: {
            firstDueOn: plan!.firstDueOn,
            dayOfMonth: plan!.dayOfMonth,
            amount: plan!.amount,
          },
          metadata: { matterId: m.id, automationId: "C5" },
        },
        ...audit,
      ],
    };
  },
});

export const endPaymentPlan = defineCommand({
  name: "deadlines.end_payment_plan",
  permission: "deadlines.write",
  input: z.object({ matterId: z.uuid(), reason: z.string().trim().min(3).max(300) }),
  async run(ctx, input) {
    const m = await matterFor(ctx, input.matterId);
    const [plan] = await ctx.tx
      .select()
      .from(paymentPlans)
      .where(and(eq(paymentPlans.matterId, m.id), inArray(paymentPlans.status, ["active"])))
      .for("update");
    if (!plan) throw new CommandError("not_found", "There is no active payment plan.");
    await ctx.tx
      .update(paymentPlans)
      .set({ status: "ended", updatedAt: new Date() })
      .where(eq(paymentPlans.id, plan.id));
    const audit = await cancelFuturePayments(ctx.tx, plan, firmToday());
    return {
      result: { ended: true },
      audit: [
        {
          action: "deadlines.payment_plan_ended",
          entityType: "payment_plan",
          entityId: plan.id,
          before: { status: "active" },
          after: { status: "ended", reason: input.reason },
          metadata: { matterId: m.id, automationId: "C5" },
        },
        ...audit,
      ],
    };
  },
});
