import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  approvals,
  contacts,
  deadlineAlerts,
  deadlineRules,
  deadlines,
  documentExtractions,
  matterEvents,
  messages,
  tasks,
  type DeadlineRow,
} from "@/db/schema";
import type { SessionUser } from "@/lib/commands/define";
import { processDocument } from "@/jobs/documents/process";
import {
  escalateDeadlinesJob,
  runDeadlineAuditJob,
  runDeadlinesDailyJob,
} from "@/jobs/deadlines/run";
import { addDays } from "@/modules/deadlines/date-math";
import { hashOfRow } from "@/modules/deadlines/rules";
import { createCalendarFeed, revokeCalendarFeed } from "@/modules/deadlines/commands/calendar";
import {
  acknowledgeAlerts,
  addDeadline,
  addTolling,
  endPaymentPlan,
  recordEvent,
  removeEvent,
  setDeadlineStatus,
  setPaymentPlan,
  updateEvent,
} from "@/modules/deadlines/commands/deadlines";
import {
  addHoliday,
  setRuleActive,
  syncDeadlineRules,
  updateDeadlineRule,
  verifyDeadlineRule,
} from "@/modules/deadlines/commands/rules";
import {
  calendarFeedFor,
  deadlinesInSevenDays,
  deadlinesPanel,
  matterDeadlines,
} from "@/modules/deadlines/queries";
import { confirmExtraction } from "@/modules/documents/commands/documents";
import { uploadDocument } from "@/modules/documents/upload";
import { closeMatter } from "@/modules/matters/commands/lifecycle";
import { firmToday } from "@/modules/matters/scope";
import { updateIntakeProfile } from "@/modules/users/commands/intake-profile";
import { removeModel } from "./ai-kit";
import { configureGhlEnv, daytimeZone, FakeGhl, prepareMessaging, RecordingQueue } from "./ghl-kit";
import { asUser, provisionTestFirm, run, SYSTEM, TEST_REQUEST, withFreshDatabase } from "./helpers";
import { clientUser, installStore, openTestMatter } from "./matter-kit";
import { textPdf } from "../../db/seed/text-pdf";
import { matters } from "@/db/schema";

/*
 * Phase 4 acceptance:
 *  - "Unverified rules cannot fire."
 *  - "Date math passes tests including weekends, month ends, leap years."
 *    (unit tests in modules/deadlines; here, the same through the database)
 *  - "Alerts escalate when unacknowledged."
 * plus B3's hand-off to C1, and C3, C5, C6, C7.
 */

configureGhlEnv();
const { db } = withFreshDatabase();
let owner: SessionUser;
new RecordingQueue().install();
const ghl = new FakeGhl();
installStore();
const today = () => firmToday();

beforeAll(async () => {
  ({ owner } = await provisionTestFirm());
  await prepareMessaging(owner);
  ghl.install();
  removeModel();
  await run(syncDeadlineRules, SYSTEM, {});
  // The owner's alert phone (C2 texts go to staff's own GHL contact, as A5's do).
  const [staff] = await db()
    .insert(contacts)
    .values({
      sourceId: "ghl_owner_alert_phone",
      fullName: "Olivia Owner",
      phone: "+12145550142",
      timezone: daytimeZone(),
    })
    .returning();
  await run(updateIntakeProfile, asUser(owner), {
    userId: owner.id,
    practiceAreas: ["tax", "business", "estate"],
    ghlContactId: staff!.sourceId,
  });
});

async function rule(key: string) {
  const [r] = await db().select().from(deadlineRules).where(eq(deadlineRules.key, key));
  return r!;
}

async function verify(key: string) {
  const r = await rule(key);
  return run(verifyDeadlineRule, asUser(owner), {
    ruleId: r.id,
    expectedHash: hashOfRow(r),
    citation: "Checked against the source for the test firm.",
    attest: true,
  });
}

