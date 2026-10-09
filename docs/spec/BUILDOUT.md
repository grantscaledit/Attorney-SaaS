# LexDesk (working name): Law Firm AI Operations Platform

Buildout document for Claude Code. Owner: Giddens Systems LLC.
First niche: tax, business, and estate planning firms in Texas. Design partner profile: Siekierski Law PLLC (solo, McKinney, three practice areas, phone/email-only intake).

---

## 0. How to use this document

1. Copy Section 3 (Engineering rules) into `CLAUDE.md` at the repo root.
2. Build one phase at a time (Section 11). Do not start a phase until the previous phase's acceptance criteria pass.
3. Every automation in Section 7 has an ID. Reference the ID in commits, tests, and the `automations` registry.
4. Anything marked **VERIFY** must be checked against live vendor docs or by an attorney before it ships. Do not code vendor endpoints or legal deadlines from memory.

---

## 1. Product definition

**What it is:** a per-firm deployed web app that sits on top of GoHighLevel (GHL). It gives a law firm one screen for intake, matters, deadlines, revenue, and client lifecycle, plus a set of AI automations that work the pipeline for them.

**What the firm is buying at this price:** not software. A managed system with a named owner, an SLA, a security posture a lawyer can defend to a client, and a monthly report showing revenue the system produced. The build must make those four things provable.

### Decisions already made

| Decision | Choice |
|---|---|
| Deployment | Per firm: own app instance, own database, own storage bucket, own GHL sub-account, own secrets |
| Engine split | Custom app for everything differentiated. GHL for commodity plumbing (SMS, email, phone, calendars, forms, review links) |
| Legal software sync | V2 (Clio, MyCase, PracticePanther, QuickBooks, LawPay, Microsoft 365). V1 ships the adapter interface plus CSV import |
| Niche | Tax, business, estate first. Practice areas are plug-in modules |
| Tiers | Solo and Firm, one codebase, feature flags |

### Tiers

| | Solo (1-4 attorneys) | Firm (5-20 attorneys) |
|---|---|---|
| Price | ASSUMPTION: $7,500 setup, $1,500/mo. Confirm before quoting | $20,000 setup, $5,000/mo |
| Users | Up to 5 | Unlimited, SSO |
| Intake automations (A) | All except A4 | All |
| Matter and document (B) | All | All |
| Deadline engine (C) | All | All |
| Revenue (D) | D1-D3 | All |
| Lifecycle (E) | All | All |
| Marketing (F) | F1, F3 | All |
| Executive (G) | G1-G3, G7 | All |
| AI voice receptionist | No | Yes |
| Staff workload, multi-attorney routing | No | Yes |
| SLA | Next business day | 4-hour response, quarterly review |

Tier is a config value (`FIRM_TIER`). Never fork code by tier; gate with `hasFeature(flag)`.

---

## 2. Architecture

```
Website / phone / SMS / forms
          |
   GoHighLevel sub-account  <-- commodity: messaging, phone, calendar, forms, review links
          |  webhooks in, REST out
   +------v-------------------------------------------+
   |  LexDesk (one deployment per firm)               |
   |  Next.js app  |  Worker (jobs)  |  Cron          |
   |  Postgres     |  S3 bucket      |  Claude API    |
   +--------------------------------------------------+
          |
   Integration adapters (V1: CSV/manual. V2: Clio, QuickBooks, M365...)
```

### Stack

| Layer | Choice | Notes |
|---|---|---|
| App | Next.js (App Router), TypeScript strict | Server components for dashboards, route handlers for API and webhooks |
| DB | Postgres + Drizzle ORM | `pg_trgm` for conflict matching. One database per firm |
| Jobs | pg-boss | Postgres-backed queue, no extra infra per firm |
| Auth | Auth.js (or equivalent) with mandatory TOTP MFA | Firm tier: SSO via Microsoft Entra and Google |
| Storage | AWS S3, one bucket per firm, SSE-KMS, versioning on | Signed URLs only, 5-minute expiry |
| AI | Anthropic API | Model IDs in env. Defaults: `claude-haiku-4-5-20251001` for classification and chat turns, `claude-sonnet-5-5` for extraction and drafting, `claude-opus-5-5` for briefs and monthly reports. **VERIFY** current IDs at docs.claude.com |
| OCR | AWS Textract (or Tesseract fallback) | Runs before the LLM so identifiers can be masked |
| Hosting | Render: web service, background worker, cron jobs, managed Postgres | One Render project per firm, provisioned from `render.yaml` |
| UI | Tailwind + shadcn/ui, Recharts | Dense, professional, no marketing gloss |
| Observability | Sentry, structured JSON logs, uptime checks | Logs must never contain message bodies or document text |

