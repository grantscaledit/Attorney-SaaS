import { randomUUID } from "node:crypto";
import { getDb } from "@/db/client";
import {
  appointments,
  approvals,
  contacts,
  intakeRecords,
  leads,
  messages,
  type LeadStatus,
  type PracticeArea,
} from "@/db/schema";
import { ScriptedTransport, type ScriptStep } from "@/lib/ai/scripted";
import type { TransportRequest } from "@/lib/ai/transport";
import { setAiTransport } from "@/lib/ai/transport";
import type { A3Output } from "@/modules/intake/a3-prompt";
import { daytimeZone } from "./ghl-kit";

/*
 * Test data for Phase 2. Synthetic people only. Rows are inserted directly:
 * these tests exercise the commands that act on leads, not lead creation
 * (covered in ghl-webhooks.test.ts).
 */

export type SeededLead = { leadId: string; contactId: string; messageId: string | null };

export async function seedLead(
  opts: {
    first?: string;
    last?: string;
    company?: string | null;
    email?: string | null;
    phone?: string | null;
    status?: LeadStatus;
    practiceArea?: PracticeArea | null;
    inbound?: string | null;
    channel?: "sms" | "chat";
    consultHeldAt?: Date | null;
    answers?: Record<string, string>;
    assignedUserId?: string | null;
  } = {},
): Promise<SeededLead> {
  const db = getDb();
  const first = opts.first ?? "Pat";
  const last = opts.last ?? `Tester${randomUUID().slice(0, 6)}`;
  const [contact] = await db
    .insert(contacts)
    .values({
      sourceId: `ai_${randomUUID()}`,
      firstName: first,
      lastName: last,
      fullName: `${first} ${last}`,
      companyName: opts.company ?? null,
      email: opts.email === undefined ? `${last.toLowerCase()}@example.test` : opts.email,
      phone: opts.phone === undefined ? "+12145550142" : opts.phone,
      timezone: daytimeZone(),
    })
    .returning();
  const [lead] = await db
    .insert(leads)
    .values({
      contactId: contact!.id,
      channel: opts.channel ?? "sms",
      status: opts.status ?? "new",
      practiceArea: opts.practiceArea ?? null,
      firstInboundAt: new Date(Date.now() - 60 * 60_000),
      consultHeldAt: opts.consultHeldAt ?? null,
      assignedUserId: opts.assignedUserId ?? null,
    })
    .returning();
  if (opts.answers || opts.practiceArea) {
    await db.insert(intakeRecords).values({
      leadId: lead!.id,
      practiceArea: opts.practiceArea ?? null,
      answers: opts.answers ?? {},
    });
  }
  let messageId: string | null = null;
  if (opts.inbound !== null) {
    messageId = await seedInbound(
      contact!.id,
      lead!.id,
      opts.inbound ?? "Hi, I need help.",
      opts.channel,
    );
  }
  return { leadId: lead!.id, contactId: contact!.id, messageId };
}

/** Inbound message. Without `at`, timestamps come from the database (microsecond precision, as live). */
export async function seedInbound(
  contactId: string,
  leadId: string,
  body: string,
  channel: "sms" | "chat" = "sms",
  at?: Date,
): Promise<string> {
  const [m] = await getDb()
    .insert(messages)
    .values({
      contactId,
      leadId,
      direction: "inbound",
      channel,
      status: "received",
      body,
      occurredAt: at ?? new Date(),
      ...(at ? { createdAt: at } : {}),
    })
    .returning({ id: messages.id });
  return m!.id;
}

export async function seedAppointment(
  leadId: string,
  contactId: string,
  startsAt: Date,
): Promise<string> {
  const [a] = await getDb()
    .insert(appointments)
    .values({
      sourceId: `appt_${randomUUID()}`,
      contactId,
      leadId,
      status: "confirmed",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
    })
    .returning({ id: appointments.id });
  return a!.id;
}

export async function seedPendingApproval(
  leadId: string,
  contactId: string,
  body = "We can meet Tuesday at 10am. Does that work?",
) {
  const [a] = await getDb()
    .insert(approvals)
    .values({
      automationId: "A3",
      kind: "message",
      title: "Reply to an enquiry",
      channel: "sms",
      leadId,
      contactId,
      draftBody: body,
      dedupeKey: `test:${randomUUID()}`,
    })
    .returning({ id: approvals.id });
  return a!.id;
}

/** A well-behaved A3 reply. */
export function a3Reply(over: Partial<A3Output> = {}): A3Output {
  return {
    reply: "Thank you. Which agency sent the notice?",
    replyType: "question",
    practiceArea: "tax",
    outOfScopeTopic: null,
    answers: [],
    wantsConsult: false,
    ...over,
  };
}

export const SAFE_CLASSIFICATION = {
  givesAdvice: false,
  predictsOutcome: false,
  quotesFee: false,
  claimsRepresentation: false,
  describesTheirLegalSituation: false,
};

/**
 * Installs a scripted model. `reply` answers intake drafts; the classifier
 * answers with `classify` (safe by default); the brief answers A8.
 */
export function installScriptedModel(handlers: {
  reply?: (req: TransportRequest) => ScriptStep;
  classify?: (req: TransportRequest) => ScriptStep;
  brief?: (req: TransportRequest) => ScriptStep;
}): ScriptedTransport {
  const t = new ScriptedTransport((req) => {
    if (req.system.startsWith("You review one reply")) {
      return handlers.classify?.(req) ?? { output: SAFE_CLASSIFICATION };
    }
    if (req.system.startsWith("You prepare a short pre-consultation brief")) {
      return (
        handlers.brief?.(req) ?? {
          output: {
            summary: "The prospect received a notice and wants help.",
            suggestedQuestions: ["Do you have a copy of the notice?"],
          },
        }
      );
    }
    return handlers.reply?.(req) ?? { output: a3Reply() };
  });
  setAiTransport(t);
  return t;
}

export function removeModel(): void {
  setAiTransport(null);
}