/** Postgres errors arrive wrapped by Drizzle; the database's own message is the cause. */
async function dbRejects(p: Promise<unknown>, re: RegExp) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).not.toBeNull();
  const cause = (err as { cause?: { message?: string } }).cause;
  expect(cause?.message ?? String(err)).toMatch(re);
}

async function deadlinesOf(matterId: string): Promise<DeadlineRow[]> {
  return db().select().from(deadlines).where(eq(deadlines.matterId, matterId));
}

describe("Phase 4 acceptance: unverified rules cannot fire", () => {
  it("records the trigger but computes nothing, and asks the owner to verify", async () => {
    const m = await openTestMatter(owner, { practiceArea: "estate", matterType: "probate" });
    const r = (await run(recordEvent, asUser(owner), {
      matterId: m.matterId,
      kind: "date_of_death",
      occurredOn: "2025-05-31",
    })) as { computed: number; unverified: number };
    expect(r).toMatchObject({ computed: 0, unverified: 2 });
    expect(await deadlinesOf(m.matterId)).toHaveLength(0);
    const verifyTasks = await db()
      .select()
      .from(tasks)
      .where(and(eq(tasks.matterId, m.matterId), eq(tasks.automationId, "C1")));
    expect(verifyTasks.map((t) => t.title).sort()).toEqual([
      'Verify the deadline rule "Application to probate the will" (Settings > Deadline rules)',
      'Verify the deadline rule "Federal estate tax return" (Settings > Deadline rules)',
    ]);
    expect(verifyTasks.every((t) => t.assigneeId === owner.id && t.priority === "urgent")).toBe(
      true,
    );
    const view = await matterDeadlines(owner, (await matterRow(m.matterId))!);
    expect(view!.waiting.map((w) => w.rule).sort()).toEqual([
      "Application to probate the will",
      "Federal estate tax return",
    ]);
  });

  it("the database refuses a rule-computed deadline from an unverified rule", async () => {
    const m = await openTestMatter(owner, { practiceArea: "estate", matterType: "probate" });
    const r = await rule("estate.tx_inventory");
    await dbRejects(
      db()
        .insert(deadlines)
        .values({
          matterId: m.matterId,
          label: "Forged",
          dueOn: "2026-12-01",
          origin: "rule",
          ruleId: r.id,
          ruleHash: hashOfRow(r),
          severity: "high",
        }),
      /is not verified/,
    );
    await dbRejects(
      db().insert(deadlines).values({
        matterId: m.matterId,
        label: "No rule",
        dueOn: "2026-12-01",
        origin: "rule",
        severity: "high",
      }),
      /does not exist|deadlines_rule_origin_has_rule/,
    );
    // Verified, but computed from other parameters than the ones signed off.
    await verify("estate.tx_inventory");
    await dbRejects(
      db()
        .insert(deadlines)
        .values({
          matterId: m.matterId,
          label: "Forged",
          dueOn: "2026-12-01",
          origin: "rule",
          ruleId: r.id,
          ruleHash: "f".repeat(64),
          severity: "high",
        }),
      /differ from the verified rule/,
    );
  });

  it("only the owner attorney, as a person, verifies, and only what they saw", async () => {
    const r = await rule("estate.tx_inventory");
    const input = {
      ruleId: r.id,
      expectedHash: hashOfRow(r),
      citation: "Checked against the source.",
      attest: true,
    };
    await expect(run(verifyDeadlineRule, SYSTEM, input)).rejects.toThrow(/Only a person/);
    const paralegal: SessionUser = { ...owner, id: owner.id, role: "paralegal" };
    await expect(run(verifyDeadlineRule, asUser(paralegal), input)).rejects.toThrow(/permission/);
    const attorney: SessionUser = { ...owner, role: "attorney" };
    await expect(run(verifyDeadlineRule, asUser(attorney), input)).rejects.toThrow(/permission/);
    await expect(
      run(verifyDeadlineRule, asUser(owner), { ...input, expectedHash: "0".repeat(64) }),
    ).rejects.toThrow(/changed since you opened it/);
    await expect(
      run(verifyDeadlineRule, asUser(owner), { ...input, citation: "" }),
    ).rejects.toThrow();
  });

  it("computes once verified: month-end clamp, leap year and weekend roll", async () => {
    const m = await openTestMatter(owner, { practiceArea: "estate", matterType: "probate" });
    await run(recordEvent, asUser(owner), {
      matterId: m.matterId,
      kind: "date_of_death",
      occurredOn: "2025-05-31",
    });
    await verify("estate.federal_estate_return");
    await verify("estate.tx_will_application");
    const ds = await deadlinesOf(m.matterId);
    const byLabel = Object.fromEntries(ds.map((d) => [d.label, d]));
    // 31 May 2025 + 9 months = 28 Feb 2026 (Saturday), rolled to Monday 2 March.
    expect(byLabel["Federal estate tax return"]).toMatchObject({
      dueOn: "2026-03-02",
      origin: "rule",
      severity: "high",
      ownerId: owner.id,
      confirmed: true,
    });
    expect(byLabel["Federal estate tax return"]!.computation).toEqual([
      "Trigger date Sat, May 31, 2025",
      "9 months after the trigger: Sat, Feb 28, 2026",
      "Falls on a weekend or holiday; moved to Mon, Mar 2, 2026",
    ]);
    // + 4 years = 31 May 2029, a Thursday.
    expect(byLabel["Application to probate the will"]!.dueOn).toBe("2029-05-31");

    // Leap day: a death on 29 Feb 2024 plus 4 years is 29 Feb 2028 (Tuesday).
    const leap = await openTestMatter(owner, { practiceArea: "estate", matterType: "probate" });
    await run(recordEvent, asUser(owner), {
      matterId: leap.matterId,
      kind: "date_of_death",
      occurredOn: "2024-02-29",
    });
    const l = Object.fromEntries((await deadlinesOf(leap.matterId)).map((d) => [d.label, d.dueOn]));
    expect(l["Application to probate the will"]).toBe("2028-02-29");
    // 29 Feb 2024 + 9 months = 29 Nov 2024 (Friday).
    expect(l["Federal estate tax return"]).toBe("2024-11-29");
  });

  it("editing a verified rule stops it computing until it is verified again", async () => {
    const m = await openTestMatter(owner, { practiceArea: "estate", matterType: "probate" });
    await verify("estate.tx_creditor_notice");
    await run(recordEvent, asUser(owner), {
      matterId: m.matterId,
      kind: "letters_granted",
      occurredOn: "2026-01-30",
    });
    let [d] = await deadlinesOf(m.matterId);
    // 30 Jan + 1 month = 28 Feb 2026 (Saturday), rolled to 2 March.
    expect(d!.dueOn).toBe("2026-03-02");
    const r = await rule("estate.tx_creditor_notice");
    await run(updateDeadlineRule, asUser(owner), {
      ruleId: r.id,
      expectedVersion: r.version,
      label: r.label,
      description: r.description,
      offset: { unit: "days", amount: 30 },
      rollForward: r.rollForward,
      severity: r.severity,
      noticeTypes: r.noticeTypes,
      preferPrinted: r.preferPrinted,
    });
    const edited = await rule("estate.tx_creditor_notice");
    expect(edited.verifiedAt).toBeNull();
    [d] = await deadlinesOf(m.matterId);
    // The old date stays, flagged; nothing is recomputed from an unverified rule.
    expect(d).toMatchObject({ dueOn: "2026-03-02", ruleChanged: true });
    // A new event on another matter computes nothing.
    const other = await openTestMatter(owner, { practiceArea: "estate", matterType: "probate" });
    await run(recordEvent, asUser(owner), {
      matterId: other.matterId,
      kind: "letters_granted",
      occurredOn: "2026-01-30",
    });
    expect(await deadlinesOf(other.matterId)).toHaveLength(0);
    // Re-verified: both compute from the new parameters (30 Jan + 30 days = 1 March, Sunday -> 2 March).
    await verify("estate.tx_creditor_notice");
    [d] = await deadlinesOf(m.matterId);
    expect(d).toMatchObject({ dueOn: "2026-03-02", ruleChanged: false, ruleVersion: 2 });
    expect(await deadlinesOf(other.matterId)).toHaveLength(1);
  });

  it("a holiday the firm enters moves a rolled date, and correcting the event moves it again", async () => {
    await verify("estate.tx_beneficiary_notice");
    const m = await openTestMatter(owner, { practiceArea: "estate", matterType: "probate" });
    const ev = (await run(recordEvent, asUser(owner), {
      matterId: m.matterId,
      kind: "will_admitted",
      // + 60 days = Monday 7 September 2026 (Labor Day).
      occurredOn: "2026-07-09",
    })) as { eventId: string };
    expect((await deadlinesOf(m.matterId))[0]!.dueOn).toBe("2026-09-07");
    await run(addHoliday, asUser(owner), { date: "2026-09-07", label: "Labor Day" });
    const [moved] = await deadlinesOf(m.matterId);
    expect(moved!.dueOn).toBe("2026-09-08");
    expect(moved!.dueChangedAt).not.toBeNull();
    await run(updateEvent, asUser(owner), {
      eventId: ev.eventId,
      occurredOn: "2026-07-10",
      noticeType: null,
      flags: {},
      note: null,
    });
    expect((await deadlinesOf(m.matterId))[0]!.dueOn).toBe("2026-09-08");
    await run(removeEvent, asUser(owner), {
      eventId: ev.eventId,
      reason: "Entered on the wrong matter",
    });
    expect((await deadlinesOf(m.matterId))[0]!.status).toBe("cancelled");
  });

  it("refuses an event in the future or one the matter type does not record", async () => {
    const m = await openTestMatter(owner, { practiceArea: "estate", matterType: "probate" });
    await expect(
      run(recordEvent, asUser(owner), {
        matterId: m.matterId,
        kind: "date_of_death",
        occurredOn: addDays(today(), 2),
      }),
    ).rejects.toThrow(/future/);
    await expect(
      run(recordEvent, asUser(owner), {
        matterId: m.matterId,
        kind: "assessment_date",
        occurredOn: "2026-01-02",
      }),
    ).rejects.toThrow(/does not apply/);
  });
});

