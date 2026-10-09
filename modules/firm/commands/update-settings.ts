import { eq } from "drizzle-orm";
import { firmSettings, type FirmSettingsRow } from "@/db/schema";
import { isIpAllowed } from "@/lib/auth/ip-allowlist";
import { defineCommand } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";
import { firmSettingsInput } from "../schemas";

const snapshot = (s: FirmSettingsRow) => {
  const { createdAt: _c, updatedAt: _u, updatedBy: _b, provisionedAt: _p, ...rest } = s;
  return rest;
};

export const updateFirmSettings = defineCommand({
  name: "firm.settings.update",
  permission: "firm.settings.update",
  input: firmSettingsInput,
  async run(ctx, input) {
    const [before] = await ctx.tx
      .select()
      .from(firmSettings)
      .where(eq(firmSettings.id, 1))
      .for("update");
    if (!before)
      throw new CommandError("not_found", "Firm settings are missing. Re-run provisioning.");

    // Lockout guard: an allowlist that excludes the person saving it would sign them out on the next request.
    if (
      input.ipAllowlist.length > 0 &&
      ctx.principal.type === "user" &&
      !isIpAllowed(ctx.request.ip, input.ipAllowlist)
    ) {
      throw new CommandError("validation", "Some fields need attention.", {
        ipAllowlist: [
          `The list must include your current address (${ctx.request.ip ?? "unknown"}).`,
        ],
      });
    }

    const [after] = await ctx.tx
      .update(firmSettings)
      .set({
        ...input,
        updatedAt: new Date(),
        updatedBy: ctx.principal.type === "user" ? ctx.principal.user.id : null,
      })
      .where(eq(firmSettings.id, 1))
      .returning();
    if (!after) throw new Error("update returned no row");

    return {
      result: { updated: true },
      audit: [
        {
          action: "firm.settings.updated",
          entityType: "firm_settings",
          entityId: "1",
          before: snapshot(before),
          after: snapshot(after),
        },
      ],
    };
  },
});
