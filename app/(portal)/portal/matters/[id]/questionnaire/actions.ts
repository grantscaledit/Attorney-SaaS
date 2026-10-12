"use server";

import { revalidatePath } from "next/cache";
import { runCommand, type ActionState } from "@/lib/commands/action";
import { saveQuestionnaire } from "@/modules/matters/commands/lifecycle";

export async function saveQuestionnaireAction(
  matterId: string,
  answers: Record<string, string>,
  submit: boolean,
): Promise<ActionState<unknown>> {
  const r = await runCommand(
    saveQuestionnaire,
    { matterId, answers, submit },
    {
      portal: true,
      successMessage: submit
        ? "Submitted. Thank you; your attorney will review it."
        : "Saved. You can come back to finish later.",
    },
  );
  if (r.status === "success") revalidatePath(`/portal/matters/${matterId}`);
  return r;
}
