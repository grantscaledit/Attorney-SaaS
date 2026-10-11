"use server";

import { revalidatePath } from "next/cache";
import { runCommand, type ActionState } from "@/lib/commands/action";
import { declineLead, referLead } from "@/modules/intake/commands/followups";
import { ESignError, getESignProvider } from "@/lib/esign";
import {
  draftEngagement,
  markEngagementSigned,
  withdrawEngagement,
} from "@/modules/matters/commands/engagements";
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

export async function retainAction(
  leadId: string,
  input: {
    practiceArea: string;
    matterType: string;
    feeTerms: string;
    signingUrl: string;
    signerName: string;
    signerEmail: string | null;
  },
): Promise<ActionState<unknown>> {
  // The e-sign provider prepares signing before the command (it may call a vendor; commands never do).
  const provider = getESignProvider();
  let prepared;
  try {
    prepared = await provider.prepare({
      engagementId: leadId,
      letterText: "",
      signer: { name: input.signerName, email: input.signerEmail },
      providedUrl: input.signingUrl,
    });
  } catch (err) {
    if (err instanceof ESignError)
      return { status: "error", message: err.message, fieldErrors: { signingUrl: [err.message] } };
    throw err;
  }
  const r = await runCommand(
    draftEngagement,
    {
      leadId,
      practiceArea: input.practiceArea,
      matterType: input.matterType,
      feeTerms: input.feeTerms,
      signingUrl: prepared.signingUrl,
      provider: provider.kind,
      envelopeId: prepared.envelopeId,
    },
    { successMessage: "Engagement letter drafted. Review and approve it in Approvals to send it." },
  );
  if (r.status === "success") refresh(leadId);
  return r;
}

export async function markSignedAction(
  leadId: string,
  engagementId: string,
): Promise<ActionState<unknown>> {
  const r = await runCommand(
    markEngagementSigned,
    { engagementId },
    { successMessage: "Signed. The matter is open." },
  );
  if (r.status === "success") refresh(leadId);
  return r;
}

export async function withdrawEngagementAction(
  leadId: string,
  engagementId: string,
  reason: string,
): Promise<ActionState<unknown>> {
  const r = await runCommand(
    withdrawEngagement,
    { engagementId, reason },
    { successMessage: "Engagement letter withdrawn." },
  );
  if (r.status === "success") refresh(leadId);
  return r;
}
