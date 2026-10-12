import { and, asc, eq, isNull, lt, lte, ne, or } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import {
  contacts,
  deadlineAlerts,
  deadlines,
  matterEvents,
  matters,
  paymentPlans,
  tasks,
  users,
  type DeadlineRow,
  type MatterRow,
} from "@/db/schema";
import type { AuditSpec } from "@/lib/commands/define";
import { defineCommand } from "@/lib/commands/define";
import { requireSystem } from "@/lib/commands/system";
import { env } from "@/lib/env";
import type { TemplateKey } from "@/lib/messaging/templates";
import { createApproval } from "@/modules/approvals/commands/create";
import {
  automationEnabled,
  queueAutomatedMessage,
  recordAutomationRun,
} from "@/modules/messaging/commands/outbox";
import { firmName, firmToday } from "@/modules/matters/scope";
import { addDays, formatDate } from "../date-math";
import { dueInWords, isCritical, smsAt, thresholdFor } from "../engine";
import { deadlineAuditReport } from "../report";
import {
  applyContext,
  computeOccurrence,
  eventConfirmed,
  ownerAttorneys,
  type ApplyOutcome,
} from "./apply";
import { insertMissingSeeds } from "./rules";
import { topUpPayments } from "./schedule";

/*
 * Scheduled deadline automations, run by jobs as the system:
 *   daily  C3 next annual occurrence and client reminder, C5 payment dates,
 *          C2 alerts at 30, 14, 7, 3 and 1 days (and on the day)
 *   hourly C2 escalation of critical alerts nobody acknowledged
 *   weekly C7 deadline audit
 */

/** A critical alert nobody acknowledged within this long goes to the owner attorney. */
export const ESCALATE_AFTER_MS = 4 * 3_600_000;

const deadlineUrl = (matterId: string) =>
  new URL(`/matters/${matterId}#deadlines`, env().APP_URL).toString();

/** Text a member of staff on their own phone (their GHL contact), as A5 does. No client details. */
async function textStaff(
  tx: Tx,
  userId: string,
  templateKey: TemplateKey,
  idempotencyKey: string,
  values: { dueIn: string; deadlineUrl: string },
): Promise<{ messageId: string | null; audit: AuditSpec[] }> {
  const [u] = await tx.select({ ghl: users.ghlContactId }).from(users).where(eq(users.id, userId));
  const [contact] = u?.ghl
    ? await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.source, "ghl"), eq(contacts.sourceId, u.ghl)))
    : [];
  if (!contact) {
    return {
      messageId: null,
      audit: [
        {
          action: "deadlines.alert_text_not_sent",
          entityType: "user",
          entityId: userId,
          metadata: { reason: "no GHL contact for alerts", templateKey },
        },
      ],
    };
  }
  const q = await queueAutomatedMessage(tx, {
    automationId: "C2",
    templateKey,
    contact,
    leadId: null,
    idempotencyKey,
    dueAt: new Date(),
    ignoreQuietHours: true,
    values,
  });
  return { messageId: q.messageId, audit: q.audit };
}

type Open = { d: DeadlineRow; m: MatterRow };

async function openDeadlines(tx: Tx, upTo: string): Promise<Open[]> {
  return tx
    .select({ d: deadlines, m: matters })
    .from(deadlines)
    .innerJoin(matters, eq(matters.id, deadlines.matterId))
    .where(
      and(
        eq(deadlines.status, "open"),
        lte(deadlines.dueOn, upTo),
        eq(matters.status, "open"),
        isNull(matters.deletedAt),
      ),
    )
    .orderBy(asc(deadlines.dueOn));
}

// ---------------------------------------------------------------- C3 --

