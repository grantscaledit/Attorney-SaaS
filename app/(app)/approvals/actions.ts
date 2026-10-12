"use server";

import { revalidatePath } from "next/cache";
import { runCommand, type ActionState } from "@/lib/commands/action";
import { enqueueSafely, QUEUES } from "@/lib/jobs/queue";
import { decideApproval } from "@/modules/approvals/commands/decide";

export async function decideApprovalAction(
  input:
    | { approvalId: string; decision: "approve"; body?: string; subject?: string }
    | { approvalId: string; decision: "reject"; reason: string },
): Promise<ActionState<unknown>> {
  const result = await runCommand(decideApproval, input, {
    successMessage:
      input.decision === "approve"
        ? "Approved."
        : "Rejected. The reason is kept for review of the drafts.",
  });
  if (result.status === "success") {
    const { messages } = result.data as {
      messages: { messageId: string; scheduledFor: Date | null; status: string }[];
    };
    for (const m of messages) {
      if (m.status !== "queued") continue;
      await enqueueSafely(
        QUEUES.messageSend,
        { messageId: m.messageId },
        {
          startAfter: m.scheduledFor ?? undefined,
          singletonKey: m.messageId,
        },
      );
    }
    revalidatePath("/", "layout");
  }
  return result;
}
