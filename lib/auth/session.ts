import "server-only";
import { headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db/client";
import { recordAudit } from "@/lib/audit/record";
import { log } from "@/lib/log";
import { getRequestMeta } from "@/lib/request-context";
import { loadFirmSettings } from "@/lib/firm.config";
import { getAuth } from "./auth";
import { can, type Action, type CanContext, type FirmPolicy } from "./can";
import { AUTH_POLICY } from "./config";
import { isIpAllowed } from "./ip-allowlist";
import { isRole, type Role, type UserStatus } from "./roles";
import type { SessionUser } from "@/lib/commands/define";

export type CurrentUser = SessionUser & {
  title: string | null;
  twoFactorEnabled: boolean;
};

export type CurrentSession = {
  user: CurrentUser;
  sessionId: string;
  createdAt: Date;
  expiresAt: Date;
  policy: FirmPolicy;
};

type RawSessionUser = {
  id: string;
  email: string;
  name: string;
  role?: unknown;
  status?: unknown;
  title?: unknown;
  twoFactorEnabled?: boolean | null;
};

/** The Better Auth session for this request, memoized per request. */
export const getRawSession = cache(async () => {
  return getAuth().api.getSession({ headers: await headers() });
});

const loadPolicy = cache(
  async (): Promise<{ policy: FirmPolicy; ipAllowlist: readonly string[] }> => {
    const s = await loadFirmSettings();
    return {
      policy: { attorneysSeeFinancials: s.attorneysSeeFinancials },
      ipAllowlist: s.ipAllowlist,
    };
  },
);

function toCurrentUser(u: RawSessionUser): CurrentUser | null {
  if (!isRole(u.role)) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role as Role,
    status: (u.status === "active" ? "active" : "disabled") as UserStatus,
    title: typeof u.title === "string" ? u.title : null,
    twoFactorEnabled: u.twoFactorEnabled === true,
  };
}

type RequireOptions = {
  /** Only the MFA enrollment screen may be reached before MFA is set up. */
  allowPendingMfa?: boolean;
};

/**
 * Gate for every authenticated page and server action. Redirects to sign-in,
 * MFA enrollment, or an access page; never returns a partial session.
 */
async function loadSession(options: RequireOptions): Promise<CurrentSession> {
  const raw = await getRawSession();
  if (!raw) redirect("/sign-in");

  const user = toCurrentUser(raw.user as RawSessionUser);
  if (!user || user.status !== "active") redirect("/sign-out?reason=disabled");

  const createdAt = new Date(raw.session.createdAt);
  if (Date.now() - createdAt.getTime() > AUTH_POLICY.absoluteLifetimeSeconds * 1000) {
    redirect("/sign-out?reason=expired");
  }

  const { policy, ipAllowlist } = await loadPolicy();
  const meta = await getRequestMeta();
  if (!isIpAllowed(meta.ip, ipAllowlist)) redirect("/sign-out?reason=network");

  if (!user.twoFactorEnabled && !options.allowPendingMfa) redirect("/setup/mfa");

  return {
    user,
    sessionId: raw.session.id,
    createdAt,
    expiresAt: new Date(raw.session.expiresAt),
    policy,
  };
}

/** Staff app gate. Portal clients are sent to the portal; vendor accounts have no access. */
export async function requireSession(options: RequireOptions = {}): Promise<CurrentSession> {
  const session = await loadSession(options);
  if (session.user.role === "client") redirect("/portal");
  if (session.user.role === "vendor_support") forbidden();
  return session;
}

/** Client portal gate (Phase 3): portal clients only; staff are sent to the staff app. */
export async function requireClient(options: RequireOptions = {}): Promise<CurrentSession> {
  const session = await loadSession(options);
  if (session.user.role !== "client") redirect("/");
  return session;
}

/** Routes both staff and clients use (document download, upload). Permission is checked per resource. */
export async function requireAnySession(options: RequireOptions = {}): Promise<CurrentSession> {
  const session = await loadSession(options);
  if (session.user.role === "vendor_support") forbidden();
  return session;
}

export async function requireUser(options: RequireOptions = {}): Promise<CurrentUser> {
  return (await requireSession(options)).user;
}

/** requireUser plus a permission check; renders the 403 page when denied. */
export async function requirePermission(
  action: Action,
  ctx: Omit<CanContext, "policy"> = {},
): Promise<CurrentSession> {
  const session = await requireSession();
  if (!can(session.user, action, { ...ctx, policy: session.policy })) {
    // Attempts to reach a page outside one's role are security-relevant: record them.
    await recordAudit(getDb(), {
      actor: { type: "user", id: session.user.id, label: session.user.email },
      action: "access.denied",
      metadata: { permission: action, via: "page" },
      request: await getRequestMeta(),
    }).catch((err: unknown) => log.error("failed to audit page denial", { err }));
    forbidden();
  }
  return session;
}

/** For conditional UI: does the current user hold this permission? */
export async function currentUserCan(action: Action): Promise<boolean> {
  const session = await requireSession();
  return can(session.user, action, { policy: session.policy });
}
