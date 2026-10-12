import { eq } from "drizzle-orm";
import { z } from "zod";
import { WEBHOOK_AUTH_METHODS, webhookEvents } from "@/db/schema";
import { defineCommand } from "@/lib/commands/define";
import { requireSystem } from "@/lib/commands/system";

/**
 * Stores an authenticated webhook before any processing (spec Section 2).
 * The payload arrives already sanitized (lib/ghl/events.ts). A delivery with a
 * dedupe key seen before is not stored again; the repeat is still audited, so
 * the log shows every replay that reached us.
 */
export const ingestGhlWebhook = defineCommand({
  name: "ghl.ingest_webhook",
  permission: "firm.settings.update",
  input: z.object({
    dedupeKey: z.string().min(1).max(200),
    eventType: z.string().min(1).max(100),
    authMethod: z.enum(WEBHOOK_AUTH_METHODS),
    locationId: z.string().max(100).nullable(),
    payload: z.record(z.string(), z.unknown()),
  }),
  async run(ctx, input) {
    requireSystem(ctx);
    const [row] = await ctx.tx
      .insert(webhookEvents)
      .values({
        dedupeKey: input.dedupeKey,
        eventType: input.eventType,
        authMethod: input.authMethod,
        locationId: input.locationId,
        payload: input.payload,
      })
      .onConflictDoNothing({ target: webhookEvents.dedupeKey })
      .returning({ id: webhookEvents.id });

    if (row) {
      return {
        result: { eventId: row.id, duplicate: false },
        audit: [
          {
            action: "ghl.webhook_received",
            entityType: "webhook_event",
            entityId: row.id,
            metadata: { eventType: input.eventType, authMethod: input.authMethod },
          },
        ],
      };
    }

    const [existing] = await ctx.tx
      .select({ id: webhookEvents.id })
      .from(webhookEvents)
      .where(eq(webhookEvents.dedupeKey, input.dedupeKey));
    if (!existing) throw new Error("dedupe conflict without an existing row");
    return {
      result: { eventId: existing.id, duplicate: true },
      audit: [
        {
          action: "ghl.webhook_duplicate",
          entityType: "webhook_event",
          entityId: existing.id,
          metadata: { eventType: input.eventType, authMethod: input.authMethod },
        },
      ],
    };
  },
});
