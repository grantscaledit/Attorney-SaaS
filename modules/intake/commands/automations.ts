import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { appointments, calls, contacts, leads, messages, type ContactRow } from "@/db/schema";
import type { AuditSpec } from "@/lib/commands/define";
import { formatAppointmentTime, type TemplateKey } from "@/lib/messaging/templates";
import {
  automationEnabled,
  cancelQueued,
  queueAutomatedMessage,
  recipientTimeZone,
  recordAutomationRun,
  type QueueOutcome,
} from "@/modules/messaging/commands/outbox";

/*
 * Intake automations A1, A2 and A7 (spec Section 7). Each makes one decision
 * and queues its messages in the outbox. They run inside the transaction of
 * the command that observed the trigger (webhook processing, reconciliation),
 * so a trigger can never be lost between commit and enqueue (ADR 0006). Every
 * decision, including "do nothing", leaves an automation_runs row and an
 * audit row.
 */

export type AutomationOutcome = { audit: AuditSpec[]; messages: QueuedMessage[] };

export type QueuedMessage = { messageId: string; status: string; scheduledFor: Date | null };

const summarize = (o: QueueOutcome): QueuedMessage => ({
  messageId: o.messageId,
  status: o.status,
  scheduledFor: o.scheduledFor,
});

async function loadContact(tx: Tx, id: string): Promise<ContactRow> {
  const [c] = await tx.select().from(contacts).where(eq(contacts.id, id));
  if (!c) throw new Error(`contact ${id} not found`);
  return c;
}

/** A1 sends at most one text-back per caller in this window, however many times they call. */
export const A1_REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A1 Missed-call text-back: template SMS with the booking link within 60 seconds. */
export async function runA1MissedCallTextBack(tx: Tx, callId: string): Promise<AutomationOutcome> {
  const [call] = await tx.select().from(calls).where(eq(calls.id, callId));
  if (!call) throw new Error(`call ${callId} not found`);
  const contact = await loadContact(tx, call.contactId);

  const [recent] = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.contactId, contact.id),
        eq(messages.automationId, "A1"),
        inArray(messages.status, ["queued", "sending", "sent", "simulated", "unknown"]),
        gt(messages.createdAt, new Date(Date.now() - A1_REPEAT_WINDOW_MS)),
      ),
    )
    .limit(1);

  const outcome = await queueAutomatedMessage(tx, {
    automationId: "A1",
    templateKey: "A1.sms",
    contact,
    leadId: call.leadId,
    idempotencyKey: `A1:${call.id}`,
    dueAt: new Date(),
    context: { callId: call.id },
    suppress: recent ? "recent_text_back" : undefined,
  });
  return {
    messages: [summarize(outcome)],
    audit: [
      {
        action: "automations.A1_ran",
        entityType: "call",
        entityId: call.id,
        metadata: {
          messageId: outcome.messageId,
          status: outcome.status,
          reason: outcome.reason ?? null,
          replay: !outcome.created,
        },
      },
      ...outcome.audit,
    ],
  };
}

/** A2 Instant lead response: email acknowledgement, plus SMS when the person opted in. */
export async function runA2InstantLeadResponse(tx: Tx, leadId: string): Promise<AutomationOutcome> {
  const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId));
  if (!lead) throw new Error(`lead ${leadId} not found`);
  const contact = await loadContact(tx, lead.contactId);
  const out: QueueOutcome[] = [];
  for (const templateKey of ["A2.email", "A2.sms"] as const) {
    out.push(
      await queueAutomatedMessage(tx, {
        automationId: "A2",
        templateKey,
        contact,
        leadId: lead.id,
        idempotencyKey: `A2:${lead.id}:${templateKey}`,
        dueAt: new Date(),
        requireSmsConsent: true,
        context: { leadId: lead.id },
      }),
    );
  }
  return {
    messages: out.map(summarize),
    audit: [
      {
        action: "automations.A2_ran",
        entityType: "lead",
        entityId: lead.id,
        metadata: Object.fromEntries(
          out.map((o, i) => [i === 0 ? "email" : "sms", o.reason ?? o.status]),
        ),
      },
      ...out.flatMap((o) => o.audit),
    ],
  };
}

type Planned = {
  templateKey: TemplateKey;
  idempotencyKey: string;
  dueAt: Date;
  notAfter?: Date;
  context?: Record<string, string>;
};

const HOUR = 60 * 60 * 1000;

/**
 * The A7 messages an appointment should have right now. Keys include the
 * start time, so a reschedule produces a fresh set and the old one is
 * cancelled.
 */
