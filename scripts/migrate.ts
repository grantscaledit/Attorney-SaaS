/**
 * Applies pending migrations to DATABASE_URL. Runs in CI and as Render's
 * preDeployCommand, so a deploy never starts on an unmigrated database.
 */
import { runMigrations } from "@/db/migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const started = Date.now();
runMigrations(url)
  .then(() => {
    console.log(
      JSON.stringify({ level: "info", msg: "migrations applied", ms: Date.now() - started }),
    );
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