### GHL boundary

GHL owns: phone numbers, call tracking, SMS and email delivery, A2P registration, calendars and booking pages, web forms, review request links, voice AI telephony (Firm tier).

LexDesk owns: the system of record for leads, matters, deadlines, documents, money, and every AI decision. GHL contacts and opportunities are mirrored into LexDesk by webhook, with a nightly reconciliation job.

- Use the current GHL API with a Private Integration Token scoped to the firm's sub-account. **VERIFY** endpoint paths, scopes, webhook event names, and rate limits against live GHL docs before writing the client.
- All GHL calls go through `lib/ghl/client.ts` with retry, backoff, and idempotency keys.
- Inbound webhooks: verify signature, write raw payload to `webhook_events`, return 200, process in a job.
- Ship one GHL snapshot (`/ghl/snapshot/`) containing pipelines, custom fields, calendars, and the thin workflows that fire webhooks. All logic lives in LexDesk, not in GHL workflows.

### Integration adapter interface (V2-ready)

```ts
interface PracticeAdapter {
  kind: 'csv' | 'clio' | 'mycase' | 'practicepanther' | 'quickbooks' | 'lawpay' | 'm365';
  pullMatters(since: Date): Promise<MatterInput[]>;
  pullTimeEntries(since: Date): Promise<TimeEntryInput[]>;
  pullInvoices(since: Date): Promise<InvoiceInput[]>;
  pullPayments(since: Date): Promise<PaymentInput[]>;
  pushDeadline?(d: Deadline): Promise<void>;
}
```

V1 implements `csv` (upload with column mapping, saved per firm) and manual entry. Every imported row stores `source` and `source_id`.

---

## 3. Engineering rules (copy into CLAUDE.md)

1. TypeScript strict. No `any`. Zod-validate every external input (webhooks, forms, LLM output, CSV rows).
2. Every mutation writes an `audit_log` row: actor, action, entity, before, after, IP, timestamp. No exceptions.
3. Every LLM call goes through `lib/ai/call.ts`, which masks identifiers, logs to `ai_runs` (prompt hash, model, tokens, cost, output, reviewer), and enforces structured output with a Zod schema.
4. No AI output that is substantive reaches a client or prospect without passing the approval queue (Section 6). Only messages on the pre-approved template list send automatically.
5. The AI never gives legal advice, quotes outcomes, or confirms an attorney-client relationship. Enforced in system prompts and by a post-generation classifier that blocks and escalates.
6. Never log, store in plaintext, or send to an LLM: full SSN, EIN, bank or card numbers, dates of birth. Mask to last 4. Field-level encrypt where storage is required.
7. Deadlines computed by the system are advisory. Every screen showing a deadline carries the line "Verify against the source document. The firm's calendar is the system of record."
8. Secrets only in environment variables. Nothing firm-specific in the repo; firm config lives in `firm.config.ts` values loaded from the database.
9. Tests required for: deadline calculations, conflict matching, permission checks, masking, webhook idempotency, tier gating. No phase closes with failing tests.
10. All times stored UTC, displayed in firm timezone. Deadlines are date-only values in firm timezone.
11. Migrations are forward-only and run in CI before deploy.
12. Demo mode (`DEMO_MODE=true`) uses synthetic data only and can never connect to live GHL or send real messages.

### Repo layout

```
/app            routes: (dashboard), (portal), api/webhooks, api/internal
/modules        intake, matters, documents, deadlines, revenue, lifecycle, marketing, briefs
/practice       tax/, business/, estate/   (plug-in modules, Section 8)
/lib            ai, ghl, auth, audit, masking, storage, adapters, flags
/db             schema, migrations, seed (demo firm)
/jobs           pg-boss handlers, one file per automation ID
/ghl            snapshot export, field map
/scripts        provision-firm.ts, offboard-firm.ts, restore-drill.ts
/docs           runbooks, security overview, onboarding checklist
```

---

## 4. Security and compliance requirements

These are build requirements, not a wish list. A lawyer's first question will be confidentiality.

