# Runbook: local development

1. Postgres 16 running locally with a user that can create databases.
2. `pnpm install`, then `cp .env.example .env` and fill the secrets.
3. Demo data: see `demo.md`. Empty firm: `pnpm provision-firm --local ...`.
4. `pnpm dev` for the app, `pnpm worker` for background jobs.

Schema changes: edit `db/schema/*`, run `pnpm db:generate`, commit the new migration. Never edit a
migration that has been merged; write a new one (rule 11). Custom SQL migrations:
`pnpm drizzle-kit generate --custom --name <name>`.

Writes: add a command under `modules/<area>/commands/`, register it in `lib/commands/registry.ts`
and add its fixture to `tests/integration/commands-audited.test.ts`.
