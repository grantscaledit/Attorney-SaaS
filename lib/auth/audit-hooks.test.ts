import { describe, expect, it } from "vitest";
import { auditForAuthEvent, type AuthHookInput } from "./audit-hooks";

const base: AuthHookInput = {
  path: "/sign-in/email",
  returned: null,
  sessionUser: null,
  newSessionUser: null,
  body: { email: "Scott@Example.test", password: "hunter2hunter2" },
  ip: "203.0.113.5",
  userAgent: "test",
};
const user = { id: "u1", email: "u1@example.test", twoFactorEnabled: true };
const apiError = (code: string) => ({ statusCode: 401, status: "UNAUTHORIZED", body: { code } });

describe("auditForAuthEvent", () => {
  it("records a failed sign-in against the attempted email, never the password", () => {
    const e = auditForAuthEvent({ ...base, returned: apiError("INVALID_EMAIL_OR_PASSWORD") });
    expect(e).toEqual({
      action: "auth.sign_in_failed",
      actor: { type: "anonymous", label: "scott@example.test" },
      metadata: { code: "INVALID_EMAIL_OR_PASSWORD" },
    });
    expect(JSON.stringify(e)).not.toContain("hunter2");
  });

  it("records the password step when MFA is pending", () => {
    const e = auditForAuthEvent({ ...base, returned: { twoFactorRedirect: true } });
    expect(e?.action).toBe("auth.password_verified");
  });

  it("records only the password step for an enrolled user, even before the 2FA plugin rewrites the response", () => {
    const e = auditForAuthEvent({ ...base, returned: { token: "t" }, newSessionUser: user });
    expect(e?.action).toBe("auth.password_verified");
  });

  it("records a first sign-in (MFA not yet enrolled) as pending enrollment", () => {
    const e = auditForAuthEvent({ ...base, returned: { token: "t" }, newSessionUser: { ...user, twoFactorEnabled: false } });
    expect(e).toMatchObject({ action: "auth.signed_in", metadata: { mfa: "pending_enrollment" } });
  });

  it("records sign-in completion after TOTP", () => {
    const e = auditForAuthEvent({ ...base, path: "/two-factor/verify-totp", returned: { token: "x" }, newSessionUser: user });
    expect(e).toMatchObject({ action: "auth.signed_in", actor: { type: "user", id: "u1" }, metadata: { mfa: "totp" } });
  });

  it("records MFA enrollment when the first code is verified on an un-enrolled session", () => {
    const e = auditForAuthEvent({
      ...base,
      path: "/two-factor/verify-totp",
      returned: { token: "x" },
      sessionUser: { ...user, twoFactorEnabled: false },
    });
    expect(e?.action).toBe("auth.mfa_enabled");
  });

  it("records failed MFA codes", () => {
    const e = auditForAuthEvent({ ...base, path: "/two-factor/verify-totp", returned: apiError("INVALID_CODE") });
    expect(e?.action).toBe("auth.mfa_failed");
  });

  it("records sign-out and session revocation", () => {
    expect(auditForAuthEvent({ ...base, path: "/sign-out", returned: { success: true }, sessionUser: user })?.action).toBe(
      "auth.signed_out",
    );
    expect(
      auditForAuthEvent({ ...base, path: "/revoke-other-sessions", returned: { status: true }, sessionUser: user })?.action,
    ).toBe("auth.other_sessions_revoked");
  });

  it("ignores read-only endpoints", () => {
    expect(auditForAuthEvent({ ...base, path: "/get-session", returned: {}, sessionUser: user })).toBeNull();
  });
});