| Requirement | Implementation |
|---|---|
| Isolation | Separate database, bucket, KMS key, and secrets per firm. No shared tables |
| Access | RBAC (Section 5), mandatory MFA, session timeout 30 min idle, IP allowlist option |
| Encryption | TLS in transit, encryption at rest, field-level encryption for sensitive columns |
| Audit | Immutable `audit_log`, exportable by the firm owner |
| Vendor access | Giddens staff have no standing access. Break-glass access is requested, approved by the firm owner in-app, time-boxed to 4 hours, fully logged |
| AI data handling | Mask before send. `ALLOW_RAW_DOCUMENT_TO_LLM=false` by default. **VERIFY** Anthropic commercial data-retention terms and document them in `/docs/security-overview.md` |
| Human in the loop | Approval queue for all substantive AI output |
| Client disclosure | Firm-editable disclosure text shown in chat, SMS first message, and portal: an AI assistant is in use, no legal advice, no attorney-client relationship until an engagement letter is signed |
| Messaging consent | Explicit SMS opt-in captured with timestamp and source. STOP/HELP honored. Quiet hours 8am-9pm recipient local time |
| Call recording | Always announce recording. Store consent flag per call |
| Retention | Firm-configurable retention per record type. `offboard-firm.ts` exports everything to the firm, then destroys data and keys, and produces a destruction certificate |
| Backups | Daily backups plus point-in-time recovery where the plan supports it. Quarterly restore drill, logged |
| Advertising content | Any public-facing content (F3, review replies) requires attorney approval before publishing |

Reference for the firm's own obligations: Texas Professional Ethics Committee Opinion 705 (February 2025) on generative AI covers competence, confidentiality, verification of AI output, and billing. The product's approval queue, masking, and audit trail exist so the firm can show compliance. This document is not legal advice; the pilot attorney must review the disclosure text and workflows.

---

## 5. Roles

| Role | Can |
|---|---|
| `owner_attorney` | Everything, including approvals, deadline rule verification, break-glass grants, data export |
| `attorney` | Own and assigned matters, approvals for own matters, all dashboards except firm financials (configurable) |
| `paralegal` | Matters, documents, deadlines, drafts. Cannot approve AI output to clients |
| `intake` | Leads, consults, conflict pre-screen results. No matter documents |
| `billing` | Revenue module, AR automations |
| `client` | Portal only: own matters, uploads, checklist, messages |
| `vendor_support` | Nothing by default. Break-glass only |

Permission checks live in one place (`lib/auth/can.ts`) and are unit tested per role per action.

---

## 6. AI layer

### Approval queue

Central inbox of pending AI outputs. Each item shows the draft, the source data it used, the automation ID, and Approve / Edit / Reject. Rejections require a reason, which is stored and fed into prompt evaluation. Metrics: approval rate, edit rate, time in queue, by automation.

**Auto-send allowed** (pre-approved templates with variable slots only): missed-call text-back, appointment confirmations and reminders, document checklist reminders, review requests, payment reminders, first-touch lead acknowledgement.

**Always queued:** anything describing a client's legal situation, status updates, pre-consult briefs, engagement and non-engagement letters, review replies, campaign content, anything mentioning amounts owed to a tax authority.

### Guardrails on every conversational AI

- System prompt states: intake assistant for the firm, collects information, books consults, cannot give legal advice or predict outcomes.
- Post-generation check blocks: advice, outcome predictions, fee quotes not in the firm's published fee table, statements that the firm represents the person.
- Escalate to a human immediately on: deadline within 10 days, mention of levy, garnishment, seizure, criminal investigation, death in the last 30 days, or the person asking for a human.
- Conversation transcript stored in full, linked to the lead.

### Evaluation

`/modules/*/evals/` holds golden test cases per automation (at least 20 each for A3, B3, A6). CI runs evals on prompt changes and fails on regression.

---

## 7. Automation catalog

Every automation is a row in the `automations` table with: ID, name, trigger, enabled flag, tier flag, config JSON, last run, success and failure counts. The firm can toggle each one from Settings.

### A. Intake and conversion

