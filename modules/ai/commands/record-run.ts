import { z } from "zod";
import { AI_RUN_STATUSES, aiRuns } from "@/db/schema";
import { defineCommand } from "@/lib/commands/define";
import { requireSystem } from "@/lib/commands/system";

/**
 * Records one LLM call (rule 3). Written after the call returns, never
 * inside a transaction that waits on the model. Output arrives masked.
 */
export const recordAiRun = defineCommand({
  name: "ai.record_run",
  permission: "firm.settings.update",
  input: z.object({
    purpose: z.string().max(100),
    automationId: z.string().max(10).nullable(),
    model: z.string().max(100),
    servedModel: z.string().max(100).nullable(),
    promptHash: z.string().length(64),
    promptVersion: z.string().max(50),
    status: z.enum(AI_RUN_STATUSES),
    stopReason: z.string().max(50).nullable(),
    refusalCategory: z.string().max(50).nullable(),
    inputTokens: z.number().int().nullable(),
    outputTokens: z.number().int().nullable(),
    cacheReadTokens: z.number().int().nullable(),
    costUsd: z.number().nullable(),
    latencyMs: z.number().int().nullable(),
    maskedCounts: z.record(z.string(), z.number()),
    output: z.unknown().nullable(),
    error: z.string().max(500).nullable(),
    entityType: z.string().max(50).nullable(),
    entityId: z.string().max(100).nullable(),
  }),
  async run(ctx, input) {
    requireSystem(ctx);
    const [row] = await ctx.tx
      .insert(aiRuns)
      .values({ ...input, costUsd: input.costUsd === null ? null : input.costUsd.toFixed(6) })
      .returning({ id: aiRuns.id });
    if (!row) throw new Error("ai_runs insert returned no row");
    return {
      result: { runId: row.id },
      audit: [
        {
          action: "ai.run_recorded",
          entityType: "ai_run",
          entityId: row.id,
          metadata: {
            purpose: input.purpose,
            automationId: input.automationId,
            model: input.servedModel ?? input.model,
            status: input.status,
            tokens: (input.inputTokens ?? 0) + (input.outputTokens ?? 0),
            masked: input.maskedCounts,
          },
        },
      ],
    };
  },
});
