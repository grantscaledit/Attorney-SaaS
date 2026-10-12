import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { firmSettings, webhookEvents } from "@/db/schema";
import type { AuditSpec } from "@/lib/commands/define";
import { defineCommand } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";
import { requireSystem } from "@/lib/commands/system";
import { featureEnabledIn } from "@/lib/flags/load";
import { normalizeGhlEvent, type GhlEvent } from "@/lib/ghl/events";
import { ghlContact, type GhlContact } from "@/lib/ghl/schemas";
import {
  attachContactAttribution,
  deleteAppointment,
  deleteContact,
  deleteOpportunity,
  lockContact,
  recordCall,
  recordForm,
  recordMessage,
  upsertAppointment,
  upsertContact,
  upsertOpportunity,
  type MirrorContext,
  type MirrorResult,
} from "@/modules/intake/commands/mirror";
import { runTriggers, type QueuedMessage } from "@/modules/intake/commands/automations";

/** Builds the mirror context for a transaction: firm website host and whether F1 is on. */
export async function mirrorContext(tx: Tx, cause: Record<string, string>): Promise<MirrorContext> {
  const [firm] = await tx
    .select({ website: firmSettings.website })
    .from(firmSettings)
    .where(eq(firmSettings.id, 1));
  let firmHost: string | null = null;
  try {
    firmHost = firm?.website ? new URL(firm.website).hostname.toLowerCase() : null;
  } catch {
    firmHost = null;
  }
  return { tx, firmHost, attribution: await featureEnabledIn(tx, "automation.F1"), cause };
}

/** The GHL contact an event is about, used to serialize work per person. */
export function eventContactId(e: GhlEvent): string | null {
  switch (e.kind) {
    case "contact.upsert":
      return e.contact.id;
    case "contact.delete":
      return e.contactId;
    case "opportunity.upsert":
      return e.opportunity.contactId;
    case "appointment.upsert":
      return e.appointment.contactId;
    case "call":
      return e.call.contactId;
    case "message":
      return e.contactId;
    case "form":
      return e.form.contactId;
    default:
      return null;
  }
}

async function apply(
  ctx: MirrorContext,
  e: GhlEvent,
  enrichment: GhlContact | null,
): Promise<MirrorResult> {
  switch (e.kind) {
    case "contact.upsert": {
      const { row, result } = await upsertContact(ctx, e.contact);
      const attribution = await attachContactAttribution(ctx, row, enrichment ?? e.contact);
      return {
        audit: [...result.audit, ...attribution.audit],
        triggers: [...result.triggers, ...attribution.triggers],
      };
    }
    case "contact.delete":
      return deleteContact(ctx, e.contactId);
    case "opportunity.upsert":
      return upsertOpportunity(ctx, e.opportunity);
    case "opportunity.delete":
      return deleteOpportunity(ctx, e.opportunityId);
    case "appointment.upsert":
      return upsertAppointment(ctx, e.appointment);
    case "appointment.delete":
      return deleteAppointment(ctx, e.appointmentId);
    case "call":
      return recordCall(ctx, e.call, { contact: enrichment, hint: e.contactHint });
    case "message":
      return recordMessage(ctx, e, { contact: enrichment });
    case "form":
      return recordForm(ctx, e.form, { contact: enrichment });
    case "ignored":
      return { audit: [], triggers: [] };
  }
}

export type ProcessResult = {
  status: GhlEvent["kind"] | "skipped";
  /** Messages the triggered automations queued, for the job to send. */
  messages: QueuedMessage[];
  /** Inbound messages for the intake assistant, run by the job after commit. */
  a3: { leadId: string; messageId: string }[];
};

/**
 * Applies one stored webhook to the mirror and lead records, runs the
 * automations it triggers (A1, A2, A7), then marks it processed. Runs in a job (spec Section 2). Safe to run twice: a processed
 * event is skipped, and every write underneath is keyed by GHL ids.
 *
 * `enrichment` is the contact as returned by GET /contacts/{id}, fetched by
 * the job before this transaction so no network call holds database locks.
 */
