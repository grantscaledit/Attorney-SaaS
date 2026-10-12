# Build phases

Spec Section 11. A phase closes only when its acceptance criteria pass, tests are green, the demo
seed is updated and its runbook entry exists.

| Phase                         | Status                   |
| ----------------------------- | ------------------------ |
| 0. Foundation                 | Complete, pending review |
| 1. GHL sync and intake basics | Not started              |
| 2-8, V2                       | Not started              |

## Phase 0: Foundation

Scope: repo, CI, auth with MFA, RBAC, audit log, feature flags, firm settings, `render.yaml`,
`provision-firm.ts`, demo seed for a fictional firm.

### Acceptance criteria and evidence

| Criterion                                       | Evidence                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A new firm instance provisions from one command | `tests/integration/provision.test.ts` runs `provisionFirm()` against a fresh database: secrets, Blueprint, migrations, firm row, owner invite, audit chain verified. It refuses to provision over an existing firm and rejects bad input before creating anything                                                                                                                  |
| Every role's permissions pass tests             | `lib/auth/can.test.ts`: a hand-written matrix of 7 roles x 30 actions (210 cases), plus matter-scope, disabled-account and firm-policy cases. `e2e/phase0.spec.ts` confirms a paralegal is refused the audit log in the browser                                                                                                                                                    |
| Every mutation appears in the audit log         | `tests/integration/commands-audited.test.ts` runs every registered command and asserts its audit row; it fails if a command has no fixture. `tests/architecture/rules.test.ts` fails the build if code outside a command writes to the database. Auth events (sign-in, MFA, sign-out, failures) are audited from Better Auth hooks and checked in `tests/integration/auth.test.ts` |

### Also delivered

- Audit log is append-only at the database level (UPDATE, DELETE and TRUNCATE rejected) and
  SHA-256 hash-chained by a trigger. Verification runs nightly (worker), on demand from the Audit
  log page, and in tests, which include a simulated superuser tamper.
- Mandatory TOTP MFA with backup codes, account lockout, 30-minute idle timeout with a client
  warning, 12-hour absolute session limit, optional IP allowlist, disabled-user lockout.
- Tier gating for all 55 automation IDs plus platform features, with a hand-written tier test.
  Solo seat limit (5) enforced on invite and reactivation.
- Owner tools: invite with one-time setup links (hash stored only), role changes with last-owner
  protection, deactivation that ends sessions immediately, MFA reset, session revocation, audit log
  filtering and CSV export with hash columns.
- Health endpoint that refuses a database belonging to another firm.
- Light and dark themes, keyboard-accessible Radix primitives, CSP with per-request nonce.

### Open items and VERIFY

- **VERIFY** `render.yaml` against Render's current Blueprint spec. Render's docs were not
  reachable while this was written. Render resources are created from the rendered Blueprint by
  hand (runbook), not by API, until the API is verified.
- **Attorney review**: the default AI disclosure text in `modules/firm/schemas.ts`.
- Sentry is not wired yet. Errors go to structured logs on stdout and stderr.
- `pnpm audit` reports one moderate advisory in esbuild's dev server, reached through drizzle-kit
  (development tooling, not shipped). Tracked; the audit job is advisory until Phase 8.
- Break-glass vendor access (spec Section 4) and SSO arrive in Phase 8. `vendor_support` has no
  permissions until then.
