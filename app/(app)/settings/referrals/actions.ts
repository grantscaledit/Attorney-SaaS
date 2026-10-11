"use server";

import { revalidatePath } from "next/cache";
import { runCommand, type ActionState } from "@/lib/commands/action";
import { removeReferralPartner, saveReferralPartner } from "@/modules/intake/commands/followups";

export async function saveReferralPartnerAction(
  _prev: ActionState<unknown>,
  form: FormData,
): Promise<ActionState<unknown>> {
  const text = (k: string) => String(form.get(k) ?? "");
  const result = await runCommand(
    saveReferralPartner,
    {
      name: text("name"),
      organization: text("organization"),
      handles: text("handles"),
      phone: text("phone"),
      email: text("email"),
      website: text("website"),
    },
    { successMessage: "Referral partner added." },
  );
  if (result.status === "success") revalidatePath("/settings/referrals");
  return result;
}

export async function removeReferralPartnerAction(id: string): Promise<ActionState<unknown>> {
  const result = await runCommand(removeReferralPartner, { id }, { successMessage: "Removed." });
  if (result.status === "success") revalidatePath("/settings/referrals");
  return result;
}