| ID | Automation | Trigger | Action |
|---|---|---|---|
| A1 | Missed-call text-back | GHL call status = missed | Template SMS within 60 seconds with booking link. Create or update lead |
| A2 | Instant lead response | Form, chat, or email lead created | Acknowledgement by SMS and email in under 60 seconds. Start A3 |
| A3 | AI intake assistant | Inbound web chat or SMS from a lead | Qualifying conversation by practice area (Section 8). Structured intake record. Offers consult slots |
| A4 | AI voice receptionist (Firm) | After-hours or overflow call | GHL voice AI answers, collects intake fields, posts transcript to LexDesk, which runs the same pipeline as A3 |
| A5 | Lead scoring and routing | Intake record complete | Score 0-100 (urgency, matter value band, fit). Assign practice area and attorney. Urgent leads page the attorney by SMS |
| A6 | Conflict pre-screen | Intake record complete | Fuzzy match of prospect, related parties, and businesses against contacts, matters, and adverse parties. Output is a flag list for a human. Never auto-clears |
| A7 | Consult booking and reminders | Appointment booked | Confirmation, 24h and 2h reminders, intake form link. No-show triggers rebooking sequence |
| A8 | Pre-consult brief | 12 hours before consult | One page for the attorney: who, issue, amounts, deadlines, documents received, conflict flags, suggested questions |
| A9 | Engagement letter draft and chase | Attorney marks "retain" | Draft from firm template with matter variables. Attorney approves. E-sign link sent. Reminders on day 2, 4, 7 |
| A10 | Unconverted lead nurture | Consult held, not retained after 7 days | 30/60/90-day sequence, attorney-approved copy, stops on reply |
| A11 | Non-engagement letter | Attorney marks "declined" or lead goes cold after consult | Draft non-engagement letter for approval and send. Log in file |
| A12 | Referral-out routing | Lead outside practice areas | Draft referral message using the firm's referral list. Track where it went |

### B. Matter and documents

| ID | Automation | Trigger | Action |
|---|---|---|---|
| B1 | Portal and checklist setup | Matter opened | Create client portal access and a document checklist from the matter-type template |
| B2 | Document chasing | Checklist item outstanding | Reminders on day 3, 7, 14, then task for staff. Stops when uploaded |
| B3 | Notice triage | Document uploaded and classified as a tax notice | OCR, mask, extract notice type, agency, tax year, amount, notice date, respond-by date. Create deadline (C1), summary, and task |
| B4 | Document classification and naming | Any upload | Classify type, rename to firm convention, attach to checklist item, flag illegible or incomplete pages |
| B5 | Stalled matter alert | Matter in one stage beyond the stage's threshold | Alert responsible attorney, appear in G1 brief |
| B6 | Client status update drafts | Stage change, or 14 days with no client contact | Draft plain-language update for approval |
| B7 | Matter summary and timeline | On demand, and weekly for active matters | Summary from notes, documents, and messages, with source links |
| B8 | Drafting assist | Attorney requests | First drafts from firm templates: IRS response letter skeleton, information for Form 2848, estate planning design summary from questionnaire, entity formation data sheet. Always labeled draft, always attorney-reviewed |
| B9 | Estate planning questionnaire | Estate matter opened | Guided portal questionnaire (family, assets, fiduciaries, goals). Output feeds B8 |
| B10 | Closing package | Matter marked complete | Closing letter draft, document return list, retention date set, triggers E7 and E2 |

### C. Deadlines

| ID | Automation | Trigger | Action |
|---|---|---|---|
| C1 | Deadline rules engine | Trigger event recorded (notice date, date of death, letters issued, entity formed) | Compute deadlines from verified rules (Section 8). Unverified rules cannot activate |
| C2 | Escalating alerts | Daily cron | Alerts at 30, 14, 7, 3, 1 days. SMS to attorney at 3 and 1. Unacknowledged critical alerts escalate to owner |
| C3 | Entity compliance calendar | Annual, per entity client | Franchise tax and information report reminders to client and firm, with a "want us to handle it" reply option |
| C4 | Probate milestone tracker | Probate matter opened | Milestone list with dates and status |
| C5 | Collection and compliance tracking | Tax resolution matter | Track collection statute expiration date, installment agreement payments, offer-in-compromise compliance period |
| C6 | Calendar push | Deadline created or changed | One-way push to the attorney's Google or Microsoft calendar |
| C7 | Deadline audit | Weekly | Report of matters with no deadlines, deadlines with no owner, and deadlines changed in the last 7 days |

### D. Revenue and billing

