import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, inject } from "vitest";
import { closeDb, getDb, type Database } from "@/db/client";
import { auditLog, users } from "@/db/schema";
import { execute } from "@/lib/commands/execute";
import type { AnyCommand, Command, Principal, SessionUser } from "@/lib/commands/define";
import { resetEnvCache } from "@/lib/env";
import { bootstrapFirm } from "@/modules/firm/commands/bootstrap";
import { desc, eq } from "drizzle-orm";
import type { z } from "zod";
import { ADMIN_URL, dbUrl } from "./db-names";

export const TEST_REQUEST = { ip: "203.0.113.10", userAgent: "vitest", requestId: "test-request" };

/** Clones the migrated template into a new database for this test file and points the app at it. */
export function useFreshDatabase(): { db: () => Database; url: () => string } {
  let name = "";
  beforeAll(async () => {
    name = `lexdesk_it_${randomBytes(6).toString("hex")}`;
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${inject("templateDb")}"`);
    await admin.end();
    process.env.DATABASE_URL = dbUrl(name);
    resetEnvCache();
    await closeDb();
  });
  afterAll(async () => {
    await closeDb();
  });
  return { db: () => getDb(), url: () => dbUrl(name) };
}

export const SYSTEM: Principal = { type: "system", label: "test" };

export function asUser(user: SessionUser): Principal {
  return { type: "user", user };
}

/** Run a command without fighting its generic types (tests only). */
export function run(command: AnyCommand, principal: Principal, input: unknown): Promise<unknown> {
  return execute(command as unknown as Command<z.ZodType, unknown>, principal, input, { request: TEST_REQUEST });
}

export async function provisionTestFirm(): Promise<{ owner: SessionUser; setupUrl: string }> {
  const result = (await run(bootstrapFirm, SYSTEM, {
    slug: process.env.FIRM_SLUG,
    legalName: "Test Firm PLLC",
    displayName: "Test Firm",
    practiceAreas: ["tax", "business", "estate"],
    owner: { name: "Olivia Owner", email: "owner@test-firm.example" },
  })) as { ownerId: string; setupUrl: string };
  // Tests act as an enrolled owner; MFA enrollment itself is covered in auth.test.ts.
  await getDb().update(users).set({ twoFactorEnabled: true }).where(eq(users.id, result.ownerId));
  return {
    owner: { id: result.ownerId, email: "owner@test-firm.example", name: "Olivia Owner", role: "owner_attorney", status: "active" },
    setupUrl: result.setupUrl,
  };
}

export async function lastAudit(db: Database) {
  const [row] = await db.select().from(auditLog).orderBy(desc(auditLog.seq)).limit(1);
  return row;
}

export async function auditCount(db: Database): Promise<number> {
  return (await db.select({ id: auditLog.id }).from(auditLog)).length;
}

export function tokenFromSetupUrl(url: string): string {
  const token = new URL(url).pathname.split("/").pop();
  if (!token) throw new Error(`no token in ${url}`);
  return token;
}
