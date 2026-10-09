# ADR 0001: Better Auth for authentication

Status: accepted (Phase 0)

## Context

The spec names Auth.js "or equivalent" with mandatory TOTP MFA, a 30-minute idle timeout, and SSO
(Microsoft Entra, Google) for the Firm tier. Auth.js has no built-in MFA, so TOTP enrollment,
backup codes, lockout and step-up would be custom security code.

## Decision

Use Better Auth, self-hosted in each firm's own Postgres through its Drizzle adapter, with the
two-factor plugin (TOTP, encrypted secrets, encrypted backup codes, account lockout).

- Sign-up, profile updates, password reset by email and MFA disable are turned off
  (`DISABLED_PATHS` in `lib/auth/auth.ts`). User lifecycle runs through audited commands.
- Sessions: 30-minute expiry refreshed at most once a minute while the person is active. No cookie
  cache, so revocation and deactivation take effect on the next request.
- Auth events are audited from Better Auth's `after` hook (`lib/auth/audit-hooks.ts`).

## Consequences

Less custom security code to own. SSO for the Firm tier uses Better Auth's SSO/OIDC support in
Phase 8. Upgrades of Better Auth need the auth integration tests, which exercise the real
request handler.
