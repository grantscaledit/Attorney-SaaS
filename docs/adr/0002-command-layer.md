# ADR 0002: All writes go through audited commands

Status: accepted (Phase 0)

## Context

Rule 2: every mutation writes an audit row with actor, action, entity, before, after, IP and time.
A convention ("remember to call audit") erodes as the codebase grows.

## Decision

Domain writes are commands (`defineCommand` in `modules/<area>/commands/`). `execute()` validates
input with Zod, checks the permission, runs the command in a transaction and writes the command's
audit rows in that same transaction. A command must return at least one audit row.

Enforcement:

- `tests/architecture/rules.test.ts` fails if code outside `modules/*/commands/` writes to the
  database.
- `tests/integration/commands-audited.test.ts` executes every registered command and fails if one
  has no fixture or writes no audit row.
- Permission denials are audited (`access.denied`), both for commands and for pages.

## Consequences

Slight ceremony per write; in exchange the audit guarantee is structural and tested.
