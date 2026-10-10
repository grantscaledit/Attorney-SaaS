import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import {
  appointments,
  automationRuns,
  consents,
  contacts,
  firmSettings,
  leads,
  messages,
  messageTemplates,
  type ContactRow,
  type MessageRow,
} from "@/db/schema";
import type { AuditSpec } from "@/lib/commands/define";
import { defineCommand } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";
import { requireSystem } from "@/lib/commands/system";
import { env } from "@/lib/env";
import { isFeatureFlag } from "@/lib/flags/catalog";
import { featureEnabledIn } from "@/lib/flags/load";
import { isValidTimeZone, nextSendableTime } from "@/lib/messaging/quiet-hours";
import {
  renderTemplate,
  templateDefinition,
  type TemplateKey,
  type TemplateValues,
} from "@/lib/messaging/templates";
import { noteResponse } from "@/modules/intake/commands/mirror";
import { mirrorContext } from "@/modules/ghl/commands/process-webhook";

/*
 * Outbox for automatic messages (spec Section 6). A message row is written
 * first, keyed by a unique idempotency key, then a job sends it. Every rule
 * that can stop a message is checked when it is queued and again just before
 * it is sent:
 *
 *   automation switched off · do-not-disturb or consent revoked · no SMS
 *   consent where one is required · template not approved by the firm ·
 *   a required value missing (booking link...) · quiet hours (deferred to 8am)
 */

export type SuppressionReason =
  | "feature_off"
  | "dnd"
  | "consent_revoked"
  | "no_sms_consent"
  | "no_phone"
  | "no_email"
  | "template_not_approved"
  | "template_changed"
  | "missing_value"
  | "quiet_hours_window_passed"
  | "recent_text_back"
  | "contact_deleted";

export type QueueSpec = {
  automationId: "A1" | "A2" | "A7";
  templateKey: TemplateKey;
  contact: ContactRow;
  leadId: string | null;
  idempotencyKey: string;
  dueAt: Date;
  /** Drop the message if quiet hours would push it past this time. */
  notAfter?: Date;
  /** A2 texts need a recorded opt-in; A1 replies to the caller's own call. */
  requireSmsConsent?: boolean;
  values?: TemplateValues;
  /** Pointers only: appointmentId, callId, cancelIfRebookedAfter. */
  context?: Record<string, string>;
  /** Caller already decided not to send (e.g. A1 repeat window); recorded like any suppression. */
  suppress?: SuppressionReason;
};

export type QueueOutcome = {
  messageId: string;
  created: boolean;
  status: MessageRow["status"];
  scheduledFor: Date | null;
  reason?: string;
  audit: AuditSpec[];
};

/** Recipient's time zone for quiet hours; the firm's when GHL has none. */
export function recipientTimeZone(contact: Pick<ContactRow, "timezone">): string {
  return isValidTimeZone(contact.timezone) ? contact.timezone : env().FIRM_TIMEZONE;
}

async function latestConsent(tx: Tx, contactId: string, channel: "sms" | "email") {
  const [row] = await tx
    .select({ status: consents.status })
    .from(consents)
    .where(and(eq(consents.contactId, contactId), eq(consents.channel, channel)))
    .orderBy(desc(consents.capturedAt), desc(consents.createdAt))
    .limit(1);
  return row?.status ?? null;
}

/** Rules that hold at queue time and at send time. */
async function channelBlock(
  tx: Tx,
  contact: ContactRow,
  channel: "sms" | "email",
  requireSmsConsent: boolean,
): Promise<SuppressionReason | null> {
  if (contact.deletedAt) return "contact_deleted";
  if (channel === "sms") {
    if (contact.dnd || contact.dndSms) return "dnd";
    if (!contact.phone) return "no_phone";
  } else {
    if (contact.dnd || contact.dndEmail) return "dnd";
    if (!contact.email) return "no_email";
  }
  const consent = await latestConsent(tx, contact.id, channel);
  if (consent === "revoked") return "consent_revoked";
  if (channel === "sms" && requireSmsConsent && consent !== "granted") return "no_sms_consent";
  return null;
}

