import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "./client";

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "db", "migrations");

/** Applies pending forward-only migrations. Safe to run repeatedly. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const { db, pool } = createDatabase(databaseUrl, 1);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
