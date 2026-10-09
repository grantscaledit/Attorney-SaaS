import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "@/db/schema";
import { defineCommand } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";
import { assertSeatAvailable, userSnapshot } from "../guards";
import { email, jobTitle, personName, staffRole } from "../schemas";
import { issueSetupLink } from "./setup-link";

export const inviteUser = defineCommand({
  name: "users.invite",
  permission: "users.invite",
  input: z.object({ name: personName, email, role: staffRole, title: jobTitle }),
  async run(ctx, input) {
    const [existing] = await ctx.tx.select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (existing) {
      throw new CommandError("conflict", "A user with that email already exists.", { email: ["Already in use"] });
    }
    await assertSeatAvailable(ctx.tx, ctx.tier);

    const [created] = await ctx.tx
      .insert(users)
      .values({ name: input.name, email: input.email, role: input.role, title: input.title, status: "active" })
      .returning();
    if (!created) throw new Error("insert returned no row");

    const createdBy = ctx.principal.type === "user" ? ctx.principal.user.id : null;
    const link = await issueSetupLink(ctx.tx, created.id, createdBy);

    return {
      result: { userId: created.id, setupUrl: link.url, expiresAt: link.expiresAt },
      audit: [
        {
          action: "users.invited",
          entityType: "user",
          entityId: created.id,
          after: userSnapshot(created),
          metadata: { setupLinkId: link.inviteId, expiresAt: link.expiresAt.toISOString() },
        },
      ],
    };
  },
});
