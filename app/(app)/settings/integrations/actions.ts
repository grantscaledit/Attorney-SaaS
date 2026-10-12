"use server";

import { revalidatePath } from "next/cache";
import { runCommand, type ActionState } from "@/lib/commands/action";
import { enqueueSafely, QUEUES } from "@/lib/jobs/queue";
import { retryGhlWebhook } from "@/modules/ghl/commands/process-webhook";
import { requestReconcile } from "@/modules/ghl/commands/reconcile";

export async function retryWebhookAction(eventId: string): Promise<ActionState<unknown>> {
  const result = await runCommand(retryGhlWebhook, { eventId });
  if (result.status === "success") {
    await enqueueSafely(QUEUES.ghlWebhook, { eventId }, { singletonKey: `${eventId}:retry` });
    revalidatePath("/settings/integrations");
  }
  return result;
}

export async function reconcileNowAction(): Promise<ActionState<unknown>> {
  const result = await runCommand(requestReconcile, {});
  if (result.status !== "success") return result;
  const queued = await enqueueSafely(QUEUES.ghlReconcile, {}, { singletonKey: "reconcile-now" });
  return queued
    ? {
        status: "success",
        data: null,
        message: "Reconciliation started. Refresh in a minute to see the result.",
      }
    : {
        status: "error",
        message: "The background worker could not be reached. Try again shortly.",
      };
}