async function rollAnnual(tx: Tx, today: string, audit: AuditSpec[]): Promise<number> {
  const rows = await tx
    .select({ d: deadlines, m: matters, ev: matterEvents })
    .from(deadlines)
    .innerJoin(matters, eq(matters.id, deadlines.matterId))
    .innerJoin(matterEvents, eq(matterEvents.id, deadlines.eventId))
    .where(
      and(
        eq(deadlines.origin, "rule"),
        ne(deadlines.status, "cancelled"),
        or(eq(deadlines.status, "done"), lt(deadlines.dueOn, today)),
        eq(matters.status, "open"),
        isNull(matters.deletedAt),
        isNull(matterEvents.deletedAt),
      ),
    );
  if (rows.length === 0) return 0;
  const c = await applyContext(tx, null);
  let created = 0;
  for (const { d, m, ev } of rows) {
    const rule = c.rules.find((r) => r.id === d.ruleId);
    if (rule?.recurring !== "annual") continue;
    const [next] = await tx
      .select({ id: deadlines.id })
      .from(deadlines)
      .where(
        and(
          eq(deadlines.eventId, ev.id),
          eq(deadlines.ruleId, rule.id),
          eq(deadlines.occurrence, d.occurrence + 1),
        ),
      );
    if (next) continue;
    const out: ApplyOutcome = {
      computed: 0,
      recomputed: 0,
      cancelled: 0,
      unverified: [],
      audit: [],
    };
    await computeOccurrence(
      tx,
      m,
      ev,
      rule,
      d.occurrence + 1,
      { ...c, confirmed: await eventConfirmed(tx, ev) },
      out,
    );
    created += out.computed;
    audit.push(...out.audit);
  }
  return created;
}

/** C3: an annual filing reminder to the client, through the approval queue, with a reply option. */
async function clientReminder(tx: Tx, o: Open, audit: AuditSpec[]): Promise<boolean> {
  const [contact] = await tx.select().from(contacts).where(eq(contacts.id, o.m.contactId));
  if (!contact) return false;
  const channel = contact.email ? "email" : contact.phone ? "sms" : "none";
  const firm = await firmName(tx);
  const due = formatDate(o.d.dueOn);
  const body = [
    `Hi ${contact.firstName ?? "there"},`,
    "",
    `This is a reminder from ${firm}: the ${o.d.label.toLowerCase()} for your business is due on ${due}.`,
    "",
    "Would you like us to handle it? Reply to this message and we will take care of it. If you file it yourself, no reply is needed.",
    "",
    firm,
  ].join("\n");
  const a = await createApproval(tx, {
    automationId: "C3",
    kind: "message",
    title: `Annual reminder: ${o.m.number} ${o.d.label} due ${due}`,
    channel,
    contactId: contact.id,
    matterId: o.m.id,
    subject: channel === "email" ? `${o.d.label}: due ${due}` : null,
    draftBody: body,
    sources: { deadlineId: o.d.id },
    dedupeKey: `C3:reminder:${o.d.id}`,
  });
  audit.push(...a.audit);
  return a.created;
}

// ---------------------------------------------------------------- C2 --

