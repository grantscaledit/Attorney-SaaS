import { and, gt, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { appointments, approvals } from "@/db/schema";
import { aiCall } from "@/lib/ai/call";
import { execute } from "@/lib/commands/execute";
import { QUEUES } from "@/lib/jobs/queue";
import { log } from "@/lib/log";
import { A8_PROMPT_VERSION, A8_SYSTEM, a8Output } from "@/modules/intake/followup-prompts";
import {
  a10Enroll,
  a11Cold,
  a8Brief,
  briefFacts,
  briefPromptInput,
  coldLeads,
  leadsDueForNurture,
} from "@/modules/intake/commands/followups";
import { automationEnabled } from "@/modules/messaging/commands/outbox";
import { jobContext } from "../context";
import { dispatchQueued } from "../messaging/send";

/** A8 looks for consults starting in the next 12 hours every 15 minutes. */
export const A8_CRON = "*/15 * * * *";
/** A10 and A11 run once a day, 7:10am firm time. */
export const INTAKE_DAILY_CRON = "10 7 * * *";

const BRIEF_LEAD_MS = 12 * 60 * 60 * 1000;

/** Consults within 12 hours that have no brief yet. */
async function consultsNeedingBrief(now: Date): Promise<{ id: string; startsAt: Date }[]> {
  const db = getDb();
  const rows = await db
    .select({ id: appointments.id, startsAt: appointments.startsAt })
    .from(appointments)
    .where(
      and(
        isNotNull(appointments.leadId),
        isNull(appointments.deletedAt),
        inArray(appointments.status, ["new", "confirmed"]),
        gt(appointments.startsAt, now),
        lte(appointments.startsAt, new Date(now.getTime() + BRIEF_LEAD_MS)),
      ),
    );
  if (rows.length === 0) return [];
  const keys = rows.map((r) => `A8:${r.id}:${r.startsAt.toISOString()}`);
  const done = await db
    .select({ key: approvals.dedupeKey })
    .from(approvals)
    .where(inArray(approvals.dedupeKey, keys));
  const have = new Set(done.map((d) => d.key));
  return rows.filter((r) => !have.has(`A8:${r.id}:${r.startsAt.toISOString()}`));
}

export async function runA8(now = new Date()): Promise<number> {
  const db = getDb();
  if (!(await automationEnabled(db, "A8"))) return 0;
  const { principal, request } = jobContext(QUEUES.A8);
  let n = 0;
  for (const appt of await consultsNeedingBrief(now)) {
    try {
      const facts = await briefFacts(db, appt.id);
      if (!facts) continue;
      // The model writes only the summary and questions; facts come from records.
      const ai = await aiCall({
        purpose: "intake.pre_consult_brief",
        automationId: "A8",
        promptVersion: A8_PROMPT_VERSION,
        tier: "standard",
        effort: "medium",
        maxTokens: 4000,
        system: A8_SYSTEM,
        messages: [{ role: "user", content: briefPromptInput(facts) }],
        schema: a8Output,
        entity: { type: "appointment", id: appt.id },
      });
      await execute(
        a8Brief,
        principal,
        {
          appointmentId: appt.id,
          ai: ai.ok ? ai.output : null,
          aiRunId: ai.runId || null,
        },
        { request },
      );
      n++;
    } catch (err) {
      log.error("A8 brief failed", { appointmentId: appt.id, err });
    }
  }
  return n;
}

/** A10 enrolment and A11 cold-lead letters. */
export async function runIntakeDaily(
  now = new Date(),
): Promise<{ nurtured: number; letters: number }> {
  const db = getDb();
  const { principal, request } = jobContext(QUEUES.intakeDaily);
  let nurtured = 0;
  let letters = 0;
  for (const leadId of await leadsDueForNurture(db, now)) {
    try {
      const r = await execute(a10Enroll, principal, { leadId }, { request });
      await dispatchQueued(r.messages);
      nurtured++;
    } catch (err) {
      log.error("A10 enrolment failed", { leadId, err });
    }
  }
  for (const leadId of await coldLeads(db, now)) {
    try {
      await execute(a11Cold, principal, { leadId }, { request });
      letters++;
    } catch (err) {
      log.error("A11 draft failed", { leadId, err });
    }
  }
  return { nurtured, letters };
}
