import { randomBytes } from "node:crypto";

// Environment for an integration test worker. DATABASE_URL is set per file by
// withFreshDatabase(); everything else is fixed test configuration.
process.env.FIRM_SLUG ??= "test-firm";
process.env.FIRM_TIER ??= "solo";
process.env.FIRM_TIMEZONE ??= "America/Chicago";
process.env.DEMO_MODE = "false";
process.env.APP_URL ??= "http://localhost:3000";
process.env.AUTH_SECRET ??= randomBytes(48).toString("base64");
process.env.FIELD_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.LOG_LEVEL = "error";
process.env.DATABASE_URL ??= "postgres://unset";
// Tests never call a live model: they install a scripted transport. Only the
// live eval (`pnpm eval`, EVAL_LIVE=1) keeps the key.
if (process.env.EVAL_LIVE !== "1") delete process.env.ANTHROPIC_API_KEY;