async function firmValues(tx: Tx): Promise<TemplateValues> {
  const [f] = await tx
    .select({
      displayName: firmSettings.displayName,
      phone: firmSettings.phone,
      bookingUrl: firmSettings.bookingUrl,
      intakeFormUrl: firmSettings.intakeFormUrl,
    })
    .from(firmSettings)
    .where(eq(firmSettings.id, 1));
  return {
    firmName: f?.displayName ?? null,
    firmPhone: f?.phone ?? null,
    bookingUrl: f?.bookingUrl ?? null,
    intakeFormUrl: f?.intakeFormUrl ?? null,
  };
}

/** Writes the automation decision row (spec Section 7: runs, successes, failures). */
export async function recordAutomationRun(
  tx: Tx,
  run: {
    automationId: string;
    trigger: string;
    status: "succeeded" | "skipped" | "failed";
    entityType?: string;
    entityId?: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(automationRuns).values({
    automationId: run.automationId,
    trigger: run.trigger,
    status: run.status,
    entityType: run.entityType ?? null,
    entityId: run.entityId ?? null,
    detail: run.detail ?? null,
  });
}

/** Whether an automation's feature flag is on (tier and firm override). */
export async function automationEnabled(tx: Tx, automationId: string): Promise<boolean> {
  const flag = `automation.${automationId}`;
  return isFeatureFlag(flag) && featureEnabledIn(tx, flag);
}

/** Queues (or records the suppression of) one automatic message. Idempotent on `idempotencyKey`. */
export async function queueAutomatedMessage(tx: Tx, spec: QueueSpec): Promise<QueueOutcome> {
  const [existing] = await tx
    .select()
    .from(messages)
    .where(eq(messages.idempotencyKey, spec.idempotencyKey));
  if (existing) {
    return {
      messageId: existing.id,
      created: false,
      status: existing.status,
      scheduledFor: existing.scheduledFor,
      audit: [],
    };
  }

  const def = templateDefinition(spec.templateKey);
  const channel = def.channel;
  let reason: string | null = null;
  let text: string | null = null;
  let subject: string | null = null;
  let scheduledFor: Date | null = null;

  if (!(await automationEnabled(tx, spec.automationId))) reason = "feature_off";
  reason ??= spec.suppress ?? null;
  reason ??= await channelBlock(tx, spec.contact, channel, spec.requireSmsConsent ?? false);
  if (!reason) {
    const [tpl] = await tx
      .select()
      .from(messageTemplates)
      .where(eq(messageTemplates.key, spec.templateKey));
    if (!tpl?.approvedAt) {
      reason = "template_not_approved";
    } else {
      const values: TemplateValues = {
        firstName: spec.contact.firstName,
        ...(await firmValues(tx)),
        ...spec.values,
      };
      const body = renderTemplate(tpl.body, values);
      const subj = renderTemplate(tpl.subject ?? def.subject ?? "", values);
      if (!body.ok || !subj.ok) {
        reason = `missing_value:${[...(body.ok ? [] : body.missing), ...(subj.ok ? [] : subj.missing)].join(",")}`;
      } else {
        text = body.text;
        subject = channel === "email" ? subj.text : null;
      }
    }
  }
  if (!reason) {
    scheduledFor = nextSendableTime(spec.dueAt, recipientTimeZone(spec.contact));
    if (spec.notAfter && scheduledFor > spec.notAfter) reason = "quiet_hours_window_passed";
  }

  const status = reason ? "suppressed" : "queued";
  const [row] = await tx
    .insert(messages)
    .values({
      contactId: spec.contact.id,
      leadId: spec.leadId,
      direction: "outbound",
      channel,
      status,
      automationId: spec.automationId,
      templateKey: spec.templateKey,
      subject,
      body: text,
      idempotencyKey: spec.idempotencyKey,
      scheduledFor: reason ? null : scheduledFor,
      deferredFrom:
        scheduledFor && scheduledFor.getTime() !== spec.dueAt.getTime() ? spec.dueAt : null,
      suppressedReason: reason,
      context: spec.context ?? null,
    })
    .onConflictDoNothing({ target: messages.idempotencyKey })
    .returning();
  if (!row) {
    // Lost a race with an identical trigger; theirs stands.
    const [winner] = await tx
      .select()
      .from(messages)
      .where(eq(messages.idempotencyKey, spec.idempotencyKey));
    return {
      messageId: winner!.id,
      created: false,
      status: winner!.status,
      scheduledFor: winner!.scheduledFor,
      audit: [],
    };
  }

  await recordAutomationRun(tx, {
    automationId: spec.automationId,
    trigger: spec.templateKey,
    status: reason ? "skipped" : "succeeded",
    entityType: "message",
    entityId: row.id,
    detail: reason ? { reason } : { scheduledFor: scheduledFor?.toISOString() },
  });

  return {
    messageId: row.id,
    created: true,
    status: row.status,
    scheduledFor: row.scheduledFor,
    reason: reason ?? undefined,
    audit: [
      {
        action: reason ? "messaging.suppressed" : "messaging.queued",
        entityType: "message",
        entityId: row.id,
        after: {
          automationId: spec.automationId,
          template: spec.templateKey,
          channel,
          scheduledFor: row.scheduledFor,
          deferredFrom: row.deferredFrom,
          reason,
        },
        metadata: { contactId: spec.contact.id, leadId: spec.leadId, ...(spec.context ?? {}) },
      },
    ],
  };
}

/** Cancels queued messages that no longer apply (a rescheduled or cancelled consult). */
export async function cancelQueued(tx: Tx, ids: string[], reason: string): Promise<AuditSpec[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .update(messages)
    .set({ status: "cancelled", suppressedReason: reason, updatedAt: new Date() })
    .where(and(inArray(messages.id, ids), eq(messages.status, "queued")))
    .returning({ id: messages.id, templateKey: messages.templateKey });
  return rows.map((r) => ({
    action: "messaging.cancelled",
    entityType: "message",
    entityId: r.id,
    after: { template: r.templateKey, reason },
  }));
}

// ---------------------------------------------------------------------------
// Sending: claim -> GHL call (outside any transaction) -> record result
// ---------------------------------------------------------------------------

export type ClaimResult =
  | {
      action: "send";
      channel: "sms" | "email";
      ghlContactId: string;
      subject: string | null;
      body: string;
    }
  | { action: "wait"; until: Date }
  | { action: "skip"; reason: string };

/**
 * Marks a due message as `sending` after re-checking every rule. The send
 * happens after this commits; if the process dies mid-send the row stays
 * `sending` and the sweep marks it `unknown` for a person, never resending.
 */
export const claimMessage = defineCommand({
  name: "messaging.claim",
  permission: "firm.settings.update",
  input: z.object({ messageId: z.uuid() }),
  async run(ctx, input) {
    requireSystem(ctx);
    const [m] = await ctx.tx
      .select()
      .from(messages)
      .where(eq(messages.id, input.messageId))
      .for("update");
    if (!m) throw new CommandError("not_found", "Message not found.");
    const audit = (action: string, after: Record<string, unknown>): [AuditSpec] => [
      { action, entityType: "message", entityId: m.id, after },
    ];

    if (m.status !== "queued" || m.direction !== "outbound" || !m.body) {
      return {
        result: { action: "skip", reason: `status ${m.status}` } as ClaimResult,
        audit: audit("messaging.claim_skipped", { status: m.status }),
      };
    }
    if (m.scheduledFor && m.scheduledFor.getTime() > Date.now() + 2_000) {
      return {
        result: { action: "wait", until: m.scheduledFor } as ClaimResult,
        audit: audit("messaging.claim_deferred", { scheduledFor: m.scheduledFor }),
      };
    }

    const [contact] = await ctx.tx.select().from(contacts).where(eq(contacts.id, m.contactId));
    const channel = m.channel === "email" ? "email" : "sms";
    let reason: string | null = null;
    if (!contact) reason = "contact_deleted";
    if (!reason && m.automationId && !(await automationEnabled(ctx.tx, m.automationId))) {
      reason = "feature_off";
    }
    if (!reason && contact) {
      reason = await channelBlock(
        ctx.tx,
        contact,
        channel,
        m.automationId === "A2" && channel === "sms",
      );
    }
    if (!reason && m.templateKey) {
      const [tpl] = await ctx.tx
        .select({ approvedAt: messageTemplates.approvedAt, updatedAt: messageTemplates.updatedAt })
        .from(messageTemplates)
        .where(eq(messageTemplates.key, m.templateKey));
      // Approval withdrawn, or the text edited, after this message was rendered.
      if (!tpl?.approvedAt) reason = "template_not_approved";
      else if (tpl.updatedAt > m.createdAt) reason = "template_changed";
    }
    const ctxObj = (m.context ?? {}) as Record<string, string>;
    if (!reason && ctxObj.cancelIfRebookedAfter && m.leadId) {
      const [rebooked] = await ctx.tx
        .select({ id: appointments.id })
        .from(appointments)
        .where(
          and(
            eq(appointments.leadId, m.leadId),
            gt(appointments.createdAt, new Date(ctxObj.cancelIfRebookedAfter)),
            isNull(appointments.deletedAt),
            sql`${appointments.status} not in ('cancelled', 'invalid')`,
          ),
        )
        .limit(1);
      if (rebooked) reason = "rebooked";
    }

    if (reason) {
      await ctx.tx
        .update(messages)
        .set({
          status: reason === "rebooked" ? "cancelled" : "suppressed",
          suppressedReason: reason,
          updatedAt: new Date(),
        })
        .where(eq(messages.id, m.id));
      return {
        result: { action: "skip", reason } as ClaimResult,
        audit: audit("messaging.suppressed_at_send", { reason, template: m.templateKey }),
      };
    }

    await ctx.tx
      .update(messages)
      .set({ status: "sending", attempts: m.attempts + 1, updatedAt: new Date() })
      .where(eq(messages.id, m.id));
    return {
      result: {
        action: "send",
        channel,
        ghlContactId: contact!.sourceId,
        subject: m.subject,
        body: m.body,
      } as ClaimResult,
      audit: audit("messaging.send_started", { template: m.templateKey, attempt: m.attempts + 1 }),
    };
  },
});

const MAX_SEND_ATTEMPTS = 3;

/** Records what happened when GHL was asked to send. A sent message is the lead's first response. */
export const recordSendResult = defineCommand({
  name: "messaging.record_result",
  permission: "firm.settings.update",
  input: z.object({
    messageId: z.uuid(),
    outcome: z.enum(["sent", "simulated", "failed", "unknown"]),
    ghlMessageId: z.string().max(100).nullable().optional(),
    /** For a failure GHL definitely did not process (rate limit, 4xx): try again later. */
    retryable: z.boolean().optional(),
    error: z.string().max(500).optional(),
  }),
  async run(ctx, input) {
    requireSystem(ctx);
    const [m] = await ctx.tx
      .select()
      .from(messages)
      .where(eq(messages.id, input.messageId))
      .for("update");
    if (!m) throw new CommandError("not_found", "Message not found.");
    if (m.status !== "sending") {
      throw new CommandError("invalid_state", `Message is ${m.status}, not sending.`);
    }
    const now = new Date();
    const audit: [AuditSpec, ...AuditSpec[]] = [
      {
        action: `messaging.${input.outcome === "unknown" ? "send_outcome_unknown" : input.outcome}`,
        entityType: "message",
        entityId: m.id,
        after: {
          template: m.templateKey,
          channel: m.channel,
          ghlMessageId: input.ghlMessageId ?? null,
          error: input.error ?? null,
        },
      },
    ];
    let retryAt: Date | null = null;

    if (input.outcome === "sent" || input.outcome === "simulated") {
      await ctx.tx
        .update(messages)
        .set({
          status: input.outcome,
          sentAt: now,
          ghlMessageId: input.ghlMessageId ?? null,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(messages.id, m.id));
      if (m.leadId) {
        const [lead] = await ctx.tx
          .select()
          .from(leads)
          .where(eq(leads.id, m.leadId))
          .for("update");
        if (lead) {
          const mctx = await mirrorContext(ctx.tx, { messageId: m.id });
          audit.push(...(await noteResponse(mctx, lead, now, false)).result.audit);
        }
      }
    } else if (input.outcome === "failed" && input.retryable && m.attempts < MAX_SEND_ATTEMPTS) {
      retryAt = new Date(now.getTime() + 60_000 * m.attempts);
      await ctx.tx
        .update(messages)
        .set({
          status: "queued",
          scheduledFor: retryAt,
          lastError: input.error ?? null,
          updatedAt: now,
        })
        .where(eq(messages.id, m.id));
    } else {
      await ctx.tx
        .update(messages)
        .set({ status: input.outcome, lastError: input.error ?? null, updatedAt: now })
        .where(eq(messages.id, m.id));
    }

    // Successes were counted when queued; record deliveries that finally failed.
    const finalFailure = input.outcome === "unknown" || (input.outcome === "failed" && !retryAt);
    if (m.automationId && finalFailure) {
      await recordAutomationRun(ctx.tx, {
        automationId: m.automationId,
        trigger: m.templateKey ?? "send",
        status: "failed",
        entityType: "message",
        entityId: m.id,
        detail: { outcome: input.outcome, error: input.error ?? null },
      });
    }
    return { result: { retryAt }, audit };
  },
});

/** A send claimed this long ago without a recorded result died mid-flight. */
export const STALE_SEND_MS = 10 * 60 * 1000;

/**
 * Sweep action: a message stuck in `sending` may or may not have reached the
 * person. Mark it `unknown` for staff to check in GHL; never resend it.
 */
export const markStaleSend = defineCommand({
  name: "messaging.mark_stale_send",
  permission: "firm.settings.update",
  input: z.object({ messageId: z.uuid() }),
  async run(ctx, input) {
    requireSystem(ctx);
    const [m] = await ctx.tx
      .select()
      .from(messages)
      .where(eq(messages.id, input.messageId))
      .for("update");
    if (!m) throw new CommandError("not_found", "Message not found.");
    if (m.status !== "sending" || m.updatedAt.getTime() > Date.now() - STALE_SEND_MS) {
      throw new CommandError("invalid_state", "Message is not a stale send.");
    }
    await ctx.tx
      .update(messages)
      .set({
        status: "unknown",
        lastError: "send interrupted; outcome unknown",
        updatedAt: new Date(),
      })
      .where(eq(messages.id, m.id));
    if (m.automationId) {
      await recordAutomationRun(ctx.tx, {
        automationId: m.automationId,
        trigger: m.templateKey ?? "send",
        status: "failed",
        entityType: "message",
        entityId: m.id,
        detail: { outcome: "unknown", cause: "stale_send" },
      });
    }
    return {
      result: { messageId: m.id },
      audit: [
        {
          action: "messaging.send_outcome_unknown",
          entityType: "message",
          entityId: m.id,
          after: { template: m.templateKey, cause: "stale_send" },
        },
      ],
    };
  },
});
