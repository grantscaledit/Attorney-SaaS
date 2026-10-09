import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
/** A transaction handle; same query API as `Database`. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

type Handle = { pool: Pool; db: Database };

const globalForDb = globalThis as unknown as { __lexdeskDb?: Handle };

export function createDatabase(connectionString: string, max = 10): Handle {
  const pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: "lexdesk",
  });
  return { pool, db: drizzle(pool, { schema }) };
}

function handle(): Handle {
  if (!globalForDb.__lexdeskDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.__lexdeskDb = createDatabase(url);
  }
  return globalForDb.__lexdeskDb;
}

/** Shared database handle for the running process (app, worker, or script). */
export function getDb(): Database {
  return handle().db;
}

export function getPool(): Pool {
  return handle().pool;
}

export async function closeDb(): Promise<void> {
  const h = globalForDb.__lexdeskDb;
  globalForDb.__lexdeskDb = undefined;
  if (h) await h.pool.end();
}
