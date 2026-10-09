"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { sessions } from "@/db/schema";
import { getAuth } from "@/lib/auth/auth";
import { requireSession } from "@/lib/auth/session";

/**
 * Ends one of the signed-in user's own sessions by id. Session tokens are bearer
 * credentials, so they never go to the browser; the token is looked up here and
 * the revocation runs through Better Auth (audited by its hooks).
 */
export async function revokeOwnSessionAction(sessionId: string): Promise<{ ok: boolean }> {
  const { user } = await requireSession();
  const [row] = await getDb()
    .select({ token: sessions.token })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, user.id)));
  if (!row) return { ok: false };
  await getAuth().api.revokeSession({ headers: await headers(), body: { token: row.token } });
  revalidatePath("/settings/security");
  return { ok: true };
}
