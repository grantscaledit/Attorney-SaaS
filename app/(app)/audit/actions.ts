"use server";

import { runCommand, type ActionState } from "@/lib/commands/action";
import type { ChainVerification } from "@/lib/audit/verify";
import { verifyChain } from "@/modules/audit/commands/verify-chain";

export async function verifyChainAction(): Promise<ActionState<ChainVerification>> {
  return runCommand(verifyChain, {});
}
