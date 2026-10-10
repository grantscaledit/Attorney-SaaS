/**
 * Background worker (Render background worker service). Uses pg-boss on the
 * firm's own Postgres, so no extra infrastructure per firm.
 *
 * Queues and schedules are registered in jobs/runtime.ts. Automations that
 * react to GHL events (A1, A2, A7) run inside webhook processing; jobs here
 * deliver their messages and run the scheduled work.
 */
import { closeDb } from "@/db/client";
import { env } from "@/lib/env";
import { loadFirmSettings } from "@/lib/firm.config";
import { log } from "@/lib/log";
import { startJobs } from "./runtime";

async function main(): Promise<void> {
  const e = env();
  // Same isolation guard as the web app: refuse to run against another firm's database.
  await loadFirmSettings();

  const boss = await startJobs({ connectionString: e.DATABASE_URL, timezone: e.FIRM_TIMEZONE });

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
