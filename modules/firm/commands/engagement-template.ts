import { eq } from "drizzle-orm";
import { z } from "zod";
import { firmSettings } from "@/db/schema";
import { defineCommand } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";
import { unknownEngagementFields } from "@/modules/matters/engagement";

/** The firm's engagement letter template (A9). Owner-maintained; empty restores the product default. */
export const updateEngagementTemplate = defineCommand({
  name: "firm.engagement_template.update",
  permission: "firm.settings.update",
  input: z.object({ template: z.string().max(30_000) }),
  async run(ctx, input) {
    const template = input.template.trim();
    const unknown = unknownEngagementFields(template);
    if (unknown.length) {
      throw new CommandError("validation", "Some fields need attention.", {
        template: [
          `Unknown merge field${unknown.length > 1 ? "s" : ""}: ${unknown.map((u) => `{{${u}}}`).join(", ")}`,
        ],
      });
    }
    if (template && !template.includes("{{signingUrl}}")) {
      throw new CommandError("validation", "Some fields need attention.", {
        template: ["Include {{signingUrl}} so the client can sign."],
      });
    }
    const [before] = await ctx.tx
      .select({ t: firmSettings.engagementTemplate })
      .from(firmSettings)
      .where(eq(firmSettings.id, 1))
      .for("update");
    await ctx.tx
      .update(firmSettings)
      .set({
        engagementTemplate: template || null,
        updatedAt: new Date(),
        updatedBy: ctx.principal.type === "user" ? ctx.principal.user.id : null,
      })
      .where(eq(firmSettings.id, 1));
    return {
      result: { updated: true },
      audit: [
        {
          action: "firm.engagement_template.updated",
          entityType: "firm_settings",
          entityId: "1",
          before: { template: before?.t ?? null },
          after: { template: template || null },
        },
      ],
    };
  },
});
