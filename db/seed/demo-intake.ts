/**
 * Demo intake activity (Phase 1): about 45 synthetic enquiries over the last
 * 60 days, pushed through the real webhook commands so the Intake panel,
 * leads and audit log show what a live deployment would.
 *
 * Rule 12: every person is fictional (555-01xx numbers, example.test emails),
 * DEMO_MODE is required, and automatic messages are recorded as simulated.
 * Because the seed runs "now" but the enquiries are dated in the past, send
 * times of the simulated acknowledgements are moved back to just after each
 * enquiry, as they would have been live.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { appointments, leads, messages } from "@/db/schema";
import type { AnyCommand, Command, Principal } from "@/lib/commands/define";
import { execute } from "@/lib/commands/execute";
import { env } from "@/lib/env";
import { setGhlClientForTesting } from "@/lib/ghl/client";
import { DEFAULT_TEMPLATES } from "@/lib/messaging/templates";
import { sendMessageJob } from "@/jobs/messaging/send";
import { ingestGhlWebhook } from "@/modules/ghl/commands/ingest-webhook";
import { processGhlWebhook } from "@/modules/ghl/commands/process-webhook";
import { approveMessageTemplate } from "@/modules/messaging/commands/templates";
import type { z } from "zod";

const REQUEST = { ip: "127.0.0.1", userAgent: "lexdesk-demo-seed", requestId: "script:demo-seed" };
const SYSTEM: Principal = { type: "system", label: "demo-seed" };
const LOCATION = "demo_location";

function run(command: AnyCommand, principal: Principal, input: unknown) {
  return execute(command as unknown as Command<z.ZodType, unknown>, principal, input, {
    request: REQUEST,
  });
}

/** Etc/GMT zone where it is early afternoon right now (Etc/GMT signs are inverted). */
function daytimeZone(now = new Date()): string {
  let offset = 13 - now.getUTCHours();
  if (offset > 14) offset -= 24;
  if (offset < -12) offset += 24;
  return offset === 0 ? "Etc/GMT" : offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

/** Deterministic randomness so every reset produces the same demo. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  "Avery",
  "Jordan",
  "Morgan",
  "Riley",
  "Casey",
  "Taylor",
  "Quinn",
  "Reese",
  "Harper",
  "Rowan",
  "Emerson",
  "Sage",
  "Parker",
  "Hayden",
  "Blake",
];
const LAST = [
  "Alder",
  "Brightwater",
  "Calloway",
  "Delacroix",
  "Easton",
  "Fairbanks",
  "Galloway",
  "Hollis",
  "Ingram",
  "Juniper",
  "Kessler",
  "Lockhart",
  "Merriweather",
  "Northcott",
  "Oakley",
];
const PRACTICE = [
  "IRS notice / tax problem",
  "Forming an LLC",
  "Wills and trusts",
  "Probate of a parent's estate",
  "Business contract review",
  "Texas franchise tax question",
];

type Kind = "missed_call" | "form" | "chat" | "email" | "answered_call";

export async function deliver(
  type: string,
  key: string,
  payload: Record<string, unknown>,
): Promise<{ a3: { leadId: string; messageId: string }[] }> {
  const { eventId } = (await run(ingestGhlWebhook, SYSTEM, {
    dedupeKey: `demo:${key}`,
    eventType: type,
    authMethod: "demo",
    locationId: LOCATION,
    payload: { ...payload, type, locationId: LOCATION },
  })) as { eventId: string };
  const r = (await run(processGhlWebhook, SYSTEM, { eventId })) as {
    messages: { messageId: string; status: string; scheduledFor: Date | null }[];
    a3: { leadId: string; messageId: string }[];
  };
  for (const m of r.messages) {
    if (m.status === "queued" && (!m.scheduledFor || m.scheduledFor <= new Date())) {
      await sendMessageJob(m.messageId);
    }
  }
  return { a3: r.a3 };
}

export async function seedDemoIntake(owner: Principal): Promise<{ leads: number }> {
  if (!env().DEMO_MODE) throw new Error("demo intake seed requires DEMO_MODE=true");
  setGhlClientForTesting(null);

  // The firm reviewed every template but one, so the approval screen shows both states.
  for (const t of DEFAULT_TEMPLATES) {
    if (t.key === "A7.no_show_followup.sms") continue;
    await run(approveMessageTemplate, owner, {
      key: t.key,
      body: t.body,
      subject: "subject" in t ? t.subject : null,
    });
  }

  const rand = mulberry32(20261010);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const now = Date.now();
  const DAY = 86_400_000;
  let n = 0;

  for (let i = 0; i < 45; i++) {
    n += 1;
    const first = pick(FIRST);
    const last = pick(LAST);
    const contactId = `demo_contact_${i + 1}`;
    // 555-0100 to 555-0199 are reserved for fiction.
    const phone = `+1214555${String(100 + (i % 100)).padStart(4, "0")}`;
    const email = `${first}.${last}.${i + 1}@example.test`.toLowerCase();
    // Business hours, spread over 60 days, more recent days a little busier.
    const daysAgo = Math.floor(Math.pow(rand(), 1.3) * 60);
    const at = new Date(now - daysAgo * DAY);
    at.setUTCHours(14 + Math.floor(rand() * 8), Math.floor(rand() * 60), 0, 0);
    if (at.getTime() > now) at.setTime(now - 3_600_000);

    const r = rand();
    const kind: Kind =
      r < 0.35
        ? "missed_call"
        : r < 0.7
          ? "form"
          : r < 0.8
            ? "chat"
            : r < 0.9
              ? "email"
              : "answered_call";
    const contact = {
      id: contactId,
      firstName: first,
      lastName: last,
      name: `${first} ${last}`,
      email,
      phone,
      source:
        kind === "form"
          ? "Website contact form"
          : kind === "chat"
            ? "Website chat widget"
            : "Phone",
      dateAdded: at.toISOString(),
      // A zone where it is daytime now, so quiet hours never hold the demo's acknowledgements.
      timezone: daytimeZone(),
    };
    await deliver("ContactCreate", `${contactId}:create`, contact);

    if (kind === "missed_call" || kind === "answered_call") {
      await deliver("InboundMessage", `${contactId}:call`, {
        contactId,
        messageType: "CALL",
        direction: "inbound",
        messageId: `demo_call_${i + 1}`,
        status: kind === "missed_call" ? (rand() < 0.5 ? "voicemail" : "no-answer") : "completed",
        callStatus:
          kind === "missed_call" ? (rand() < 0.5 ? "voicemail" : "no-answer") : "completed",
        callDuration: kind === "answered_call" ? 180 + Math.floor(rand() * 600) : 0,
        dateAdded: at.toISOString(),
      });
    } else if (kind === "form") {
      const src = rand();
      const utm =
        src < 0.35
          ? {
              utmSource: "google",
              utmMedium: "cpc",
              utmCampaign: "tax-relief-dfw",
              gclid: `demo-gclid-${i}`,
            }
          : src < 0.6
            ? { referrer: "https://www.google.com/" }
            : src < 0.75
              ? {
                  utmSource: "facebook",
                  utmMedium: "paid_social",
                  utmCampaign: "estate-planning-collin",
                }
              : src < 0.9
                ? { utmSource: "cpa-partner", utmMedium: "referral" }
                : {};
      await deliver("LexDeskFormSubmitted", `${contactId}:form`, {
        contactId,
        submissionId: `demo_sub_${i + 1}`,
        formName: "Website contact form",
        occurredAt: at.toISOString(),
        firstName: first,
        lastName: last,
        email,
        phone,
        practiceArea: pick(PRACTICE),
        smsOptIn: rand() < 0.7 ? "Yes" : "",
        pageUrl: "https://siekierski-law.example.test/contact",
        ...utm,
      });
    } else {
      await deliver("InboundMessage", `${contactId}:msg`, {
        contactId,
        messageType: kind === "chat" ? "Live_Chat" : "Email",
        direction: "inbound",
        messageId: `demo_msg_${i + 1}`,
        dateAdded: at.toISOString(),
      });
    }

    // Most get a reply from staff; the newest few are still waiting.
    if (daysAgo > 1 || rand() < 0.4) {
      const replyAt = new Date(at.getTime() + (5 + Math.floor(rand() * 240)) * 60_000);
      if (replyAt.getTime() < now) {
        const byCall = kind === "missed_call" && rand() < 0.6;
        await deliver("OutboundMessage", `${contactId}:reply`, {
          contactId,
          messageType: byCall ? "CALL" : "SMS",
          direction: "outbound",
          messageId: `demo_reply_${i + 1}`,
          userId: "demo_user_jordan",
          status: "completed",
          callStatus: byCall ? (rand() < 0.75 ? "completed" : "no-answer") : null,
          callDuration: byCall ? 300 : null,
          dateAdded: replyAt.toISOString(),
        });
      }
    }

    // About half book a consult; of those most show, some retain.
    if (rand() < 0.5) {
      const bookedAt = new Date(at.getTime() + (1 + Math.floor(rand() * 48)) * 3_600_000);
      if (bookedAt.getTime() < now) {
        const startsAt = new Date(bookedAt.getTime() + (2 + Math.floor(rand() * 6)) * DAY);
        startsAt.setUTCHours(15 + Math.floor(rand() * 6), rand() < 0.5 ? 0 : 30, 0, 0);
        const past = startsAt.getTime() < now;
        const status = past ? (rand() < 0.8 ? "showed" : "noshow") : "confirmed";
        await deliver("AppointmentCreate", `${contactId}:appt`, {
          appointment: {
            id: `demo_appt_${i + 1}`,
            calendarId: "demo_consults",
            contactId,
            title: "Initial consultation",
            appointmentStatus: status,
            startTime: startsAt.toISOString(),
            endTime: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
            dateAdded: bookedAt.toISOString(),
            dateUpdated: bookedAt.toISOString(),
          },
        });
        await deliver("OpportunityCreate", `${contactId}:opp`, {
          id: `demo_opp_${i + 1}`,
          contactId,
          name: `${first} ${last}`,
          pipelineId: "demo_intake",
          pipelineStageId: "consult",
          status: "open",
          monetaryValue: 1500 + Math.floor(rand() * 8) * 500,
          dateAdded: bookedAt.toISOString(),
          updatedAt: bookedAt.toISOString(),
        });
        if (status === "showed") {
          const outcome = rand() < 0.55 ? "won" : rand() < 0.5 ? "lost" : null;
          if (outcome) {
            const decided = new Date(
              Math.min(startsAt.getTime() + (1 + rand() * 6) * DAY, now - 3_600_000),
            );
            await deliver("OpportunityStatusUpdate", `${contactId}:opp:${outcome}`, {
              id: `demo_opp_${i + 1}`,
              contactId,
              name: `${first} ${last}`,
              pipelineId: "demo_intake",
              pipelineStageId: "decided",
              status: outcome,
              monetaryValue: 3000,
              updatedAt: decided.toISOString(),
            });
          }
        }
      }
    }
  }

  await backdateSimulatedSends(rand);
  return { leads: n };
}

/**
 * Moves the simulated A1/A2 sends (and A7 confirmations) to when they would
 * have gone out live, then recomputes each lead's first response.
 */
async function backdateSimulatedSends(rand: () => number): Promise<void> {
  const db = getDb();
  const acks = await db
    .select({
      id: messages.id,
      leadId: messages.leadId,
      automationId: messages.automationId,
      context: messages.context,
    })
    .from(messages)
    .where(
      and(
        eq(messages.status, "simulated"),
        inArray(messages.templateKey, ["A1.sms", "A2.sms", "A2.email", "A7.confirmation.sms"]),
      ),
    );
  for (const m of acks) {
    if (!m.leadId) continue;
    let base: Date | null = null;
    if (m.automationId === "A7") {
      const apptId = (m.context as { appointmentId?: string } | null)?.appointmentId;
      if (!apptId) continue;
      const [a] = await db
        .select({ leadId: appointments.leadId })
        .from(appointments)
        .where(eq(appointments.id, apptId));
      const [l] = await db
        .select({ booked: leads.consultBookedAt })
        .from(leads)
        .where(eq(leads.id, a?.leadId ?? m.leadId));
      base = l?.booked ?? null;
    } else {
      const [l] = await db
        .select({ at: leads.firstInboundAt })
        .from(leads)
        .where(eq(leads.id, m.leadId));
      base = l?.at ?? null;
    }
    if (!base) continue;
    const sentAt = new Date(base.getTime() + (35 + Math.floor(rand() * 50)) * 1000);
    if (sentAt.getTime() > Date.now()) continue;
    await db
      .update(messages)
      .set({ sentAt, scheduledFor: sentAt, deferredFrom: null, createdAt: sentAt })
      .where(eq(messages.id, m.id));
  }
  await db.execute(sql`
    update leads l set first_response_at = least(
      l.first_human_response_at,
      (select min(m.sent_at) from messages m
        where m.lead_id = l.id and m.automation_id in ('A1', 'A2') and m.status = 'simulated')
    )
    where l.first_response_at is not null
  `);
}
