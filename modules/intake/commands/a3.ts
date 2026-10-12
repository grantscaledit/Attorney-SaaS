import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import {
  automationRuns,
  contacts,
  firmSettings,
  intakeRecords,
  leads,
  messages,
  PRACTICE_AREAS,
  users,
  type IntakeRecordRow,
  type PracticeArea,
} from "@/db/schema";
import { ESCALATION_LABELS, type EscalationReason } from "@/lib/ai/guard";
import type { AuditSpec } from "@/lib/commands/define";
import { defineCommand } from "@/lib/commands/define";
import { requireSystem } from "@/lib/commands/system";
import { env } from "@/lib/env";
import { featureEnabledIn } from "@/lib/flags/load";
import { maskText } from "@/lib/masking";
import { missingAnswers, PRACTICE_MODULES, type Answers } from "@/practice";
import { createApproval } from "@/modules/approvals/commands/create";
import {
  automationEnabled,
  queueApprovedMessage,
  queueAutomatedMessage,
  recordAutomationRun,
} from "@/modules/messaging/commands/outbox";
import { a3Output, AUTO_SENDABLE } from "../a3-prompt";
import { scoreLead } from "../scoring";
import type { QueuedMessage } from "./automations";
import { runConflictCheck } from "./conflicts";
import { draftReferral } from "./followups";

/*
 * A3 AI intake assistant and A5 scoring and routing (spec Section 7).
 *
 * The job (jobs/automations/A3.ts) calls the model outside any transaction;
 * these commands apply the result. Whatever the model said, only text that
 * passed the deterministic guard and the classifier, under the firm's chosen
 * mode, can send without a person. Everything else waits in the approval
 * queue, and advice requests and urgent situations go straight to a person.
 */

const ESCALATION_SCHEMA = z.enum(
  Object.keys(ESCALATION_LABELS) as [EscalationReason, ...EscalationReason[]],
);

async function ensureIntakeRecord(tx: Tx, leadId: string): Promise<IntakeRecordRow> {
  await tx.insert(intakeRecords).values({ leadId }).onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(intakeRecords)
    .where(eq(intakeRecords.leadId, leadId))
    .for("update");
  if (!row) throw new Error("intake record missing");
  return row;
}

type Outcome = { audit: AuditSpec[]; messages: QueuedMessage[] };

/**
 * A5: score, assign an attorney, and alert them when urgent. Runs when an
 * intake record completes or a conversation escalates.
 */