export const processGhlWebhook = defineCommand({
  name: "ghl.process_webhook",
  permission: "firm.settings.update",
  input: z.object({
    eventId: z.uuid(),
    enrichment: z.object({ contact: z.unknown().nullable() }).optional(),
  }),
  async run(ctx, input) {
    requireSystem(ctx);
    const [event] = await ctx.tx
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, input.eventId))
      .for("update");
    if (!event) throw new CommandError("not_found", "Webhook event not found.");

    if (event.status === "processed" || event.status === "ignored") {
      return {
        result: { status: "skipped", messages: [], a3: [] } as ProcessResult,
        audit: [
          {
            action: "ghl.webhook_already_processed",
            entityType: "webhook_event",
            entityId: event.id,
            metadata: { eventType: event.eventType, status: event.status },
          },
        ],
      };
    }

    const normalized = normalizeGhlEvent(event.payload as Record<string, unknown>);
    const parsedEnrichment = ghlContact.safeParse(input.enrichment?.contact);
    const enrichment = parsedEnrichment.success ? parsedEnrichment.data : null;

    const contactId = eventContactId(normalized);
    if (contactId) await lockContact(ctx.tx, contactId);
    const mctx = await mirrorContext(ctx.tx, { webhookEventId: event.id });
    const outcome = await apply(mctx, normalized, enrichment);
    // A1, A2 and A7 decide in this same transaction, so no trigger is lost (ADR 0006).
    const automations = await runTriggers(
      ctx.tx,
      outcome.triggers.filter((t) => t.automation !== "A3"),
    );
    const a3 = outcome.triggers.flatMap((t) =>
      t.automation === "A3" ? [{ leadId: t.leadId, messageId: t.messageId }] : [],
    );

    const ignored = normalized.kind === "ignored";
    await ctx.tx
      .update(webhookEvents)
      .set({
        status: ignored ? "ignored" : "processed",
        processedAt: new Date(),
        attempts: event.attempts + 1,
        lastError: ignored ? normalized.reason : null,
        updatedAt: new Date(),
      })
      .where(eq(webhookEvents.id, event.id));

    const audit: [AuditSpec, ...AuditSpec[]] = [
      {
        action: ignored ? "ghl.webhook_ignored" : "ghl.webhook_processed",
        entityType: "webhook_event",
        entityId: event.id,
        metadata: {
          eventType: event.eventType,
          kind: normalized.kind,
          ...(ignored ? { reason: normalized.reason } : {}),
          changes: outcome.audit.length,
          triggers: outcome.triggers.map((t) => t.automation).join(",") || null,
        },
      },
      ...outcome.audit,
      ...automations.audit,
    ];
    const result: ProcessResult = { status: normalized.kind, messages: automations.messages, a3 };
    return { result, audit };
  },
});

/** Records a processing failure. The event stays visible in Settings > Integrations for retry. */
export const markGhlWebhookFailed = defineCommand({
  name: "ghl.mark_webhook_failed",
  permission: "firm.settings.update",
  input: z.object({ eventId: z.uuid(), error: z.string().max(2000) }),
  async run(ctx, input) {
    requireSystem(ctx);
    const [event] = await ctx.tx
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, input.eventId))
      .for("update");
    if (!event) throw new CommandError("not_found", "Webhook event not found.");
    if (event.status === "processed" || event.status === "ignored") {
      throw new CommandError("invalid_state", "The event has already been processed.");
    }
    const attempts = event.attempts + 1;
    await ctx.tx
      .update(webhookEvents)
      .set({
        status: "failed",
        attempts,
        lastError: input.error.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(webhookEvents.id, event.id));
    return {
      result: { attempts },
      audit: [
        {
          action: "ghl.webhook_failed",
          entityType: "webhook_event",
          entityId: event.id,
          metadata: { eventType: event.eventType, attempts, error: input.error.slice(0, 200) },
        },
      ],
    };
  },
});

/** Owner action: put a failed event back in the queue. */
export const retryGhlWebhook = defineCommand({
  name: "ghl.retry_webhook",
  permission: "firm.settings.update",
  input: z.object({ eventId: z.uuid() }),
  async run(ctx, input) {
    const [event] = await ctx.tx
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, input.eventId))
      .for("update");
    if (!event) throw new CommandError("not_found", "Webhook event not found.");
    if (event.status !== "failed") {
      throw new CommandError("invalid_state", "Only failed events can be retried.");
    }
    await ctx.tx
      .update(webhookEvents)
      .set({ status: "pending", updatedAt: new Date() })
      .where(eq(webhookEvents.id, event.id));
    return {
      result: { eventId: event.id },
      audit: [
        {
          action: "ghl.webhook_retry_requested",
          entityType: "webhook_event",
          entityId: event.id,
          metadata: { eventType: event.eventType, attempts: event.attempts },
        },
      ],
    };
  },
});
