import { and, eq, isNull, lt } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  approvals,
  checklistItems,
  contacts,
  documentExtractions,
  documents,
  engagements,
  firmSettings,
  intakeRecords,
  matters,
  questionnaires,
  users,
} from "@/db/schema";
import { aiCall } from "@/lib/ai/call";
import { checkDraft, type FeeEntry } from "@/lib/ai/guard";
import { execute } from "@/lib/commands/execute";
import { enqueueSafely, QUEUES } from "@/lib/jobs/queue";
import { log } from "@/lib/log";
import { sendEngagementReminders } from "@/modules/matters/commands/engagements";
import {
  applyDraft,
  chaseDocuments,
  draftStatusUpdate,
  flagStalled,
} from "@/modules/matters/commands/lifecycle";
import {
  B6_PROMPT_VERSION,
  B6_SYSTEM,
  b6Output,
  B8_PROMPT_VERSION,
  B8_SYSTEM,
  b8Output,
  DRAFT_KINDS,
  DRAFT_LABEL,
  plainStatusUpdate,
  skeleton,
  type DraftKind,
} from "@/modules/matters/drafts";
import { ESTATE_QUESTIONNAIRE } from "@/modules/matters/questionnaire";
import { stageLabel, typeOf } from "@/modules/matters/scope";
import { automationEnabled } from "@/modules/messaging/commands/outbox";
import { stagesOf } from "@/practice";
import type { NoticeFields } from "@/modules/documents/notice-parser";
import { jobContext } from "../context";
import { dispatchQueued } from "../messaging/send";

/*
 * Matter jobs that call a model (B6, B8) and the daily pass (B2, B5, B6 for
 * quiet matters, A9 reminders). Model calls run here, outside transactions;
 * commands apply the results.
 */

export async function enqueueStatusUpdate(
  matterId: string,
  reason: "stage_change" | "no_contact",
): Promise<void> {
  await enqueueSafely(
    QUEUES.matterStatusUpdate,
    { matterId, reason },
    { singletonKey: `${matterId}:${reason}` },
  );
}

export async function enqueueDraft(
  matterId: string,
  kind: DraftKind,
  requestedBy: string,
): Promise<void> {
  await enqueueSafely(QUEUES.matterDraft, { matterId, kind, requestedBy });
}

/** B6: a plain-language update for the client, drafted for approval. */
export async function runStatusUpdate(
  matterId: string,
  reason: "stage_change" | "no_contact",
): Promise<void> {
  const db = getDb();
  if (!(await automationEnabled(db, "B6"))) return;
  const [m] = await db.select().from(matters).where(eq(matters.id, matterId));
  if (!m || m.status !== "open") return;
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, m.contactId));
  const [firm] = await db
    .select({ name: firmSettings.displayName, fees: firmSettings.feeTable })
    .from(firmSettings)
    .where(eq(firmSettings.id, 1));
  const outstanding = (
    await db
      .select({ label: checklistItems.label })
      .from(checklistItems)
      .where(and(eq(checklistItems.matterId, m.id), eq(checklistItems.status, "requested")))
  ).map((i) => i.label);
  const stages = stagesOf(typeOf(m));
  const next = stages[stages.findIndex((s) => s.key === m.stage) + 1];
  const fallback = plainStatusUpdate({
    firstName: contact?.firstName ?? null,
    firmName: firm?.name ?? "the firm",
    stage: stageLabel(m),
    outstanding,
  });
  const ai = await aiCall({
    purpose: "matters.status_update",
    automationId: "B6",
    promptVersion: B6_PROMPT_VERSION,
    tier: "standard",
    effort: "low",
    maxTokens: 1_000,
    system: B6_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          `Client first name: ${contact?.firstName ?? "(unknown)"}`,
          `Firm: ${firm?.name ?? "the firm"}`,
          `Matter: ${typeOf(m).label}`,
          `Current stage: ${stageLabel(m)}`,
          next && next.key !== "closed" ? `Next stage: ${next.label}` : "",
          outstanding.length
            ? `Documents still needed from the client: ${outstanding.join("; ")}`
            : "Nothing is needed from the client.",
          reason === "no_contact"
            ? "Reason: the client has not heard from the firm in two weeks."
            : "Reason: the matter moved to a new stage.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    schema: b6Output,
    entity: { type: "matter", id: m.id },
  });
  const body = ai.ok ? ai.output.body : fallback;
  const findings = checkDraft(body, (firm?.fees as FeeEntry[]) ?? []);
  const { principal, request } = jobContext(QUEUES.matterStatusUpdate, matterId);
  await execute(
    draftStatusUpdate,
    principal,
    { matterId, reason, body, aiRunId: ai.ok ? ai.runId : null, findings },
    { request },
  );
}