export async function scoreAndRoute(
  tx: Tx,
  leadId: string,
  escalations: EscalationReason[] = [],
): Promise<Outcome> {
  const out: Outcome = { audit: [], messages: [] };
  const record = await ensureIntakeRecord(tx, leadId);
  const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId)).for("update");
  if (!lead) return out;
  const [firm] = await tx
    .select({ areas: firmSettings.practiceAreas })
    .from(firmSettings)
    .where(eq(firmSettings.id, 1));
  const practiceArea = record.practiceArea ?? lead.practiceArea;
  const allEscalations = [
    ...new Set([...(record.escalationReasons as EscalationReason[]), ...escalations]),
  ];
  const score = scoreLead({
    practiceArea,
    answers: record.answers as Answers,
    escalations: allEscalations,
    firmAreas: firm?.areas ?? [],
    now: new Date(),
  });
  const wasUrgent = record.urgent;
  await tx
    .update(intakeRecords)
    .set({
      score: score.score,
      scoreBreakdown: { ...score.parts, notes: score.notes },
      urgent: score.urgent,
      updatedAt: new Date(),
    })
    .where(eq(intakeRecords.leadId, leadId));
  out.audit.push({
    action: "intake.lead_scored",
    entityType: "lead",
    entityId: leadId,
    after: { score: score.score, urgent: score.urgent, ...score.parts },
  });

  let assigneeId = lead.assignedUserId;
  if (!assigneeId) {
    const routing = await featureEnabledIn(tx, "platform.multi_attorney_routing");
    const lawyers = await tx
      .select({ id: users.id, role: users.role, areas: users.practiceAreas })
      .from(users)
      .where(
        and(
          inArray(users.role, ["owner_attorney", "attorney"]),
          eq(users.status, "active"),
          isNull(users.deletedAt),
        ),
      )
      .orderBy(asc(users.createdAt));
    let pick = lawyers.find((u) => u.role === "owner_attorney") ?? lawyers[0];
    if (routing && practiceArea) {
      const fits = lawyers.filter((u) => u.areas.includes(practiceArea));
      if (fits.length > 0) {
        const loads = await tx
          .select({ userId: leads.assignedUserId, n: sql<number>`count(*)::int` })
          .from(leads)
          .where(
            and(
              inArray(
                leads.assignedUserId,
                fits.map((f) => f.id),
              ),
              inArray(leads.status, ["new", "contacted", "consult_booked", "consult_held"]),
            ),
          )
          .groupBy(leads.assignedUserId);
        const load = new Map(loads.map((l) => [l.userId, l.n]));
        pick = [...fits].sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0))[0];
      }
    }
    if (pick) {
      assigneeId = pick.id;
      await tx
        .update(leads)
        .set({
          assignedUserId: pick.id,
          practiceArea: lead.practiceArea ?? practiceArea,
          updatedAt: new Date(),
        })
        .where(eq(leads.id, leadId));
      out.audit.push({
        action: "intake.lead_assigned",
        entityType: "lead",
        entityId: leadId,
        after: { assignedUserId: pick.id, routing },
      });
    }
  } else if (!lead.practiceArea && practiceArea) {
    await tx.update(leads).set({ practiceArea, updatedAt: new Date() }).where(eq(leads.id, leadId));
  }

  // Urgent leads page the attorney by SMS (spec A5), once, with no client details.
  if (score.urgent && !wasUrgent && assigneeId) {
    const [assignee] = await tx
      .select({ ghl: users.ghlContactId })
      .from(users)
      .where(eq(users.id, assigneeId));
    const [staffContact] = assignee?.ghl
      ? await tx
          .select()
          .from(contacts)
          .where(and(eq(contacts.source, "ghl"), eq(contacts.sourceId, assignee.ghl)))
      : [];
    if (staffContact) {
      const reasons = allEscalations
        .filter((e) => e !== "asked_for_human")
        .map((e) => ESCALATION_LABELS[e].toLowerCase());
      const q = await queueAutomatedMessage(tx, {
        automationId: "A5",
        templateKey: "A5.urgent.sms",
        contact: staffContact,
        leadId: null,
        idempotencyKey: `A5:urgent:${leadId}`,
        dueAt: new Date(),
        ignoreQuietHours: true,
        values: {
          urgentReason: reasons.join(", ") || `score ${score.score}`,
          leadUrl: new URL(`/intake/leads/${leadId}`, env().APP_URL).toString(),
        },
        context: { leadId },
      });
      out.audit.push(...q.audit);
      out.messages.push({ messageId: q.messageId, status: q.status, scheduledFor: q.scheduledFor });
    } else {
      out.audit.push({
        action: "intake.urgent_alert_not_sent",
        entityType: "lead",
        entityId: leadId,
        metadata: { reason: "assignee has no GHL contact for alerts" },
      });
    }
  }
  return out;
}

/** Intake complete: score and route (A5) and run the conflict pre-screen (A6). */
async function onIntakeComplete(tx: Tx, leadId: string): Promise<Outcome> {
  const out: Outcome = { audit: [], messages: [] };
  if (await automationEnabled(tx, "A5")) {
    const routed = await scoreAndRoute(tx, leadId);
    out.audit.push(...routed.audit);
    out.messages.push(...routed.messages);
  }
  if (await automationEnabled(tx, "A6")) {
    const a6 = await runConflictCheck(tx, leadId);
    out.audit.push(...a6.audit);
  }
  return out;
}

async function latestInbound(tx: Tx, messageId: string) {
  const [m] = await tx
    .select({ body: messages.body, channel: messages.channel, contactId: messages.contactId })
    .from(messages)
    .where(eq(messages.id, messageId));
  return m;
}

/**
 * Hands the conversation to a person: an urgent item in the approval queue,
 * the pre-approved hand-off text to the prospect, and A5 scoring (which
 * alerts the attorney when urgent). The assistant does not reply again.
 */
