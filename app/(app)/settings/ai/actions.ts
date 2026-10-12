"use server";

import { revalidatePath } from "next/cache";
import { runCommand, type ActionState } from "@/lib/commands/action";
import { invalidateFirmCaches } from "@/lib/firm.config";
import { updateAiSettings } from "@/modules/firm/commands/ai-settings";
import { updateIntakeProfile } from "@/modules/users/commands/intake-profile";

/** Fee table lines: "Service | Fee". */
function parseFees(text: string): { service: string; fee: string }[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [service = "", ...fee] = l.split("|");
      return { service: service.trim(), fee: fee.join("|").trim() };
    });
}

export async function updateAiSettingsAction(
  _prev: ActionState<unknown>,
  form: FormData,
): Promise<ActionState<unknown>> {
  const result = await runCommand(
    updateAiSettings,
    {
      a3Mode: String(form.get("a3Mode") ?? "review_all"),
      consultCalendarId: String(form.get("consultCalendarId") ?? ""),
      feeTable: parseFees(String(form.get("feeTable") ?? "")),
    },
    { successMessage: "AI intake settings saved." },
  );
  if (result.status === "success") {
    invalidateFirmCaches();
    revalidatePath("/settings/ai");
  }
  return result;
}

export async function updateIntakeProfileAction(
  _prev: ActionState<unknown>,
  form: FormData,
): Promise<ActionState<unknown>> {
  const result = await runCommand(
    updateIntakeProfile,
    {
      userId: String(form.get("userId") ?? ""),
      practiceAreas: form.getAll("practiceAreas").map(String),
      ghlContactId: String(form.get("ghlContactId") ?? ""),
    },
    { successMessage: "Saved." },
  );
  if (result.status === "success") revalidatePath("/settings/ai");
  return result;
}
