# Build phases

Spec Section 11. A phase closes only when its acceptance criteria pass, tests are green, the demo
seed is updated and its runbook entry exists.

| Phase                         | Status                                             |
| ----------------------------- | -------------------------------------------------- |
| 0. Foundation                 | Complete, pending review                           |
| 1. GHL sync and intake basics | Complete, pending review and live GHL verification |
| 2-8, V2                       | Not started                                        |

## Phase 1: GHL sync and intake basics

Scope: GHL client, webhook ingestion, contact and opportunity mirror, reconciliation job, Intake
panel, A1, A2, A7, F1. Design: ADR 0006. Setup: `docs/runbooks/ghl-setup.md`.

### Acceptance criteria and evidence

| Criterion                                                    | Evidence                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A missed call produces a text and a lead in under 60 seconds | `tests/integration/missed-call.test.ts` posts a missed-call webhook to the real route handler with the real pg-boss worker running; asserts the SMS reached GHL (faked HTTP only) with the booking link and the lead exists, in under 60 s. Measured: about 0.7 s                                                                                             |
| Replayed webhooks do not duplicate records                   | `tests/integration/ghl-webhooks.test.ts`: the same delivery 3 times in sequence and 5 concurrently, plus a duplicated processing job, gives one event, contact, lead, call, message and GHL send; redeliveries under new webhookIds and reworded bodies create nothing; opportunity replays update in place; older contact updates never overwrite newer ones |

### Also delivered

- Webhook authentication by shared secret (snapshot workflows) or GHL's RSA signature
  (Marketplace app); other sub-accounts rejected; payloads stored without message text, notes,
  custom field values, dates of birth or SSNs.
- Outbox with idempotency keys, at-most-once sending (ambiguous GHL failures are never resent),
  quiet hours 8am-9pm recipient time, do-not-disturb, SMS consent for A2, and owner approval of the
  exact text of every automatic message (Settings > Message templates).
- A7: confirmation with intake form link, 24 h and 2 h reminders, reschedule and cancel handling,
  no-show rebooking text and a follow-up cancelled by a new booking.
- F1: first and last touch per lead from UTM tags, click ids, referrer, GHL attribution and the
  dialed number, normalized to reporting sources.
- Intake panel with every spec metric that exists in Phase 1, definitions, trends and drill-down;
  leads list and lead detail; live "Unanswered leads" top-bar counter.
- Nightly reconciliation and a one-minute sweep; Settings > GoHighLevel shows connection, recent
  events with retry, reconciliation results and automation counts.
- Demo seed: 45 synthetic enquiries through the real webhook commands. Playwright:
  `e2e/phase1.spec.ts`.

### Open items and VERIFY

- **VERIFY** the seven GHL items in `docs/ghl/api-notes.md` (missed-call statuses, send-message
  body, contact list endpoint, appointment event types, workflow webhook headers and merge fields,
  dialed number, STOP handling) in a staging sub-account. The GHL docs site was not reachable from
  the build environment; the official docs repository was.
- **Attorney review**: the eight default message templates, the SMS consent wording on the form,
  and whether A1 (a reply to the person's own call) should be exempt from quiet hours. Today a
  missed call after 9pm is texted at 8am.
- Conflict flags pending shows a dash until A6 (Phase 2). Practice area is set only from the web
  form until A5 scoring (Phase 2).
- Call recording consent per call (spec Section 4) is not stored yet; GHL announces recording.
- Inbound message text is not stored (rule 6) until masking exists in Phase 2.

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