/** B8: a first draft for the attorney from the matter's records. */
export async function runDraft(
  matterId: string,
  kind: DraftKind,
  requestedBy: string | null,
): Promise<void> {
  const db = getDb();
  if (!(await automationEnabled(db, "B8"))) return;
  const [m] = await db.select().from(matters).where(eq(matters.id, matterId));
  if (!m) return;
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, m.contactId));
  const [attorney] = m.responsibleAttorneyId
    ? await db.select({ name: users.name }).from(users).where(eq(users.id, m.responsibleAttorneyId))
    : [];
  const facts: Record<string, string> = {};
  if (contact?.fullName) facts.clientName = contact.fullName;
  if (attorney?.name) facts.attorneyName = attorney.name;
  const [ex] = await db
    .select({ fields: documentExtractions.fields })
    .from(documentExtractions)
    .innerJoin(documents, eq(documents.id, documentExtractions.documentId))
    .where(eq(documents.matterId, m.id))
    .limit(1);
  const nf = ex?.fields as NoticeFields | undefined;
  if (nf?.noticeType) facts.noticeType = nf.noticeType;
  if (nf?.taxYears.length) facts.taxYears = nf.taxYears.join(", ");
  if (nf?.noticeDate) facts.noticeDate = nf.noticeDate;
  const [q] = await db.select().from(questionnaires).where(eq(questionnaires.matterId, m.id));
  const qa = (q?.answers ?? {}) as Record<string, string>;
  for (const s of ESTATE_QUESTIONNAIRE) {
    const lines = s.questions.filter((x) => qa[x.id]).map((x) => `${x.label}: ${qa[x.id]}`);
    if (lines.length) facts[s.key] = lines.join("; ");
  }
  const [rec] = m.leadId
    ? await db
        .select({ answers: intakeRecords.answers })
        .from(intakeRecords)
        .where(eq(intakeRecords.leadId, m.leadId))
    : [];
  const ia = (rec?.answers ?? {}) as Record<string, string>;
  if (ia.entity) facts.entity = ia.entity;
  if (ia.owners) facts.owners = ia.owners;
  const outline = skeleton(kind, facts);
  const ai = await aiCall({
    purpose: "matters.draft",
    automationId: "B8",
    promptVersion: B8_PROMPT_VERSION,
    tier: "deep",
    effort: "medium",
    maxTokens: 8_000,
    system: B8_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Prepare: ${DRAFT_KINDS[kind].label}.\n\nRecords:\n${Object.entries(facts)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n")}\n\nFollow this outline:\n${outline}`,
      },
    ],
    schema: b8Output,
    entity: { type: "matter", id: m.id },
  });
  let body = ai.ok ? ai.output.body : outline;
  if (!body.startsWith("DRAFT")) body = `${DRAFT_LABEL}\n\n${body}`;
  const { principal, request } = jobContext(QUEUES.matterDraft, matterId);
  await execute(
    applyDraft,
    principal,
    { matterId, kind, body, aiRunId: ai.ok ? ai.runId : null, requestedBy },
    { request },
  );
}

const DAY = 86_400_000;
export const MATTERS_DAILY_CRON = "40 7 * * *";

/** B2, B5, B6 (no contact in 14 days) and A9 reminders. */
export async function runMattersDaily(): Promise<{ matters: number; engagements: number }> {
  const db = getDb();
  const { principal, request } = jobContext(QUEUES.mattersDaily);
  const [b2, b5, b6] = await Promise.all([
    automationEnabled(db, "B2"),
    automationEnabled(db, "B5"),
    automationEnabled(db, "B6"),
  ]);
  const open = await db
    .select()
    .from(matters)
    .where(and(eq(matters.status, "open"), isNull(matters.deletedAt)));
  for (const m of open) {
    try {
      if (b2) {
        const r = await execute(chaseDocuments, principal, { matterId: m.id }, { request });
        await dispatchQueued(r.messages);
      }
      if (b5) await execute(flagStalled, principal, { matterId: m.id }, { request });
      if (b6 && Date.now() - (m.lastClientContactAt ?? m.openedAt).getTime() >= 14 * DAY) {
        const [pending] = await db
          .select({ id: approvals.id })
          .from(approvals)
          .where(
            and(
              eq(approvals.matterId, m.id),
              eq(approvals.automationId, "B6"),
              eq(approvals.status, "pending"),
            ),
          );
        if (!pending) await runStatusUpdate(m.id, "no_contact");
      }
    } catch (err) {
      log.error("daily matter pass failed", { matterId: m.id, err });
    }
  }
  const sent = await db
    .select({ id: engagements.id })
    .from(engagements)
    .where(and(eq(engagements.status, "sent"), lt(engagements.remindersSent, 3)));
  for (const e of sent) {
    try {
      const r = await execute(
        sendEngagementReminders,
        principal,
        { engagementId: e.id },
        { request },
      );
      await dispatchQueued(r.messages);
    } catch (err) {
      log.error("A9 reminders failed", { engagementId: e.id, err });
    }
  }
  return { matters: open.length, engagements: sent.length };
}
