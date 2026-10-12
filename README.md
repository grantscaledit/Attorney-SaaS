# LexDesk

Law firm operations platform by Giddens Systems LLC. One deployment per firm, on top of
GoHighLevel. First niche: tax, business and estate planning firms in Texas.

- Product spec: [`docs/spec/BUILDOUT.md`](docs/spec/BUILDOUT.md)
- Engineering rules and conventions: [`CLAUDE.md`](CLAUDE.md)
- Build status by phase: [`docs/phases.md`](docs/phases.md)
- Architecture decisions: [`docs/adr/`](docs/adr)
- Runbooks: [`docs/runbooks/`](docs/runbooks)

## Stack

Next.js 16 (App Router, TypeScript strict) · Postgres 16 + Drizzle · Better Auth with mandatory
TOTP MFA · pg-boss · Tailwind CSS 4 with Radix primitives · Vitest and Playwright · Render.

## Local development

Requirements: Node 22, pnpm 10, Postgres 16 running locally.

```bash
pnpm install
cp .env.example .env            # then fill AUTH_SECRET and FIELD_ENCRYPTION_KEY (openssl rand -base64 48 / 32)

# Demo firm (synthetic data): set FIRM_SLUG=siekierski-law and DEMO_MODE=true in .env
createdb lexdesk_demo
pnpm db:seed:demo               # prints demo credentials and writes .demo/credentials.md
pnpm dev                        # http://localhost:3000
```

All demo accounts share one password and one authenticator key (both printed by the seed), so a
presenter adds the key to an authenticator app once. `pnpm db:seed:demo --reset` rebuilds it.

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm format:check
pnpm db:check                   # schema and migrations agree
pnpm test:unit                  # no database needed
pnpm test:integration           # needs a local Postgres (TEST_DATABASE_ADMIN_URL)
pnpm build && pnpm test:e2e     # Playwright against the built app and a seeded demo firm
```

CI runs all of the above on every pull request (`.github/workflows/ci.yml`).

## Provisioning a firm

```bash
pnpm provision-firm --help
```

One command validates the firm's configuration, generates its secrets, writes a per-firm Render
Blueprint, migrates its empty database, creates the owner attorney, verifies the result and prints
the owner's one-time setup link. See [`docs/runbooks/provision-firm.md`](docs/runbooks/provision-firm.md).
