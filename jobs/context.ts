import type { AuditRequest } from "@/lib/audit/record";
import type { Principal } from "@/lib/commands/define";

/** Principal and audit request metadata for a job run. */
export function jobContext(
  queue: string,
  ref?: string,
): { principal: Principal; request: AuditRequest } {
  return {
    principal: { type: "system", label: queue },
    request: { ip: null, userAgent: null, requestId: `job:${queue}${ref ? `:${ref}` : ""}` },
  };
}
