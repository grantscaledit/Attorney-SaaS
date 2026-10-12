# Runbook: demo environment

The demo firm is Siekierski Law PLLC (design partner). Every person, address, phone number and
email in it is fictional. `DEMO_MODE=true` refuses GHL credentials, so a demo cannot reach live
messaging.

```bash
# .env: FIRM_SLUG=siekierski-law, DEMO_MODE=true, DATABASE_URL=<demo db>
pnpm db:seed:demo --reset
```

The seed prints the shared demo password and authenticator key and writes them to
`.demo/credentials.md` (git-ignored). Accounts: owner attorney, paralegal, intake and billing, all
enrolled; one attorney left at the invitation stage. The seed ends with a real password + TOTP
sign-in as a smoke test.

Never point a demo deployment at a database holding real client data, and never reuse the demo
authenticator key outside demo databases.
