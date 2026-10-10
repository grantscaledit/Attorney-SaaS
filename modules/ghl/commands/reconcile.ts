import { eq } from "drizzle-orm";
import { z } from "zod";
import { syncState } from "@/db/schema";
import type { AuditSpec } from "@/lib/commands/define";
import { defineCommand } from "@/lib/commands/define";
import { requireSystem } from "@/lib/commands/system";
import { ghlAppointment, ghlContact, ghlOpportunity } from "@/lib/ghl/schemas";
import { runTriggers } from "@/modules/intake/commands/automations";
import {
  lockContact,
  upsertAppointment,
  upsertContact,
  upsertOpportunity,
  type Trigger,
} from "@/modules/intake/commands/mirror";
import { mirrorContext } from "./process-webhook";

/** Sync processes tracked in sync_state. */
export const SYNC_KEYS = { reconcile: "ghl.reconcile" } as const;

/**
 * Applies one page of records read from the GHL API during nightly
 * reconciliation (spec Section 2). Uses the same mirror functions as
 * webhooks, so a record that a webhook already delivered is unchanged and
 * writes no audit row; anything a webhook missed is filled in and audited.
 */
export const reconcileGhlBatch = defineCommand({
  name: "ghl.reconcile_batch",
  permission: "firm.settings.update",
  input: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("contacts"),
      runId: z.string(),
      items: z.array(ghlContact).max(200),
    }),
    z.object({
      kind: z.literal("opportunities"),
      runId: z.string(),
      items: z.array(ghlOpportunity).max(200),
    }),
    z.object({
      kind: z.literal("appointments"),
      runId: z.string(),
      items: z.array(ghlAppointment).max(500),
    }),
  ]),
  async run(ctx, input) {
    requireSystem(ctx);
    const mctx = await mirrorContext(ctx.tx, { reconcileRunId: input.runId });
    const changes: AuditSpec[] = [];
    const triggers: Trigger[] = [];

    // Lock every contact in the page first, in a stable order, to avoid deadlocks with webhooks.
    const contactIds = [
      ...new Set(
        input.items
          .map((i) => ("contactId" in i ? i.contactId : i.id))
          .filter((v): v is string => typeof v === "string"),
      ),
    ].sort();
    for (const id of contactIds) await lockContact(ctx.tx, id);

    for (const item of input.items) {
      const r =
        input.kind === "contacts"
          ? (await upsertContact(mctx, item as z.output<typeof ghlContact>)).result
          : input.kind === "opportunities"
            ? await upsertOpportunity(mctx, item as z.output<typeof ghlOpportunity>)
            : await upsertAppointment(mctx, item as z.output<typeof ghlAppointment>);
      changes.push(...r.audit);
      // Only appointment changes matter after the fact: A7 reschedules reminders.
      triggers.push(...r.triggers.filter((t) => t.automation === "A7"));
    }

    const automations = await runTriggers(
      ctx.tx,
      triggers as Extract<Trigger, { automation: "A7" }>[],
    );
    changes.push(...automations.audit);

    return {
      result: { seen: input.items.length, changed: changes.length, messages: automations.messages },
      audit: [
        {
          action: "ghl.reconcile_batch",
          entityType: "sync_state",
          entityId: SYNC_KEYS.reconcile,
          metadata: {
            runId: input.runId,
            kind: input.kind,
            seen: input.items.length,
            changes: changes.length,
          },
        },
        ...changes,
      ],
    };
  },
});

/** Start and finish markers for a sync run, shown in Settings > Integrations. */
export const recordSyncRun = defineCommand({
  name: "ghl.record_sync_run",
  permission: "firm.settings.update",
  input: z.object({
    key: z.enum([SYNC_KEYS.reconcile]),
    runId: z.string(),
    phase: z.enum(["started", "succeeded", "failed"]),
    stats: z.record(z.string(), z.number()).optional(),
    error: z.string().max(500).optional(),
  }),
  async run(ctx, input) {
    requireSystem(ctx);
    const now = new Date();
    const [before] = await ctx.tx
      .select()
      .from(syncState)
      .where(eq(syncState.key, input.key))
      .for("update");
    const patch =
      input.phase === "started"
        ? { lastStartedAt: now }
        : input.phase === "succeeded"
          ? { lastSucceededAt: now, lastError: null, stats: { ...input.stats, runId: input.runId } }
          : {
              lastFailedAt: now,
              lastError: input.error ?? "unknown error",
              stats: { ...input.stats, runId: input.runId },
            };
    if (before) {
      await ctx.tx
        .update(syncState)
        .set({ ...patch, updatedAt: now })
        .where(eq(syncState.key, input.key));
    } else {
      await ctx.tx.insert(syncState).values({ key: input.key, ...patch });
    }
    return {
      result: { ok: true },
      audit: [
        {
          action: `ghl.sync_${input.phase}`,
          entityType: "sync_state",
          entityId: input.key,
          metadata: {
            runId: input.runId,
            ...(input.stats ?? {}),
            ...(input.error ? { error: input.error } : {}),
          },
        },
      ],
    };
  },
});
