"use server";

import { revalidatePath } from "next/cache";
import { runCommand, type ActionState } from "@/lib/commands/action";
import { setFeatureEnabled } from "@/modules/firm/commands/set-feature";

export async function setFeatureAction(
  flag: string,
  enabled: boolean,
  reason?: string,
): Promise<ActionState<unknown>> {
  const result = await runCommand(setFeatureEnabled, { flag, enabled, reason });
  if (result.status === "success") revalidatePath("/", "layout");
  return result;
}
