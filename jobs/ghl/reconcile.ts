import { randomUUID } from "node:crypto";
import { execute } from "@/lib/commands/execute";
import { getGhlClient, type GhlClient } from "@/lib/ghl/client";
import { QUEUES } from "@/lib/jobs/queue";
import { log } from "@/lib/log";
import { reconcileGhlBatch, recordSyncRun, SYNC_KEYS } from "@/modules/ghl/commands/reconcile";
import { jobContext } from "../context";
import { dispatchQueued } from "../messaging/send";

/** Nightly, 3:05am firm time (spec Section 2: "with a nightly reconciliation job"). */
export const GHL_RECONCILE_CRON = "5 3 * * *";

/** Appointments are compared from a week back to two months ahead. */
const APPOINTMENT_WINDOW = { pastDays: 7, futureDays: 60 } as const;
/** Guard against a pagination loop: 100 pages of 100 is far beyond a small firm's book. */
const MAX_PAGES = 100;

type Stats = Record<string, number>;

async function each<T>(
  label: string,
  fetchPage: (cursor: T | null) => Promise<{ items: unknown[]; next: T | null }>,
  apply: (items: unknown[]) => Promise<void>,
): Promise<number> {
  let cursor: T | null = null;
  let seen = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { items, next } = await fetchPage(cursor);
    if (items.length > 0) await apply(items);
    seen += items.length;
    if (!next) return seen;
    cursor = next;
  }
  log.warn("reconcile stopped at page limit", { label, seen });
  return seen;
}

/**
 * Re-reads contacts, opportunities and upcoming appointments from GHL and
 * applies any differences through the same mirror code as webhooks, so a
 * missed or failed webhook is repaired within a day.
 */
export async function reconcileGhl(
  client: GhlClient | null = getGhlClient(),
): Promise<{ ok: boolean; stats: Stats; errors: string[] }> {
  const runId = randomUUID();
  const { principal, request } = jobContext(QUEUES.ghlReconcile, runId);
  const run = (phase: "started" | "succeeded" | "failed", stats?: Stats, error?: string) =>
    execute(
      recordSyncRun,
      principal,
      { key: SYNC_KEYS.reconcile, runId, phase, stats, error },
      { request },
    );

  await run("started");
  if (!client) {
    await run("failed", {}, "GoHighLevel is not connected");
    return { ok: false, stats: {}, errors: ["not connected"] };
  }

  const stats: Stats = { contacts: 0, opportunities: 0, appointments: 0, changes: 0 };
  const errors: string[] = [];
  const apply =
    (kind: "contacts" | "opportunities" | "appointments") => async (items: unknown[]) => {
      for (let i = 0; i < items.length; i += 100) {
        const r = await execute(
          reconcileGhlBatch,
          principal,
          { kind, runId, items: items.slice(i, i + 100) },
          { request },
        );
        stats.changes! += r.changed;
        await dispatchQueued(r.messages);
      }
    };

  // Each kind is independent: one failing endpoint does not stop the others.
  try {
    stats.contacts = await each(
      "contacts",
      async (cursor: { startAfter: number | null; startAfterId: string } | null) => {
        const r = await client.listContacts(cursor ?? {});
        return { items: r.contacts, next: r.next };
      },
      apply("contacts"),
    );
  } catch (err) {
    errors.push(`contacts: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    stats.opportunities = await each(
      "opportunities",
      async (cursor: { startAfter: number | null; startAfterId: string | null } | null) => {
        const r = await client.searchOpportunities(cursor ?? {});
        return { items: r.opportunities, next: r.next };
      },
      apply("opportunities"),
    );
  } catch (err) {
    errors.push(`opportunities: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    const now = Date.now();
    const from = new Date(now - APPOINTMENT_WINDOW.pastDays * 86_400_000);
    const to = new Date(now + APPOINTMENT_WINDOW.futureDays * 86_400_000);
    for (const cal of await client.listCalendars()) {
      const events = await client.listCalendarEvents(cal.id, from, to);
      stats.appointments! += events.length;
      if (events.length > 0) await apply("appointments")(events);
    }
  } catch (err) {
    errors.push(`appointments: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (errors.length > 0) {
    log.error("ghl reconciliation finished with errors", { runId, errors, stats });
    await run("failed", stats, errors.join("; ").slice(0, 500));
    return { ok: false, stats, errors };
  }
  log.info("ghl reconciliation finished", { runId, stats });
  await run("succeeded", stats);
  return { ok: true, stats, errors };
}
