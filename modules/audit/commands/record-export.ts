import { z } from "zod";
import { defineCommand } from "@/lib/commands/define";

/** Exporting the audit log is itself an audited event, with the filters used. */
export const recordAuditExport = defineCommand({
  name: "audit.export",
  permission: "audit.export",
  input: z.object({ filters: z.record(z.string(), z.unknown()), format: z.literal("csv") }),
  async run(_ctx, input) {
    return {
      result: { recorded: true },
      audit: [
        {
          action: "audit.exported",
          entityType: "audit_log",
          entityId: null,
          metadata: { filters: input.filters, format: input.format },
        },
      ],
    };
  },
});
