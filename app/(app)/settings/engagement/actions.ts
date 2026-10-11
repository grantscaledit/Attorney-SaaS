"use server";

import { revalidatePath } from "next/cache";
import { runCommand, type ActionState } from "@/lib/commands/action";
import { invalidateFirmCaches } from "@/lib/firm.config";
import { updateEngagementTemplate } from "@/modules/firm/commands/engagement-template";

export async function saveEngagementTemplateAction(
  _prev: ActionState<unknown>,
  form: FormData,
): Promise<ActionState<unknown>> {
  const r = await runCommand(
    updateEngagementTemplate,
    { template: String(form.get("template") ?? "") },
    { successMessage: "Template saved." },
  );
  if (r.status === "success") {
    invalidateFirmCaches();
    revalidatePath("/settings/engagement");
  }
  return r;
}
