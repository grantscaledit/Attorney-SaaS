import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "@/db/schema";
import { defineCommand } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";
import { assertNotLastOwner, loadUserForUpdate, userSnapshot } from "../guards";
import { jobTitle, personName, staffRole, userId } from "../schemas";

export const updateUser = defineCommand({
  name: "users.update",
  permission: "users.update",
  input: z.object({ userId, name: personName, role: staffRole, title: jobTitle }),
  async run(ctx, input) {
    const before = await loadUserForUpdate(ctx.tx, input.userId);
    if (before.role === "client" || before.role === "vendor_support") {
      throw new CommandError("invalid_state", "This account is not managed from staff settings.");
    }

    const roleChanged = before.role !== input.role;
    if (roleChanged) {
      if (ctx.principal.type === "user" && ctx.principal.user.id === before.id) {
        throw new CommandError(
          "invalid_state",
          "You cannot change your own role. Ask another owner attorney.",
        );
      }
      if (before.role === "owner_attorney") await assertNotLastOwner(ctx.tx, before);
    }

    const [after] = await ctx.tx
      .update(users)
      .set({ name: input.name, role: input.role, title: input.title, updatedAt: new Date() })
      .where(eq(users.id, before.id))
      .returning();
    if (!after) throw new Error("update returned no row");

    return {
      result: { userId: after.id },
      audit: [
        {
          action: roleChanged ? "users.role_changed" : "users.updated",
          entityType: "user",
          entityId: after.id,
          before: userSnapshot(before),
          after: userSnapshot(after),
        },
      ],
    };
  },
});