| ID | Automation | Trigger | Action |
|---|---|---|---|
| D1 | Receivables follow-up | Invoice past due | Reminders at 7, 21, 45 days, then task for billing |
| D2 | Unbilled time nudge | Weekly | List of unbilled entries and matters with activity but no time logged |
| D3 | Retainer balance alert | Trust or retainer balance below threshold | Replenishment request draft |
| D4 | Flat-fee profitability (Firm) | Matter closed | Hours logged vs fee, effective hourly rate, flagged if below target |
| D5 | General counsel utilization report (Firm) | Monthly | Per retainer client: hours used, matters handled, value delivered. Sent after approval |
| D6 | Revenue forecast (Firm) | Weekly | Pipeline-weighted forecast by practice area |

### E. Client lifecycle

| ID | Automation | Trigger | Action |
|---|---|---|---|
| E1 | Cross-sell gap detection | Nightly | Flags: business client without estate plan, estate client owning entities, tax client without entity review, entity without buy-sell or succession plan |
| E2 | Estate plan review cycle | 3 years after signing, or life-event signal | Review invitation, attorney-approved |
| E3 | Annual business checkup | Entity anniversary | Checklist outreach: minutes, ownership changes, agreements, registered agent |
| E4 | Law-change client alerts | Attorney enters a short note | Draft alert, segment the affected clients, queue for approval |
| E5 | Dormant client reactivation | On demand (onboarding) and quarterly | Segment clients inactive 18+ months, attorney-approved sequence. This is the Dormant Revenue Audit, run in week one to produce an early win |
| E6 | Referral partner tracking | Lead source = referral | Attribute to CPA, advisor, or attorney. Thank-you draft. Quarterly touch for top partners |
| E7 | Review requests | Matter closed with positive status | Request by SMS and email, one reminder. Never to clients flagged do-not-contact |
| E8 | Review monitoring and replies | New review detected | Draft reply that never confirms the reviewer is a client. Always queued |
| E9 | Satisfaction check | Mid-matter and at close | Two-question survey. Low scores alert the owner before any review request sends |

### F. Marketing

| ID | Automation | Trigger | Action |
|---|---|---|---|
| F1 | Source attribution | Every lead | Tracking numbers, UTM capture, first and last touch stored |
| F2 | Spend to retained client (Firm) | Weekly | Ad spend import, cost per lead, per consult, per retained client, by channel |
| F3 | Content drafts | Attorney enters bullet points | Blog post, newsletter, and Google Business Profile post drafts. Always queued |
| F4 | Local visibility tracking (Firm) | Weekly | Rank tracking for target terms, review velocity vs competitors |

### G. Executive

| ID | Automation | Trigger | Action |
|---|---|---|---|
| G1 | Daily brief | 7am firm time | Today's consults, deadlines in 7 days, approvals waiting, new leads, stalled matters |
| G2 | Weekly brief | Monday 7am | Funnel numbers, revenue, receivables, cold leads, wins, anything off trend |
| G3 | Monthly owner report | 1st of month | PDF: revenue attributed to the system, response times, conversion, reviews, hours saved estimate with method shown |
| G4 | Ask the dashboard (Firm) | User question | Natural language to SQL over allowlisted read-only views, row-limited, SQL shown to the user |
| G5 | Anomaly alerts (Firm) | Nightly | Lead volume, response time, show rate, or conversion outside normal range |
| G6 | Workload and capacity (Firm) | Weekly | Open matters, deadlines, and hours per attorney and paralegal |
| G7 | Task generation | Any automation needing a human | Creates an owned, dated task. No orphan alerts |

---

## 8. Practice modules

A module is a folder under `/practice/<area>/` exporting: intake question set, lead scoring weights, matter types and stages, document checklist templates, deadline rules, cross-sell rules, and prompt fragments. Adding a practice area must require no changes outside its folder.

### Intake fields

- **Tax:** agency (IRS, Texas Comptroller, other), notice type and date, respond-by date, tax years, approximate amount, individual or business, returns unfiled, levy or lien in place, prior representation.
- **Business:** need (formation, contract, dispute, sale or purchase, ongoing counsel), entity type and state, owners, revenue band, timeline, other parties (feeds A6).
- **Estate and probate:** planning or probate, marital status, children and minors, asset bands, real estate in other states, business ownership, existing documents and their age; for probate: date of death, county, will exists, named executor.

### Deadline rules: SEED VALUES, ATTORNEY MUST VERIFY

Each rule row has `verified_by` and `verified_at`. The engine refuses to compute from a rule where these are null. When a document prints a respond-by date, use the printed date and record the rule as a cross-check only.

