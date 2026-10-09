import { getDb } from "@/db/client";
import { recordAudit, type AuditActor } from "@/lib/audit/record";
import { log } from "@/lib/log";

/**
 * Maps Better Auth endpoints to audit actions. Auth state changes happen inside
 * Better Auth, outside the command layer, so they are audited here from an
 * `after` hook that sees the endpoint path, the outcome and the user.
 */
const SUCCESS_ACTIONS: Record<string, string> = {
  "/sign-out": "auth.signed_out",
  "/two-factor/enable": "auth.mfa_enrollment_started",
  "/two-factor/generate-backup-codes": "auth.backup_codes_regenerated",
  "/change-password": "auth.password_changed",
  "/revoke-session": "auth.session_revoked",
  "/revoke-sessions": "auth.sessions_revoked",
  "/revoke-other-sessions": "auth.other_sessions_revoked",
};

const FAILURE_ACTIONS: Record<string, string> = {
  "/sign-in/email": "auth.sign_in_failed",
  "/two-factor/verify-totp": "auth.mfa_failed",
  "/two-factor/verify-backup-code": "auth.mfa_failed",
  "/change-password": "auth.password_change_failed",
};

type HookUser = { id: string; email: string; twoFactorEnabled?: boolean | null };

export type AuthHookInput = {
  path: string;
  /** The endpoint's return value, or an APIError-like object on failure. */
  returned: unknown;
  /** User from the request's existing session, if any. */
  sessionUser: HookUser | null;
  /** User from a session created by this request (sign-in or MFA completion). */
  newSessionUser: HookUser | null;
  body: unknown;
  ip: string | null;
  userAgent: string | null;
};

export function isErrorResult(returned: unknown): boolean {
  if (returned === null || typeof returned !== "object") return false;
  const r = returned as { statusCode?: unknown; status?: unknown };
  return typeof r.statusCode === "number" && r.statusCode >= 400;
}

function attemptedEmail(body: unknown): string | null {
  if (body && typeof body === "object" && "email" in body && typeof body.email === "string") {
    return body.email.toLowerCase().slice(0, 254);
  }
  return null;
}

/** Pure mapping from an auth endpoint outcome to an audit entry (unit-tested). */
export function auditForAuthEvent(input: AuthHookInput): { action: string; actor: AuditActor; metadata?: Record<string, unknown> } | null {
  const failed = isErrorResult(input.returned);
  const user = input.newSessionUser ?? input.sessionUser;
  const actor: AuditActor = user
    ? { type: "user", id: user.id, label: user.email }
    : { type: "anonymous", label: attemptedEmail(input.body) ?? undefined };

  if (failed) {
    const action = FAILURE_ACTIONS[input.path];
    if (!action) return null;
    const code = (input.returned as { body?: { code?: unknown } }).body?.code;
    return { action, actor, metadata: { code: typeof code === "string" ? code : undefined } };
  }

  // Sign-in: the password step succeeded. When the user has MFA enrolled, the
  // two-factor plugin replaces this session with a TOTP challenge after our hook
  // runs, so this is only the first factor. Without MFA (first sign-in), the
  // app confines the session to MFA enrollment.
  if (input.path === "/sign-in/email") {
    const r = input.returned as { twoFactorRedirect?: boolean } | null;
    if (r?.twoFactorRedirect || user?.twoFactorEnabled) return { action: "auth.password_verified", actor };
    return user ? { action: "auth.signed_in", actor, metadata: { method: "password", mfa: "pending_enrollment" } } : null;
  }

  if (input.path === "/two-factor/verify-totp" || input.path === "/two-factor/verify-backup-code") {
    const method = input.path.endsWith("backup-code") ? "backup_code" : "totp";
    // Verifying the first TOTP code during enrollment completes enrollment.
    if (input.sessionUser && !input.sessionUser.twoFactorEnabled) {
      return { action: "auth.mfa_enabled", actor, metadata: { method } };
    }
    return { action: "auth.signed_in", actor, metadata: { method: "password", mfa: method } };
  }

  const action = SUCCESS_ACTIONS[input.path];
  return action ? { action, actor } : null;
}

export async function recordAuthEvent(input: AuthHookInput): Promise<void> {
  const entry = auditForAuthEvent(input);
  if (!entry) return;
  try {
    await recordAudit(getDb(), {
      ...entry,
      entityType: entry.actor.type === "user" ? "user" : null,
      entityId: entry.actor.type === "user" ? entry.actor.id : null,
      request: { ip: input.ip, userAgent: input.userAgent, requestId: null },
    });
  } catch (err) {
    // An auth event that cannot be audited is an operational alarm, not a user-facing failure.
    log.error("auth audit write failed", { err, action: entry.action });
  }
}
