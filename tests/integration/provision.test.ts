import { mkdtempSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { provisionFirm } from "@/scripts/provision-firm";
import { ADMIN_URL } from "./db-names";

/*
 * Phase 0 acceptance: "A new firm instance provisions from one command."
 * Runs the real provisioning entry point against a fresh local database.
 */

const slug = `it-${Math.random().toString(36).slice(2, 8)}`;
const outDir = mkdtempSync(path.join(os.tmpdir(), "lexdesk-provision-"));
const dbName = `lexdesk_${slug.replace(/-/g, "_")}`;

// The provisioned database is named lexdesk_it_*, so global teardown also removes it.
afterAll(async () => {
  const c = new Client({ connectionString: ADMIN_URL });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await c.end();
});

const options = {
  slug,
  legalName: "Harlow & Vance PLLC",
  displayName: "Harlow & Vance",
  tier: "firm" as const,
  timezone: "America/Chicago",
  practice: ["tax", "estate"] as ("tax" | "estate")[],
  city: "Plano",
  state: "TX",
  ownerName: "Avery Harlow",
  ownerEmail: "avery@harlowvance.example",
  appUrl: "https://harlowvance.lexdesk.example",
  local: true,
  adminUrl: ADMIN_URL,
  outDir,
};

describe("provision-firm", () => {
  it("provisions a firm end to end from one call", async () => {
    const lines: string[] = [];
    const result = await provisionFirm(options, (l) => lines.push(l));

    expect(result.ownerSetupUrl).toMatch(
      /^https:\/\/harlowvance\.lexdesk\.example\/invite\/[A-Za-z0-9_-]{40,}$/,
    );
    expect(result.auditEntries).toBeGreaterThanOrEqual(2);
    expect(lines.filter((l) => /^\[\d\/8\]/.test(l))).toHaveLength(8);

    const c = new Client({ connectionString: result.databaseUrl });
    await c.connect();
    const firm = await c.query("SELECT slug, legal_name, practice_areas FROM firm_settings");
    const owner = await c.query("SELECT email, role, two_factor_enabled FROM users");
    const audit = await c.query("SELECT action, actor_type FROM audit_log ORDER BY seq");
    await c.end();

    expect(firm.rows).toEqual([
      { slug, legal_name: "Harlow & Vance PLLC", practice_areas: ["tax", "estate"] },
    ]);
    expect(owner.rows).toEqual([
      { email: "avery@harlowvance.example", role: "owner_attorney", two_factor_enabled: false },
    ]);
    expect(audit.rows.map((r: { action: string }) => r.action)).toEqual([
      "firm.provisioned",
      "users.invited",
    ]);
    expect(audit.rows.every((r: { actor_type: string }) => r.actor_type === "system")).toBe(true);
  });

  it("writes a secret env file readable only by the operator, and a per-firm blueprint", () => {
    const dir = path.join(outDir, slug);
    const envFile = path.join(dir, "env");
    expect(statSync(envFile).mode & 0o777).toBe(0o600);
    const env = readFileSync(envFile, "utf8");
    expect(env).toMatch(/^AUTH_SECRET=.{40,}$/m);
    expect(env).toMatch(/^FIELD_ENCRYPTION_KEY=.+$/m);
    expect(env).toContain(`FIRM_SLUG=${slug}`);
    expect(env).not.toContain("DATABASE_URL=");

    const blueprint = readFileSync(path.join(dir, "render.yaml"), "utf8");
    expect(blueprint).toContain(`name: lexdesk-${slug}-web`);
    expect(blueprint).toContain(`name: lexdesk-${slug}-db`);
    expect(blueprint).not.toMatch(/name: lexdesk-(web|worker|db)\b/);
  });

  it("refuses to provision over an existing firm", async () => {
    await expect(provisionFirm(options, () => undefined)).rejects.toThrow(
      /already belongs to firm/,
    );
  });

  it("rejects invalid input before touching anything", async () => {
    await expect(
      provisionFirm({ ...options, slug: "Bad Slug" }, () => undefined),
    ).rejects.toThrow();
    await expect(
      provisionFirm({ ...options, timezone: "Mars/Olympus", slug: "it-tzbad" }, () => undefined),
    ).rejects.toThrow(/FIRM_TIMEZONE/);
  });
});
