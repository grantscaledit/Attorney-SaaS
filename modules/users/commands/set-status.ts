import { eq } from "drizzle-orm";
import { z } from "zod";
import { sessions, users } from "@/db/schema";
import { defineCommand } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";
import { assertNotLastOwner, assertSeatAvailable, loadUserForUpdate, userSnapshot } from "../guards";
import { userId } from "../schemas";

export const deactivateUser = defineCommand({
  name: "users.deactivate",
  permission: "users.deactivate",
  input: z.object({ userId }),
  async run(ctx, input) {
    const before = await loadUserForUpdate(ctx.tx, input.userId);
    if (ctx.principal.type === "user" && ctx.principal.user.id === before.id) {
      throw new CommandError("invalid_state", "You cannot deactivate your own account.");
    }
    if (before.status === "disabled") throw new CommandError("invalid_state", "That user is already deactivated.");
    await assertNotLastOwner(ctx.tx, before);

    const [after] = await ctx.tx
      .update(users)
      .set({ status: "disabled", updatedAt: new Date() })
      .where(eq(users.id, before.id))
      .returning();
    if (!after) throw new Error("update returned no row");
    // Immediate effect: end every session the user holds.
    const ended = await ctx.tx.delete(sessions).where(eq(sessions.userId, before.id)).returning({ id: sessions.id });

    return {
      result: { userId: after.id },
      audit: [
        {
          action: "users.deactivated",
          entityType: "user",
          entityId: after.id,
          before: userSnapshot(before),
          after: userSnapshot(after),
          metadata: { sessionsEnded: ended.length },
        },
      ],
    };
  },
});

export const reactivateUser = defineCommand({
  name: "users.reactivate",
  permission: "users.deactivate",
  input: z.object({ userId }),
  async run(ctx, input) {
    const before = await loadUserForUpdate(ctx.tx, input.userId);
    if (before.status === "active") throw new CommandError("invalid_state", "That user is already active.");
    await assertSeatAvailable(ctx.tx, ctx.tier);

    const [after] = await ctx.tx
      .update(users)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(users.id, before.id))
      .returning();
    if (!after) throw new Error("update returned no row");

    return {
      result: { userId: after.id },
      audit: [
        {
          action: "users.reactivated",
          entityType: "user",
          entityId: after.id,
          before: userSnapshot(before),
          after: userSnapshot(after),
        },
      ],
    };
  },
});
