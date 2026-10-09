import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { userInvites } from "@/db/schema";
import { AUTH_POLICY } from "@/lib/auth/config";
import { env } from "@/lib/env";

/**
 * One-time setup links, used both for new-user invitations and for resetting a
 * user's password. Only the SHA-256 of the token is stored; the URL is shown
 * once to the owner, who sends it to the user out of band.
 */
export function hashSetupToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function setupLinkUrl(token: string): string {
  return new URL(`/invite/${token}`, env().APP_URL).toString();
}

export type IssuedSetupLink = { url: string; expiresAt: Date; inviteId: string };

/** Revokes any open links for the user and issues a new one. Runs inside the caller's transaction. */
export async function issueSetupLink(tx: DbOrTx, userId: string, createdBy: string | null): Promise<IssuedSetupLink> {
  const now = new Date();
  await tx
    .update(userInvites)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(eq(userInvites.userId, userId), isNull(userInvites.acceptedAt), isNull(userInvites.revokedAt)));

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + AUTH_POLICY.inviteTtlHours * 3600 * 1000);
  const [row] = await tx
    .insert(userInvites)
    .values({ userId, tokenHash: hashSetupToken(token), expiresAt, createdBy })
    .returning({ id: userInvites.id });
  if (!row) throw new Error("failed to create setup link");
  return { url: setupLinkUrl(token), expiresAt, inviteId: row.id };
}
