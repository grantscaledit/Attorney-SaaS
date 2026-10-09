# ADR 0004: Scheduled jobs run in the pg-boss worker

Status: accepted (Phase 0)

## Decision

Scheduled work (nightly audit verification now; briefs, alerts and reconciliation later) is
scheduled with pg-boss `schedule()` in the firm's time zone and runs in the background worker,
instead of separate Render cron services.

## Consequences

Two services per firm (web and worker) instead of one per cron job, so fewer per-firm services
to provision and monitor (spec risk 6). Schedules and job history live in the firm's own database.
