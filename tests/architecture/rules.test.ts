import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Architecture tests: the engineering rules in CLAUDE.md, checked against the
 * source tree so they cannot quietly erode.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const source = ["app", "lib", "modules", "components", "jobs"].flatMap((d) =>
  walk(path.join(ROOT, d)),
);
const read = (f: string) => readFileSync(f, "utf8");

describe("rule 2: every database write goes through an audited path", () => {
  // Writes are allowed only in commands (which execute() audits), the audit
  // writer itself, and scripts/seeds/tests that record their own audit rows.
  const ALLOWED = [/^modules\/[^/]+\/commands\//, /^lib\/audit\/record\.ts$/];
  // A Drizzle write: a database handle, possibly across a line break, then .insert/.update/.delete.
  const WRITE = /\b(?:tx|db|getDb\(\)|db\(\))\s*\.\s*(?:insert|update|delete)\(/;

  it("no source file outside the allowlist writes to the database", () => {
    const offenders = source
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => !ALLOWED.some((re) => re.test(rel(f))))
      .filter((f) => WRITE.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("every command file is registered", () => {
    const registry = read(path.join(ROOT, "lib/commands/registry.ts"));
    const commandFiles = source.filter((f) => /^modules\/[^/]+\/commands\/[^/]+\.ts$/.test(rel(f)));
    const defined = commandFiles.flatMap((f) =>
      [...read(f).matchAll(/export const (\w+) = defineCommand\(/g)].map((m) => m[1]!),
    );
    const unregistered = defined.filter((name) => !new RegExp(`\\b${name}\\b`).test(registry));
    expect(unregistered).toEqual([]);
  });
});

describe("authorization: every entry point checks the session", () => {
  it("every page in the signed-in app calls requireSession, requireUser or requirePermission", () => {
    const pages = source.filter((f) => /^app\/\(app\)\/.*page\.tsx$/.test(rel(f)));
    expect(pages.length).toBeGreaterThan(0);
    const unguarded = pages
      .filter((f) => !/\brequire(Session|User|Permission)\(/.test(read(f)))
      .map(rel);
    expect(unguarded).toEqual([]);
  });

  it("every API route except auth, health and webhooks checks the session", () => {
    const PUBLIC = new Set(["app/api/auth/[...all]/route.ts", "app/api/health/route.ts"]);
    const routes = source.filter(
      (f) =>
        /^app\/api\/.*route\.ts$/.test(rel(f)) &&
        !PUBLIC.has(rel(f)) &&
        !rel(f).startsWith("app/api/webhooks/"),
    );
    const unguarded = routes
      .filter((f) => !/\brequire(Session|User|Permission)\(/.test(read(f)))
      .map(rel);
    expect(unguarded).toEqual([]);
  });

  it("every webhook route authenticates the sender before doing anything", () => {
    const routes = source.filter((f) => /^app\/api\/webhooks\/.*route\.ts$/.test(rel(f)));
    expect(routes.length).toBeGreaterThan(0);
    const unguarded = routes.filter((f) => !/\bhandleGhlWebhook\(/.test(read(f))).map(rel);
    expect(unguarded).toEqual([]);
    // The handler itself must verify credentials.
    const handler = read(path.join(ROOT, "modules/ghl/ingest.ts"));
    expect(handler).toMatch(/\bauthenticateWebhook\(/);
  });

  it("every server action in the signed-in app goes through runCommand or requireSession", () => {
    const actions = source.filter(
      (f) => rel(f).startsWith("app/(app)/") && /^["']use server["']/.test(read(f).trimStart()),
    );
    const unguarded = actions
      .filter((f) => !/\b(runCommand|requireSession|requireUser)\(/.test(read(f)))
      .map(rel);
    expect(unguarded).toEqual([]);
  });
});

// Rule 1 (no `any`) is enforced by ESLint: @typescript-eslint/no-explicit-any is an error.

describe("rule 8: no secrets or firm data in the repo", () => {
  it(".env files are git-ignored; only .env.example is tracked", () => {
    const ignored = read(path.join(ROOT, ".gitignore"));
    expect(ignored).toMatch(/^\.env$/m);
    expect(ignored).toMatch(/^!\.env\.example$/m);
  });

  it("the write detector actually detects writes (guards against a regex that matches nothing)", () => {
    const commandFiles = source.filter((f) => /^modules\/[^/]+\/commands\//.test(rel(f)));
    const detected = commandFiles.filter((f) =>
      /\b(?:tx|db|getDb\(\)|db\(\))\s*\.\s*(?:insert|update|delete)\(/.test(read(f)),
    );
    expect(detected.length).toBeGreaterThanOrEqual(5);
  });

  it(".provision and .demo output directories are git-ignored", () => {
    const ignored = read(path.join(ROOT, ".gitignore"));
    expect(ignored).toMatch(/^\.provision\/$/m);
    expect(ignored).toMatch(/^\.demo\/$/m);
  });
});

describe("rule 6: logs never carry message bodies", () => {
  it("console.log is not used in app code (structured logger only)", () => {
    const offenders = source.filter((f) => /console\.log\(/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("rule 4: automatic messages only leave through the outbox", () => {
  it("only the send job calls GHL's sendMessage", () => {
    const callers = source
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => /\.sendMessage\(/.test(read(f)))
      .map(rel);
    expect(callers).toEqual(["jobs/messaging/send.ts"]);
  });

  it("only lib/ghl/client.ts talks to the GHL API host", () => {
    const offenders = source
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => /leadconnectorhq\.com/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual(["lib/ghl/endpoints.ts"]);
  });
});