export function planConsultMessages(
  appt: { id: string; status: string; startsAt: Date; deleted: boolean },
  now: Date,
): Planned[] {
  if (appt.deleted) return [];
  const at = appt.startsAt.toISOString();
  if (appt.status === "noshow") {
    return [
      { templateKey: "A7.no_show.sms", idempotencyKey: `A7:${appt.id}:no_show`, dueAt: now },
      {
        templateKey: "A7.no_show_followup.sms",
        idempotencyKey: `A7:${appt.id}:no_show_followup`,
        dueAt: new Date(now.getTime() + 48 * HOUR),
        context: { cancelIfRebookedAfter: now.toISOString() },
      },
    ];
  }
  if ((appt.status !== "new" && appt.status !== "confirmed") || appt.startsAt <= now) return [];
  const plan: Planned[] = [
    {
      templateKey: "A7.confirmation.sms",
      idempotencyKey: `A7:${appt.id}:${at}:confirmation`,
      dueAt: now,
      notAfter: new Date(appt.startsAt.getTime() - HOUR),
    },
  ];
  const remind24 = new Date(appt.startsAt.getTime() - 24 * HOUR);
  if (remind24 > now) {
    plan.push({
      templateKey: "A7.reminder_24h.sms",
      idempotencyKey: `A7:${appt.id}:${at}:reminder_24h`,
      dueAt: remind24,
      notAfter: new Date(appt.startsAt.getTime() - 3 * HOUR),
    });
  }
  const remind2 = new Date(appt.startsAt.getTime() - 2 * HOUR);
  if (remind2 > now) {
    plan.push({
      templateKey: "A7.reminder_2h.sms",
      idempotencyKey: `A7:${appt.id}:${at}:reminder_2h`,
      dueAt: remind2,
      notAfter: new Date(appt.startsAt.getTime() - 30 * 60 * 1000),
    });
  }
  return plan;
}

/** A7 Consult booking and reminders: confirmation, 24h and 2h reminders, no-show rebooking. */
export async function runA7ConsultMessages(
  tx: Tx,
  appointmentId: string,
): Promise<AutomationOutcome> {
  const [appt] = await tx
    .select()
    .from(appointments)
    .where(eq(appointments.id, appointmentId))
    .for("update");
  if (!appt) throw new Error(`appointment ${appointmentId} not found`);
  const now = new Date();
  const plan = planConsultMessages(
    { id: appt.id, status: appt.status, startsAt: appt.startsAt, deleted: appt.deletedAt !== null },
    now,
  );

  // Cancel queued A7 messages for this appointment that the plan no longer contains.
  const keep = new Set(plan.map((p) => p.idempotencyKey));
  const pending = await tx
    .select({ id: messages.id, key: messages.idempotencyKey })
    .from(messages)
    .where(
      and(
        eq(messages.automationId, "A7"),
        eq(messages.status, "queued"),
        sql`${messages.context}->>'appointmentId' = ${appt.id}`,
      ),
    );
  const audit: AuditSpec[] = await cancelQueued(
    tx,
    pending.filter((p) => !p.key || !keep.has(p.key)).map((p) => p.id),
    appt.deletedAt ? "appointment_deleted" : `appointment_${appt.status}`,
  );

  const queued: QueuedMessage[] = [];
  // Nothing to send to an appointment without a mirrored contact.
  const [contact] = appt.contactId
    ? await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, appt.contactId), isNull(contacts.deletedAt)))
    : [];
  if (contact && plan.length > 0) {
    const appointmentTime = formatAppointmentTime(appt.startsAt, recipientTimeZone(contact));
    for (const p of plan) {
      const o = await queueAutomatedMessage(tx, {
        automationId: "A7",
        templateKey: p.templateKey,
        contact,
        leadId: appt.leadId,
        idempotencyKey: p.idempotencyKey,
        dueAt: p.dueAt,
        notAfter: p.notAfter,
        values: { appointmentTime },
        context: { appointmentId: appt.id, ...(p.context ?? {}) },
      });
      queued.push(summarize(o));
      audit.push(...o.audit);
    }
  } else if (await automationEnabled(tx, "A7")) {
    await recordAutomationRun(tx, {
      automationId: "A7",
      trigger: `appointment_${appt.status}`,
      status: "skipped",
      entityType: "appointment",
      entityId: appt.id,
      detail: { reason: contact ? "nothing_to_send" : "no_contact" },
    });
  }

  return {
    messages: queued,
    audit: [
      {
        action: "automations.A7_ran",
        entityType: "appointment",
        entityId: appt.id,
        metadata: { status: appt.status, planned: plan.length, queued: queued.length },
      },
      ...audit,
    ],
  };
}

/** Runs the automations a mirror change triggered, in the same transaction. */
export async function runTriggers(
  tx: Tx,
  triggers: readonly (
    | { automation: "A1"; callId: string }
    | { automation: "A2"; leadId: string }
    | { automation: "A7"; appointmentId: string }
  )[],
): Promise<AutomationOutcome> {
  const all: AutomationOutcome = { audit: [], messages: [] };
  const seen = new Set<string>();
  for (const t of triggers) {
    const key = JSON.stringify(t);
    if (seen.has(key)) continue;
    seen.add(key);
    const r =
      t.automation === "A1"
        ? await runA1MissedCallTextBack(tx, t.callId)
        : t.automation === "A2"
          ? await runA2InstantLeadResponse(tx, t.leadId)
          : await runA7ConsultMessages(tx, t.appointmentId);
    all.audit.push(...r.audit);
    all.messages.push(...r.messages);
  }
  return all;
}