async function raiseAlerts(
  tx: Tx,
  today: string,
  audit: AuditSpec[],
  c3: boolean,
): Promise<{ alerts: number; texts: number; reminders: number }> {
  const out = { alerts: 0, texts: 0, reminders: 0 };
  const annualRules = new Set(
    (await applyContext(tx, null)).rules.filter((r) => r.recurring === "annual").map((r) => r.id),
  );
  for (const o of await openDeadlines(tx, addDays(today, 30))) {
    const left = Math.round(
      (Date.parse(`${o.d.dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
    );
    const t = thresholdFor(left);
    if (t === null) continue;
    const recipientId = o.d.ownerId ?? o.m.responsibleAttorneyId;
    const critical = isCritical(t, o.d.severity);
    const [alert] = await tx
      .insert(deadlineAlerts)
      .values({ deadlineId: o.d.id, threshold: t, dueOn: o.d.dueOn, recipientId, critical })
      .onConflictDoNothing()
      .returning();
    if (!alert) continue;
    out.alerts++;
    audit.push({
      action: "deadlines.alert_raised",
      entityType: "deadline",
      entityId: o.d.id,
      after: { threshold: t, dueOn: o.d.dueOn, critical, recipientId },
      metadata: { matterId: o.m.id, automationId: "C2" },
    });
    if (smsAt(t) && recipientId) {
      const s = await textStaff(tx, recipientId, "C2.alert.sms", `C2:alert:${alert.id}`, {
        dueIn: dueInWords(today, o.d.dueOn).toLowerCase(),
        deadlineUrl: deadlineUrl(o.m.id),
      });
      audit.push(...s.audit);
      if (s.messageId) {
        out.texts++;
        await tx
          .update(deadlineAlerts)
          .set({ smsMessageId: s.messageId, updatedAt: new Date() })
          .where(eq(deadlineAlerts.id, alert.id));
      }
    }
    if (c3 && t === 30 && o.d.ruleId && annualRules.has(o.d.ruleId)) {
      if (await clientReminder(tx, o, audit)) out.reminders++;
    }
  }
  return out;
}

const dayInput = z.object({ today: z.iso.date().optional() });

export const runDeadlinesDaily = defineCommand({
  name: "deadlines.run_daily",
  permission: "deadlines.write",
  input: dayInput,
  async run(ctx, input) {
    requireSystem(ctx);
    const today = input.today ?? firmToday();
    const audit: AuditSpec[] = [];
    // Rules added by a product update arrive unverified.
    const newRules = await insertMissingSeeds(ctx.tx);
    if (newRules.length > 0)
      audit.push({
        action: "deadlines.rules_synced",
        entityType: "deadline_rule",
        metadata: { added: newRules },
      });
    const c1 = await automationEnabled(ctx.tx, "C1");
    const c2 = await automationEnabled(ctx.tx, "C2");
    const c3 = await automationEnabled(ctx.tx, "C3");
    const c5 = await automationEnabled(ctx.tx, "C5");
    let annual = 0;
    if (c1 && c3) annual = await rollAnnual(ctx.tx, today, audit);
    let payments = 0;
    if (c5) {
      const plans = await ctx.tx
        .select()
        .from(paymentPlans)
        .where(eq(paymentPlans.status, "active"));
      for (const p of plans) {
        const a = await topUpPayments(ctx.tx, p, today, null);
        payments += a.length;
        audit.push(...a);
      }
    }
    const alerts = c2
      ? await raiseAlerts(ctx.tx, today, audit, c3)
      : { alerts: 0, texts: 0, reminders: 0 };
    for (const [id, on, detail] of [
      ["C2", c2, { alerts: alerts.alerts, texts: alerts.texts }],
      ["C3", c1 && c3, { created: annual, reminders: alerts.reminders }],
      ["C5", c5, { payments }],
    ] as const) {
      await recordAutomationRun(ctx.tx, {
        automationId: id,
        trigger: "daily",
        status: on ? "succeeded" : "skipped",
        detail: { ...detail, today },
      });
    }
    return {
      result: { today, annual, payments, ...alerts },
      audit: [
        {
          action: "deadlines.daily_run",
          entityType: "automation",
          metadata: { today, annual, payments, ...alerts },
        },
        ...audit,
      ],
    };
  },
});

/** C2: critical alerts nobody acknowledged go to the owner attorney, by text and as an urgent task. */
export const escalateDeadlineAlerts = defineCommand({
  name: "deadlines.escalate_alerts",
  permission: "deadlines.write",
  input: z.object({ now: z.iso.datetime().optional() }),
  async run(ctx, input) {
    requireSystem(ctx);
    const now = input.now ? new Date(input.now) : new Date();
    const audit: AuditSpec[] = [];
    if (!(await automationEnabled(ctx.tx, "C2")))
      return {
        result: { escalated: 0 },
        audit: [
          {
            action: "deadlines.escalation_skipped",
            entityType: "automation",
            metadata: { reason: "C2 off" },
          },
        ],
      };
    const due = await ctx.tx
      .select({ a: deadlineAlerts, d: deadlines, m: matters })
      .from(deadlineAlerts)
      .innerJoin(deadlines, eq(deadlines.id, deadlineAlerts.deadlineId))
      .innerJoin(matters, eq(matters.id, deadlines.matterId))
      .where(
        and(
          eq(deadlineAlerts.critical, true),
          isNull(deadlineAlerts.acknowledgedAt),
          isNull(deadlineAlerts.escalatedAt),
          lte(deadlineAlerts.createdAt, new Date(now.getTime() - ESCALATE_AFTER_MS)),
          eq(deadlines.status, "open"),
          eq(matters.status, "open"),
        ),
      )
      .orderBy(asc(deadlineAlerts.createdAt));
    const owners = await ownerAttorneys(ctx.tx);
    const today = firmToday(now);
    let escalated = 0;
    for (const { a, d, m } of due) {
      // The owner attorney, or every owner but the person who already ignored it.
      const to = owners.filter((o) => o.id !== a.recipientId).map((o) => o.id);
      const targets = to.length > 0 ? to : owners.map((o) => o.id);
      await ctx.tx
        .update(deadlineAlerts)
        .set({ escalatedAt: now, escalatedTo: targets, updatedAt: now })
        .where(eq(deadlineAlerts.id, a.id));
      for (const ownerId of targets) {
        await ctx.tx
          .insert(tasks)
          .values({
            matterId: m.id,
            title: `Unacknowledged deadline alert: ${d.label} (${dueInWords(today, d.dueOn).toLowerCase()})`,
            detail: `The alert for ${m.number} was not acknowledged within 4 hours. Acknowledge it on the matter's Deadlines section.`,
            dueOn: d.dueOn,
            dueFromDocument: d.origin === "document",
            assigneeId: ownerId,
            priority: "urgent",
            automationId: "C2",
            dedupeKey: `C2:escalate:${a.id}:${ownerId}`,
          })
          .onConflictDoNothing();
        const s = await textStaff(
          ctx.tx,
          ownerId,
          "C2.escalation.sms",
          `C2:escalate:${a.id}:${ownerId}`,
          {
            dueIn: dueInWords(today, d.dueOn).toLowerCase(),
            deadlineUrl: deadlineUrl(m.id),
          },
        );
        audit.push(...s.audit);
      }
      escalated++;
      audit.push({
        action: "deadlines.alert_escalated",
        entityType: "deadline",
        entityId: d.id,
        after: { alertId: a.id, threshold: a.threshold, escalatedTo: targets },
        metadata: { matterId: m.id, automationId: "C2" },
      });
    }
    if (escalated > 0) {
      await recordAutomationRun(ctx.tx, {
        automationId: "C2",
        trigger: "escalation",
        status: "succeeded",
        detail: { escalated },
      });
    }
    return {
      result: { escalated },
      audit: [
        { action: "deadlines.escalation_run", entityType: "automation", metadata: { escalated } },
        ...audit,
      ],
    };
  },
});

