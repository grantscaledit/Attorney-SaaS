# ADR 0006: GoHighLevel webhook ingestion and automatic messages

Status: accepted (Phase 1)

## Context

Spec Section 2 wants GHL contacts and opportunities mirrored by webhook, a nightly
reconciliation, signature checks, and a missed call answered by text within 60 seconds. GHL's
documentation (checked 2026-10-10, see `docs/ghl/api-notes.md`) delivers its documented webhook
events, signed with `x-wh-signature`, only to Marketplace (OAuth) apps. A sub-account Private
Integration Token, which the spec asks for, gets API access but no event subscriptions.

## Decisions

1. **One endpoint, two ways in.** `POST /api/webhooks/ghl` accepts a delivery when either
   - `x-wh-signature` verifies (RSA SHA-256 over the raw body, GHL's published key, overridable by
     `GHL_WEBHOOK_PUBLIC_KEY` for rotation), for firms that install a private Marketplace app; or
   - `x-lexdesk-webhook-secret` equals `GHL_WEBHOOK_SECRET`, sent by the snapshot's workflow
     Custom Webhook actions, which cannot sign. TLS protects the secret in transit.
     Both paths produce the same documented event shapes, plus two LexDesk workflow events
     (`LexDeskMissedCall`, `LexDeskFormSubmitted`) for things GHL has no event for.
2. **Store first, process in a job.** The route authenticates, refuses other sub-accounts,
   sanitizes the payload (message text, notes, custom field values and attachments dropped; DOB,
   SSN and similar redacted), writes `webhook_events`, enqueues and returns 200.
3. **Two layers of replay protection.** `webhook_events.dedupe_key` (GHL's webhookId, else a hash
   of the body) stores a delivery once. Underneath, every mirrored row is keyed by GHL's id and
   every automatic message by an idempotency key (`A1:<call id>`), so a redelivery under a new
   webhookId still changes nothing. No time-window rejection: exact replays are already dropped,
   and a window would lose GHL's late retries.
4. **Automations decide in the processing transaction.** A1, A2 and A7 run inside the
   transaction that records the call, lead or appointment and write outbox rows. A crash can never
   lose a trigger between commit and enqueue. Only sending is asynchronous.
5. **At-most-once sending.** A message is claimed (`sending`) in one transaction, sent outside
   any transaction, and its result recorded in another. GHL documents no idempotency key, so the
   client retries a send only on 429. A 5xx or dropped connection is recorded as `unknown` for a
   person to check, never resent. Sweeps mark sends stuck in `sending` as `unknown`.
6. **Rules checked twice.** Feature flag, do-not-disturb, consent, owner-approved template,
   required values and quiet hours are checked when a message is queued and again at send time.
7. **Recovery.** A one-minute sweep reprocesses webhooks whose job was lost (and failed ones
   with backoff, up to 5 attempts) and sends due messages. Nightly reconciliation re-reads
   contacts, opportunities and appointments (7 days back, 60 ahead) through the same mirror code.
8. **Per-contact serialization.** Processing takes a transaction advisory lock on the GHL contact
   id, so concurrent events for one person apply in order; unique indexes are the backstop.
9. **No client PII in the audit log.** Audit rows for mirrored contacts name the changed fields,
   not their values; the audit log is immutable and cannot honor deletion requests.

## Consequences

- The 60-second path is webhook, job pickup (LISTEN/NOTIFY), one transaction and one API call:
  0.7 seconds in the integration test.
- A firm without a Marketplace app relies on its snapshot workflows; if a workflow is switched
  off, reconciliation still repairs contacts, opportunities and appointments nightly, but missed
  calls and forms between runs get no text-back.
- Quiet hours apply to every automatic message, including A1. A missed call at 10pm is texted at
  8am. Whether replies to a person's own call should be exempt is an open question for the firm's
  attorney (docs/phases.md).
