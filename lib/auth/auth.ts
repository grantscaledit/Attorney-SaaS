import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { accounts, sessions, twoFactors, users, verifications } from "@/db/schema";
import { env } from "@/lib/env";
import { getIpAllowlist } from "@/lib/firm.config";
import { clientIpFromHeaders } from "./client-ip";
import { recordAuthEvent } from "./audit-hooks";
import { AUTH_POLICY, SESSION_COOKIE_PREFIX } from "./config";
import { isIpAllowed } from "./ip-allowlist";

/**
 * Better Auth endpoints LexDesk does not expose. User lifecycle (sign-up,
 * profile changes, password reset) goes through audited commands instead, and
 * MFA cannot be turned off because it is mandatory.
 */
const DISABLED_PATHS = [
  "/sign-up/email",
  "/update-user",
  "/change-email",
  "/delete-user",
  "/delete-user/callback",
  "/request-password-reset",
  "/reset-password",
  "/reset-password/:token",
  "/set-password",
  "/send-verification-email",
  "/verify-email",
  "/link-social",
  "/unlink-account",
  "/sign-in/social",
  "/two-factor/disable",
  "/two-factor/send-otp",
  "/two-factor/verify-otp",
];

/** Same message for unknown, wrong-password and disabled accounts (no account enumeration). */
const INVALID_CREDENTIALS = "Invalid email or password";

function createAuth() {
  const e = env();
  return betterAuth({
    appName: "LexDesk",
    baseURL: e.APP_URL,
    secret: e.AUTH_SECRET,
    trustedOrigins: [e.APP_URL],
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        twoFactor: twoFactors,
      },
    }),
    disabledPaths: DISABLED_PATHS,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      autoSignIn: false,
      minPasswordLength: AUTH_POLICY.minPasswordLength,
      maxPasswordLength: AUTH_POLICY.maxPasswordLength,
      revokeSessionsOnPasswordReset: true,
    },
    user: {
      additionalFields: {
        role: { type: "string", required: true, input: false },
        status: { type: "string", required: false, input: false, defaultValue: "active" },
        title: { type: "string", required: false, input: false },
      },
    },
    session: {
      expiresIn: AUTH_POLICY.idleTimeoutSeconds,
      updateAge: AUTH_POLICY.refreshIntervalSeconds,
      freshAge: AUTH_POLICY.freshSessionSeconds,
      // No cookie cache: every request checks the database, so disabling a user
      // or revoking a session takes effect immediately.
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: e.NODE_ENV === "production",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/two-factor/verify-totp": { window: 60, max: 10 },
        "/two-factor/verify-backup-code": { window: 60, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: SESSION_COOKIE_PREFIX,
      useSecureCookies: e.NODE_ENV === "production",
      database: { generateId: "uuid" },
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    plugins: [
      twoFactor({
        issuer: "LexDesk",
        totpOptions: { digits: 6, period: 30 },
        backupCodeOptions: {
          amount: AUTH_POLICY.backupCodeCount,
          length: 10,
          storeBackupCodes: "encrypted",
        },
        accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 15 * 60 },
      }),
      // Must stay last: lets server actions set auth cookies.
      nextCookies(),
    ],
    databaseHooks: {
      session: {
        create: {
          // Defense in depth: no session for a disabled or deleted user, whatever path created it.
          before: async (session) => {
            const [u] = await getDb()
              .select({ status: users.status, deletedAt: users.deletedAt })
              .from(users)
              .where(eq(users.id, String(session.userId)));
            if (!u || u.status !== "active" || u.deletedAt) return false;
            return undefined;
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const ip = ctx.headers ? clientIpFromHeaders(ctx.headers) : null;

        if (ctx.path === "/sign-in/email") {
          if (!isIpAllowed(ip, await getIpAllowlist())) {
            throw new APIError("FORBIDDEN", {
              message: "Sign-in is not allowed from this network.",
            });
          }
          const email = (ctx.body as { email?: unknown } | undefined)?.email;
          if (typeof email === "string") {
            const [u] = await getDb()
              .select({ status: users.status, deletedAt: users.deletedAt })
              .from(users)
              .where(eq(users.email, email.toLowerCase()));
            if (u && (u.status !== "active" || u.deletedAt)) {
              throw new APIError("UNAUTHORIZED", {
                message: INVALID_CREDENTIALS,
                code: "INVALID_EMAIL_OR_PASSWORD",
              });
            }
          }
        }

        // Resolve the session up front so the after hook knows who signed out or
        // whether a TOTP verification is an enrollment (existing session) or a sign-in.
        if (
          ctx.path === "/sign-out" ||
          ctx.path.startsWith("/two-factor/") ||
          ctx.path.startsWith("/revoke")
        ) {
          await getSessionFromCtx(ctx).catch(() => null);
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const sessionUser = ctx.context.session?.user as
          { id: string; email: string; twoFactorEnabled?: boolean } | undefined;
        const newSessionUser = ctx.context.newSession?.user as
          { id: string; email: string; twoFactorEnabled?: boolean } | undefined;
        await recordAuthEvent({
          path: ctx.path,
          returned: ctx.context.returned,
          sessionUser: sessionUser ?? null,
          newSessionUser: newSessionUser ?? null,
          body: ctx.body,
          ip: ctx.headers ? clientIpFromHeaders(ctx.headers) : null,
          userAgent: ctx.headers?.get("user-agent") ?? null,
        });
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __lexdeskAuth?: Auth };

/** Lazily constructed so `next build` does not need runtime secrets. */
export function getAuth(): Auth {
  globalForAuth.__lexdeskAuth ??= createAuth();
  return globalForAuth.__lexdeskAuth;
}
