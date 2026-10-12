import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  checklistItems,
  contacts,
  deadlines,
  documents,
  matters,
  questionnaires,
  tasks,
} from "@/db/schema";
import type { AuditSpec } from "@/lib/commands/define";
import { defineCommand } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";
import { requireSystem } from "@/lib/commands/system";
import { env } from "@/lib/env";
import { maskText } from "@/lib/masking";
import { createApproval } from "@/modules/approvals/commands/create";
import type { QueuedMessage } from "@/modules/intake/commands/automations";
import {
  automationEnabled,
  queueAutomatedMessage,
  recordAutomationRun,
} from "@/modules/messaging/commands/outbox";
import { DOC_TYPE_LABELS, stagesOf, type DocType } from "@/practice";
import { closingLetter, DRAFT_KINDS } from "../drafts";
import { QUESTION_IDS } from "../questionnaire";
import { firmName, firmToday, lockMatter, scopeOf, stageLabel, typeOf } from "../scope";

/*
 * Matter lifecycle automations: B2 document chasing, B5 stalled matters, B6
 * client status update drafts, B8 drafting assist, B9 questionnaire, B10
 * closing package. Anything addressed to the client waits for approval.
 */

const DAY = 86_400_000;
const portalUrl = () => new URL("/portal", env().APP_URL).toString();

// ------------------------------------------------------------------ B10 --

function addYears(isoDate: string, years: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y + years, m - 1, d));
  // 29 February plus a year is 28 February, not 1 March.
  if (dt.getUTCMonth() !== m - 1) dt.setUTCDate(0);
  return dt.toISOString().slice(0, 10);
}

/** Exported for tests. */
export const retentionDate = addYears;

export const closeMatter = defineCommand({
  name: "matters.close",
  permission: "matters.write",
  input: z.object({
    matterId: z.uuid(),
    note: z.string().trim().min(3, "Say why the matter is closing").max(2_000),
  }),
  async run(ctx, input) {
    const m = await lockMatter(ctx.tx, input.matterId);
    ctx.authorize("matters.write", { resource: await scopeOf(ctx.tx, m) });
    if (m.status === "closed")
      throw new CommandError("invalid_state", "This matter is already closed.");
    const now = new Date();
    const retentionUntil = addYears(firmToday(now), typeOf(m).retentionYears);
    await ctx.tx
      .update(matters)
      .set({
        status: "closed",
        stage: "closed",
        stageChangedAt: now,
        closedAt: now,
        retentionUntil,
        updatedAt: now,
      })
      .where(eq(matters.id, m.id));
    await ctx.tx
      .update(checklistItems)
      .set({ status: "waived", updatedAt: now })
      .where(and(eq(checklistItems.matterId, m.id), eq(checklistItems.status, "requested")));
    await ctx.tx
      .update(tasks)
      .set({ status: "cancelled", updatedAt: now })
      .where(
        and(
          eq(tasks.matterId, m.id),
          eq(tasks.status, "open"),
          inArray(tasks.automationId, ["B2", "B5", "B3"]),
        ),
      );
    // Open deadlines close with the matter; their alerts stop (C2).
    const closedDeadlines = await ctx.tx
      .update(deadlines)
      .set({ status: "cancelled", note: "matter closed", updatedAt: now })
      .where(and(eq(deadlines.matterId, m.id), eq(deadlines.status, "open")))
      .returning({ id: deadlines.id, dueOn: deadlines.dueOn });
    const audit: AuditSpec[] = [
      ...closedDeadlines.map((d): AuditSpec => ({
        action: "deadlines.cancelled",
        entityType: "deadline",
        entityId: d.id,
        before: { status: "open", dueOn: d.dueOn },
        after: { status: "cancelled" },
        metadata: { reason: "matter closed", matterId: m.id },
      })),
      {
        action: "matters.closed",
        entityType: "matter",
        entityId: m.id,
        before: { status: m.status, stage: m.stage },
        after: { status: "closed", retentionUntil, note: input.note },
      },
    ];
    if (await automationEnabled(ctx.tx, "B10")) {
      // Originals the client handed over go back (B10 "document return list").
      const provided = await ctx.tx
        .select({ name: documents.displayName, docType: documents.docType })
        .from(documents)
        .where(
          and(
            eq(documents.matterId, m.id),
            eq(documents.uploadedVia, "portal"),
            isNull(documents.deletedAt),
          ),
        );
      const originals = await ctx.tx
        .select({ name: documents.displayName })
        .from(documents)
        .where(
          and(
            eq(documents.matterId, m.id),
            inArray(documents.docType, ["will", "trust", "deed", "death_certificate"]),
            isNull(documents.deletedAt),
          ),
        );
      const returnList = [
        ...new Set([
          ...originals.map((d) => `Original: ${d.name}`),
          ...provided.map((d) => `Copy you uploaded: ${d.name}`),
        ]),
      ];
      const [contact] = await ctx.tx.select().from(contacts).where(eq(contacts.id, m.contactId));
      const letter = closingLetter({
        firmName: await firmName(ctx.tx),
        firstName: contact?.firstName ?? null,
        matterTitle: m.title,
        returnList,
        retentionUntil: new Intl.DateTimeFormat("en-US", {
          dateStyle: "long",
          timeZone: "UTC",
        }).format(new Date(`${retentionUntil}T00:00:00Z`)),
      });
      const a = await createApproval(ctx.tx, {
        automationId: "B10",
        kind: "letter",
        title: `Closing letter: ${m.number} ${m.title}`,
        channel: contact?.email ? "email" : "none",
        leadId: m.leadId,
        contactId: m.contactId,
        matterId: m.id,
        subject: letter.subject,
        draftBody: letter.body,
        flags: {
          notes: [
            "Fixed draft: review before approving.",
            ...(contact?.email ? [] : ["No email address: send by post and keep a copy."]),
          ],
        },
        dedupeKey: `B10:${m.id}`,
      });
      audit.push(...a.audit);
      if (returnList.some((r) => r.startsWith("Original"))) {
        await ctx.tx
          .insert(tasks)
          .values({
            matterId: m.id,
            title: "Return original documents to the client",
            assigneeId: m.responsibleAttorneyId,
            automationId: "B10",
            dedupeKey: `B10:return:${m.id}`,
          })
          .onConflictDoNothing();
      }
      // E2 and E7 (lifecycle) arrive in Phase 6; the run records that they are due.
      await recordAutomationRun(ctx.tx, {
        automationId: "B10",
        trigger: "matter_closed",
        status: "succeeded",
        entityType: "matter",
        entityId: m.id,
        detail: { approvalId: a.row.id, returnItems: returnList.length, next: ["E2", "E7"] },
      });
    }
    return { result: { retentionUntil }, audit: audit as [AuditSpec, ...AuditSpec[]] };
  },
});

