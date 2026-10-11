import { eq } from "drizzle-orm";
import { z } from "zod";
import { firmSettings } from "@/db/schema";
import { defineCommand } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";

export const feeEntry = z.object({
  service: z.string().trim().min(2).max(120),
  fee: z.string().trim().min(1).max(60),
});

/**
 * AI intake settings (spec Section 6): how A3 replies go out, which GHL
 * calendar it offers times from, and the published fees it may quote
 * verbatim. Kept apart from firm details so a change here is its own audit row.
 */
export const updateAiSettings = defineCommand({
  name: "firm.ai_settings.update",
  permission: "firm.settings.update",
  input: z.object({
    a3Mode: z.enum(["review_all", "auto_send_safe"]),
    consultCalendarId: z
      .string()
      .trim()
      .max(100)
      .optional()
      .transform((v) => v || null),
    feeTable: z.array(feeEntry).max(30),
  }),
  async run(ctx, input) {
    const [before] = await ctx.tx
      .select({
        a3Mode: firmSettings.a3Mode,
        consultCalendarId: firmSettings.consultCalendarId,
        feeTable: firmSettings.feeTable,
      })
      .from(firmSettings)
      .where(eq(firmSettings.id, 1))
      .for("update");
    if (!before)
      throw new CommandError("not_found", "Firm settings are missing. Re-run provisioning.");
    await ctx.tx
      .update(firmSettings)
      .set({
        ...input,
        updatedAt: new Date(),
        updatedBy: ctx.principal.type === "user" ? ctx.principal.user.id : null,
      })
      .where(eq(firmSettings.id, 1));
    return {
      result: { updated: true },
      audit: [
        {
          action: "firm.ai_settings.updated",
          entityType: "firm_settings",
          entityId: "1",
          before,
          after: input,
        },
      ],
    };
  },
});
