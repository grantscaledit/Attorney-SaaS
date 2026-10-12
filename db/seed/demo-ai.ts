/**
 * Demo AI intake (Phase 2): a handful of synthetic text conversations run
 * through the real A3 job with demo mode's rule-based model (lib/ai/demo.ts),
 * so the approval queue, escalations, a referral, a conflict pre-screen and a
 * pre-consult brief all have something to show. Rule 12: fictional people
 * only, DEMO_MODE required, nothing is sent and no live model is called.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contacts, leads, users } from "@/db/schema";
import type { AnyCommand, Command, Principal } from "@/lib/commands/define";
import { execute } from "@/lib/commands/execute";
import { env } from "@/lib/env";
import { setJobQueue } from "@/lib/jobs/queue";
import { runA3 } from "@/jobs/automations/A3";
import { runA8, runIntakeDaily } from "@/jobs/automations/followups";
import { updateAiSettings } from "@/modules/firm/commands/ai-settings";
import { addConflictParties, rerunConflictCheck } from "@/modules/intake/commands/conflicts";
import { saveReferralPartner } from "@/modules/intake/commands/followups";
import { updateIntakeProfile } from "@/modules/users/commands/intake-profile";
import type { z } from "zod";
import { deliver } from "./demo-intake";

const REQUEST = { ip: "127.0.0.1", userAgent: "lexdesk-demo-seed", requestId: "script:demo-seed" };

function run(command: AnyCommand, principal: Principal, input: unknown) {
  return execute(command as unknown as Command<z.ZodType, unknown>, principal, input, {
    request: REQUEST,
  });
}

const CONVERSATIONS = [
  {
    first: "Dana",
    last: "Whitfield",
    text: "Hi, I got a CP2000 from the IRS about my 2024 taxes. Can someone help?",
  },
  { first: "Luis", last: "Ortega", text: "Should I just pay what the IRS says I owe?" },
  { first: "Grace", last: "Holloway", text: "The IRS put a levy on my bank account this morning" },
  { first: "Theo", last: "Brandt", text: "I need help with a divorce and child custody" },
  { first: "Nadia", last: "Farouk", text: "We want to form an LLC for our bakery with my sister" },
  {
    first: "Owen",
    last: "Pryce",
    text: "I have an IRS CP504 notice for 2022 and 2023. I booked a consult for today.",
  },
] as const;

export async function seedDemoAi(owner: Principal): Promise<{ conversations: number }> {
  if (!env().DEMO_MODE) throw new Error("demo AI seed requires DEMO_MODE=true");
  const db = getDb();
  // Later nurture steps stay queued in the database; the worker's sweep sends them when due.
  setJobQueue({ send: async () => {} });

  await run(updateAiSettings, owner, {
    a3Mode: "review_all",
    consultCalendarId: "",
    feeTable: [{ service: "Initial consultation", fee: "$250" }],
  });
  const lawyers = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.role, "owner_attorney"));
  for (const l of lawyers) {
    await run(updateIntakeProfile, owner, {
      userId: l.id,
      practiceAreas: ["tax", "business", "estate"],
    });
  }
  await run(addConflictParties, owner, {
    parties: [
      {
        name: "Owen Price",
        kind: "person",
        role: "adverse",
        matterReference: "Demo matter 2025-014",
      },
      { name: "Lone Star Bakery Supply LLC", kind: "organization", role: "adverse" },
      {
        name: "Marisol Vega",
        kind: "person",
        role: "client",
        matterReference: "Demo matter 2026-003",
      },
    ],
  });
  for (const p of [
    {
      name: "Hannah Reyes",
      organization: "Reyes Family Law",
      handles: "family law, divorce, child custody",
      phone: "(214) 555-0161",
      email: "intake@reyes-family.example.test",
    },
    {
      name: "Marcus Hill",
      organization: "Hill Injury Law",
      handles: "personal injury, car accident",
      phone: "(214) 555-0162",
    },
    {
      name: "Elena Park",
      organization: "Park Defense",
      handles: "criminal defense, DWI",
      phone: "(214) 555-0163",
    },
  ]) {
    await run(saveReferralPartner, owner, p);
  }

  const now = Date.now();
  let i = 0;
  for (const c of CONVERSATIONS) {
    i += 1;
    const contactId = `demo_ai_contact_${i}`;
    const at = new Date(now - (CONVERSATIONS.length - i + 1) * 40 * 60_000);
    await deliver("ContactCreate", `${contactId}:create`, {
      id: contactId,
      firstName: c.first,
      lastName: c.last,
      name: `${c.first} ${c.last}`,
      email: `${c.first}.${c.last}@example.test`.toLowerCase(),
      phone: `+1214555${String(170 + i).padStart(4, "0")}`,
      source: "Text message",
      dateAdded: at.toISOString(),
      timezone: "America/Chicago",
    });
    const r = await deliver("InboundMessage", `${contactId}:sms`, {
      contactId,
      messageType: "SMS",
      direction: "inbound",
      messageId: `demo_ai_sms_${i}`,
      body: c.text,
      dateAdded: at.toISOString(),
    });
    for (const t of r.a3) await runA3(t.leadId, t.messageId);
  }

  // Owen Pryce has a consult in five hours: a pre-consult brief (A8) and a
  // conflict pre-screen that finds the similarly spelled adverse party.
  const startsAt = new Date(now + 5 * 3_600_000);
  await deliver("AppointmentCreate", "demo_ai_contact_6:appt", {
    appointment: {
      id: "demo_ai_appt_6",
      calendarId: "demo_consults",
      contactId: "demo_ai_contact_6",
      title: "Initial consultation",
      appointmentStatus: "confirmed",
      startTime: startsAt.toISOString(),
      endTime: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
      dateAdded: new Date(now - 3_600_000).toISOString(),
      dateUpdated: new Date(now - 3_600_000).toISOString(),
    },
  });
  const [owenLead] = await db
    .select({ id: leads.id })
    .from(leads)
    .innerJoin(contacts, eq(contacts.id, leads.contactId))
    .where(eq(contacts.sourceId, "demo_ai_contact_6"));
  if (owenLead) await run(rerunConflictCheck, owner, { leadId: owenLead.id });
  await runA8();
  // A10 nurture and A11 letters for the older Phase 1 demo consults.
  await runIntakeDaily();
  return { conversations: CONVERSATIONS.length };
}
