# LexDesk: engineering guide

LexDesk is a per-firm deployed law-firm operations platform built on top of GoHighLevel (GHL).
Owner: Giddens Systems LLC. The full product spec is `docs/spec/BUILDOUT.md`. Build one phase at a
time (spec Section 11). Do not start a phase until the previous phase's acceptance criteria pass.
Current phase status lives in `docs/phases.md`.

## Engineering rules (spec Section 3, non-negotiable)

1. TypeScript strict. No `any`. Zod-validate every external input (webhooks, forms, LLM output, CSV rows).
2. Every mutation writes an `audit_log` row: actor, action, entity, before, after, IP, timestamp. No exceptions.
3. Every LLM call goes through `lib/ai/call.ts`, which masks identifiers, logs to `ai_runs` (prompt hash, model, tokens, cost, output, reviewer), and enforces structured output with a Zod schema.
4. No AI output that is substantive reaches a client or prospect without passing the approval queue (spec Section 6). Only messages on the pre-approved template list send automatically.
5. The AI never gives legal advice, quotes outcomes, or confirms an attorney-client relationship. Enforced in system prompts and by a post-generation classifier that blocks and escalates.
6. Never log, store in plaintext, or send to an LLM: full SSN, EIN, bank or card numbers, dates of birth. Mask to last 4. Field-level encrypt where storage is required.
7. Deadlines computed by the system are advisory. Every screen showing a deadline carries the line "Verify against the source document. The firm's calendar is the system of record."
8. Secrets only in environment variables. Nothing firm-specific in the repo; firm config lives in `firm.config.ts` values loaded from the database.
9. Tests required for: deadline calculations, conflict matching, permission checks, masking, webhook idempotency, tier gating. No phase closes with failing tests.
10. All times stored UTC, displayed in firm timezone. Deadlines are date-only values in firm timezone.
11. Migrations are forward-only and run in CI before deploy.
12. Demo mode (`DEMO_MODE=true`) uses synthetic data only and can never connect to live GHL or send real messages.

Anything marked **VERIFY** in the spec must be checked against live vendor docs or by an attorney
before it ships. Do not code vendor endpoints or legal deadlines from memory.

## How the rules are enforced in code

| Rule               | Mechanism                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2 (audit)          | All domain writes go through `execute()` in `lib/commands`. It checks permission, runs the command in a transaction, and writes the audit row in the same transaction. Auth events are audited from Better Auth hooks in `lib/auth/audit-hooks.ts`. `tests/architecture` fails the build if a file outside the allowlist calls `.insert(`, `.update(` or `.delete(` on the database |
| 2 (immutability)   | `audit_log` has DB triggers that reject UPDATE, DELETE and TRUNCATE, and a SHA-256 hash chain computed in the database. `lib/audit/verify.ts` checks the chain                                                                                                                                                                                                                      |
| Permissions        | One policy in `lib/auth/can.ts`. Every page calls `requireUser()` or `requirePermission()`; `tests/architecture` enforces it. The role-by-action matrix in `lib/auth/can.test.ts` is explicit, so a policy change must also change the test                                                                                                                                         |
| Tiers              | `hasFeature(flag)` in `lib/flags`. Never branch on `FIRM_TIER` directly                                                                                                                                                                                                                                                                                                             |
| 6 (sensitive data) | `lib/log` redacts known sensitive keys. `lib/crypto/field.ts` gives AES-256-GCM field encryption with key versioning                                                                                                                                                                                                                                                                |
| 8 (secrets)        | `lib/env.ts` validates env with Zod at first use and refuses unsafe combinations (for example DEMO_MODE with a GHL token)                                                                                                                                                                                                                                                           |
| 11 (migrations)    | Drizzle migrations in `db/migrations`, generated only by `pnpm db:generate`. CI runs `pnpm db:check` (schema matches migrations) and applies them to a clean database                                                                                                                                                                                                               |

## Repo layout

