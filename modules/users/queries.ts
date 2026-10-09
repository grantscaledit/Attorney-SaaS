import "server-only";
import { and, asc, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { accounts, auditLog, sessions, userInvites, users } from "@/db/schema";
import { assertCan, type Actor } from "@/lib/auth/can";
import type { Role, UserStatus } from "@/lib/auth/roles";

export type UserListItem = {
  id: string;
  name: string;
  email: string;
  role: Role;
  title: string | null;
  status: UserStatus;
  twoFactorEnabled: boolean;
  /** Has set a password (accepted an invite). */
  hasPassword: boolean;
  pendingInviteExpiresAt: Date | null;
  lastSignInAt: Date | null;
  activeSessions: number;
  createdAt: Date;
};

const ROLE_ORDER = sql`array_position(ARRAY['owner_attorney','attorney','paralegal','intake','billing','client','vendor_support']::text[], ${users.role}::text)`;

export async function listUsers(actor: Actor): Promise<UserListItem[]> {
  assertCan(actor, "users.read");
  const db = getDb();
  const rows = await db
    .select()
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        inArray(users.role, ["owner_attorney", "attorney", "paralegal", "intake", "billing"]),
      ),
    )
    .orderBy(asc(sql`${users.status} = 'disabled'`), asc(ROLE_ORDER), asc(users.name));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [creds, invites, signIns, live] = await Promise.all([
    db
      .select({ userId: accounts.userId })
      .from(accounts)
      .where(
        and(
          inArray(accounts.userId, ids),
          eq(accounts.providerId, "credential"),
          sql`${accounts.password} IS NOT NULL`,
        ),
      ),
    db
      .select({ userId: userInvites.userId, expiresAt: max(userInvites.expiresAt) })
      .from(userInvites)
      .where(
        and(
          inArray(userInvites.userId, ids),
          isNull(userInvites.acceptedAt),
          isNull(userInvites.revokedAt),
          sql`${userInvites.expiresAt} > now()`,
        ),
      )
      .groupBy(userInvites.userId),
    db
      .select({ userId: auditLog.actorId, at: max(auditLog.occurredAt) })
      .from(auditLog)
      .where(and(eq(auditLog.action, "auth.signed_in"), inArray(auditLog.actorId, ids)))
      .groupBy(auditLog.actorId),
    db
      .select({ userId: sessions.userId, n: sql<number>`count(*)::int` })
      .from(sessions)
      .where(and(inArray(sessions.userId, ids), sql`${sessions.expiresAt} > now()`))
      .groupBy(sessions.userId),
  ]);

  const hasPassword = new Set(creds.map((c) => c.userId));
  const inviteBy = new Map(invites.map((i) => [i.userId, i.expiresAt]));
  const signInBy = new Map(signIns.map((s) => [s.userId, s.at]));
  const liveBy = new Map(live.map((l) => [l.userId, l.n]));

  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    title: u.title,
    status: u.status,
    twoFactorEnabled: u.twoFactorEnabled,
    hasPassword: hasPassword.has(u.id),
    pendingInviteExpiresAt: inviteBy.get(u.id) ?? null,
    lastSignInAt: signInBy.get(u.id) ?? null,
    activeSessions: liveBy.get(u.id) ?? 0,
    createdAt: u.createdAt,
  }));
}

export type AccessSummary = {
  activeUsers: number;
  mfaEnrolled: number;
  awaitingSetup: number;
  disabled: number;
};

export function summarizeAccess(list: UserListItem[]): AccessSummary {
  const active = list.filter((u) => u.status === "active");
  return {
    activeUsers: active.length,
    mfaEnrolled: active.filter((u) => u.twoFactorEnabled).length,
    awaitingSetup: active.filter((u) => !u.hasPassword || !u.twoFactorEnabled).length,
    disabled: list.length - active.length,
  };
}

/** The signed-in person's own recent sign-in activity (visible to every role). */
export async function myRecentAuthEvents(actor: Actor, limit = 8) {
  return getDb()
    .select({
      action: auditLog.action,
      occurredAt: auditLog.occurredAt,
      ip: auditLog.ip,
      userAgent: auditLog.userAgent,
    })
    .from(auditLog)
    .where(and(eq(auditLog.actorId, actor.id), sql`${auditLog.action} LIKE 'auth.%'`))
    .orderBy(desc(auditLog.seq))
    .limit(limit);
}
