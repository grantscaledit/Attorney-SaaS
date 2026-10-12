"use server";

import { revalidatePath } from "next/cache";
import { runCommand, type ActionState } from "@/lib/commands/action";
import { declineLead, referLead } from "@/modules/intake/commands/followups";
import { rerunConflictCheck, reviewConflictCheck } from "@/modules/intake/commands/conflicts";

function refresh(leadId: string) {
  revalidatePath(`/intake/leads/${leadId}`);
  revalidatePath("/", "layout");
}

export async function reviewConflictAction(
  leadId: string,
  input: { checkId: string; decision: "cleared" | "conflict"; note: string },
): Promise<ActionState<unknown>> {
  const r = await runCommand(reviewConflictCheck, input, {
    successMessage:
      input.decision === "cleared" ? "Recorded as cleared." : "Recorded as a conflict.",
  });
  if (r.status === "success") refresh(leadId);
  return r;
}

export async function rerunConflictAction(leadId: string): Promise<ActionState<unknown>> {
  const r = await runCommand(
    rerunConflictCheck,
    { leadId },
    { successMessage: "Conflict pre-screen run." },
  );
  if (r.status === "success") refresh(leadId);
  return r;
}

export async function declineLeadAction(
  leadId: string,
  note: string,
): Promise<ActionState<unknown>> {
  const r = await runCommand(
    declineLead,
    { leadId, note },
    {
      successMessage: "Lead declined. If A11 is on, the non-engagement letter is in Approvals.",
    },
  );
  if (r.status === "success") refresh(leadId);
  return r;
}

export async function referLeadAction(
  leadId: string,
  partnerId: string,
): Promise<ActionState<unknown>> {
  const r = await runCommand(
    referLead,
    { leadId, partnerId },
    {
      successMessage: "Referral drafted. Review it in Approvals before it is sent.",
    },
  );
  if (r.status === "success") refresh(leadId);
  return r;
}