// ------------------------------------------------------------------- B6 --

/** A drafted client status update (from the job: model text or the fixed fallback). */
export const draftStatusUpdate = defineCommand({
  name: "matters.draft_status_update",
  permission: "matters.write",
  input: z.object({
    matterId: z.uuid(),
    reason: z.enum(["stage_change", "no_contact"]),
    body: z.string().min(1).max(2_000),
    aiRunId: z.uuid().nullable(),
    findings: z.array(z.string()),
  }),
  async run(ctx, input) {
    requireSystem(ctx);
    const m = await lockMatter(ctx.tx, input.matterId);
    const [contact] = await ctx.tx.select().from(contacts).where(eq(contacts.id, m.contactId));
    const channel = contact?.email ? "email" : contact?.phone ? "sms" : "none";
    const key =
      input.reason === "stage_change"
        ? `B6:${m.id}:stage:${m.stage}:${m.stageChangedAt.toISOString()}`
        : `B6:${m.id}:quiet:${(m.lastClientContactAt ?? m.openedAt).toISOString()}`;
    const a = await createApproval(ctx.tx, {
      automationId: "B6",
      kind: "message",
      title: `Client update: ${m.number} (${input.reason === "stage_change" ? `now ${stageLabel(m).toLowerCase()}` : "14 days without contact"})`,
      channel,
      leadId: m.leadId,
      contactId: m.contactId,
      matterId: m.id,
      subject:
        channel === "email" ? `An update on your matter with ${await firmName(ctx.tx)}` : null,
      draftBody: maskText(input.body).text,
      flags: input.findings.length
        ? {
            findings: input.findings,
            notes: ["The draft guard flagged this text: edit it before approving."],
          }
        : undefined,
      aiRunId: input.aiRunId,
      dedupeKey: key,
      supersedePendingForLead: false,
    });
    await recordAutomationRun(ctx.tx, {
      automationId: "B6",
      trigger: input.reason,
      status: a.created ? "succeeded" : "skipped",
      entityType: "matter",
      entityId: m.id,
      detail: { approvalId: a.row.id },
    });
    const [first, ...rest] = a.audit;
    return {
      result: { approvalId: a.row.id, created: a.created },
      audit: [
        first ?? { action: "matters.status_update_exists", entityType: "matter", entityId: m.id },
        ...rest,
      ],
    };
  },
});

// ------------------------------------------------------------------- B8 --