```
/app            routes: (auth) sign-in, MFA; (app) dashboard and settings; api/
/modules        domain modules; each has commands/, queries, and UI pieces
/practice       practice-area plug-ins (tax/, business/, estate/), from Phase 2
/lib            auth, audit, commands, flags, crypto, env, log, ui
/db             schema, migrations, seed (demo firm)
/jobs           pg-boss worker and handlers, one file per automation ID
/ghl            snapshot manifest and workflow bodies, field map
/scripts        provision-firm.ts, migrate.ts, offboard-firm.ts (Phase 8)
/docs           ADRs, runbooks, security overview, phase log
/tests          integration and architecture tests (unit tests sit next to source)
/e2e            Playwright end-to-end tests
```

## Commands

```
pnpm dev                  # local app on :3000
pnpm worker               # pg-boss worker
pnpm lint && pnpm typecheck && pnpm format:check
pnpm test:unit            # pure unit tests, no database
pnpm test:integration     # needs DATABASE_URL pointing at a Postgres server (creates throwaway DBs)
pnpm test:e2e             # Playwright; needs a built app and seeded database
pnpm eval                 # live-model A3 evals; needs ANTHROPIC_API_KEY and Postgres
pnpm db:generate          # new migration from schema changes (never hand-edit applied migrations)
pnpm db:migrate           # apply migrations
pnpm db:seed:demo         # demo firm (DEMO_MODE=true only)
pnpm provision-firm --help
```

## Conventions

- Writes: define a command with `defineCommand()` in `modules/<area>/commands/`, register it in
  `lib/commands/registry.ts`, and add a fixture to `tests/integration/commands-audited.test.ts`.
  The test fails if a registered command has no fixture.
- Reads: plain functions in `modules/<area>/queries.ts`. They take an `Actor` and call `can()` first.
- UI copy is plain, specific and professional. No marketing language, no emoji.
- Never put a real client's data in fixtures, seeds, tests or screenshots. The demo firm uses
  synthetic people only.
- Commit messages reference automation IDs (A1, C2...) when relevant.
- GoHighLevel: every API call goes through `lib/ghl/client.ts`; every fact about GHL's API lives in
  `lib/ghl/endpoints.ts` with its source, and anything unverified is listed in
  `docs/ghl/api-notes.md`. Webhooks are stored first, then processed (ADR 0006).
- Automatic messages go through the outbox (`modules/messaging/commands/outbox.ts`): idempotency
  key, owner-approved template, consent, do-not-disturb and quiet hours. Never call
  `sendMessage` from anywhere else.
- Metrics: read `modules/metrics/definitions.ts`; never re-derive a dashboard number elsewhere.
- AI: call models only through `aiCall()` in `lib/ai/call.ts`, with a Zod schema and a prompt
  version. Never call a model inside a transaction: run it in a job, then apply the result with a
  command. Model text that is substantive goes to the approval queue (`createApproval()`), never
  to the outbox directly; drafts to prospects pass `checkDraft()` and the classifier first.
  Deterministic safety checks live in `lib/ai/guard.ts` with golden cases in
  `modules/*/evals/`; add a case for every bug. Tests use `ScriptedTransport`; demo mode uses
  `lib/ai/demo.ts` and never calls a live model. Design: ADR 0007.
- Matters and documents (ADR 0008): matter types, stages and checklists live in
  `practice/<area>/matters.ts`. Every matter read filters rows in SQL as well as calling `can()`
  with `scopeOf(matter)`. Files go through `lib/storage` (never the filesystem directly) under
  keys without client data; text goes through `lib/ocr`, then `maskText`, before anything else
  sees it. Portal pages call `requireClient()`; staff pages never serve clients.
- Deadlines (ADR 0009): trigger events and seed rules live in `practice/<area>/deadlines.ts`.
  Compute dates only through `computeDue()` in `modules/deadlines/engine.ts`, which refuses any
  rule whose verification hash does not match; never write a rule-origin deadline any other way
  (a database trigger also refuses). Date math uses `modules/deadlines/date-math.ts` on date-only
  strings. Show `DEADLINE_NOTICE` wherever a deadline appears. Never mark a seed rule verified in
  code, migrations or seeds outside the demo.
