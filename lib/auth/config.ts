/** Session and credential policy (spec Section 4: "Access"). */
export const AUTH_POLICY = {
  /** Idle timeout. The session expires this long after the last refresh. */
  idleTimeoutSeconds: 30 * 60,
  /** Sessions refresh at most this often while the user is active. */
  refreshIntervalSeconds: 60,
  /** Hard cap regardless of activity; the user signs in again after this. */
  absoluteLifetimeSeconds: 12 * 60 * 60,
  /** Sensitive actions (change password, regenerate backup codes) need a session this fresh. */
  freshSessionSeconds: 15 * 60,
  /** Client shows a sign-out warning this long before the idle timeout. */
  idleWarningSeconds: 2 * 60,
  minPasswordLength: 12,
  maxPasswordLength: 128,
  inviteTtlHours: 72,
  backupCodeCount: 10,
} as const;

export const SESSION_COOKIE_PREFIX = "lexdesk";
