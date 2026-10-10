import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { automationRuns, syncState, webhookEvents } from "@/db/schema";
import { assertCan, type Actor } from "@/lib/auth/can";
import { env } from "@/lib/env";
import { ghlConfigured } from "@/lib/ghl/client";
import { SYNC_KEYS } from "./commands/reconcile";

export type GhlConnection = {
  apiConnected: boolean;
  locationId: string | null;
  webhookSecretSet: boolean;
  webhookUrl: string;
  demoMode: boolean;
  lastWebhookAt: Date | null;
  webhooks24h: { received: number; failed: number; ignored: number };
  reconcile: typeof syncState.$inferSelect | null;
};

export async function ghlConnection(actor: Actor): Promise<GhlConnection> {
  assertCan(actor, "firm.settings.update");
  const e = env();
  const db = getDb();
  const [[last], [counts], [reconcile]] = await Promise.all([
    db
      .select({ at: webhookEvents.receivedAt })
      .from(webhookEvents)
      .orderBy(desc(webhookEvents.receivedAt))
      .limit(1),
    db
      .select({
        received: sql<number>`count(*)::int`,
        failed: sql<number>`count(*) filter (where ${webhookEvents.status} = 'failed')::int`,
        ignored: sql<number>`count(*) filter (where ${webhookEvents.status} = 'ignored')::int`,
      })
      .from(webhookEvents)
      .where(sql`${webhookEvents.receivedAt} > now() - interval '24 hours'`),
    db.select().from(syncState).where(eq(syncState.key, SYNC_KEYS.reconcile)),
  ]);
  return {
    apiConnected: ghlConfigured(),
    locationId: e.GHL_LOCATION_ID ?? null,
    webhookSecretSet: Boolean(e.GHL_WEBHOOK_SECRET),
    webhookUrl: new URL("/api/webhooks/ghl", e.APP_URL).toString(),
    demoMode: e.DEMO_MODE,
    lastWebhookAt: last?.at ?? null,
    webhooks24h: counts ?? { received: 0, failed: 0, ignored: 0 },
    reconcile: reconcile ?? null,
  };
}

/** Recent deliveries: type and outcome only, never payload contents. */
export async function recentWebhookEvents(actor: Actor, limit = 25) {
  assertCan(actor, "firm.settings.update");
  return getDb()
    .select({
      id: webhookEvents.id,
      eventType: webhookEvents.eventType,
      authMethod: webhookEvents.authMethod,
      status: webhookEvents.status,
      attempts: webhookEvents.attempts,
      lastError: webhookEvents.lastError,
      receivedAt: webhookEvents.receivedAt,
    })
    .from(webhookEvents)
    .orderBy(desc(webhookEvents.receivedAt))
    .limit(limit);
}

/** Per automation: runs, skips and failures in the last 30 days (spec Section 7). */
export async function automationActivity(actor: Actor) {
  assertCan(actor, "firm.settings.update");
  return getDb()
    .select({
      automationId: automationRuns.automationId,
      succeeded: sql<number>`count(*) filter (where ${automationRuns.status} = 'succeeded')::int`,
      skipped: sql<number>`count(*) filter (where ${automationRuns.status} = 'skipped')::int`,
      failed: sql<number>`count(*) filter (where ${automationRuns.status} = 'failed')::int`,
      lastRunAt: sql<Date>`max(${automationRuns.createdAt})`,
    })
    .from(automationRuns)
    .where(sql`${automationRuns.createdAt} > now() - interval '30 days'`)
    .groupBy(automationRuns.automationId)
    .orderBy(automationRuns.automationId);
}