async function matterRow(id: string) {
  const [m] = await db().select().from(matters).where(eq(matters.id, id));
  return m;
}

describe("B3 to C1: the printed date governs, the rule cross-checks", () => {
  const notice = (type: string, noticeDate: string, respondBy: string | null) => [
    [
      "Department of the Treasury",
      "Internal Revenue Service",
      noticeDate,
      `Notice ${type}`,
      "Tax year 2024",
      "Taxpayer: SAMPLE, ALEX   SSN: 123-45-6789",
      "Amount due: $1,200.00",
      ...(respondBy ? [`Respond by: ${respondBy}`] : []),
    ],
  ];

  async function triage(pages: string[][]) {
    const m = await openTestMatter(owner);
    const up = await uploadDocument({
      user: owner,
      request: TEST_REQUEST,
      matterId: m.matterId,
      fileName: "IRS letter.pdf",
      bytes: textPdf(pages),
    });
    await processDocument(up.documentId);
    return { ...m, documentId: up.documentId };
  }

  it("creates an unconfirmed deadline from the printed date, cross-checked once the rule is verified", async () => {
    const t = await triage(notice("CP2000", "September 30, 2026", "October 30, 2026"));
    let [d] = await deadlinesOf(t.matterId);
    expect(d).toMatchObject({
      origin: "document",
      dueOn: "2026-10-30",
      confirmed: false,
      documentId: t.documentId,
      crossCheck: null,
    });
    const [ev] = await db()
      .select()
      .from(matterEvents)
      .where(eq(matterEvents.matterId, t.matterId));
    expect(ev).toMatchObject({
      kind: "notice_date",
      occurredOn: "2026-09-30",
      noticeType: "CP2000",
    });

    await verify("tax.irs_cp2000_response");
    [d] = await deadlinesOf(t.matterId);
    // 30 Sep + 30 days = 30 Oct (Friday): the rule agrees with the printed date.
    expect(d!.crossCheck).toMatchObject({ dueOn: "2026-10-30", matches: true });
    // Still one deadline: the rule does not add a second.
    expect(await deadlinesOf(t.matterId)).toHaveLength(1);

    const [ex] = await db()
      .select()
      .from(documentExtractions)
      .where(eq(documentExtractions.documentId, t.documentId));
    await run(confirmExtraction, asUser(owner), {
      extractionId: ex!.id,
      fields: { ...(ex!.fields as Record<string, unknown>), respondBy: "2026-11-02" },
    });
    [d] = await deadlinesOf(t.matterId);
    expect(d).toMatchObject({ dueOn: "2026-11-02", confirmed: true });
    expect(d!.crossCheck).toMatchObject({ dueOn: "2026-10-30", matches: false });
    const mismatch = await db()
      .select()
      .from(tasks)
      .where(and(eq(tasks.matterId, t.matterId), eq(tasks.automationId, "C1")));
    expect(mismatch.some((x) => x.title.startsWith("Check the deadline: the printed date"))).toBe(
      true,
    );
  });

  it("computes from the verified rule when the notice prints no date", async () => {
    await verify("tax.irs_cdp_hearing");
    const t = await triage(notice("LT11", "September 14, 2026", null));
    const ds = await deadlinesOf(t.matterId);
    expect(ds).toHaveLength(1);
    // 14 Sep + 30 days = 14 Oct 2026 (Wednesday). Unconfirmed until a person confirms the notice.
    expect(ds[0]).toMatchObject({
      origin: "rule",
      label: "Collection due process hearing request",
      dueOn: "2026-10-14",
      severity: "critical",
      confirmed: false,
    });
  });
});

