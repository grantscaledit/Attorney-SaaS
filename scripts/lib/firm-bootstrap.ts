import type { z } from "zod";
import { type Database } from "@/db/client";
import type { Command } from "@/lib/commands/define";
import { execute } from "@/lib/commands/execute";
import { syncDeadlineRules } from "@/modules/deadlines/commands/rules";
import { bootstrapFirm } from "@/modules/firm/commands/bootstrap";

export type BootstrapInput = z.input<(typeof bootstrapFirm)["input"]>;

/** Runs the firm bootstrap command as the provisioning system principal. */
export async function runBootstrap(db: Database, input: BootstrapInput, label: string) {
  const out = await execute(
    bootstrapFirm as Command<
      (typeof bootstrapFirm)["input"],
      { ownerId: string; setupUrl: string; expiresAt: Date }
    >,
    { type: "system", label },
    input,
    {
      db,
      request: { ip: null, userAgent: null, requestId: `script:${label}` },
    },
  );
  // The product's deadline rule seeds, unverified (spec Section 8).
  await execute(
    syncDeadlineRules,
    { type: "system", label },
    {},
    { db, request: { ip: null, userAgent: null, requestId: `script:${label}` } },
  );
  return out;
}
