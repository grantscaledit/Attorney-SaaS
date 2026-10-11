import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contacts, leads, OPEN_LEAD_STATUSES, webhookEvents } from "@/db/schema";
import { execute } from "@/lib/commands/execute";
import { getGhlClient } from "@/lib/ghl/client";
import { normalizeGhlEvent, type GhlEvent } from "@/lib/ghl/events";
import type { GhlContact } from "@/lib/ghl/schemas";
import { enqueueSafely, QUEUES } from "@/lib/jobs/queue";
import { log } from "@/lib/log";
import {
  eventContactId,
  markGhlWebhookFailed,
  processGhlWebhook,
} from "@/modules/ghl/commands/process-webhook";
import { jobContext } from "../context";
import { dispatchQueued } from "../messaging/send";

/** Events whose processing can open a lead, so GHL's attribution (F1) is worth fetching. */
const ENRICH: ReadonlySet<GhlEvent["kind"]> = new Set([
  "call",
  "message",
  "form",
  "contact.upsert",
]);

/**
 * Reads GET /contacts/{id} before the processing transaction when the
 * contact is new to us or may get a new lead. Best effort: a failure here
 * only means less attribution detail, never a lost event.
 */
async function enrichmentFor(e: GhlEvent): Promise<GhlContact | null> {
  const client = getGhlClient();
  const contactId = eventContactId(e);
  if (!client || !contactId || !ENRICH.has(e.kind)) return null;
  const db = getDb();
  const [mirrored] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.source, "ghl"), eq(contacts.sourceId, contactId)));
  if (mirrored && e.kind !== "contact.upsert") {
    const [open] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(
        and(
          eq(leads.contactId, mirrored.id),
          inArray(leads.status, [...OPEN_LEAD_STATUSES]),
          isNull(leads.deletedAt),
        ),
      )
      .limit(1);
    if (open) return null;
  }
  try {
    return await client.getContact(contactId);
  } catch (err) {
    log.warn("contact enrichment failed; continuing without it", { err });
    return null;
  }
}

export async function processWebhookJob(eventId: string): Promise<void> {
  const { principal, request } = jobContext(QUEUES.ghlWebhook, eventId);
  const [event] = await getDb().select().from(webhookEvents).where(eq(webhookEvents.id, eventId));
  if (!event || event.status === "processed" || event.status === "ignored") return;

  const normalized = normalizeGhlEvent(event.payload as Record<string, unknown>);
  const contact = await enrichmentFor(normalized);
  let result;
  try {
    result = await execute(
      processGhlWebhook,
      principal,
      { eventId, enrichment: { contact } },
      { request },
    );
  } catch (err) {
    log.error("webhook processing failed", { eventId, eventType: event.eventType, err });
    const message = err instanceof Error ? err.message : String(err);
    await execute(markGhlWebhookFailed, principal, { eventId, error: message }, { request }).catch(
      (e: unknown) => log.error("could not mark webhook failed", { eventId, err: e }),
    );
    return;
  }
  await dispatchQueued(result.messages);
  // A3 calls a model, so it runs as its own job after this transaction committed.
  for (const t of result.a3) {
    await enqueueSafely(QUEUES.A3, t, { singletonKey: t.messageId });
  }
}