describe("C2 alerts and escalation", () => {
  it("alerts at the threshold reached, texts the attorney at 3 days, and escalates when nobody acknowledges", async () => {
    const m = await openTestMatter(owner);
    const due = addDays(today(), 3);
    const d = (await run(addDeadline, asUser(owner), {
      matterId: m.matterId,
      label: "File the protest",
      dueOn: due,
      severity: "high",
      ownerId: owner.id,
    })) as { deadlineId: string };
    const far = (await run(addDeadline, asUser(owner), {
      matterId: m.matterId,
      label: "Later deadline",
      dueOn: addDays(today(), 20),
      severity: "normal",
      ownerId: owner.id,
    })) as { deadlineId: string };

    await runDeadlinesDailyJob(today());
    await runDeadlinesDailyJob(today()); // idempotent
    const alerts = await db().select().from(deadlineAlerts);
    const mine = alerts.filter((a) => a.deadlineId === d.deadlineId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ threshold: 3, critical: true, recipientId: owner.id });
    expect(mine[0]!.smsMessageId).not.toBeNull();
    const [sms] = await db().select().from(messages).where(eq(messages.id, mine[0]!.smsMessageId!));
    expect(sms).toMatchObject({ templateKey: "C2.alert.sms" });
    expect(sms!.status).not.toBe("suppressed");
    expect(sms!.body).toContain("due in 3 days");
    expect(sms!.body).not.toContain("Sample");
    const later = alerts.filter((a) => a.deadlineId === far.deadlineId);
    expect(later).toMatchObject([{ threshold: 30, critical: false, smsMessageId: null }]);

    // Not yet four hours: no escalation.
    await escalateDeadlinesJob(new Date(Date.now() + 3_600_000));
    expect(
      (await db().select().from(deadlineAlerts).where(eq(deadlineAlerts.id, mine[0]!.id)))[0]!
        .escalatedAt,
    ).toBeNull();
    // Five hours on, still unacknowledged: escalated to the owner attorney.
    await escalateDeadlinesJob(new Date(Date.now() + 5 * 3_600_000));
    const [esc] = await db()
      .select()
      .from(deadlineAlerts)
      .where(eq(deadlineAlerts.id, mine[0]!.id));
    expect(esc!.escalatedAt).not.toBeNull();
    expect(esc!.escalatedTo).toEqual([owner.id]);
    const escTasks = await db()
      .select()
      .from(tasks)
      .where(and(eq(tasks.matterId, m.matterId), eq(tasks.automationId, "C2")));
    expect(escTasks).toHaveLength(1);
    expect(escTasks[0]).toMatchObject({ priority: "urgent", assigneeId: owner.id });
    const escSms = await db()
      .select()
      .from(messages)
      .where(eq(messages.templateKey, "C2.escalation.sms"));
    expect(escSms.length).toBeGreaterThanOrEqual(1);
    // The 30-day alert is not critical and never escalates.
    expect(
      (await db().select().from(deadlineAlerts).where(eq(deadlineAlerts.id, later[0]!.id)))[0]!
        .escalatedAt,
    ).toBeNull();
    // Escalation happens once.
    await escalateDeadlinesJob(new Date(Date.now() + 9 * 3_600_000));
    expect(
      await db()
        .select()
        .from(tasks)
        .where(and(eq(tasks.matterId, m.matterId), eq(tasks.automationId, "C2"))),
    ).toHaveLength(1);
  });

  it("an acknowledged alert does not escalate", async () => {
    const m = await openTestMatter(owner);
    const d = (await run(addDeadline, asUser(owner), {
      matterId: m.matterId,
      label: "Hearing request",
      dueOn: addDays(today(), 1),
      severity: "critical",
      ownerId: owner.id,
    })) as { deadlineId: string };
    await runDeadlinesDailyJob(today());
    await run(acknowledgeAlerts, asUser(owner), { deadlineId: d.deadlineId });
    await escalateDeadlinesJob(new Date(Date.now() + 5 * 3_600_000));
    const [a] = await db()
      .select()
      .from(deadlineAlerts)
      .where(eq(deadlineAlerts.deadlineId, d.deadlineId));
    expect(a).toMatchObject({ threshold: 1, critical: true });
    expect(a!.acknowledgedAt).not.toBeNull();
    expect(a!.escalatedAt).toBeNull();
    await expect(
      run(acknowledgeAlerts, asUser(owner), { deadlineId: d.deadlineId }),
    ).rejects.toThrow(/no alert/);
  });

  it("a done deadline stops alerting, and closing a matter cancels its deadlines", async () => {
    const m = await openTestMatter(owner);
    const d = (await run(addDeadline, asUser(owner), {
      matterId: m.matterId,
      label: "Respond",
      dueOn: addDays(today(), 7),
      severity: "normal",
      ownerId: null,
    })) as { deadlineId: string };
    await run(setDeadlineStatus, asUser(owner), { deadlineId: d.deadlineId, status: "done" });
    await runDeadlinesDailyJob(today());
    expect(
      await db().select().from(deadlineAlerts).where(eq(deadlineAlerts.deadlineId, d.deadlineId)),
    ).toHaveLength(0);
    await run(addDeadline, asUser(owner), {
      matterId: m.matterId,
      label: "Another",
      dueOn: addDays(today(), 40),
      severity: "normal",
      ownerId: null,
    });
    await run(closeMatter, asUser(owner), { matterId: m.matterId, note: "Resolved." });
    const ds = await deadlinesOf(m.matterId);
    expect(ds.find((x) => x.label === "Another")!.status).toBe("cancelled");
  });
});

