import { eq } from "drizzle-orm";
import { z } from "zod";
import { matters } from "@/db/schema";
import { defineCommand } from "@/lib/commands/define";
import { requireSystem } from "@/lib/commands/system";
import { maskText } from "@/lib/masking";
import { recordAutomationRun } from "@/modules/messaging/commands/outbox";
import { lockMatter } from "../scope";

/** B7 result. Internal to the firm, so it does not wait for approval; the source of each line is kept. */
export const applySummary = defineCommand({
  name: "matters.apply_summary",
  permission: "matters.write",
  input: z.object({
    matterId: z.uuid(),
    summary: z.string().min(1).max(4_000),
    timeline: z
      .array(
        z.object({
          date: z.iso.date(),
          event: z.string().max(300),
          source: z.object({
            type: z.enum(["note", "document", "message", "task"]),
            id: z.string().max(40),
          }),
        }),
      )
      .max(80),
    aiRunId: z.uuid().nullable(),
    trigger: z.enum(["on_demand", "weekly", "document"]),
  }),
  async run(ctx, input) {
    requireSystem(ctx);
    const m = await lockMatter(ctx.tx, input.matterId);
    const now = new Date();
    await ctx.tx
      .update(matters)
      .set({
        summary: maskText(input.summary).text,
        summaryTimeline: input.timeline.map((t) => ({ ...t, event: maskText(t.event).text })),
        summaryUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(matters.id, m.id));
    await recordAutomationRun(ctx.tx, {
      automationId: "B7",
      trigger: input.trigger,
      status: "succeeded",
      entityType: "matter",
      entityId: m.id,
      detail: { entries: input.timeline.length, ai: input.aiRunId !== null },
    });
    return {
      result: { updated: true },
      audit: [
        {
          action: "matters.summary_updated",
          entityType: "matter",
          entityId: m.id,
          metadata: { aiRunId: input.aiRunId, trigger: input.trigger },
        },
      ],
    };
  },
});