async function handOff(
  tx: Tx,
  input: {
    leadId: string;
    messageId: string;
    reasons: EscalationReason[];
    notes: string[];
    blockedDraft?: string | null;
    findings?: string[];
    aiRunId?: string | null;
  },
): Promise<Outcome> {
  const out: Outcome = { audit: [], messages: [] };
  const record = await ensureIntakeRecord(tx, input.leadId);
  const now = new Date();
  const reasons = [
    ...new Set([...(record.escalationReasons as EscalationReason[]), ...input.reasons]),
  ];
  await tx
    .update(intakeRecords)
    .set({
      escalationReasons: reasons,
      escalatedAt: record.escalatedAt ?? (input.reasons.length ? now : null),
      handedOffAt: record.handedOffAt ?? now,
      updatedAt: now,
    })
    .where(eq(intakeRecords.leadId, input.leadId));

  const msg = await latestInbound(tx, input.messageId);
  const [lead] = await tx
    .select({ contactId: leads.contactId })
    .from(leads)
    .where(eq(leads.id, input.leadId));
  const hard = input.reasons.filter((r) => r !== "asked_for_human");
  const title = [...input.reasons.map((r) => ESCALATION_LABELS[r]), ...input.notes].join(", ");
  const approval = await createApproval(tx, {
    automationId: "A3",
    kind: "escalation",
    title: `Take over the conversation: ${title || "assistant stopped"}`,
    channel: "none",
    leadId: input.leadId,
    contactId: lead?.contactId ?? null,
    draftBody: [
      "The intake assistant stopped and handed this conversation to you. Reply to the person from GoHighLevel.",
      "",
      `Their latest message: "${msg?.body ?? ""}"`,
      ...(input.blockedDraft
        ? ["", `The assistant's draft, not sent: "${input.blockedDraft}"`]
        : []),
    ].join("\n"),
    flags: { escalations: input.reasons, findings: input.findings ?? [], notes: input.notes },
    sources: { latestMessageId: input.messageId },
    aiRunId: input.aiRunId ?? null,
    priority: hard.length > 0 ? "urgent" : "normal",
    dedupeKey: `A3:handoff:${input.messageId}`,
    supersedePendingForLead: true,
  });
  out.audit.push(...approval.audit);

  const [contact] = lead
    ? await tx.select().from(contacts).where(eq(contacts.id, lead.contactId))
    : [];
  if (approval.created && contact && msg?.channel === "sms") {
    const q = await queueAutomatedMessage(tx, {
      automationId: "A3",
      templateKey: "A3.handoff.sms",
      contact,
      leadId: input.leadId,
      idempotencyKey: `A3:handoff:${input.messageId}`,
      dueAt: now,
      context: { messageId: input.messageId },
    });
    out.audit.push(...q.audit);
    out.messages.push({ messageId: q.messageId, status: q.status, scheduledFor: q.scheduledFor });
  }

  if (await automationEnabled(tx, "A5")) {
    const routed = await scoreAndRoute(tx, input.leadId, input.reasons);
    out.audit.push(...routed.audit);
    out.messages.push(...routed.messages);
  }
  await recordAutomationRun(tx, {
    automationId: "A3",
    trigger: "inbound_message",
    status: "skipped",
    entityType: "message",
    entityId: input.messageId,
    detail: { handoff: true, reasons: input.reasons, notes: input.notes },
  });
  return out;
}

/** True when A3 already recorded an outcome for this message (job replays, sweep recovery). */
async function alreadyHandled(tx: Tx, messageId: string): Promise<boolean> {
  const [r] = await tx
    .select({ id: automationRuns.id })
    .from(automationRuns)
    .where(and(eq(automationRuns.automationId, "A3"), eq(automationRuns.entityId, messageId)));
  return Boolean(r);
}

/** The assistant did not act on a message, and why. Recorded so the sweep does not retry it. */
export const a3Skipped = defineCommand({
  name: "intake.a3_skipped",
  permission: "leads.write",
  input: z.object({
    leadId: z.uuid(),
    messageId: z.uuid(),
    reason: z.enum([
      "lead_closed_or_message_missing",
      "already_handed_off",
      "newer_message",
      "ai_not_configured",
    ]),
  }),
  async run(ctx, input) {
    requireSystem(ctx);
    if (!(await alreadyHandled(ctx.tx, input.messageId))) {
      await recordAutomationRun(ctx.tx, {
        automationId: "A3",
        trigger: "inbound_message",
        status: "skipped",
        entityType: "message",
        entityId: input.messageId,
        detail: { reason: input.reason },
      });
    }
    return {
      result: { skipped: true },
      audit: [
        {
          action: "intake.a3_skipped",
          entityType: "lead",
          entityId: input.leadId,
          metadata: { messageId: input.messageId, reason: input.reason },
        },
      ],
    };
  },
});

const handoffInput = z.object({
  leadId: z.uuid(),
  messageId: z.uuid(),
  reasons: z.array(ESCALATION_SCHEMA),
  adviceSeeking: z.boolean(),
  /** The assistant was not available (no API key, refusal, error). */
  unavailable: z.string().max(100).optional(),
});