describe("C3, C5", () => {
  it("C3: creates the next year's report when this year's is done, and drafts a client reminder", async () => {
    await verify("business.tx_franchise_report");
    const m = await openTestMatter(owner, {
      practiceArea: "business",
      matterType: "entity_formation",
      email: "owner@entity.example.test",
    });
    await run(recordEvent, asUser(owner), {
      matterId: m.matterId,
      kind: "entity_formed",
      occurredOn: "2025-08-01",
    });
    let ds = await deadlinesOf(m.matterId);
    // The next 15 May after formation: 15 May 2026 (Friday).
    expect(ds).toMatchObject([{ dueOn: "2026-05-15", occurrence: 0 }]);
    await runDeadlinesDailyJob(today());
    ds = (await deadlinesOf(m.matterId)).sort((a, b) => a.occurrence - b.occurrence);
    // Past due, so the next occurrence exists: 15 May 2027 is a Saturday, rolled to the 17th.
    expect(ds.map((d) => [d.occurrence, d.dueOn])).toEqual([
      [0, "2026-05-15"],
      [1, "2027-05-17"],
    ]);
    // Thirty days out, the client reminder waits for approval with a reply option.
    await runDeadlinesDailyJob("2027-04-20");
    const [a] = await db()
      .select()
      .from(approvals)
      .where(and(eq(approvals.matterId, m.matterId), eq(approvals.automationId, "C3")));
    expect(a).toMatchObject({ kind: "message", status: "pending", channel: "email" });
    expect(a!.draftBody).toContain("Would you like us to handle it?");
    expect(a!.draftBody).toContain("Mon, May 17, 2027");
  });

  it("C5: tolling extends the collection statute; payment dates are tracked", async () => {
    await verify("tax.csed");
    const m = await openTestMatter(owner, { matterType: "collections" });
    await run(recordEvent, asUser(owner), {
      matterId: m.matterId,
      kind: "assessment_date",
      occurredOn: "2020-06-15",
    });
    const [csed] = await deadlinesOf(m.matterId);
    expect(csed!.dueOn).toBe("2030-06-15");
    await run(addTolling, asUser(owner), {
      deadlineId: csed!.id,
      days: 45,
      reason: "Installment agreement request pending",
      fromOn: null,
      toOn: null,
    });
    const [tolled] = await deadlinesOf(m.matterId);
    expect(tolled!.dueOn).toBe("2030-07-30");

    const plan = (await run(setPaymentPlan, asUser(owner), {
      matterId: m.matterId,
      label: "Installment agreement",
      firstDueOn: addDays(today(), 5),
      dayOfMonth: 31,
      amount: "$450.00",
    })) as { planId: string };
    expect(plan.planId).toBeTruthy();
    const pays = (await deadlinesOf(m.matterId)).filter((d) => d.origin === "schedule");
    expect(pays.length).toBeGreaterThanOrEqual(3);
    expect(pays.every((d) => d.label === "Installment agreement payment ($450.00)")).toBe(true);
    await run(endPaymentPlan, asUser(owner), { matterId: m.matterId, reason: "Paid in full" });
    const after = (await deadlinesOf(m.matterId)).filter((d) => d.origin === "schedule");
    expect(after.every((d) => d.status === "cancelled")).toBe(true);
  });
});

