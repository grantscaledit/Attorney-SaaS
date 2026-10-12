/**
 * Demo deadlines (Phase 4). Rule 12: synthetic matters, DEMO_MODE only.
 *
 * A few rules are marked verified so the demo shows computed dates. Their
 * citation says plainly that no attorney checked them: a demo verification is
 * not a verification, and the demo database never serves a real firm. The
 * other rules stay unverified to show the workflow.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contacts, deadlineRules, deadlines, leads } from "@/db/schema";
import type { AnyCommand, Command, Principal } from "@/lib/commands/define";
import { execute } from "@/lib/commands/execute";
import { env } from "@/lib/env";
import { runDeadlinesDaily } from "@/modules/deadlines/commands/automations";
import { createCalendarFeed } from "@/modules/deadlines/commands/calendar";
import {
  addDeadline,
  addTolling,
  recordEvent,
  setPaymentPlan,
} from "@/modules/deadlines/commands/deadlines";
import {
  addFederalHolidays,
  syncDeadlineRules,
  verifyDeadlineRule,
} from "@/modules/deadlines/commands/rules";
import { addDays } from "@/modules/deadlines/date-math";
import { hashOfRow } from "@/modules/deadlines/rules";
import { openMatter } from "@/modules/matters/commands/matters";
import { firmToday } from "@/modules/matters/scope";
import type { z } from "zod";
import { deliver } from "./demo-intake";

const REQUEST = { ip: "127.0.0.1", userAgent: "lexdesk-demo-seed", requestId: "script:demo-seed" };
const SYSTEM: Principal = { type: "system", label: "demo-seed" };

function run(command: AnyCommand, principal: Principal, input: unknown) {
  return execute(command as unknown as Command<z.ZodType, unknown>, principal, input, {
    request: REQUEST,
  });
}

/** Rules the demo shows as computing. Everything else stays unverified. */
const DEMO_VERIFIED = [
  "tax.irs_cp2000_response",
  "tax.csed",
  "estate.federal_estate_return",
  "estate.tx_will_application",
  "estate.tx_creditor_notice",
  "business.tx_franchise_report",
];

export async function seedDemoDeadlines(
  owner: Principal,
  ids: { notice: string; formation: string; probate: string },
): Promise<{ verified: number; deadlines: number }> {
  if (!env().DEMO_MODE) throw new Error("demo deadlines seed requires DEMO_MODE=true");
  const db = getDb();
  const today = firmToday();
  const year = Number(today.slice(0, 4));
  await run(syncDeadlineRules, SYSTEM, {});
  for (const y of [year, year + 1]) await run(addFederalHolidays, owner, { year: y });
  for (const key of DEMO_VERIFIED) {
    const [r] = await db.select().from(deadlineRules).where(eq(deadlineRules.key, key));
    if (!r || r.verifiedAt) continue;
    await run(verifyDeadlineRule, owner, {
      ruleId: r.id,
      expectedHash: hashOfRow(r),
      citation: "DEMO ONLY. Not checked by an attorney. Do not rely on this rule.",
      attest: true,
    });
  }

  // Probate (C4): a date of death and letters granted; the inventory rule stays unverified.
  await run(recordEvent, owner, {
    matterId: ids.probate,
    kind: "date_of_death",
    occurredOn: addDays(today, -75),
  });
  await run(recordEvent, owner, {
    matterId: ids.probate,
    kind: "letters_granted",
    occurredOn: addDays(today, -20),
  });
  await run(recordEvent, owner, {
    matterId: ids.probate,
    kind: "qualified",
    occurredOn: addDays(today, -18),
  });

  // Entity formation (C3): the annual franchise tax report.
  await run(recordEvent, owner, {
    matterId: ids.formation,
    kind: "entity_formed",
    occurredOn: addDays(today, -40),
  });

  // Notice response: a staff deadline two days out, so C2 alerts and texts.
  await run(addDeadline, owner, {
    matterId: ids.notice,
    label: "Send the bank statements to the IRS examiner",
    dueOn: addDays(today, 2),
    severity: "high",
    ownerId: null,
  });

  // Collections (C5): the collection statute with tolling, and an installment agreement.
  await deliver("ContactCreate", "demo_matter_reese:create", {
    id: "demo_matter_reese",
    firstName: "Reese",
    lastName: "Demo",
    name: "Reese Demo",
    email: "reese.demo@example.test",
    source: "Referral",
    dateAdded: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    timezone: "America/Chicago",
  });
  await deliver("InboundMessage", "demo_matter_reese:sms", {
    contactId: "demo_matter_reese",
    messageType: "SMS",
    direction: "inbound",
    messageId: "demo_matter_reese_sms_1",
    body: "I owe back taxes and want a payment plan.",
    dateAdded: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  });
  const [lead] = await db
    .select({ id: leads.id })
    .from(leads)
    .innerJoin(contacts, eq(contacts.id, leads.contactId))
    .where(eq(contacts.sourceId, "demo_matter_reese"));
  const coll = (await run(openMatter, owner, {
    leadId: lead!.id,
    practiceArea: "tax",
    matterType: "collections",
  })) as { matterId: string };
  await run(recordEvent, owner, {
    matterId: coll.matterId,
    kind: "assessment_date",
    occurredOn: "2019-04-15",
  });
  const [csed] = await db.select().from(deadlines).where(eq(deadlines.matterId, coll.matterId));
  if (csed) {
    await run(addTolling, owner, {
      deadlineId: csed.id,
      days: 120,
      reason: "Offer in compromise pending (demo)",
      fromOn: null,
      toOn: null,
    });
  }
  await run(setPaymentPlan, owner, {
    matterId: coll.matterId,
    label: "Installment agreement",
    firstDueOn: addDays(today, 6),
    dayOfMonth: Number(addDays(today, 6).slice(8)),
    amount: "$425.00",
  });

  await run(runDeadlinesDaily, SYSTEM, { today });
  await run(createCalendarFeed, owner, {});
  const all = await db.select({ id: deadlines.id }).from(deadlines);
  return { verified: DEMO_VERIFIED.length, deadlines: all.length };
}
