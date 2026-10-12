import { execute } from "@/lib/commands/execute";
import type { ChainVerification } from "@/lib/audit/verify";
import { log } from "@/lib/log";
import { verifyChain } from "@/modules/audit/commands/verify-chain";

export const AUDIT_CHAIN_VERIFY = "system.audit-chain-verify";
/** Nightly, 2:15am firm time. */
export const AUDIT_CHAIN_VERIFY_CRON = "15 2 * * *";

/**
 * Recomputes the audit hash chain every night. The result is itself recorded in
 * the audit log; a broken chain is logged at error level for alerting.
 */
export async function auditChainVerify(): Promise<ChainVerification> {
  const result = await execute(
    verifyChain,
    { type: "system", label: AUDIT_CHAIN_VERIFY },
    {},
    {
      request: { ip: null, userAgent: null, requestId: `job:${AUDIT_CHAIN_VERIFY}` },
    },
  );
  if (result.ok) {
    log.info("audit chain verified", { checked: result.checked });
  } else {
    log.error("AUDIT CHAIN BROKEN", {
      firstInvalidSeq: result.firstInvalidSeq,
      reason: result.reason,
      checked: result.checked,
    });
  }
  return result;
}
