import { z } from "zod";
import { verifyAuditChain } from "@/lib/audit/verify";
import { defineCommand } from "@/lib/commands/define";

/** Recomputes the hash chain on demand. The check itself is recorded in the log. */
export const verifyChain = defineCommand({
  name: "audit.verify_chain",
  permission: "audit.read",
  input: z.object({}),
  async run(ctx) {
    const result = await verifyAuditChain(ctx.tx);
    return {
      result,
      audit: [
        {
          action: "audit.chain_verified",
          entityType: "audit_log",
          entityId: null,
          metadata: {
            ok: result.ok,
            checked: result.checked,
            firstInvalidSeq: result.firstInvalidSeq,
            reason: result.reason,
          },
        },
      ],
    };
  },
});
