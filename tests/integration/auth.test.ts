import { generateSync } from "otplib";
import { desc, eq, gt } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { auditLog, twoFactors, users } from "@/db/schema";
import { getAuth } from "@/lib/auth/auth";
import type { SessionUser } from "@/lib/commands/define";
import { acceptInvite } from "@/modules/users/commands/accept-invite";
import { inviteUser } from "@/modules/users/commands/invite";
import { deactivateUser } from "@/modules/users/commands/set-status";
import { asUser, provisionTestFirm, run, tokenFromSetupUrl, useFreshDatabase } from "./helpers";

/*
 * End-to-end auth through Better Auth's real request handler: invite, password,
 * mandatory TOTP enrollment, MFA sign-in, lockout of disabled users, and the
 * audit trail each step leaves.
 */

const { db } = useFreshDatabase();
const ORIGIN = "http://localhost:3000";
const PASSWORD = "a perfectly serviceable passphrase";

class Browser {
  private jar = new Map<string, string>();

  async call(path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
    const headers = new Headers({ origin: ORIGIN, "x-forwarded-for": "198.51.100.20", "user-agent": "vitest-browser" });
    if (body !== undefined) headers.set("content-type", "application/json");
    if (this.jar.size) headers.set("cookie", [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await getAuth().handler(
      new Request(`${ORIGIN}/api/auth${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    );
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const [name, ...rest] = pair!.split("=");
      const value = rest.join("=");
      const expired = attrs.some((a) => /max-age=0/i.test(a.trim())) || value === "";
      if (expired) this.jar.delete(name!.trim());
      else this.jar.set(name!.trim(), value);
    }
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }
}

function totpFrom(uri: string): string {
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) throw new Error("no secret in otpauth URI");
  return generateSync({ secret });
}

async function auditSince(seq: number) {
  return db().select().from(auditLog).where(gt(auditLog.seq, seq)).orderBy(auditLog.seq);
}

async function headSeq(): Promise<number> {
  const [row] = await db().select({ seq: auditLog.seq }).from(auditLog).orderBy(desc(auditLog.seq)).limit(1);
  return row?.seq ?? 0;
}

let owner: SessionUser;
let paralegalEmail: string;
let totpUri: string;

beforeAll(async () => {
  ({ owner } = await provisionTestFirm());
  paralegalEmail = "para@test-firm.example";
  const { setupUrl } = (await run(inviteUser, asUser(owner), { name: "Pat Paralegal", email: paralegalEmail, role: "paralegal" })) as {
    setupUrl: string;
  };
  await run(acceptInvite, { type: "anonymous" }, { token: tokenFromSetupUrl(setupUrl), password: PASSWORD, confirmPassword: PASSWORD });
});

describe("sign-in and mandatory MFA enrollment", () => {
  it("rejects a wrong password and audits the attempt without the password", async () => {
    const seq = await headSeq();
    const res = await new Browser().call("/sign-in/email", { email: paralegalEmail, password: "wrong password here" });
    expect(res.status).toBe(401);
    const rows = await auditSince(seq);
    expect(rows.map((r) => r.action)).toEqual(["auth.sign_in_failed"]);
    expect(rows[0]).toMatchObject({ actorType: "anonymous", actorLabel: paralegalEmail, ip: "198.51.100.20" });
    expect(JSON.stringify(rows)).not.toContain("wrong password");
  });

  it("first sign-in creates a session that must enroll TOTP, then enrollment completes MFA", async () => {
    const browser = new Browser();
    const signIn = await browser.call("/sign-in/email", { email: paralegalEmail, password: PASSWORD });
    expect(signIn.status).toBe(200);
    expect(signIn.json?.twoFactorRedirect).toBeUndefined();

    const session = await browser.call("/get-session");
    expect((session.json?.user as { twoFactorEnabled: boolean }).twoFactorEnabled).toBe(false);

    const enable = await browser.call("/two-factor/enable", { password: PASSWORD });
    expect(enable.status).toBe(200);
    totpUri = enable.json?.totpURI as string;
    expect(totpUri).toMatch(/^otpauth:\/\/totp\//);
    expect(enable.json?.backupCodes).toHaveLength(10);

    // Not enrolled until a code is verified.
    const [pending] = await db().select().from(twoFactors);
    expect(pending?.verified).toBe(false);

    const seq = await headSeq();
    const verify = await browser.call("/two-factor/verify-totp", { code: totpFrom(totpUri) });
    expect(verify.status).toBe(200);
    const [u] = await db().select().from(users).where(eq(users.email, paralegalEmail));
    expect(u?.twoFactorEnabled).toBe(true);
    expect((await auditSince(seq)).map((r) => r.action)).toContain("auth.mfa_enabled");

    // The stored TOTP secret is encrypted, not the base32 secret from the URI.
    const [tf] = await db().select().from(twoFactors);
    const uriSecret = new URL(totpUri).searchParams.get("secret")!;
    expect(tf?.secret).not.toContain(uriSecret);
  });

  it("subsequent sign-ins require the TOTP code before any session exists", async () => {
    const browser = new Browser();
    const seq = await headSeq();
    const signIn = await browser.call("/sign-in/email", { email: paralegalEmail, password: PASSWORD });
    expect(signIn.json?.twoFactorRedirect).toBe(true);
    expect((await browser.call("/get-session")).json).toBeNull();

    const bad = await browser.call("/two-factor/verify-totp", { code: "000000" });
    expect(bad.status).toBe(401);

    const good = await browser.call("/two-factor/verify-totp", { code: totpFrom(totpUri) });
    expect(good.status).toBe(200);
    const session = await browser.call("/get-session");
    expect((session.json?.user as { email: string }).email).toBe(paralegalEmail);

    const actions = (await auditSince(seq)).map((r) => r.action);
    expect(actions).toEqual(["auth.password_verified", "auth.mfa_failed", "auth.signed_in"]);

    const out = await browser.call("/sign-out", {});
    expect(out.status).toBe(200);
    expect((await browser.call("/get-session")).json).toBeNull();
    expect((await auditSince(seq)).at(-1)).toMatchObject({ action: "auth.signed_out", actorType: "user" });
  });

  it("sessions expire after 30 minutes idle", async () => {
    const browser = new Browser();
    await browser.call("/sign-in/email", { email: paralegalEmail, password: PASSWORD });
    await browser.call("/two-factor/verify-totp", { code: totpFrom(totpUri) });
    const s = (await browser.call("/get-session")).json?.session as { expiresAt: string; createdAt: string };
    const lifetimeMs = new Date(s.expiresAt).getTime() - Date.now();
    expect(lifetimeMs).toBeGreaterThan(29 * 60_000);
    expect(lifetimeMs).toBeLessThanOrEqual(30 * 60_000);
  });
});

describe("account controls", () => {
  it("disabled users cannot sign in, with the same error as a wrong password", async () => {
    const { setupUrl, userId } = (await run(inviteUser, asUser(owner), {
      name: "Leaving Soon",
      email: "leaving@test-firm.example",
      role: "intake",
    })) as { setupUrl: string; userId: string };
    await run(acceptInvite, { type: "anonymous" }, { token: tokenFromSetupUrl(setupUrl), password: PASSWORD, confirmPassword: PASSWORD });
    await run(deactivateUser, asUser(owner), { userId });

    const res = await new Browser().call("/sign-in/email", { email: "leaving@test-firm.example", password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.json?.code).toBe("INVALID_EMAIL_OR_PASSWORD");
  });

  it.each(["/sign-up/email", "/two-factor/disable", "/update-user", "/request-password-reset"])(
    "%s is not exposed",
    async (path) => {
      const res = await new Browser().call(path, {});
      expect(res.status).toBe(404);
    },
  );

  it("IP allowlist blocks sign-in from other networks", async () => {
    const { firmSettings } = await import("@/db/schema");
    const { invalidateFirmCaches } = await import("@/lib/firm.config");
    await db().update(firmSettings).set({ ipAllowlist: ["203.0.113.0/24"] });
    invalidateFirmCaches();
    const res = await new Browser().call("/sign-in/email", { email: paralegalEmail, password: PASSWORD });
    expect(res.status).toBe(403);
    await db().update(firmSettings).set({ ipAllowlist: [] });
    invalidateFirmCaches();
  });
});
