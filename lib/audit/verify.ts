import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";

export type ChainVerification = {
  ok: boolean;
  checked: number;
  firstInvalidSeq: number | null;
  reason: string | null;
};

/** Recomputes the audit hash chain in the database (see migration 0001). */
export async function verifyAuditChain(db: DbOrTx): Promise<ChainVerification> {
  const result = await db.execute<{
    checked: string;
    first_invalid_seq: string | null;
    reason: string | null;
  }>(sql`SELECT checked, first_invalid_seq, reason FROM audit_log_verify_chain()`);
  const row = result.rows[0];
  if (!row) return { ok: true, checked: 0, firstInvalidSeq: null, reason: null };
  return {
    ok: row.first_invalid_seq === null,
    checked: Number(row.checked),
    firstInvalidSeq: row.first_invalid_seq === null ? null : Number(row.first_invalid_seq),
    reason: row.reason,
  };
}