export const applyDraft = defineCommand({
  name: "matters.apply_draft",
  permission: "drafts.write",
  input: z.object({
    matterId: z.uuid(),
    kind: z.enum(
      Object.keys(DRAFT_KINDS) as [keyof typeof DRAFT_KINDS, ...(keyof typeof DRAFT_KINDS)[]],
    ),
    body: z.string().min(1).max(20_000),
    aiRunId: z.uuid().nullable(),
    requestedBy: z.uuid().nullable(),
  }),
  async run(ctx, input) {
    requireSystem(ctx);
    const m = await lockMatter(ctx.tx, input.matterId);
    const a = await createApproval(ctx.tx, {
      automationId: "B8",
      kind: "draft",
      title: `Draft: ${DRAFT_KINDS[input.kind].label} (${m.number})`,
      channel: "none",
      leadId: m.leadId,
      contactId: m.contactId,
      matterId: m.id,
      draftBody: maskText(input.body).text,
      sources: { kind: input.kind, requestedBy: input.requestedBy },
      aiRunId: input.aiRunId,
      dedupeKey: `B8:${m.id}:${input.kind}:${Date.now()}`,
    });
    await recordAutomationRun(ctx.tx, {
      automationId: "B8",
      trigger: "attorney_request",
      status: "succeeded",
      entityType: "matter",
      entityId: m.id,
      detail: { kind: input.kind, approvalId: a.row.id },
    });
    return {
      result: { approvalId: a.row.id },
      audit: [
        {
          action: "matters.draft_prepared",
          entityType: "matter",
          entityId: m.id,
          after: { kind: input.kind },
        },
        ...a.audit,
      ],
    };
  },
});

// ------------------------------------------------------------------- B9 --

export const saveQuestionnaire = defineCommand({
  name: "questionnaires.save",
  permission: "portal.access",
  input: z.object({
    matterId: z.uuid(),
    answers: z.record(z.string().max(40), z.string().max(4_000)),
    submit: z.boolean(),
  }),
  async run(ctx, input) {
    const m = await lockMatter(ctx.tx, input.matterId);
    ctx.authorize("matters.read", { resource: await scopeOf(ctx.tx, m) });
    const [q] = await ctx.tx
      .select()
      .from(questionnaires)
      .where(and(eq(questionnaires.matterId, m.id), eq(questionnaires.kind, "estate_planning")))
      .for("update");
    if (!q) throw new CommandError("not_found", "There is no questionnaire for this matter.");
    if (q.status === "submitted")
      throw new CommandError(
        "invalid_state",
        "This questionnaire was already submitted. Contact the firm to change an answer.",
      );
    // Known questions only; identifiers and dates of birth masked (rule 6).
    const answers: Record<string, string> = { ...(q.answers as Record<string, string>) };
    let maskedAny = false;
    for (const [k, v] of Object.entries(input.answers)) {
      if (!QUESTION_IDS.has(k)) continue;
      const r = maskText(v.trim());
      if (Object.keys(r.found).length) maskedAny = true;
      if (r.text) answers[k] = r.text;
      else delete answers[k];
    }
    const now = new Date();
    await ctx.tx
      .update(questionnaires)
      .set({
        answers,
        status: input.submit ? "submitted" : "in_progress",
        submittedAt: input.submit ? now : null,
        updatedAt: now,
      })
      .where(eq(questionnaires.id, q.id));
    await ctx.tx.update(matters).set({ lastClientContactAt: now }).where(eq(matters.id, m.id));
    if (input.submit) {
      await ctx.tx
        .insert(tasks)
        .values({
          matterId: m.id,
          title: "Review the client's estate planning questionnaire",
          assigneeId: m.responsibleAttorneyId,
          automationId: "B9",
          dedupeKey: `B9:review:${m.id}`,
        })
        .onConflictDoNothing();
      await recordAutomationRun(ctx.tx, {
        automationId: "B9",
        trigger: "submitted",
        status: "succeeded",
        entityType: "matter",
        entityId: m.id,
      });
    }
    return {
      result: { saved: true, masked: maskedAny },
      audit: [
        {
          action: input.submit ? "questionnaires.submitted" : "questionnaires.saved",
          entityType: "matter",
          entityId: m.id,
          metadata: { answered: Object.keys(answers).length, masked: maskedAny },
        },
      ],
    };
  },
});

// ------------------------------------------------------------------- B2 --

export const B2_DAYS = [3, 7, 14] as const;

