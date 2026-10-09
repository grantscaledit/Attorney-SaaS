import { eq } from "drizzle-orm";
import { z } from "zod";
import { featureFlags } from "@/db/schema";
import { defineCommand } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";
import { FEATURE_FLAGS, type FeatureFlag } from "@/lib/flags/catalog";
import { tierIncludes } from "@/lib/flags/evaluate";

export const setFeatureEnabled = defineCommand({
  name: "flags.set",
  permission: "flags.update",
  input: z.object({
    flag: z.enum(FEATURE_FLAGS as [FeatureFlag, ...FeatureFlag[]]),
    enabled: z.boolean(),
    reason: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((v) => (v ? v : null)),
  }),
  async run(ctx, input) {
    if (!tierIncludes(ctx.tier, input.flag)) {
      throw new CommandError("invalid_state", "This feature is not included in the firm's plan.");
    }
    const [existing] = await ctx.tx
      .select()
      .from(featureFlags)
      .where(eq(featureFlags.key, input.flag))
      .for("update");
    const beforeEnabled = existing ? existing.enabled : true;
    if (beforeEnabled === input.enabled) {
      throw new CommandError("invalid_state", `Already ${input.enabled ? "on" : "off"}.`);
    }

    const updatedBy = ctx.principal.type === "user" ? ctx.principal.user.id : null;
    if (input.enabled) {
      // Back to the tier default: remove the override.
      await ctx.tx.delete(featureFlags).where(eq(featureFlags.key, input.flag));
    } else {
      await ctx.tx
        .insert(featureFlags)
        .values({ key: input.flag, enabled: false, reason: input.reason, updatedBy })
        .onConflictDoUpdate({
          target: featureFlags.key,
          set: { enabled: false, reason: input.reason, updatedBy, updatedAt: new Date() },
        });
    }

    return {
      result: { flag: input.flag, enabled: input.enabled },
      audit: [
        {
          action: input.enabled ? "flags.enabled" : "flags.disabled",
          entityType: "feature_flag",
          entityId: input.flag,
          before: { enabled: beforeEnabled },
          after: { enabled: input.enabled },
          metadata: input.reason ? { reason: input.reason } : null,
        },
      ],
    };
  },
});