| Rule | Trigger | Seed offset |
|---|---|---|
| IRS notice of deficiency, Tax Court petition | Notice date | 90 days (150 if addressed outside the US) |
| IRS collection due process hearing request | Notice date | 30 days |
| IRS 30-day letter, protest to Appeals | Letter date | 30 days |
| IRS CP2000 response | Notice date | Date printed on notice (commonly 30 days) |
| Collection statute expiration | Assessment date | 10 years, subject to tolling events entered manually |
| Offer in compromise compliance period | Acceptance date | 5 years |
| Texas Comptroller redetermination request | Date of audit result notification | 60 days |
| Texas franchise tax report | Annual | May 15 |
| Federal estate tax return | Date of death | 9 months |
| Texas will, application to probate | Date of death | 4 years |
| Texas probate inventory | Date of qualification | 90 days |
| Texas notice to beneficiaries | Order admitting will | 60 days |
| Texas published notice to creditors | Letters granted | 1 month |

These are starting points for the pilot attorney to confirm or correct. They are not legal advice and must not ship as verified.

---

## 9. Dashboard

Top bar on every screen: approvals waiting, deadlines in 7 days, unanswered leads. Each is a count that links to the list.

| Panel | Metrics (each with definition tooltip, trend, and drill-down) |
|---|---|
| Intake | Leads by source and practice area, median first-response time, missed calls and recovery rate, consult booked rate, show rate, consult-to-retained rate, lead-to-retained days, conflict flags pending |
| Pipeline | Open matters by type and stage, days in stage vs threshold, matters waiting on client, unsigned engagement letters, checklist completion |
| Deadlines | Next 7, 30, 90 days by severity, unacknowledged alerts, matters with no deadline, calendar view |
| Revenue | Fees by practice area and attorney, flat-fee vs hourly mix, retainer recurring revenue, unbilled time, receivables aging, average matter value, effective hourly rate on flat fees, forecast |
| Lifecycle | Cross-sell gaps by type with estimated value, estate plans due for review, dormant clients, referral partners ranked by revenue, client lifetime value |
| Reputation | Review count, average, and recency by platform, request-to-review rate, satisfaction scores |
| Marketing | Cost per lead, per consult, per retained client by channel, source-to-revenue |
| AI operations | Automations run, approval and edit rates, escalations, hours saved estimate, AI cost |
| System value | Revenue attributed to the system this month (recovered missed calls, reactivation, cross-sell, nurture) with the calculation shown |

Metric definitions live in `/modules/metrics/definitions.ts` as SQL views. The dashboard, briefs, monthly report, and G4 all read the same views so numbers never disagree.

**V1 data honesty:** revenue metrics come from CSV import or manual entry until V2 sync exists. Every revenue tile shows "Data as of <last import date>". Do not present stale data as live.

---

## 10. Data model (core tables)

`users`, `roles`, `sessions`, `audit_log`, `break_glass_grants`
`contacts`, `organizations`, `relationships` (spouse, owner-of, adverse-to), `consents`
`leads`, `intake_records`, `conversations`, `messages`, `calls`, `appointments`, `conflict_checks`, `conflict_hits`
`matters`, `matter_types`, `matter_stages`, `matter_parties`, `tasks`, `notes`
`documents`, `document_extractions`, `checklist_templates`, `checklist_items`
`deadline_rules`, `deadlines`, `deadline_alerts`
`time_entries`, `invoices`, `payments`, `retainers`, `import_batches`
`campaigns`, `campaign_sends`, `reviews`, `surveys`, `referral_sources`, `ad_spend`
`automations`, `automation_runs`, `ai_runs`, `approvals`, `templates`
`webhook_events`, `sync_state`, `firm_settings`, `feature_flags`

Every table: `id` (uuid), `created_at`, `updated_at`, `source`, `source_id` where imported. Soft delete only (`deleted_at`) outside the offboarding script.

---

## 11. Build phases

Each phase ends with: tests green, demo seed updated, a runbook entry, and the acceptance criteria below.

