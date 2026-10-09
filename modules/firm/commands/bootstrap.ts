import { count } from "drizzle-orm";
import { z } from "zod";
import { firmSettings, users, PRACTICE_AREAS } from "@/db/schema";
import { defineCommand } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";
import { email, jobTitle, personName } from "@/modules/users/schemas";
import { userSnapshot } from "@/modules/users/guards";
import { issueSetupLink } from "@/modules/users/commands/setup-link";
import { DEFAULT_AI_DISCLOSURE } from "../schemas";

/**
 * First-run setup for a new firm database: the firm_settings row and the
 * first owner attorney, who receives a one-time setup link. Only runs on an
 * empty database. Executed by scripts/provision-firm.ts as a system principal.
 */
export const bootstrapFirm = defineCommand({
  name: "firm.bootstrap",
  permission: "firm.settings.update",
  input: z.object({
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/),
    legalName: z.string().trim().min(2).max(200),
    displayName: z.string().trim().min(2).max(120),
    practiceAreas: z.array(z.enum(PRACTICE_AREAS)).min(1),
    city: z.string().trim().max(100).optional(),
    state: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    owner: z.object({ name: personName, email, title: jobTitle }),
  }),
  async run(ctx, input) {
    if (ctx.principal.type !== "system") {
      throw new CommandError("forbidden", "Bootstrap runs from the provisioning script only.");
    }
    const [existing] = await ctx.tx.select({ n: count() }).from(firmSettings);
    const [people] = await ctx.tx.select({ n: count() }).from(users);
    if ((existing?.n ?? 0) > 0 || (people?.n ?? 0) > 0) {
      throw new CommandError(
        "conflict",
        "This database already holds a firm. Bootstrap only runs on an empty database.",
      );
    }

    const [settings] = await ctx.tx
      .insert(firmSettings)
      .values({
        id: 1,
        slug: input.slug,
        legalName: input.legalName,
        displayName: input.displayName,
        practiceAreas: input.practiceAreas,
        city: input.city ?? null,
        state: input.state ?? null,
        aiDisclosureText: DEFAULT_AI_DISCLOSURE,
      })
      .returning();
    if (!settings) throw new Error("insert returned no row");

    const [owner] = await ctx.tx
      .insert(users)
      .values({
        name: input.owner.name,
        email: input.owner.email,
        title: input.owner.title,
        role: "owner_attorney",
      })
      .returning();
    if (!owner) throw new Error("insert returned no row");

    const link = await issueSetupLink(ctx.tx, owner.id, null);

    return {
      result: { ownerId: owner.id, setupUrl: link.url, expiresAt: link.expiresAt },
      audit: [
        {
          action: "firm.provisioned",
          entityType: "firm_settings",
          entityId: "1",
          after: {
            slug: settings.slug,
            legalName: settings.legalName,
            practiceAreas: settings.practiceAreas,
            tier: ctx.tier,
          },
        },
        {
          action: "users.invited",
          entityType: "user",
          entityId: owner.id,
          after: userSnapshot(owner),
          metadata: { setupLinkId: link.inviteId, expiresAt: link.expiresAt.toISOString() },
        },
      ],
    };
  },
});
