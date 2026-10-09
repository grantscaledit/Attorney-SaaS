# ADR 0003: Audit immutability and hash chain enforced in Postgres

Status: accepted (Phase 0)

## Decision

`audit_log` has triggers that reject UPDATE, DELETE and TRUNCATE. A BEFORE INSERT trigger assigns
`seq`, `occurred_at` and `prev_hash`, and computes `hash = sha256(row fields || prev_hash)`, with
inserts serialized by a transaction-scoped advisory lock. `audit_log_verify_chain()` recomputes the
chain and reports the first broken row. See migration `0001_audit_log_integrity.sql`.

Doing this in the database means every path (app, scripts, psql) produces chained rows, and the
app cannot write a malformed one.

## Residual risk

A database superuser can disable triggers and rewrite rows. The chain makes that detectable (a test
simulates exactly this), not impossible. Phase 8 adds an external anchor: the chain head exported
on a schedule to storage the app cannot modify.

## Consequences

Audit inserts serialize. At a single firm's volume this is negligible; revisit if audit inserts
exceed a few hundred per second.