/** C7: the weekly deadline audit, as a task for each owner attorney when it finds anything. */
export const runDeadlineAudit = defineCommand({
  name: "deadlines.run_audit",
  permission: "deadlines.write",
  input: z.object({ now: z.iso.datetime().optional() }),
  async run(ctx, input) {
    requireSystem(ctx);
    const now = input.now ? new Date(input.now) : new Date();
    if (!(await automationEnabled(ctx.tx, "C7"))) {
      await recordAutomationRun(ctx.tx, {
        automationId: "C7",
        trigger: "weekly",
        status: "skipped",
      });
      return {
        result: { findings: 0, mattersWithoutDeadline: 0, withoutOwner: 0, changedThisWeek: 0 },
        audit: [
          {
            action: "deadlines.audit_skipped",
            entityType: "automation",
            metadata: { reason: "C7 off" },
          },
        ],
      };
    }
    const r = await deadlineAuditReport(ctx.tx, now);
    const counts = {
      mattersWithoutDeadline: r.mattersWithoutDeadline.length,
      withoutOwner: r.withoutOwner.length,
      changedThisWeek: r.changedThisWeek.length,
    };
    const findings = counts.mattersWithoutDeadline + counts.withoutOwner + counts.changedThisWeek;
    const week = firmToday(now);
    if (findings > 0) {
      for (const o of await ownerAttorneys(ctx.tx)) {
        await ctx.tx
          .insert(tasks)
          .values({
            title: `Weekly deadline audit: ${counts.mattersWithoutDeadline} matters with no deadline, ${counts.withoutOwner} deadlines with no owner, ${counts.changedThisWeek} dates changed`,
            detail: "See Deadlines > Deadline audit.",
            assigneeId: o.id,
            automationId: "C7",
            dedupeKey: `C7:${week}:${o.id}`,
          })
          .onConflictDoNothing();
      }
    }
    await recordAutomationRun(ctx.tx, {
      automationId: "C7",
      trigger: "weekly",
      status: "succeeded",
      detail: {
        ...counts,
        withoutOwnerIds: r.withoutOwner.slice(0, 50).map((x) => x.deadlineId),
        changedIds: r.changedThisWeek.slice(0, 50).map((x) => x.deadlineId),
      },
    });
    return {
      result: { findings, ...counts },
      audit: [{ action: "deadlines.audit_run", entityType: "automation", metadata: counts }],
    };
  },
});
