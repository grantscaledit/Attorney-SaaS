import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { ADMIN_URL, E2E_ENV } from "./env";

/**
 * Runs before the e2e server starts (Playwright starts webServer before
 * globalSetup, so this is chained into the webServer command instead).
 * Fresh database, seeded with the demo firm through the real seed script.
 */
async function prepare(): Promise<void> {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "lexdesk_e2e" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "lexdesk_e2e"`);
  await admin.end();

  execFileSync("pnpm", ["exec", "tsx", "db/seed/demo.ts"], {
    env: { ...process.env, ...E2E_ENV, NODE_ENV: "development" },
    stdio: "inherit",
  });
}

prepare().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