export const a3Handoff = defineCommand({
  name: "intake.a3_handoff",
  permission: "leads.write",
  input: handoffInput,
  async run(ctx, input) {
    requireSystem(ctx);
    await ensureIntakeRecord(ctx.tx, input.leadId);
    if (await alreadyHandled(ctx.tx, input.messageId)) {
      return {
        result: { messages: [] },
        audit: [
          {
            action: "intake.a3_skipped",
            entityType: "lead",
            entityId: input.leadId,
            metadata: { messageId: input.messageId, reason: "duplicate" },
          },
        ],
      };
    }
    const notes = [
      ...(input.adviceSeeking ? ["Asked for legal advice"] : []),
      ...(input.unavailable ? [`Assistant unavailable (${input.unavailable})`] : []),
    ];
    const out = await handOff(ctx.tx, {
      leadId: input.leadId,
      messageId: input.messageId,
      reasons: input.reasons,
      notes,
    });
    return {
      result: { messages: out.messages },
      audit: [
        {
          action: "intake.a3_handed_off",
          entityType: "lead",
          entityId: input.leadId,
          after: { reasons: input.reasons, notes },
          metadata: { messageId: input.messageId },
        },
        ...out.audit,
      ],
    };
  },
});

/** Merge the assistant's extracted answers into the intake record (masked; known question ids only). */
function mergeAnswers(
  area: PracticeArea | null,
  current: Answers,
  extracted: { questionId: string; value: string }[],
): Answers {
  if (!area) return current;
  const known = new Set(PRACTICE_MODULES[area].questions.map((q) => q.id));
  const next = { ...current };
  for (const a of extracted) {
    const v = maskText(a.value.trim()).text;
    if (known.has(a.questionId) && v) next[a.questionId] = v;
  }
  return next;
}

