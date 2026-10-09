import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { accounts, sessions, userInvites, users } from "@/db/schema";
import type { SessionUser } from "@/lib/commands/define";
import { acceptInvite } from "@/modules/users/commands/accept-invite";
import { issueUserSetupLink } from "@/modules/users/commands/access";
import { inviteUser } from "@/modules/users/commands/invite";
import { deactivateUser, reactivateUser } from "@/modules/users/commands/set-status";
import { updateUser } from "@/modules/users/commands/update";
import { SYSTEM, asUser, provisionTestFirm, run, tokenFromSetupUrl, useFreshDatabase } from "./helpers";

process.env.FIRM_TIER = "solo";
const { db } = useFreshDatabase();

let owner: SessionUser;
const PASSWORD = "a long and unremarkable passphrase";

async function invite(email: string, role = "paralegal") {
  return (await run(inviteUser, asUser(owner), { name: "Person Example", email, role })) as {
    userId: string;
    setupUrl: string;
  };
}

beforeAll(async () => {
  ({ owner } = await provisionTestFirm());
});

describe("tier gating: Solo seat limit", () => {
  it("allows up to 5 active staff users and blocks the 6th", async () => {
    for (let i = 1; i <= 4; i++) await invite(`seat${i}@test-firm.example`);
    await expect(invite("seat5@test-firm.example")).rejects.toMatchObject({ code: "limit" });
  });

  it("frees a seat on deactivation and enforces the cap on reactivation", async () => {
    const [u] = await db().select().from(users).where(eq(users.email, "seat4@test-firm.example"));
    await run(deactivateUser, asUser(owner), { userId: u!.id });
    const extra = await invite("seat5@test-firm.example");
    expect(extra.userId).toBeTruthy();
    await expect(run(reactivateUser, asUser(owner), { userId: u!.id })).rejects.toMatchObject({ code: "limit" });
  });
});

describe("owner safeguards", () => {
  it("an owner cannot change their own role", async () => {
    await expect(
      run(updateUser, asUser(owner), { userId: owner.id, name: owner.name, role: "attorney" }),
    ).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("an owner cannot deactivate themselves", async () => {
    await expect(run(deactivateUser, asUser(owner), { userId: owner.id })).rejects.toMatchObject({
      code: "invalid_state",
    });
  });

  it("the firm always keeps one active owner attorney", async () => {
    const [p] = await db().select().from(users).where(eq(users.email, "seat1@test-firm.example"));
    await run(updateUser, asUser(owner), { userId: p!.id, name: "Second Owner", role: "owner_attorney" });
    const second: SessionUser = { id: p!.id, email: p!.email, name: "Second Owner", role: "owner_attorney", status: "active" };

    // With two owners, one may demote the other.
    await run(updateUser, asUser(second), { userId: owner.id, name: owner.name, role: "attorney" });
    // Now `second` is the only owner; even trusted system code cannot demote or deactivate them.
    await expect(run(updateUser, SYSTEM, { userId: second.id, name: second.name, role: "attorney" })).rejects.toMatchObject({
      code: "invalid_state",
    });
    await expect(run(deactivateUser, SYSTEM, { userId: second.id })).rejects.toMatchObject({ code: "invalid_state" });

    // Restore the original owner for the remaining tests.
    await run(updateUser, asUser(second), { userId: owner.id, name: owner.name, role: "owner_attorney" });
  });

  it("rejects duplicate emails", async () => {
    await expect(invite("seat1@test-firm.example")).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("setup links", () => {
  it("accepting sets a credential password, verifies the email and is single-use", async () => {
    const { userId, setupUrl } = await invite("newhire@test-firm.example").catch(async () => {
      // Seat cap may be reached by earlier tests; free one.
      const [u] = await db().select().from(users).where(eq(users.email, "seat3@test-firm.example"));
      await run(deactivateUser, asUser(owner), { userId: u!.id });
      return invite("newhire@test-firm.example");
    });
    const token = tokenFromSetupUrl(setupUrl);
    await run(acceptInvite, { type: "anonymous" }, { token, password: PASSWORD, confirmPassword: PASSWORD });

    const [account] = await db()
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")));
    expect(account?.password).toBeTruthy();
    expect(account?.password).not.toContain(PASSWORD);
    const [u] = await db().select().from(users).where(eq(users.id, userId));
    expect(u?.emailVerified).toBe(true);

    await expect(
      run(acceptInvite, { type: "anonymous" }, { token, password: PASSWORD, confirmPassword: PASSWORD }),
    ).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("stores only a hash of the token", async () => {
    const rows = await db().select({ tokenHash: userInvites.tokenHash }).from(userInvites);
    for (const r of rows) expect(r.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("issuing a new link revokes the previous one", async () => {
    const [u] = await db().select().from(users).where(eq(users.email, "newhire@test-firm.example"));
    const first = (await run(issueUserSetupLink, asUser(owner), { userId: u!.id })) as { setupUrl: string };
    await run(issueUserSetupLink, asUser(owner), { userId: u!.id });
    await expect(
      run(acceptInvite, { type: "anonymous" }, { token: tokenFromSetupUrl(first.setupUrl), password: PASSWORD, confirmPassword: PASSWORD }),
    ).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("rejects expired links", async () => {
    const [u] = await db().select().from(users).where(eq(users.email, "newhire@test-firm.example"));
    const link = (await run(issueUserSetupLink, asUser(owner), { userId: u!.id })) as { setupUrl: string };
    await db().execute(sql`UPDATE user_invites SET expires_at = now() - interval '1 minute' WHERE revoked_at IS NULL AND accepted_at IS NULL`);
    await expect(
      run(acceptInvite, { type: "anonymous" }, { token: tokenFromSetupUrl(link.setupUrl), password: PASSWORD, confirmPassword: PASSWORD }),
    ).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("rejects a password containing the email name and mismatched confirmation", async () => {
    const [u] = await db().select().from(users).where(eq(users.email, "newhire@test-firm.example"));
    const link = (await run(issueUserSetupLink, asUser(owner), { userId: u!.id })) as { setupUrl: string };
    const token = tokenFromSetupUrl(link.setupUrl);
    await expect(
      run(acceptInvite, { type: "anonymous" }, { token, password: "newhire-is-my-password", confirmPassword: "newhire-is-my-password" }),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(
      run(acceptInvite, { type: "anonymous" }, { token, password: PASSWORD, confirmPassword: PASSWORD + "x" }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("signed-in users cannot use public commands", async () => {
    await expect(run(acceptInvite, asUser(owner), { token: "x".repeat(40), password: PASSWORD, confirmPassword: PASSWORD })).rejects.toMatchObject({
      code: "invalid_state",
    });
  });
});

describe("deactivation", () => {
  it("ends the user's sessions immediately", async () => {
    const [u] = await db().select().from(users).where(eq(users.email, "seat2@test-firm.example"));
    await db().insert(sessions).values({ userId: u!.id, token: "t-" + u!.id, expiresAt: new Date(Date.now() + 60_000) });
    await run(deactivateUser, asUser(owner), { userId: u!.id });
    expect(await db().select().from(sessions).where(eq(sessions.userId, u!.id))).toHaveLength(0);
  });
});
