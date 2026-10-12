import { eq } from "drizzle-orm";
import { z } from "zod";
import { sessions, twoFactors, users } from "@/db/schema";
import { defineCommand } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";
import { loadUserForUpdate, userSnapshot } from "../guards";
import { userId } from "../schemas";
import { issueSetupLink } from "./setup-link";

/** New one-time link to set a password: the invite flow, reused for password resets. */
export const issueUserSetupLink = defineCommand({
  name: "users.issue_setup_link",
  permission: "users.update",
  input: z.object({ userId }),
  async run(ctx, input) {
    const target = await loadUserForUpdate(ctx.tx, input.userId);
    if (target.status !== "active")
      throw new CommandError("invalid_state", "Reactivate the user first.");
    const createdBy = ctx.principal.type === "user" ? ctx.principal.user.id : null;
    const link = await issueSetupLink(ctx.tx, target.id, createdBy);
    return {
      result: { setupUrl: link.url, expiresAt: link.expiresAt },
      audit: [
        {
          action: "users.setup_link_issued",
          entityType: "user",
          entityId: target.id,
          metadata: { setupLinkId: link.inviteId, expiresAt: link.expiresAt.toISOString() },
        },
      ],
    };
  },
});

/** Lost authenticator: remove the user's MFA enrollment and sessions. They must enroll again at next sign-in. */
export const resetUserMfa = defineCommand({
  name: "users.reset_mfa",
  permission: "users.update",
  input: z.object({ userId }),
  async run(ctx, input) {
    const before = await loadUserForUpdate(ctx.tx, input.userId);
    if (ctx.principal.type === "user" && ctx.principal.user.id === before.id) {
      throw new CommandError("invalid_state", "Ask another owner attorney to reset your MFA.");
    }
    await ctx.tx.delete(twoFactors).where(eq(twoFactors.userId, before.id));
    const [after] = await ctx.tx
      .update(users)
      .set({ twoFactorEnabled: false, updatedAt: new Date() })
      .where(eq(users.id, before.id))
      .returning();
    if (!after) throw new Error("update returned no row");
    const ended = await ctx.tx
      .delete(sessions)
      .where(eq(sessions.userId, before.id))
      .returning({ id: sessions.id });
    return {
      result: { userId: after.id },
      audit: [
        {
          action: "users.mfa_reset",
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

export const revokeUserSessions = defineCommand({
  name: "users.revoke_sessions",
  permission: "users.update",
  input: z.object({ userId }),
  async run(ctx, input) {
    const target = await loadUserForUpdate(ctx.tx, input.userId);
    const ended = await ctx.tx
      .delete(sessions)
      .where(eq(sessions.userId, target.id))
      .returning({ id: sessions.id });
    return {
      result: { sessionsEnded: ended.length },
      audit: [
        {
          action: "users.sessions_revoked",
          entityType: "user",
          entityId: target.id,
          metadata: { sessionsEnded: ended.length },
        },
      ],
    };
  },
});
