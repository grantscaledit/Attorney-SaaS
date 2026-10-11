# Runbook: AI intake (Phase 2)

## Turn it on

1. Set `ANTHROPIC_API_KEY` on the web and worker services (Render environment group). Optional:
   `MODEL_FAST`, `MODEL_STANDARD` and `MODEL_DEEP` override the defaults in `lib/ai/models.ts`.
   Without a key, the assistant does not reply. Enquiries wait for staff in GoHighLevel as before.
2. **Settings > AI intake**:
   - Reply mode: keep **Review every reply** until the attorney has reviewed a few weeks of
     drafts.
   - Consult calendar: the GHL calendar ID whose free slots the assistant may offer.
   - Published fees: one per line, `Service | Fee`. The assistant may quote only these, word for
     word.
   - Lead routing: practice areas per attorney, and the GHL contact ID of each attorney's own
     phone for urgent alerts.
3. **Settings > Conflict list**: paste current and former clients, adverse parties and related
   parties, one per line.
4. **Settings > Referral partners**: who takes out-of-scope enquiries, with the areas they handle.
5. **Settings > Message templates**: approve `A3.handoff.sms`, `A5.urgent.sms` and the three A10
   nurture emails. Unapproved templates are never sent.
6. **Settings > Features**: A3, A5, A6, A8, A10, A11 and A12 can each be switched off.

## Daily use

- **Approvals** lists everything that waits for a person. Urgent items are listed first.
  - Escalations: the assistant stopped. Reply from GHL, then mark the item reviewed.
  - Replies: approve, edit, or reject with a reason. Reasons are kept for prompt review.
  - Briefs: one per consult, about 12 hours ahead. Deadlines in a brief are as the prospect stated
    them; verify them against the source document.
  - Letters (A11) and referrals (A12): review the wording for this person before approving.
- **Lead page**:
  - intake record, score, conflict pre-screen;
  - **Clear** or **Record a conflict** (attorneys);
  - **Refer out**;
  - **Decline**, which closes the lead and drafts the non-engagement letter.

## Checks

- Model calls and their cost over the last 30 days: Settings > AI intake.
- `ai_runs` holds every call: prompt hash and version, model, tokens, cost, masked output and the
  reviewer's outcome. The prompt text is never stored.
- A message that should have reached the assistant but did not: the worker's one-minute sweep
  retries A3 for inbound texts up to 24 hours old that have no `automation_runs` row.

## Evals

- `pnpm test:unit` runs the deterministic evals on every build:
  - advice detection, escalation triggers and the draft guard (`modules/intake/evals/guard.*`);
  - A3 routing (`a3.*`).
- `pnpm test:integration` runs the A6 known-collision eval against Postgres
  (`tests/integration/conflicts-eval.test.ts`).
- `pnpm eval` runs the A3 cases against the live model. It needs `ANTHROPIC_API_KEY` and a
  Postgres server, like the integration tests. CI runs it when the repository has the
  `ANTHROPIC_API_KEY` secret. Bump `A3_PROMPT_VERSION` when the prompt changes.