/** Daily, per open matter: document reminders on days 3, 7 and 14, then a task for staff. */
export const chaseDocuments = defineCommand({
  name: "matters.chase_documents",
  permission: "matters.write",
  input: z.object({ matterId: z.uuid() }),
  async run(ctx, input) {
    requireSystem(ctx);
    const m = await lockMatter(ctx.tx, input.matterId);
    const audit: AuditSpec[] = [];
    const queued: QueuedMessage[] = [];
    const items = await ctx.tx
      .select()
      .from(checklistItems)
      .where(
        and(
          eq(checklistItems.matterId, m.id),
          eq(checklistItems.status, "requested"),
          eq(checklistItems.required, true),
        ),
      )
      .orderBy(asc(checklistItems.requestedAt));
    if (m.status !== "open" || items.length === 0) {
      return {
        result: { messages: [] },
        audit: [
          {
            action: "matters.chase_checked",
            entityType: "matter",
            entityId: m.id,
            metadata: { outstanding: 0 },
          },
        ],
      };
    }
    const age = Math.floor((Date.now() - items[0]!.requestedAt.getTime()) / DAY);
    const step = B2_DAYS.filter((d) => age >= d).length;
    const [contact] = await ctx.tx.select().from(contacts).where(eq(contacts.id, m.contactId));
    const outstanding = items.map((i) => `- ${i.label}`).join("\n");
    for (let s = Math.max(0, items[0]!.remindersSent); s < step && contact; s++) {
      const day = B2_DAYS[s]!;
      for (const templateKey of ["B2.reminder.email", "B2.reminder.sms"] as const) {
        const q = await queueAutomatedMessage(ctx.tx, {
          automationId: "B2",
          templateKey,
          contact,
          leadId: m.leadId,
          idempotencyKey: `B2:${m.id}:day${day}:${templateKey.endsWith("sms") ? "sms" : "email"}`,
          dueAt: new Date(),
          notAfter: new Date(items[0]!.requestedAt.getTime() + (day + 3) * DAY),
          requireSmsConsent: true,
          values: { outstandingItems: outstanding, portalUrl: portalUrl() },
          context: { matterId: m.id, onlyWhileChecklistOpen: m.id },
        });
        audit.push(...q.audit);
        queued.push({ messageId: q.messageId, status: q.status, scheduledFor: q.scheduledFor });
      }
    }
    if (step > items[0]!.remindersSent) {
      const now = new Date();
      await ctx.tx
        .update(checklistItems)
        .set({ remindersSent: step, lastReminderAt: now, updatedAt: now })
        .where(
          inArray(
            checklistItems.id,
            items.map((i) => i.id),
          ),
        );
    }
    // After the day-14 reminder, a person follows up.
    if (step >= B2_DAYS.length) {
      await ctx.tx
        .insert(tasks)
        .values({
          matterId: m.id,
          title: `Call the client about outstanding documents (${items.length})`,
          detail: items
            .map((i) => `${i.label} (${DOC_TYPE_LABELS[i.docType as DocType]})`)
            .join("\n"),
          assigneeId: m.assignedUserIds[0] ?? m.responsibleAttorneyId,
          automationId: "B2",
          dedupeKey: `B2:task:${m.id}:${items[0]!.requestedAt.toISOString().slice(0, 10)}`,
        })
        .onConflictDoNothing();
    }
    if (queued.length) {
      await recordAutomationRun(ctx.tx, {
        automationId: "B2",
        trigger: "documents_outstanding",
        status: "succeeded",
        entityType: "matter",
        entityId: m.id,
        detail: { step, outstanding: items.length },
      });
    }
    return {
      result: { messages: queued },
      audit: [
        {
          action: "matters.chase_checked",
          entityType: "matter",
          entityId: m.id,
          metadata: { outstanding: items.length, step },
        },
        ...audit,
      ],
    };
  },
});

// ------------------------------------------------------------------- B5 --

/** Daily, per open matter: in one stage past the stage's threshold, the attorney gets a task. */
export const flagStalled = defineCommand({
  name: "matters.flag_stalled",
  permission: "matters.write",
  input: z.object({ matterId: z.uuid() }),
  async run(ctx, input) {
    requireSystem(ctx);
    const m = await lockMatter(ctx.tx, input.matterId);
    const stage = stagesOf(typeOf(m)).find((s) => s.key === m.stage);
    const days = Math.floor((Date.now() - m.stageChangedAt.getTime()) / DAY);
    const stalled =
      m.status === "open" && stage?.thresholdDays != null && days > stage.thresholdDays;
    if (stalled) {
      const [t] = await ctx.tx
        .insert(tasks)
        .values({
          matterId: m.id,
          title: `Stalled: ${stage!.label} for ${days} days (threshold ${stage!.thresholdDays})`,
          assigneeId: m.responsibleAttorneyId,
          priority: "urgent",
          automationId: "B5",
          dedupeKey: `B5:${m.id}:${m.stage}:${m.stageChangedAt.toISOString()}`,
        })
        .onConflictDoNothing()
        .returning({ id: tasks.id });
      if (t)
        await recordAutomationRun(ctx.tx, {
          automationId: "B5",
          trigger: "stage_threshold",
          status: "succeeded",
          entityType: "matter",
          entityId: m.id,
          detail: { stage: m.stage, days },
        });
    }
    return {
      result: { stalled },
      audit: [
        {
          action: "matters.stall_checked",
          entityType: "matter",
          entityId: m.id,
          metadata: { stage: m.stage, days, stalled },
        },
      ],
    };
  },
});