describe("C6 calendar feed and C7 audit", () => {
  it("serves a private feed with matter numbers and no client names, until revoked", async () => {
    const m = await openTestMatter(owner, { first: "Quincy" });
    await run(addDeadline, asUser(owner), {
      matterId: m.matterId,
      label: "Protest due",
      dueOn: addDays(today(), 10),
      severity: "high",
      ownerId: owner.id,
    });
    const { token } = (await run(createCalendarFeed, asUser(owner), {})) as { token: string };
    const ics = await calendarFeedFor(token);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain(`SUMMARY:${m.number}: Protest due`);
    expect(ics).toContain("Verify against the source document");
    expect(ics).not.toContain("Quincy");
    expect(await calendarFeedFor("x".repeat(43))).toBeNull();
    await run(revokeCalendarFeed, asUser(owner), {});
    expect(await calendarFeedFor(token)).toBeNull();
  });

  it("C7 reports deadlines with no owner and assigns the audit to the owner attorney", async () => {
    const m = await openTestMatter(owner);
    await run(addDeadline, asUser(owner), {
      matterId: m.matterId,
      label: "Unowned",
      dueOn: addDays(today(), 50),
      severity: "normal",
      ownerId: null,
    });
    const r = (await runDeadlineAuditJob()) as {
      withoutOwner: number;
      mattersWithoutDeadline: number;
    };
    expect(r.withoutOwner).toBeGreaterThanOrEqual(1);
    const [t] = await db()
      .select()
      .from(tasks)
      .where(and(eq(tasks.automationId, "C7"), eq(tasks.assigneeId, owner.id)));
    expect(t!.title).toMatch(/^Weekly deadline audit/);
    const panel = await deadlinesPanel(owner, { month: today().slice(0, 7), mine: false });
    expect(panel.audit.withoutOwner.some((x) => x.label === "Unowned")).toBe(true);
    expect(await deadlinesInSevenDays(owner)).toBe(
      panel.counts.windows["7"].critical +
        panel.counts.windows["7"].high +
        panel.counts.windows["7"].normal,
    );
  });
});