| Phase | Scope | Acceptance criteria |
|---|---|---|
| 0. Foundation | Repo, CI, auth with MFA, RBAC, audit log, feature flags, firm settings, `render.yaml`, `provision-firm.ts`, demo seed for a fictional firm | A new firm instance provisions from one command. Every role's permissions pass tests. Every mutation appears in the audit log |
| 1. GHL sync and intake basics | GHL client, webhook ingestion, contact and opportunity mirror, reconciliation job, Intake panel, A1, A2, A7, F1 | A missed call produces a text and a lead in under 60 seconds. Replayed webhooks do not duplicate records |
| 2. AI intake | AI layer, masking, approval queue, A3, A5, A6, A8, A10, A11, A12, evals | 20-case eval sets pass. Advice-seeking prompts are blocked and escalated. Conflict hits surface for known test collisions |
| 3. Matters and documents | Matters, stages, tasks, client portal, storage, B1-B10, A9, Pipeline panel | A sample IRS notice uploads, extracts correct fields with identifiers masked, and creates a matter summary. Client sees only their own matter |
| 4. Deadlines | Rules engine, verification workflow, C1-C7, Deadlines panel | Unverified rules cannot fire. Date math passes tests including weekends, month ends, leap years. Alerts escalate when unacknowledged |
| 5. Revenue | CSV adapter with column mapping, manual entry, D1-D6, Revenue panel | An exported billing CSV imports cleanly, re-import does not duplicate, tiles show data-as-of date |
| 6. Lifecycle and marketing | E1-E9, F2-F4, Lifecycle, Reputation, and Marketing panels | Cross-sell flags are correct on seeded data. Review request suppressed after a low satisfaction score. No campaign sends without approval |
| 7. Executive layer | G1-G7, AI operations and System value panels, monthly PDF | Brief numbers match dashboard numbers exactly. G4 cannot write, cannot read non-allowlisted tables |
| 8. Hardening | Security review, dependency audit, load test, restore drill, offboarding script, docs set, onboarding kit, Firm-tier features (SSO, A4) | Restore drill succeeds from backup. Offboarding exports and destroys a test firm. Security overview document is complete and accurate |
| V2 | Clio, MyCase, PracticePanther, QuickBooks, LawPay, Microsoft 365 adapters; two-way calendar | Per adapter: full sync, incremental sync, conflict handling, disconnect |

**Sellable pilot = phases 0-4 plus E5 and E7.** That covers the fastest wins: recovered calls, AI intake, notice triage, deadlines, reactivation, reviews.

---

## 12. Environment variables

```
FIRM_SLUG, FIRM_TIER, FIRM_TIMEZONE, DEMO_MODE
DATABASE_URL, DATABASE_URL_READONLY
AUTH_SECRET, SSO_* (Firm tier)
GHL_PRIVATE_TOKEN, GHL_LOCATION_ID, GHL_WEBHOOK_SECRET
ANTHROPIC_API_KEY, MODEL_FAST, MODEL_STANDARD, MODEL_DEEP
ALLOW_RAW_DOCUMENT_TO_LLM=false
S3_BUCKET, S3_REGION, KMS_KEY_ID, AWS_* (scoped to this firm's bucket only)
FIELD_ENCRYPTION_KEY
SENTRY_DSN
```

---

## 13. Deliverables outside the code

The price is not defensible without these. Create templates in `/docs` during phase 8.

- Master services agreement, data processing addendum, SLA with response times and credits
- Security overview (2 pages, plain language) and a completed vendor security questionnaire
- AI use policy template the firm can adopt, plus client disclosure language for engagement letters
- Onboarding checklist: GHL sub-account, A2P registration, number porting or forwarding, template approval session, deadline rule verification session, data import, staff training
- Runbooks: incident response, breach notification, backup restore, offboarding
- Monthly report template and quarterly business review deck outline

## 14. Known risks

1. **No track record at this price.** The agency's current tiers are far below $5,000 a month. The first firm should be a discounted design partner in exchange for a case study, a reference, and attorney review of the legal content in this spec.
2. **Solo firms cannot carry the Firm price.** Hence the Solo tier. Confirm the Solo numbers before quoting anyone.
3. **Revenue data is manual in V1.** Firms on Clio or similar will ask for sync on the first call. If the first three prospects all ask, pull the most common adapter forward.
4. **Deadline liability.** The contract must state deadlines are advisory, and the UI must say so everywhere. Carry errors-and-omissions and cyber coverage before the first paid deployment.
5. **No SOC 2.** Do not claim it. Say which audited vendors hold the data and show the security overview.
6. **Per-firm deployments multiply ops work.** Provisioning, upgrades, and monitoring must be scripted from phase 0 or support costs will eat the monthly fee.
