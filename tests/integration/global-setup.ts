import { Client } from "pg";
import type { TestProject } from "vitest/node";
import { runMigrations } from "../../db/migrate";
import { ADMIN_URL, TEMPLATE_DB, dbUrl } from "./db-names";

/**
 * Builds one migrated template database per run. Each test file clones it
 * (CREATE DATABASE ... TEMPLATE), which takes milliseconds and gives every file
 * an isolated database, exactly like a freshly provisioned firm.
 */
export async function setup(project: TestProject): Promise<() => Promise<void>> {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await dropTestDatabases(admin);
  await admin.query(`CREATE DATABASE "${TEMPLATE_DB}"`);
  await admin.end();

  await runMigrations(dbUrl(TEMPLATE_DB));
  project.provide("templateDb", TEMPLATE_DB);

  return async () => {
    const c = new Client({ connectionString: ADMIN_URL });
    await c.connect();
    await dropTestDatabases(c);
    await c.end();
  };
}

async function dropTestDatabases(admin: Client): Promise<void> {
  const { rows } = await admin.query<{ datname: string }>(
    `SELECT datname FROM pg_database WHERE datname LIKE 'lexdesk_it_%'`,
  );
  for (const { datname } of rows) {
    await admin.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
  }
}

declare module "vitest" {
  export interface ProvidedContext {
    templateDb: string;
  }
}
