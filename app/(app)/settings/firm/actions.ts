"use server";

import { revalidatePath } from "next/cache";
import { runCommand, type ActionState } from "@/lib/commands/action";
import { invalidateFirmCaches } from "@/lib/firm.config";
import { updateFirmSettings } from "@/modules/firm/commands/update-settings";

export async function updateFirmSettingsAction(
  _prev: ActionState<unknown>,
  form: FormData,
): Promise<ActionState<unknown>> {
  const text = (k: string) => String(form.get(k) ?? "");
  const result = await runCommand(
    updateFirmSettings,
    {
      legalName: text("legalName"),
      displayName: text("displayName"),
      addressLine1: text("addressLine1"),
      addressLine2: text("addressLine2"),
      city: text("city"),
      state: text("state").toUpperCase(),
      postalCode: text("postalCode"),
      phone: text("phone"),
      website: text("website"),
      practiceAreas: form.getAll("practiceAreas").map(String),
      aiDisclosureText: text("aiDisclosureText"),
      attorneysSeeFinancials: form.get("attorneysSeeFinancials") === "on",
      ipAllowlist: text("ipAllowlist")
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean),
    },
    { successMessage: "Firm settings saved." },
  );
  if (result.status === "success") {
    invalidateFirmCaches();
    revalidatePath("/", "layout");
  }
  return result;
}
