"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { matters } from "@/db/schema";
import { can } from "@/lib/auth/can";
import { requireSession } from "@/lib/auth/session";
import { runCommand, type ActionState } from "@/lib/commands/action";
import { enqueueSafely, QUEUES } from "@/lib/jobs/queue";
import {
  confirmExtraction,
  setDocumentType,
  shareDocument,
} from "@/modules/documents/commands/documents";
import { closeMatter } from "@/modules/matters/commands/lifecycle";
import {
  addNote,
  addParty,
  assignMatter,
  changeStage,
  createTask,
  reissuePortalLink,
  removeParty,
  setTaskStatus,
} from "@/modules/matters/commands/matters";
import { DRAFT_KINDS, type DraftKind } from "@/modules/matters/drafts";
import { scopeOf } from "@/modules/matters/scope";

type State = ActionState<unknown>;

function refresh(matterId: string) {
  revalidatePath(`/matters/${matterId}`);
  revalidatePath("/", "layout");
}

export async function changeStageAction(matterId: string, stage: string): Promise<State> {
  const r = await runCommand(
    changeStage,
    { matterId, stage },
    { successMessage: "Stage updated." },
  );
  if (r.status === "success") {
    // B6 drafts a client update; it calls a model, so it runs as a job.
    if ((r.data as { b6: boolean }).b6) {
      await enqueueSafely(
        QUEUES.matterStatusUpdate,
        { matterId, reason: "stage_change" },
        { singletonKey: `${matterId}:stage_change` },
      );
    }
    refresh(matterId);
  }
  return r;
}

export async function assignAction(
  matterId: string,
  responsibleAttorneyId: string,
  assignedUserIds: string[],
): Promise<State> {
  const r = await runCommand(
    assignMatter,
    { matterId, responsibleAttorneyId, assignedUserIds },
    { successMessage: "Assignment saved." },
  );
  if (r.status === "success") refresh(matterId);
  return r;
}

export async function addNoteAction(matterId: string, body: string): Promise<State> {
  const r = await runCommand(addNote, { matterId, body }, { successMessage: "Note added." });
  if (r.status === "success") refresh(matterId);
  return r;
}

export async function createTaskAction(
  matterId: string,
  input: { title: string; dueOn?: string; assigneeId?: string },
): Promise<State> {
  const r = await runCommand(
    createTask,
    {
      matterId,
      title: input.title,
      dueOn: input.dueOn || undefined,
      assigneeId: input.assigneeId || undefined,
    },
    { successMessage: "Task added." },
  );
  if (r.status === "success") refresh(matterId);
  return r;
}

export async function setTaskStatusAction(
  matterId: string,
  taskId: string,
  status: "open" | "done" | "cancelled",
): Promise<State> {
  const r = await runCommand(setTaskStatus, { taskId, status });
  if (r.status === "success") refresh(matterId);
  return r;
}

export async function addPartyAction(
  matterId: string,
  input: { name: string; kind: string; role: string },
): Promise<State> {
  const r = await runCommand(
    addParty,
    { matterId, ...input },
    { successMessage: "Party added. New enquiries are checked against it." },
  );
  if (r.status === "success") refresh(matterId);
  return r;
}

export async function removePartyAction(matterId: string, partyId: string): Promise<State> {
  const r = await runCommand(removeParty, { partyId });
  if (r.status === "success") refresh(matterId);
  return r;
}

export async function closeMatterAction(matterId: string, note: string): Promise<State> {
  const r = await runCommand(
    closeMatter,
    { matterId, note },
    { successMessage: "Matter closed. The closing letter is in Approvals." },
  );
  if (r.status === "success") refresh(matterId);
  return r;
}

export async function reissuePortalLinkAction(matterId: string): Promise<State> {
  const r = await runCommand(reissuePortalLink, { matterId });
  if (r.status === "success") refresh(matterId);
  return r;
}

export async function confirmExtractionAction(
  matterId: string,
  extractionId: string,
  fields: {
    agency: string | null;
    noticeType: string | null;
    taxYears: string[];
    amountDue: string | null;
    noticeDate: string | null;
    respondBy: string | null;
  },
): Promise<State> {
  const r = await runCommand(
    confirmExtraction,
    { extractionId, fields },
    { successMessage: "Fields recorded." },
  );
  if (r.status === "success") refresh(matterId);
  return r;
}

export async function setDocumentTypeAction(
  matterId: string,
  documentId: string,
  docType: string,
): Promise<State> {
  const r = await runCommand(setDocumentType, { documentId, docType });
  if (r.status === "success") refresh(matterId);
  return r;
}

export async function shareDocumentAction(
  matterId: string,
  documentId: string,
  shared: boolean,
): Promise<State> {
  const r = await runCommand(shareDocument, { documentId, shared });
  if (r.status === "success") refresh(matterId);
  return r;
}

async function scopedCheck(
  matterId: string,
  action: "matters.read" | "drafts.write",
): Promise<boolean> {
  const { user, policy } = await requireSession();
  const [m] = await getDb().select().from(matters).where(eq(matters.id, matterId));
  return Boolean(m) && can(user, action, { resource: await scopeOf(getDb(), m!), policy });
}

/** B7 on demand. Reading the matter is enough: the summary is internal. */
export async function refreshSummaryAction(matterId: string): Promise<State> {
  if (!(await scopedCheck(matterId, "matters.read")))
    return { status: "error", message: "Not permitted." };
  await enqueueSafely(
    QUEUES.matterSummary,
    { matterId, trigger: "on_demand" },
    { singletonKey: `${matterId}:on_demand` },
  );
  return { status: "success", data: null, message: "Summary requested. Refresh in a minute." };
}

/** B8: request a first draft; it appears in Approvals as a draft. */
export async function requestDraftAction(matterId: string, kind: string): Promise<State> {
  const { user } = await requireSession();
  if (!(kind in DRAFT_KINDS)) return { status: "error", message: "Unknown draft type." };
  if (!(await scopedCheck(matterId, "drafts.write")))
    return { status: "error", message: "Not permitted." };
  await enqueueSafely(QUEUES.matterDraft, {
    matterId,
    kind: kind as DraftKind,
    requestedBy: user.id,
  });
  return {
    status: "success",
    data: null,
    message: "Draft requested. It will appear under Drafts and in Approvals.",
  };
}
