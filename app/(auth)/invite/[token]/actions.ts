"use server";

import { redirect } from "next/navigation";
import { runCommand, type ActionState } from "@/lib/commands/action";
import { acceptInvite } from "@/modules/users/commands/accept-invite";

export async function acceptInviteAction(
  _prev: ActionState<unknown>,
  form: FormData,
): Promise<ActionState<unknown>> {
  const result = await runCommand(
    acceptInvite,
    {
      token: form.get("token"),
      password: form.get("password"),
      confirmPassword: form.get("confirmPassword"),
    },
    { anonymous: true },
  );
  if (result.status === "success") {
    redirect(`/sign-in?reason=welcome&email=${encodeURIComponent(result.data.email)}`);
  }
  return result;
}