describe("permissions", () => {
  it("clients and attorneys off the matter cannot touch its deadlines", async () => {
    const m = await openTestMatter(owner, { practiceArea: "estate", matterType: "probate" });
    const client = await clientUser(m.contactId);
    await expect(
      run(recordEvent, asUser(client), {
        matterId: m.matterId,
        kind: "date_of_death",
        occurredOn: "2025-01-02",
      }),
    ).rejects.toThrow(/permission/);
    const assoc: SessionUser = {
      id: "00000000-0000-4000-8000-0000000000aa",
      email: "assoc@x.test",
      name: "Assoc",
      role: "attorney",
      status: "active",
    };
    await expect(
      run(recordEvent, asUser(assoc), {
        matterId: m.matterId,
        kind: "date_of_death",
        occurredOn: "2025-01-02",
      }),
    ).rejects.toThrow(/permission/);
    expect(await matterDeadlines(assoc, (await matterRow(m.matterId))!)).toBeNull();
    const intake: SessionUser = { ...assoc, role: "intake" };
    await expect(deadlinesInSevenDays(intake)).rejects.toThrow();
  });

  it("a rule-computed deadline cannot be cancelled or moved by hand", async () => {
    const m = await openTestMatter(owner, { practiceArea: "estate", matterType: "probate" });
    await run(recordEvent, asUser(owner), {
      matterId: m.matterId,
      kind: "date_of_death",
      occurredOn: "2025-03-03",
    });
    const d = (await deadlinesOf(m.matterId)).find((x) => x.origin === "rule")!;
    await expect(
      run(setDeadlineStatus, asUser(owner), {
        deadlineId: d.id,
        status: "cancelled",
        note: "x y z",
      }),
    ).rejects.toThrow(/cannot be cancelled by hand/);
  });
});

describe("switched-off rules", () => {
  it("compute nothing and raise no verification task", async () => {
    const r = await rule("estate.tx_beneficiary_notice");
    await run(setRuleActive, asUser(owner), { ruleId: r.id, active: false });
    const m = await openTestMatter(owner, { practiceArea: "estate", matterType: "probate" });
    const out = (await run(recordEvent, asUser(owner), {
      matterId: m.matterId,
      kind: "will_admitted",
      occurredOn: "2026-02-02",
    })) as { computed: number; unverified: number };
    expect(out).toMatchObject({ computed: 0, unverified: 0 });
    const verifyTasks = await db()
      .select()
      .from(tasks)
      .where(and(eq(tasks.matterId, m.matterId), eq(tasks.automationId, "C1")));
    expect(verifyTasks).toHaveLength(0);
    const view = await matterDeadlines(owner, (await matterRow(m.matterId))!);
    expect(view!.waiting).toEqual([]);
  });
});
