import { sql } from "drizzle-orm";
import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { auditLog } from "@/db/schema";
import { recordAudit } from "@/lib/audit/record";
import { verifyAuditChain } from "@/lib/audit/verify";
import { withFreshDatabase } from "./helpers";

const { db, url } = withFreshDatabase();

describe("audit_log integrity", () => {
  beforeAll(async () => {
    for (let i = 0; i < 5; i++) {
      await recordAudit(db(), {
        actor: { type: "system", label: "test" },
        action: `test.event_${i}`,
        after: { i },
      });
    }
  });

  it("assigns sequential seq numbers and links each row to the previous hash", async () => {
    const rows = await db().select().from(auditLog).orderBy(auditLog.seq);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[0]!.prevHash).toBeNull();
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.prevHash).toBe(rows[i - 1]!.hash);
    for (const r of rows) expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifies an intact chain", async () => {
    expect(await verifyAuditChain(db())).toEqual({
      ok: true,
      checked: 5,
      firstInvalidSeq: null,
      reason: null,
    });
  });

  it("rejects UPDATE, DELETE and TRUNCATE", async () => {
    for (const statement of [
      sql`UPDATE audit_log SET action = 'x' WHERE seq = 1`,
      sql`DELETE FROM audit_log WHERE seq = 1`,
      sql`TRUNCATE audit_log`,
    ]) {
      const err = await db()
        .execute(statement)
        .then(() => null)
        .catch((e: unknown) => e as Error & { cause?: Error });
      expect(err, "statement should fail").not.toBeNull();
      expect(String(err?.cause?.message ?? err?.message)).toMatch(/append-only/);
    }
  });

  it("ignores caller-supplied seq, timestamp and hash", async () => {
    await db()
      .insert(auditLog)
      .values({
        actorType: "system",
        action: "test.forged",
        seq: 999,
        hash: "forged",
        occurredAt: new Date(0),
      });
    const [row] = await db()
      .select()
      .from(auditLog)
      .where(sql`action = 'test.forged'`);
    expect(row!.seq).toBe(6);
    expect(row!.hash).not.toBe("forged");
    expect(row!.occurredAt.getTime()).toBeGreaterThan(0);
  });

  it("redacts sensitive keys before writing", async () => {
    await recordAudit(db(), {
      actor: { type: "system", label: "test" },
      action: "test.redaction",
      after: { name: "Pat", password: "pw", nested: { ssn: "123-45-6789" } },
    });
    const [row] = await db()
      .select()
      .from(auditLog)
      .where(sql`action = 'test.redaction'`);
    expect(row!.after).toEqual({
      name: "Pat",
      password: "[REDACTED]",
      nested: { ssn: "[REDACTED]" },
    });
  });

  it("keeps the chain valid under concurrent writers", async () => {
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        db().transaction((tx) =>
          recordAudit(tx, {
            actor: { type: "system", label: "c" },
            action: `test.concurrent_${i}`,
          }),
        ),
      ),
    );
    const result = await verifyAuditChain(db());
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(47);
  });

  it("detects a row altered with triggers bypassed", async () => {
    // Simulates a superuser edit, the threat the hash chain exists to expose.
    const c = new Client({ connectionString: url() });
    await c.connect();
    await c.query("BEGIN");
    await c.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update_delete");
    await c.query("UPDATE audit_log SET after = '{\"i\": 99}' WHERE seq = 3");
    const { rows } = await c.query(
      "SELECT first_invalid_seq, reason FROM audit_log_verify_chain()",
    );
    await c.query("ROLLBACK");
    await c.end();
    expect(rows[0]).toEqual({
      first_invalid_seq: "3",
      reason: "row content does not match its hash",
    });
  });
});
