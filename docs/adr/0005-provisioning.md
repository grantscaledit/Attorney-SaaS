# ADR 0005: Provisioning from one command; Render resources from a Blueprint

Status: accepted (Phase 0), revisit when Render's API is verified

## Decision

`scripts/provision-firm.ts` does everything that touches the firm's data and secrets: validation,
secret generation, per-firm Blueprint rendering, migrations, firm and owner bootstrap, and
verification. Render resources are created from the rendered Blueprint (`.provision/<slug>/`).

The script does not call Render's REST API yet. The spec requires vendor endpoints to be verified
against live documentation, and Render's documentation was not reachable when this was built.
Adding an `--infra render` step is a contained change once verified.

## Consequences

Provisioning a firm is one command plus one Blueprint import in Render. Secrets never enter the
repo: the env file is written with mode 0600 to a git-ignored directory.
