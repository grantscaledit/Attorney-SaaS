/**
 * Background worker (Render background worker service). Uses pg-boss on the
 * firm's own Postgres, so no extra infrastructure per firm.
 *
 * Each automation registers one handler file under /jobs, named for its ID
 * (A1, C2...). Phase 0 ships the system jobs only.
 */
import { PgBoss } from "pg-boss";
import { closeDb } from "@/db/client";
import { env } from "@/lib/env";
import { loadFirmSettings } from "@/lib/firm.config";
import { log } from "@/lib/log";
import {
  AUDIT_CHAIN_VERIFY,
  AUDIT_CHAIN_VERIFY_CRON,
  auditChainVerify,
} from "./system/audit-chain-verify";

async function main(): Promise<void> {
  const e = env();
  // Same isolation guard as the web app: refuse to run against another firm's database.
  await loadFirmSettings();

  const boss = new PgBoss({
    connectionString: e.DATABASE_URL,
    schema: "pgboss",
    application_name: "lexdesk-worker",
  });
  boss.on("error", (err: unknown) => log.error("pg-boss error", { err }));
  await boss.start();

  await boss.createQueue(AUDIT_CHAIN_VERIFY);
  await boss.schedule(AUDIT_CHAIN_VERIFY, AUDIT_CHAIN_VERIFY_CRON, null, { tz: e.FIRM_TIMEZONE });
  await boss.work(AUDIT_CHAIN_VERIFY, async () => {
    await auditChainVerify();
  });

  log.info("worker started", { queues: [AUDIT_CHAIN_VERIFY], timezone: e.FIRM_TIMEZONE });

  const shutdown = async (signal: string) => {
    log.info("worker stopping", { signal });
    await boss.stop({ graceful: true, timeout: 20_000 });
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  log.error("worker failed to start", { err });
  process.exit(1);
});
