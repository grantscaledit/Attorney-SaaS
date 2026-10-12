import { and, count, eq, inArray, isNull, ne } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { users, type UserRow } from "@/db/schema";
import { ASSIGNABLE_STAFF_ROLES } from "@/lib/auth/roles";
import { CommandError } from "@/lib/commands/errors";
import type { Tier } from "@/lib/env";
import { userLimit } from "@/lib/flags/evaluate";

export async function loadUserForUpdate(tx: DbOrTx, userId: string): Promise<UserRow> {
  const [row] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .for("update");
  if (!row) throw new CommandError("not_found", "That user no longer exists.");
  return row;
}

/** Snapshot for audit rows: identity and access fields only. */
export function userSnapshot(u: UserRow) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    title: u.title,
    twoFactorEnabled: u.twoFactorEnabled,
  };
}

export async function activeStaffCount(tx: DbOrTx, excludeUserId?: string): Promise<number> {
  const conditions = [
    eq(users.status, "active"),
    isNull(users.deletedAt),
    inArray(users.role, [...ASSIGNABLE_STAFF_ROLES]),
  ];
  if (excludeUserId) conditions.push(ne(users.id, excludeUserId));
  const [row] = await tx
    .select({ n: count() })
    .from(users)
    .where(and(...conditions));
  return row?.n ?? 0;
}

/** Tier gate: Solo is capped at 5 active staff users (spec Section 1). */
export async function assertSeatAvailable(tx: DbOrTx, tier: Tier): Promise<void> {
  const limit = userLimit(tier);
  if (limit === null) return;
  const active = await activeStaffCount(tx);
  if (active >= limit) {
    throw new CommandError(
      "limit",
      `The Solo plan includes up to ${limit} users and all ${limit} are in use. Deactivate a user or move to the Firm plan.`,
    );
  }
}

/** The firm must always keep at least one active owner attorney. */
export async function assertNotLastOwner(tx: DbOrTx, target: UserRow): Promise<void> {
  if (target.role !== "owner_attorney" || target.status !== "active") return;
  const [row] = await tx
    .select({ n: count() })
    .from(users)
    .where(
      and(
        eq(users.role, "owner_attorney"),
        eq(users.status, "active"),
        isNull(users.deletedAt),
        ne(users.id, target.id),
      ),
    );
  if ((row?.n ?? 0) === 0) {
    throw new CommandError(
      "invalid_state",
      "The firm must keep at least one active owner attorney.",
    );
  }
}
