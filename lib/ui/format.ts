/**
 * Display formatting. Rule 10: times are stored in UTC and shown in the firm's
 * time zone, which callers pass in (server components read it from env).
 */
export function formatDateTime(value: Date | string, timeZone: string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export function formatDate(value: Date | string, timeZone: string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

export function formatTime(value: Date | string, timeZone: string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

/** Short zone label for the firm, e.g. "CDT". */
export function timeZoneAbbreviation(timeZone: string, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone;
}

export function formatRelative(value: Date | string, now: Date = new Date()): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.round((d.getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(seconds, "second");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  return rtf.format(Math.round(seconds / 86400), "day");
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

/** "users.role_changed" -> "Role changed"; known actions get hand-written labels. */
const ACTION_LABELS: Record<string, string> = {
  "auth.signed_in": "Signed in",
  "auth.signed_out": "Signed out",
  "auth.password_verified": "Password verified (MFA pending)",
  "auth.sign_in_failed": "Sign-in failed",
  "auth.mfa_failed": "MFA code rejected",
  "auth.mfa_enabled": "MFA enabled",
  "auth.mfa_enrollment_started": "MFA enrollment started",
  "auth.backup_codes_regenerated": "Backup codes regenerated",
  "auth.password_changed": "Password changed",
  "auth.password_change_failed": "Password change failed",
  "auth.password_reset_via_link": "Password reset by link",
  "auth.session_revoked": "Session revoked",
  "auth.sessions_revoked": "Sessions revoked",
  "auth.other_sessions_revoked": "Other sessions revoked",
  "access.denied": "Access denied",
  "audit.exported": "Audit log exported",
  "audit.chain_verified": "Audit chain verified",
  "firm.provisioned": "Firm provisioned",
  "firm.settings.updated": "Firm settings updated",
  "flags.enabled": "Feature turned on",
  "flags.disabled": "Feature turned off",
  "users.invited": "User invited",
  "users.invite_accepted": "Invitation accepted",
  "users.updated": "User updated",
  "users.role_changed": "Role changed",
  "users.deactivated": "User deactivated",
  "users.reactivated": "User reactivated",
  "users.setup_link_issued": "Setup link issued",
  "users.mfa_reset": "MFA reset",
  "users.sessions_revoked": "Sessions ended by owner",
};

export function actionLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const last = action.split(".").pop() ?? action;
  const words = last.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
