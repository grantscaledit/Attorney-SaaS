# ADR 0009: Deadline rules engine and verification

Status: accepted (Phase 4)

## Context

Phase 4 adds the deadline engine (C1), escalating alerts (C2), the entity compliance calendar (C3),
probate milestones (C4), collection and compliance tracking (C5), calendar push (C6), the weekly
deadline audit (C7) and the Deadlines panel. Its acceptance criteria are:

- unverified rules cannot fire;
- date math passes tests including weekends, month ends and leap years;
- alerts escalate when unacknowledged.

Spec Section 8 gives seed rules that are explicitly not legal advice and "must not ship as
verified", and says that when a document prints a respond-by date, that date is used and the rule
is only a cross-check. Rule 7 makes every computed deadline advisory.

## Decisions

1. **Seeds in code, the firm's rules in the database.**
   - Each practice module exports its trigger events and seed rules
     (`practice/<area>/deadlines.ts`). Adding an area needs no change elsewhere.
   - Provisioning, the daily job and a settings button copy any missing seed into `deadline_rules`,
     unverified. Existing rows are never overwritten; the settings page shows when the firm's copy
     differs from the product seed.
2. **Verification is a hash of exactly what the attorney saw.**
   - The verified parameters (offset, roll-forward, severity, matter types, notice numbers,
     condition, printed-date preference, recurrence, tolling) are hashed with SHA-256 over a
     key-order-independent encoding (`ruleHash`).
   - Verifying stores `verified_by`, `verified_at` and `verified_hash`, plus the citation the
     attorney checked. The verify command requires the hash shown on screen, an attestation and a
     person (never a job or script), and only `deadline_rules.verify` (owner attorney) may run it.
   - The engine computes only when the stored hash equals the hash of the row as it is now. An edit
     clears the verification; so does any change made outside the application.
3. **A database trigger is the second lock.** `deadlines_require_verified_rule` (migration 0009)
   rejects any rule-computed deadline whose rule is unverified, switched off, or verified under a
   different hash. A check constraint requires a rule and hash on every rule-computed row.
4. **Unverified rules are visible, not silent.** A trigger event that needs an unverified rule is
   recorded; the matter page lists the rule as "not verified: no date computed" and the owner
   attorney gets an urgent task. When the rule is verified, every live event it applies to is
   recomputed in the same transaction.
5. **Date math is date-only and pure.** `modules/deadlines/date-math.ts` works on `YYYY-MM-DD`
   strings over UTC midnights, so no time zone or daylight-saving change can move a date. Month
   and year offsets clamp to the last day of a shorter month (31 January + 1 month = 28 or 29
   February; 29 February + 1 year = 28 February). Rolling forward skips weekends and the firm's
   holiday list. Whether a given deadline rolls, and which holidays count, are rule parameters the
   attorney verifies.
6. **Printed dates govern.** B3 turns a notice's printed respond-by date into a "document"
   deadline (unconfirmed until a person confirms the extraction) and its notice date into a
   trigger event. A verified rule with "prefer printed" records its own date beside the printed
   one as a cross-check; a disagreement creates an urgent task. When the notice prints no date, the
   verified rule computes the deadline.
7. **Rule-computed dates are not edited by hand.** They change only through their event or rule.
   Staff add "manual" deadlines for their own calculations and can move manual and printed dates
   with a reason. Every change bumps a version and `due_changed_at` (C6, C7).
8. **Alerts are rows; escalation is a separate hourly job.**
   - The daily job creates one alert per deadline per point it has reached (30, 14, 7, 3, 1 days,
     and on the day), keyed by deadline, point and due date, so reruns change nothing and a moved
     date alerts again.
   - At 3 and 1 days and on the day, the owner is texted on their own GHL contact (as A5 does),
     through the outbox with an owner-approved template and no client details.
   - An alert in the last 3 days, or 7 days for a critical deadline, is critical. A critical alert
     not acknowledged within 4 hours goes to the owner attorney as an urgent task and a text.
     Acknowledging, completing the deadline or closing the matter stops it.
9. **C6 is a private subscription feed, not a vendor push.** Google Calendar and Microsoft Graph
   need OAuth apps and endpoints that must be verified against live documentation (CLAUDE.md:
   do not code vendor endpoints from memory). The spec's "one-way push" is met in V1 by a private
   per-person iCalendar feed (RFC 5545) that both products can subscribe to. The token is shown
   once and stored as a hash; events carry the matter number and deadline name, never client
   names. SEQUENCE carries the deadline's version so a changed date replaces the old event. The
   trade-off is the subscriber's refresh interval (often hours), stated on the page. A direct push
   adapter can be added behind the same data later.
10. **C3, C4 and C5 reuse the engine.** The franchise tax report is an annual rule: when one year's
    occurrence is done or past, the daily job creates the next, and 30 days out it drafts a client
    reminder into the approval queue with a "want us to handle it" reply line. Probate milestones
    are the probate rules shown with their trigger and status. The collection statute is a rule
    that allows tolling days entered by staff with a reason; installment payments are "schedule"
    deadlines kept a few ahead from the agreement's terms.

## Consequences

- A firm sees no computed deadline until its attorney verifies the rules. The demo firm verifies a
  handful with a citation that says no attorney checked them.
- Notice numbers mapped to each rule are part of the verified parameters, so the attorney also
  confirms which notices a rule applies to.
- Deadline alerts reuse the outbox and its template approval: a firm that has not approved the C2
  templates gets in-app alerts and tasks but no texts.