export const a3Turn = defineCommand({
  name: "intake.a3_turn",
  permission: "leads.write",
  input: z.object({
    leadId: z.uuid(),
    messageId: z.uuid(),
    aiRunId: z.uuid(),
    output: a3Output,
    /** Deterministic draft guard (lib/ai/guard.ts). */
    findings: z.array(z.string()),
    /** LLM classifier: null when it could not run, which counts as not safe. */
    classifierSafe: z.boolean().nullable(),
    classifierRunId: z.uuid().nullable(),
  }),
  async run(ctx, input) {
    requireSystem(ctx);
    const tx = ctx.tx;
    const record = await ensureIntakeRecord(tx, input.leadId);
    const [lead] = await tx.select().from(leads).where(eq(leads.id, input.leadId)).for("update");
    if (!lead) throw new Error("lead not found");
    const [firm] = await tx.select().from(firmSettings).where(eq(firmSettings.id, 1));
    const out: Outcome = { audit: [], messages: [] };

    // The assistant hands off once; a later message must not restart it. Replays change nothing.
    if (await alreadyHandled(tx, input.messageId)) {
      return {
        result: { messages: [], outOfScope: false },
        audit: [
          {
            action: "intake.a3_skipped",
            entityType: "lead",
            entityId: input.leadId,
            metadata: { messageId: input.messageId, reason: "duplicate" },
          },
        ],
      };
    }
    if (record.handedOffAt) {
      await recordAutomationRun(tx, {
        automationId: "A3",
        trigger: "inbound_message",
        status: "skipped",
        entityType: "message",
        entityId: input.messageId,
        detail: { reason: "already_handed_off" },
      });
      return {
        result: { messages: [], outOfScope: false },
        audit: [
          {
            action: "intake.a3_skipped",
            entityType: "lead",
            entityId: input.leadId,
            metadata: { reason: "already_handed_off" },
          },
        ],
      };
    }

    const o = input.output;
    const area: PracticeArea | null =
      record.practiceArea ??
      (o.practiceArea && (PRACTICE_AREAS as readonly string[]).includes(o.practiceArea)
        ? (o.practiceArea as PracticeArea)
        : null);
    const outOfScope =
      o.practiceArea === "other" || (area !== null && !(firm?.practiceAreas ?? []).includes(area));
    const answers = mergeAnswers(area, record.answers as Answers, o.answers);
    const missing = area ? missingAnswers(PRACTICE_MODULES[area], answers) : ["practice_area"];
    const nowComplete = area !== null && missing.length === 0 && !outOfScope;
    const now = new Date();
    await tx
      .update(intakeRecords)
      .set({
        practiceArea: area,
        answers,
        missing,
        complete: nowComplete,
        completedAt: nowComplete ? (record.completedAt ?? now) : record.completedAt,
        outOfScope,
        outOfScopeTopic: outOfScope
          ? o.outOfScopeTopic
            ? maskText(o.outOfScopeTopic).text
            : record.outOfScopeTopic
          : null,
        aiTurns: record.aiTurns + 1,
        updatedAt: now,
      })
      .where(eq(intakeRecords.leadId, input.leadId));
    out.audit.push({
      action: "intake.record_updated",
      entityType: "lead",
      entityId: input.leadId,
      after: {
        practiceArea: area,
        answered: Object.keys(answers).length,
        missing: missing.length,
        complete: nowComplete,
        outOfScope,
      },
      metadata: { aiRunId: input.aiRunId },
    });
    // A12: out of scope for the first time. The referral waits for approval;
    // the assistant's own reply still goes out as usual below.
    if (outOfScope && !record.outOfScope && (await automationEnabled(tx, "A12"))) {
      const ref = await draftReferral(tx, input.leadId, null);
      out.audit.push(...ref.audit);
    }
    if (nowComplete && !record.complete) {
      const done = await onIntakeComplete(tx, input.leadId);
      out.audit.push(...done.audit);
      out.messages.push(...done.messages);
    }

    // A draft that failed any check is blocked and escalated (rule 5).
    const blocked = input.findings.length > 0 || input.classifierSafe === false;
    if (blocked || o.replyType === "handoff") {
      const h = await handOff(tx, {
        leadId: input.leadId,
        messageId: input.messageId,
        reasons: [],
        notes: blocked
          ? ["Draft reply blocked by the guardrails"]
          : ["Assistant asked for a person"],
        blockedDraft: o.reply,
        findings: input.findings.concat(input.classifierSafe === false ? ["classifier"] : []),
        aiRunId: input.aiRunId,
      });
      out.audit.push(...h.audit);
      out.messages.push(...h.messages);
      return {
        result: { messages: out.messages, outOfScope },
        audit: [
          {
            action: "intake.a3_blocked",
            entityType: "lead",
            entityId: input.leadId,
            after: { findings: input.findings, classifierSafe: input.classifierSafe },
          },
          ...out.audit,
        ],
      };
    }

    const inbound = await latestInbound(tx, input.messageId);
    const channel: "sms" | "chat" = inbound?.channel === "chat" ? "chat" : "sms";
    // Spec Section 4: the disclosure goes in the first message the assistant sends.
    const disclose = !record.disclosureSentAt && firm?.aiDisclosureText;
    const text = disclose ? `${firm!.aiDisclosureText}\n\n${o.reply}` : o.reply;
    const autoSend =
      firm?.a3Mode === "auto_send_safe" &&
      input.classifierSafe === true &&
      AUTO_SENDABLE.has(o.replyType);
    const [contact] = await tx.select().from(contacts).where(eq(contacts.id, lead.contactId));
    const approval = await createApproval(tx, {
      automationId: "A3",
      kind: "message",
      title: `Reply to an enquiry (intake assistant, turn ${record.aiTurns + 1})`,
      channel,
      leadId: input.leadId,
      contactId: lead.contactId,
      draftBody: text,
      sources: {
        theirMessage: inbound?.body ?? "",
        practiceArea: area ?? "not yet known",
        stillNeeded: missing.join(", "),
      },
      flags: autoSend
        ? undefined
        : { notes: firm?.a3Mode === "review_all" ? [] : ["Not eligible to send automatically"] },
      aiRunId: input.aiRunId,
      dedupeKey: `A3:reply:${input.messageId}`,
      supersedePendingForLead: true,
      autoApproved: autoSend,
    });
    out.audit.push(...approval.audit);
    if (approval.created && autoSend && contact) {
      const q = await queueApprovedMessage(tx, {
        approvalId: approval.row.id,
        automationId: "A3",
        channel,
        contact,
        leadId: input.leadId,
        subject: null,
        body: text,
      });
      out.audit.push(...q.audit);
      out.messages.push({ messageId: q.messageId, status: q.status, scheduledFor: q.scheduledFor });
    }
    if (disclose && approval.created) {
      await tx
        .update(intakeRecords)
        .set({ disclosureSentAt: now })
        .where(eq(intakeRecords.leadId, input.leadId));
    }
    await recordAutomationRun(tx, {
      automationId: "A3",
      trigger: "inbound_message",
      status: "succeeded",
      entityType: "message",
      entityId: input.messageId,
      detail: { autoSend, replyType: o.replyType, approvalId: approval.row.id },
    });
    return {
      result: { messages: out.messages, outOfScope },
      audit: [
        {
          action: "intake.a3_replied",
          entityType: "lead",
          entityId: input.leadId,
          after: { autoSend, replyType: o.replyType },
        },
        ...out.audit,
      ],
    };
  },
});
