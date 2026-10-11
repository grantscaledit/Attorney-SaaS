import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { messages, webhookEvents } from "@/db/schema";
import { execute } from "@/lib/commands/execute";
import { QUEUES } from "@/lib/jobs/queue";
import { log } from "@/lib/log";
import { markStaleSend, STALE_SEND_MS } from "@/modules/messaging/commands/outbox";
import { jobContext } from "../context";
import { pendingA3, runA3 } from "../automations/A3";
import { processDocument, staleDocuments } from "../documents/process";
import { processWebhookJob } from "../ghl/process-webhook";
import { sendMessageJob } from "../messaging/send";

/** Every minute. Recovers anything a lost enqueue or a crash left behind. */
export const SWEEP_CRON = "* * * * *";

/** A webhook still pending this long after arrival lost its job. */
const PENDING_GRACE_MS = 30_000;
/** Failed webhooks are retried with growing gaps, then left for a person. */
export const MAX_WEBHOOK_ATTEMPTS = 5;
const BATCH = 50;

export async function sweep(): Promise<{
  webhooks: number;
  sends: number;
  stale: number;
  a3: number;
}> {
  const db = getDb();
  const now = Date.now();

  const events = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(
      or(
        and(
          eq(webhookEvents.status, "pending"),
          lt(webhookEvents.receivedAt, new Date(now - PENDING_GRACE_MS)),
        ),
        and(
          eq(webhookEvents.status, "failed"),
          lt(webhookEvents.attempts, MAX_WEBHOOK_ATTEMPTS),
          // 1, 2, 4, 8 minutes after the last attempt.
          sql`${webhookEvents.updatedAt} < now() - (interval '1 minute' * power(2, ${webhookEvents.attempts} - 1))`,
        ),
      ),
    )
    .orderBy(asc(webhookEvents.receivedAt))
    .limit(BATCH);
  for (const e of events) await processWebhookJob(e.id);

  const due = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.status, "queued"), lte(messages.scheduledFor, new Date(now))))
    .orderBy(asc(messages.scheduledFor))
    .limit(BATCH);
  for (const m of due) {
    await sendMessageJob(m.id).catch((err: unknown) =>
      log.error("sweep send failed", { messageId: m.id, err }),
    );
  }

  const stale = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        inArray(messages.status, ["sending"]),
        lt(messages.updatedAt, new Date(now - STALE_SEND_MS)),
      ),
    )
    .limit(BATCH);
  const { principal, request } = jobContext(QUEUES.sweep);
  for (const m of stale) {
    await execute(markStaleSend, principal, { messageId: m.id }, { request }).catch(
      (err: unknown) => log.error("could not mark stale send", { messageId: m.id, err }),
    );
  }
  // A3 turns whose job was lost. One at a time: each calls a model.
  const a3 = await pendingA3(5);
  for (const t of a3) {
    await runA3(t.leadId, t.messageId).catch((err: unknown) =>
      log.error("sweep A3 failed", { messageId: t.messageId, err }),
    );
  }

  // Uploads whose processing job was lost.
  const docs = await staleDocuments(5);
  for (const id of docs) {
    await processDocument(id).catch((err: unknown) =>
      log.error("sweep document failed", { documentId: id, err }),
    );
  }

  if (events.length + due.length + stale.length + a3.length + docs.length > 0) {
    log.info("sweep recovered work", {
      webhooks: events.length,
      sends: due.length,
      stale: stale.length,
      a3: a3.length,
      documents: docs.length,
    });
  }
  return { webhooks: events.length, sends: due.length, stale: stale.length, a3: a3.length };
}
