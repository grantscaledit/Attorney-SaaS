/**
 * CI guard for rule 11 (forward-only migrations):
 *  1. The Drizzle schema must match the committed migrations: running
 *     `drizzle-kit generate` must not produce anything new.
 *  2. With --base <ref>, migrations that exist on the base branch must not be
 *     edited or deleted.
 *
 * Usage: pnpm db:check [--base origin/main]
 * Note: step 1 writes a migration file if the schema drifted. In CI the checkout
 * is disposable; locally, delete it or keep it as your new migration.
 */
import { execFileSync } from "node:child_process";

const root = process.cwd();

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function fail(msg: string): never {
  console.error(`db:check failed: ${msg}`);
  process.exit(1);
}

execFileSync("pnpm", ["exec", "drizzle-kit", "generate", "--name", "drift_check"], {
  cwd: root,
  stdio: "pipe",
});
const drift = git(["status", "--porcelain", "--", "db/migrations"]).trim();
if (drift) {
  fail(`schema has changes with no committed migration. Run pnpm db:generate.\n${drift}`);
}

const baseIdx = process.argv.indexOf("--base");
const base = baseIdx > -1 ? process.argv[baseIdx + 1] : undefined;
if (base) {
  const changed = git(["diff", "--name-status", `${base}...HEAD`, "--", "db/migrations"])
    .split("\n")
    .filter(Boolean)
    .filter(
      (line) =>
        !line.startsWith("A\t") &&
        !line.endsWith("_journal.json") &&
        !/_snapshot\.json$/.test(line),
    );
  if (changed.length > 0) {
    fail(`migrations already on ${base} were modified or removed:\n${changed.join("\n")}`);
  }
}

console.log("db:check ok");
