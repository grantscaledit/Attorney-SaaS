"use server";

import { revalidatePath } from "next/cache";
import { runCommand, type ActionState } from "@/lib/commands/action";
import { addConflictParties, removeConflictParty } from "@/modules/intake/commands/conflicts";

export async function addConflictPartyAction(
  _prev: ActionState<unknown>,
  form: FormData,
): Promise<ActionState<unknown>> {
  const role = String(form.get("role") ?? "adverse");
  const kind = String(form.get("kind") ?? "person");
  const matterReference = String(form.get("matterReference") ?? "");
  // One name per line, so a list can be pasted in.
  const names = String(form.get("names") ?? "")
    .split("\n")
    .map((n) => n.trim())
    .filter(Boolean);
  const result = await runCommand(
    addConflictParties,
    { parties: names.map((name) => ({ name, kind, role, matterReference })) },
    { successMessage: `${names.length} added to the conflict list.` },
  );
  if (result.status === "success") revalidatePath("/settings/conflicts");
  return result;
}

export async function removeConflictPartyAction(partyId: string): Promise<ActionState<unknown>> {
  const result = await runCommand(removeConflictParty, { partyId }, { successMessage: "Removed." });
  if (result.status === "success") revalidatePath("/settings/conflicts");
  return result;
}
