import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { accounts, sessions, userInvites, users } from "@/db/schema";
import { defineCommand } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";
import { newPassword } from "../schemas";
import { hashSetupToken } from "./setup-link";

const INVALID_LINK = "This link is invalid or has expired. Ask your firm's owner attorney for a new one.";

export const acceptInvite = defineCommand({
  name: "users.accept_invite",
  permission: "public",
  input: z
    .object({
      token: z.string().min(20).max(200),
      password: newPassword,
      confirmPassword: z.string(),
    })
    .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" }),
  async run(ctx, input) {
    const [invite] = await ctx.tx
      .select()
      .from(userInvites)
      .where(eq(userInvites.tokenHash, hashSetupToken(input.token)))
      .for("update");
    const now = new Date();
    if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt <= now) {
      throw new CommandError("invalid_state", INVALID_LINK);
    }

    const [user] = await ctx.tx.select().from(users).where(eq(users.id, invite.userId)).for("update");
    if (!user || user.status !== "active" || user.deletedAt) throw new CommandError("invalid_state", INVALID_LINK);

    if (input.password.toLowerCase().includes(user.email.split("@")[0]!.toLowerCase())) {
      throw new CommandError("validation", "Some fields need attention.", { password: ["Do not include your email name"] });
    }

    const hash = await hashPassword(input.password);
    const [credential] = await ctx.tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, "credential")));
    if (credential) {
      await ctx.tx.update(accounts).set({ password: hash, updatedAt: now }).where(eq(accounts.id, credential.id));
    } else {
      await ctx.tx.insert(accounts).values({ userId: user.id, accountId: user.id, providerId: "credential", password: hash });
    }

    await ctx.tx.update(userInvites).set({ acceptedAt: now, updatedAt: now }).where(eq(userInvites.id, invite.id));
    await ctx.tx.update(users).set({ emailVerified: true, updatedAt: now }).where(eq(users.id, user.id));
    // A reset link must not leave old sessions alive.
    await ctx.tx.delete(sessions).where(eq(sessions.userId, user.id));

    return {
      result: { email: user.email, firstTime: !credential },
      audit: [
        {
          action: credential ? "auth.password_reset_via_link" : "users.invite_accepted",
          actor: { type: "user", id: user.id, label: user.email },
          entityType: "user",
          entityId: user.id,
          metadata: { setupLinkId: invite.id },
        },
      ],
    };
  },
});
