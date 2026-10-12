# Build phases

Spec Section 11. A phase closes only when its acceptance criteria pass, tests are green, the demo
seed is updated and its runbook entry exists.

| Phase                         | Status                                                             |
| ----------------------------- | ------------------------------------------------------------------ |
| 0. Foundation                 | Complete, pending review                                           |
| 1. GHL sync and intake basics | Complete, pending review and live GHL verification                 |
| 2. AI intake                  | Complete, pending review, attorney review and live model eval      |
| 3. Matters and documents      | Complete, pending review, attorney review and storage verification |
| 4-8, V2                       | Not started                                                        |

## Phase 3: Matters and documents

Scope: matters, stages, tasks, client portal, storage, B1-B10, A9, Pipeline panel. Design: ADR 0008. Setup and use: `docs/runbooks/matters-documents.md`.

### Acceptance criteria and evidence

| Criterion                                                                                                  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A sample IRS notice uploads, extracts correct fields with identifiers masked, and creates a matter summary | `tests/integration/matters-documents.test.ts`: a CP2000 PDF containing a full SSN, a bank account and a routing number goes through the real upload service, storage, the PDF text reader, masking, B4 and B3. The test checks the extracted fields (agency, notice, tax year, amount, notice date, respond-by date), that no full identifier is stored anywhere or sent to the model, the review and respond-by tasks, and the B7 matter summary. It runs with the model and without it. Model values not printed on the notice are ignored. A 21-case B3 eval (`modules/documents/evals`) runs on every build. `e2e/phase3.spec.ts` confirms the fields in the browser |
| Client sees only their own matter                                                                          | The same test file covers: portal list and matter page, uploads, downloads and questionnaire for another client's matter (refused); staff-only documents hidden on the client's own matter; the staff matter page unavailable to clients; attorneys limited to their own and assigned matters. In the browser, the client sees one matter and is redirected away from staff pages                                                                                                                                                                                                                                                                                        |

### Also delivered

- Storage in the firm's S3 bucket (SSE-KMS, 5-minute signed URLs, file type read from the bytes,
  25 MB limit) with every download audited. OCR uses Textract, or the PDF text layer.
- A9:
  - requires a cleared conflict pre-screen;
  - the letter comes from the firm's template (Settings > Engagement letter) and is approved
    before sending;
  - provider-neutral e-sign (the manual provider takes a pasted signing link);
  - reminders on days 2, 4 and 7;
  - signing opens the matter.
- B1 checklist and portal access; B2 reminders that stop when the documents arrive; B4 naming
  and quality flags; B5 stall tasks; B6 client updates for approval; B7 cited summaries; B8
  drafts labelled DRAFT; B9 portal questionnaire (masked, ages not dates of birth); B10 closing
  letter, retention date and document return.
- A6 now also checks parties on the firm's matters.
- UI:
  - Matters list and matter page;
  - lead page Retain;
  - client portal;
  - Pipeline panel (definitions in `modules/metrics`);
  - engagement letter settings.
- Demo seed: five matters, including a client (Jamie Rivera) who went through A9 and has portal
  access, and a triaged IRS notice.

### Open items and VERIFY

- **Storage**: create the bucket, key and IAM user. Then verify in staging that Textract can read
  KMS-encrypted objects and that signed URLs expire.
- **Attorney review**:
  - the default engagement letter;
  - the closing letter;
  - the B8 skeletons;
  - matter types, stage thresholds, checklists and retention years;
  - the B9 questionnaire wording;
  - the 21 B3 notice layouts against real notices.
- Deadlines read from notices are tasks until Phase 4's deadline engine (C1).
- Scanned uploads need Textract; without it only PDFs with a text layer are read.
- The live-model evals (Phase 2) are still to be run with a key.

## Phase 2: AI intake

Scope: AI layer, masking, approval queue, A3, A5, A6, A8, A10, A11, A12, evals. Design: ADR 0007.
Setup: `docs/runbooks/ai-intake.md`.

### Acceptance criteria and evidence

| Criterion                                        | Evidence                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 20-case eval sets pass                           | Deterministic, every CI run: 26 advice-seeking, 22 escalation and 8 non-escalation messages, 22 unsafe and 10 safe drafts (`modules/intake/evals/guard.eval.test.ts`); 22 A3 routing cases (`a3.eval.test.ts`); 22 A6 cases against Postgres (`tests/integration/conflicts-eval.test.ts`). Live model: the 14 A3 cases that reach the model, with `pnpm eval` (needs `ANTHROPIC_API_KEY`; not yet run, see open items) |
| Advice-seeking prompts are blocked and escalated | `tests/integration/ai-intake.test.ts`: an advice question hands off without a model call. The person gets only the approved hand-off text, an escalation waits in Approvals, and later messages do not restart the assistant. Drafts that give advice, or that the classifier flags, are blocked even in auto-send mode; a failed classifier counts as not safe                                                        |
| Conflict hits surface for known test collisions  | 16 known collisions surface: exact, nickname, reordered, initial and surname, misspellings, business names with and without suffixes, and parties named in answers. 6 near misses stay clear. Checks never clear themselves; only a lawyer can clear one, with a note                                                                                                                                                  |

### Also delivered

- `lib/ai/call.ts` is the only model call path. It masks identifiers, uses structured output with
  Zod, logs every call to `ai_runs` (hash, version, tokens, cost, reviewer), and records refusals
  and invalid output.
- The approval queue (Approvals) covers messages, letters, briefs, escalations and referrals.
  Edits and reject reasons are kept. The outbox refuses to send text that no person approved
  (rule 4).
- A3 runs as a job after commit, with deterministic escalation first, then the draft guard and
  classifier. Further details:
  - firm-chosen review or safe auto-send;
  - the disclosure goes in the first reply;
  - consult slots come from GHL free slots;
  - only the newest of quick messages is answered;
  - the sweep recovers lost jobs.
- A5 scoring and routing, with least-loaded routing on the Firm tier and an urgent SMS alert with
  no client details.
- A8 briefs carry the deadline notice; A10 nurture stops on reply or retention; A11 decline and
  cold-lead letters; A12 referrals with tracking.
- UI:
  - lead page: intake record, score, conflict review, refer out, decline;
  - Settings > AI intake, Conflict list and Referral partners;
  - the Intake panel's "Conflict flags pending" metric.
- Demo seed: six text conversations through the real A3 job with a rule-based model, plus
  conflict parties, referral partners, a brief and a letter. Playwright:
  `e2e/phase2.spec.ts` (the owner edits and approves a reply and clears a pre-screen; a paralegal
  cannot clear or decline).

### Open items and VERIFY

- **Live model eval**: run `pnpm eval` with a key (or add the CI secret) and record the result here.
- **Attorney review**:
  - the A3 system prompt (`modules/intake/a3-prompt.ts`) and classifier;
  - the A11 non-engagement letter and A12 referral wording (`modules/intake/followup-prompts.ts`);
  - the five new templates;
  - the urgency weights in the practice modules.
- **VERIFY** in a staging sub-account (`docs/ghl/api-notes.md`):
  - replies to web chat with `type: "Live_Chat"`;
  - free slots honour the calendar's buffers and notice.
- Escalation is broad by design ("no levy" escalates).

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
- ~~Conflict flags pending shows a dash until A6~~ (done in Phase 2).
- Call recording consent per call (spec Section 4) is not stored yet; GHL announces recording.
- ~~Inbound message text is not stored until masking exists~~: stored masked since Phase 2.

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
