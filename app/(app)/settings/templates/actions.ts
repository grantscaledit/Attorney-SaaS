"use server";

import { revalidatePath } from "next/cache";
import { runCommand, type ActionState } from "@/lib/commands/action";
import {
  approveMessageTemplate,
  saveMessageTemplate,
  withdrawTemplateApproval,
} from "@/modules/messaging/commands/templates";

export async function saveTemplateAction(
  _prev: ActionState<unknown>,
  form: FormData,
): Promise<ActionState<unknown>> {
  const subject = form.get("subject");
  const result = await runCommand(
    saveMessageTemplate,
    {
      key: String(form.get("key") ?? ""),
      body: String(form.get("body") ?? ""),
      subject: typeof subject === "string" ? subject : undefined,
    },
    { successMessage: "Saved. Review the text and approve it to start sending." },
  );
  if (result.status === "success") revalidatePath("/settings/templates");
  return result;
}

export async function approveTemplateAction(
  key: string,
  body: string,
  subject: string | null,
): Promise<ActionState<unknown>> {
  const result = await runCommand(
    approveMessageTemplate,
    { key, body, subject },
    { successMessage: "Approved. This message now sends automatically." },
  );
  if (result.status === "success") revalidatePath("/settings/templates");
  return result;
}

export async function withdrawTemplateAction(key: string): Promise<ActionState<unknown>> {
  const result = await runCommand(
    withdrawTemplateApproval,
    { key },
    { successMessage: "Approval withdrawn. Queued messages using it will not send." },
  );
  if (result.status === "success") revalidatePath("/settings/templates");
  return result;
}
