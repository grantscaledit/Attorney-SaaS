# ADR 0007: AI layer, approval queue and the intake assistant

Status: accepted (Phase 2)

## Context

Phase 2 adds the first model calls. Engineering rules 3 to 6 apply to all of them. Every call goes
through one module and is logged. No substantive output reaches a client without the approval
queue. The AI never gives legal advice, predicts outcomes or confirms representation. Identifiers
never reach a model. Spec Section 6 asks for these protections:

- a post-generation classifier that blocks and escalates
- immediate escalation on deadlines, levies, garnishments, seizures, criminal matters, recent
  deaths and requests for a person
- golden evals that run in CI

The build environment has no API key, so the safety-critical parts must be testable without a
model.

## Decisions

1. **One call path.** `lib/ai/call.ts` does the following on every call:
   - masks the system prompt and messages (`lib/masking`: SSN, EIN, bare 9-digit TINs, card numbers
     with a Luhn check, bank account and routing numbers to the last 4; dates of birth removed);
   - calls the model through an `AiTransport` with structured output (`output_config.format` from
     the Zod schema);
   - validates the result with Zod and masks the output again;
   - records an `ai_runs` row through a command. The row holds the prompt hash and version, the
     model and served model, tokens, cost, the masked output, and later the reviewer and outcome.
     The prompt text is never stored.

   Refusals, invalid output, errors and "not configured" are all recorded and returned as typed
   failures, never thrown into an automation.

2. **Transports.**
   - `AnthropicTransport` uses the official SDK, with explicit effort. On models that support it,
     it uses the server-side refusal fallback.
   - `ScriptedTransport` serves tests.
   - Demo mode uses a rule-based `demoTransport()` and never calls a live model (rule 12).
   - Model ids come from `MODEL_FAST`, `MODEL_STANDARD` and `MODEL_DEEP`, with defaults in
     `lib/ai/models.ts`.
3. **Deterministic guardrails first.** `lib/ai/guard.ts` is plain code with three functions:
   - `escalationReasons` checks the person's message for the spec's triggers. The deadline and
     recent-death rules use dates relative to today.
   - `seeksAdvice` detects a question only a lawyer may answer.
   - `checkDraft` blocks advice, outcome predictions, fees not in the firm's published table,
     statements of representation, and identifiers.

   They run in CI against golden cases. A3 applies the first two before any model call: an
   advice request or urgent situation goes straight to a person and no draft is generated.

4. **Two checks on every draft.** A draft must pass both `checkDraft` and a separate classifier
   call (fast tier, structured yes/no answers, "when unsure, answer true"). A failed classifier
   counts as not safe. Any finding blocks the draft and hands the conversation to a person. The
   person receives only the owner-approved `A3.handoff.sms` template.
5. **Approval queue as the gate (rule 4).** Substantive output becomes an `approvals` row:
   messages, letters, briefs, escalations and referrals. Each row carries its sources, flags and
   AI run. Approving a message hands it to the outbox with idempotency key `approval:<id>`.
   Rejecting requires a reason, which is stored on the run for prompt review.

   At send time the outbox enforces rule 4 independently: a message without an approved template
   or an approved approval is suppressed (`no_approved_text`). If the approval is withdrawn
   before sending, the message is suppressed too.

6. **Firm-chosen auto-send, narrowly.** `firm_settings.a3_mode` defaults to `review_all`. Under
   `auto_send_safe`, a reply sends without review only when all of these hold:
   - it only asks a question, offers times or acknowledges;
   - it passed the guard;
   - the classifier ran and found nothing.

   The send is recorded as an auto-approved approval, so the queue still shows why it went out.
   The AI disclosure prefixes the assistant's first message to each person.

7. **A3 runs after commit, one message at a time.** Model calls never run inside a database
   transaction. Webhook processing records the masked message, commits, then enqueues
   `automation.A3`. The job has five steps:
   - deterministic checks;
   - free consult slots from GHL;
   - the draft;
   - the guard and the classifier;
   - one command that applies the result.

   Replays are no-ops: the command checks `automation_runs` and approvals dedupe on the message.
   If several messages arrive quickly, only the newest is answered, with the others in its
   transcript. The sweep recovers lost jobs. A failed turn hands off to a person instead of
   retrying model calls.

8. **Inbound message text is stored masked.** A3 needs the words, so `body` and `message` in
   webhook payloads are masked at ingestion instead of dropped. Notes, custom fields and
   attachments are still dropped.
9. **Scoring and conflicts are code, not model output.**
   - A5 scores urgency (0-40), value (0-35) and fit (0-25) from the practice module's answers.
     Escalations force urgency. A score of 75 or more is urgent and pages the assigned attorney
     with `A5.urgent.sms`, which contains no client details.
   - A6 retrieves candidates with `pg_trgm` and decides hits in TypeScript (`matchNames`). The
     matcher handles nicknames, reordering, a shared surname with the same initial, small
     misspellings, and organization names with or without suffixes. A check never clears itself:
     only a lawyer (`conflicts.review`) can clear it or record a conflict, and must give a note.
10. **Follow-ups.**
    - A8 briefs are built from records. The model writes only the summary and suggested questions,
      and without a model the brief still renders.
    - A10 uses three owner-approved templates. They are cancelled when the person replies or the
      lead closes (`onlyWhileLeadStatus`).
    - A11 letters and A12 referral messages are fixed drafts, not model text. They make statements
      about representation that belong to the firm, and they wait for approval like everything
      else.

## Consequences

- Without an API key the product still works:
  - A3 records a skip and staff answer in GHL;
  - briefs render from records;
  - every check, score and conflict match runs.
- The live-model eval (`pnpm eval`) needs a key. CI runs it only when the `ANTHROPIC_API_KEY`
  secret exists.
- Escalation is deliberately broad: a mention of a levy escalates even in "no levy". A false
  escalation costs a person's attention; a missed one could cost a client's rights.
- A11 letter wording and the A3 prompts need attorney review before going live (VERIFY).
