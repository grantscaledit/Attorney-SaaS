import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  approvals,
  checklistItems,
  conflictHits,
  documentExtractions,
  documents,
  documentTexts,
  engagements,
  matters,
  messages,
  tasks,
} from "@/db/schema";
import { can } from "@/lib/auth/can";
import type { SessionUser } from "@/lib/commands/define";
import { processDocument } from "@/jobs/documents/process";
import { runDraft, runMattersDaily, runStatusUpdate } from "@/jobs/matters/drafts";
import { runSummary } from "@/jobs/matters/summary";
import { sendMessageJob } from "@/jobs/messaging/send";
import { decideApproval } from "@/modules/approvals/commands/decide";
import { logDownload } from "@/modules/documents/commands/documents";
import { uploadDocument } from "@/modules/documents/upload";
import { rerunConflictCheck } from "@/modules/intake/commands/conflicts";
import { draftEngagement, markEngagementSigned } from "@/modules/matters/commands/engagements";
import {
  closeMatter,
  retentionDate,
  saveQuestionnaire,
} from "@/modules/matters/commands/lifecycle";
import { addParty, changeStage } from "@/modules/matters/commands/matters";
import { scopeOf } from "@/modules/matters/scope";
import { listMatters, matterDetail, portalMatter, portalMatters } from "@/modules/matters/queries";
import { installScriptedModel, removeModel, seedLead } from "./ai-kit";
import { configureGhlEnv, FakeGhl, prepareMessaging, RecordingQueue } from "./ghl-kit";
import { asUser, provisionTestFirm, run, TEST_REQUEST, withFreshDatabase } from "./helpers";
import { clearedLead, clientUser, installStore, openTestMatter } from "./matter-kit";
import { textPdf } from "../../db/seed/text-pdf";

/*
 * Phase 3 acceptance:
 *  - "A sample IRS notice uploads, extracts correct fields with identifiers
 *    masked, and creates a matter summary."
 *  - "Client sees only their own matter."
 * plus A9, B1, B2, B5, B6, B8, B9 and B10 behaviour.
 */

configureGhlEnv();
const { db } = withFreshDatabase();
let owner: SessionUser;
const ghl = new FakeGhl();
new RecordingQueue().install();
const store = installStore();
const DAY = 86_400_000;

const SAMPLE_NOTICE = [
  [
    "Department of the Treasury",
    "Internal Revenue Service",
    "Kansas City, MO 64999-0025",
    "September 30, 2026",
    "Notice CP2000",
    "Tax year 2024",
    "Taxpayer: SAMPLE, ALEX   SSN: 123-45-6789",
    "Proposed changes to your 2024 Form 1040",
    "Amount due: $3,214.00",
    "Respond by: October 30, 2026",
    "Page 1 of 2",
  ],
  ["Page 2 of 2", "Bank account 000123456789 routing 111000025 shown on the payment voucher."],
];

beforeAll(async () => {
  ({ owner } = await provisionTestFirm());
  await prepareMessaging(owner);
  ghl.install();
});
afterEach(() => removeModel());

async function upload(
  user: SessionUser,
  matterId: string,
  pages: string[][],
  checklistItemId?: string,
) {
  return uploadDocument({
    user,
    request: TEST_REQUEST,
    matterId,
    checklistItemId,
    fileName: "IRS letter.pdf",
    bytes: textPdf(pages),
  });
}

describe("Phase 3 acceptance: IRS notice triage", () => {
  it("extracts the printed fields with identifiers masked and creates a matter summary", async () => {
    installScriptedModel({
      reply: (req) =>
        req.system.startsWith("You read one tax notice")
          ? {
              output: {
                agency: "IRS",
                noticeType: "CP2000",
                taxYears: ["2024"],
                amountDue: "3,214.00",
                noticeDate: "September 30, 2026",
                respondBy: "October 30, 2026",
                summary:
                  "The IRS proposes changes to the 2024 return and shows $3,214.00 due. It asks for a response by October 30, 2026.",
              },
            }
          : {
              output: {
                summary:
                  "The client received a CP2000 for 2024. A response is due October 30, 2026.",
                timeline: [],
              },
            },
    });
    const m = await openTestMatter(owner);
    const up = await upload(owner, m.matterId, SAMPLE_NOTICE);
    // The original file is kept as uploaded, in the firm's store.
    expect(store.objects.get(`matters/${m.matterId}/${up.documentId}`)).toBeDefined();

    await processDocument(up.documentId);
    const [doc] = await db().select().from(documents).where(eq(documents.id, up.documentId));
    expect(doc).toMatchObject({
      status: "processed",
      docType: "irs_notice",
      pageCount: 2,
      ocrEngine: "text_layer",
    });
    expect(doc!.displayName).toMatch(
      /^\d{4}-\d{2}-\d{2} IRS notice CP2000 2024 - \d{4}-\d{4}\.pdf$/,
    );

    const [ex] = await db()
      .select()
      .from(documentExtractions)
      .where(eq(documentExtractions.documentId, up.documentId));
    expect(ex!.fields).toEqual({
      agency: "IRS",
      noticeType: "CP2000",
      taxYears: ["2024"],
      amountDue: "3,214.00",
      noticeDate: "2026-09-30",
      respondBy: "2026-10-30",
    });
    expect(ex!.status).toBe("proposed");
    expect(ex!.aiRunId).not.toBeNull();

    // Identifiers masked everywhere the text is stored, and in what the model saw.
    const [text] = await db()
      .select()
      .from(documentTexts)
      .where(eq(documentTexts.documentId, up.documentId));
    const stored = JSON.stringify([text, ex]);
    expect(stored).not.toMatch(/123-45-6789|000123456789|111000025/);
    expect(text!.maskedText).toContain("[SSN ending 6789]");

    // Review task and a respond-by task carrying the date printed on the notice.
    const t = await db().select().from(tasks).where(eq(tasks.matterId, m.matterId));
    expect(t.find((x) => x.automationId === "B3" && x.dueOn === "2026-10-30")).toMatchObject({
      dueFromDocument: true,
    });
    expect(t.some((x) => x.title.startsWith("Review IRS CP2000"))).toBe(true);

    // Matter summary (B7 runs after triage).
    await runSummary(m.matterId, "document");
    const [after] = await db().select().from(matters).where(eq(matters.id, m.matterId));
    expect(after!.summary).toContain("CP2000");
    expect(after!.summaryUpdatedAt).not.toBeNull();
    // The upload satisfied the notice checklist item (B4).
    const [item] = await db()
      .select()
      .from(checklistItems)
      .where(and(eq(checklistItems.matterId, m.matterId), eq(checklistItems.key, "notice")));
    expect(item).toMatchObject({ status: "received", documentId: up.documentId });
  });

  it("works without a model: parser fields and a plain summary", async () => {
    removeModel();
    const m = await openTestMatter(owner);
    const up = await upload(owner, m.matterId, SAMPLE_NOTICE);
    await processDocument(up.documentId);
    const [ex] = await db()
      .select()
      .from(documentExtractions)
      .where(eq(documentExtractions.documentId, up.documentId));
    expect((ex!.fields as { respondBy: string }).respondBy).toBe("2026-10-30");
    expect(ex!.summary).toContain("IRS CP2000");
    await runSummary(m.matterId, "on_demand");
    const [after] = await db().select().from(matters).where(eq(matters.id, m.matterId));
    expect(after!.summary).toContain("CP2000");
    expect((after!.summaryTimeline as unknown[]).length).toBeGreaterThan(0);
  });

  it("ignores model values that are not in the text, and flags pages that are missing", async () => {
    installScriptedModel({
      reply: (req) =>
        req.system.startsWith("You read one tax notice")
          ? {
              output: {
                agency: "IRS",
                noticeType: "CP2000",
                taxYears: ["2024"],
                amountDue: "99,999.00",
                noticeDate: null,
                respondBy: "December 1, 2026",
                summary: "A notice.",
              },
            }
          : { output: { summary: "x", timeline: [] } },
    });
    const m = await openTestMatter(owner);
    const up = await upload(owner, m.matterId, [SAMPLE_NOTICE[0]!]);
    await processDocument(up.documentId);
    const [ex] = await db()
      .select()
      .from(documentExtractions)
      .where(eq(documentExtractions.documentId, up.documentId));
    expect(ex!.fields).toMatchObject({ amountDue: "3,214.00", respondBy: "2026-10-30" });
    const [doc] = await db().select().from(documents).where(eq(documents.id, up.documentId));
    expect(doc!.flags).toMatchObject({ incomplete: expect.stringContaining("page 2 is missing") });
  });

  it("rejects files that are not documents, and duplicate uploads are one document", async () => {
    const m = await openTestMatter(owner);
    await expect(
      uploadDocument({
        user: owner,
        request: TEST_REQUEST,
        matterId: m.matterId,
        fileName: "x.pdf",
        bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0]),
      }),
    ).rejects.toMatchObject({ code: "validation" });
    const a = await upload(owner, m.matterId, [
      ["Statement period August 2026, beginning balance $10"],
    ]);
    const b = await upload(owner, m.matterId, [
      ["Statement period August 2026, beginning balance $10"],
    ]);
    expect(b).toEqual({ documentId: a.documentId, duplicate: true });
  });
});

describe("Phase 3 acceptance: a client sees only their own matter", () => {
  it("lists, opens, uploads to and downloads from only their own matters", async () => {
    const mine = await openTestMatter(owner, { first: "Avery" });
    const theirs = await openTestMatter(owner, { first: "Blake" });
    const avery = await clientUser(mine.contactId);
    const blake = await clientUser(theirs.contactId);
    expect(mine.portal).toMatchObject({ setupUrl: expect.stringContaining("/invite/") });

    expect((await portalMatters(avery)).map((x) => x.id)).toEqual([mine.matterId]);
    expect(await portalMatter(avery, mine.matterId)).not.toBeNull();
    expect(await portalMatter(avery, theirs.matterId)).toBeNull();
    // The staff matter page is never available to a client.
    expect(await matterDetail(avery, mine.matterId)).toBeNull();

    const [mm] = await db().select().from(matters).where(eq(matters.id, theirs.matterId));
    expect(can(avery, "documents.read", { resource: await scopeOf(db(), mm!) })).toBe(false);
    await expect(
      upload(avery, theirs.matterId, [["My documents for the other matter"]]),
    ).rejects.toMatchObject({ code: "not_found" });

    // Blake uploads; the file is visible to Blake, never to Avery.
    const up = await upload(blake, theirs.matterId, [
      ["Statement period August 2026, beginning balance $10"],
    ]);
    await processDocument(up.documentId);
    expect((await portalMatter(blake, theirs.matterId))!.documents.map((d) => d.id)).toContain(
      up.documentId,
    );
    await expect(
      run(logDownload, asUser(avery), { documentId: up.documentId }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      run(saveQuestionnaire, asUser(avery), {
        matterId: theirs.matterId,
        answers: {},
        submit: false,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    // Staff-only documents stay hidden from the client even on their own matter.
    const staffDoc = await upload(owner, mine.matterId, [
      ["Internal memo text that is long enough to read"],
    ]);
    expect((await portalMatter(avery, mine.matterId))!.documents.map((d) => d.id)).not.toContain(
      staffDoc.documentId,
    );
    await expect(
      run(logDownload, asUser(avery), { documentId: staffDoc.documentId }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("an attorney sees only matters they own or are assigned to", async () => {
    const assoc: SessionUser = {
      id: "00000000-0000-4000-8000-000000000001",
      email: "a@x.test",
      name: "Assoc",
      role: "attorney",
      status: "active",
    };
    const m = await openTestMatter(owner);
    expect((await listMatters(assoc, { status: "open" })).map((x) => x.id)).not.toContain(
      m.matterId,
    );
    expect(await matterDetail(assoc, m.matterId)).toBeNull();
    expect((await listMatters(owner, { status: "open" })).map((x) => x.id)).toContain(m.matterId);
  });
});

describe("A9 engagement letter", () => {
  it("needs a cleared conflict pre-screen", async () => {
    const l = await seedLead({ status: "consult_held", inbound: null });
    await run(rerunConflictCheck, asUser(owner), { leadId: l.leadId });
    await expect(
      run(draftEngagement, asUser(owner), {
        leadId: l.leadId,
        practiceArea: "tax",
        matterType: "notice_response",
        feeTerms: "Flat fee of $2,500 for the notice response.",
        signingUrl: "https://sign.example.test/e/1",
        provider: "manual",
        envelopeId: null,
      }),
    ).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("drafts, sends on approval with the signing link, reminds, and opens the matter when signed", async () => {
    const l = await clearedLead(owner, "Emery");
    const d = (await run(draftEngagement, asUser(owner), {
      leadId: l.leadId,
      practiceArea: "estate",
      matterType: "estate_plan",
      feeTerms: "Flat fee of $3,000 for a revocable trust plan.",
      signingUrl: "https://sign.example.test/e/emery",
      provider: "manual",
      envelopeId: null,
    })) as { engagementId: string; approvalId: string };
    const [a] = await db().select().from(approvals).where(eq(approvals.id, d.approvalId));
    expect(a!.draftBody).toContain("Flat fee of $3,000");
    expect(a!.draftBody).toContain("https://sign.example.test/e/emery");
    const r = (await run(decideApproval, asUser(owner), {
      approvalId: d.approvalId,
      decision: "approve",
    })) as { messages: { messageId: string }[] };
    await sendMessageJob(r.messages[0]!.messageId);
    expect(ghl.sends().at(-1)!.body).toMatchObject({ type: "Email" });
    const [sent] = await db().select().from(engagements).where(eq(engagements.id, d.engagementId));
    expect(sent!.status).toBe("sent");

    // Day 2: one reminder.
    await db()
      .update(engagements)
      .set({ sentAt: new Date(Date.now() - 2.5 * DAY) })
      .where(eq(engagements.id, d.engagementId));
    await runMattersDaily();
    const reminders = await db()
      .select()
      .from(messages)
      .where(eq(messages.templateKey, "A9.reminder.email"));
    expect(reminders.filter((x) => x.contactId === l.contactId)).toHaveLength(1);

    const signed = (await run(markEngagementSigned, asUser(owner), {
      engagementId: d.engagementId,
    })) as {
      matterId: string;
      portal: { setupUrl?: string };
    };
    const [m] = await db().select().from(matters).where(eq(matters.id, signed.matterId));
    expect(m).toMatchObject({
      practiceArea: "estate",
      matterType: "estate_plan",
      stage: "opening",
      leadId: l.leadId,
    });
    expect(signed.portal.setupUrl).toContain("/invite/");
    // B1 built the checklist and the B9 questionnaire.
    expect(
      (await db().select().from(checklistItems).where(eq(checklistItems.matterId, m!.id))).length,
    ).toBeGreaterThan(0);
    const detail = await matterDetail(owner, m!.id);
    expect(detail!.questionnaire).toMatchObject({ status: "in_progress" });
  });
});

describe("matter automations", () => {
  it("B2 chases outstanding documents on days 3, 7 and 14, then hands to a person", async () => {
    const m = await openTestMatter(owner);
    await db()
      .update(checklistItems)
      .set({ requestedAt: new Date(Date.now() - 8 * DAY) })
      .where(eq(checklistItems.matterId, m.matterId));
    await runMattersDaily();
    const sent = await db().select().from(messages).where(eq(messages.automationId, "B2"));
    const mine = sent.filter(
      (x) => (x.context as { matterId?: string } | null)?.matterId === m.matterId,
    );
    expect(mine.map((x) => x.idempotencyKey).sort()).toEqual(
      [
        `B2:${m.matterId}:day3:email`,
        `B2:${m.matterId}:day3:sms`,
        `B2:${m.matterId}:day7:email`,
        `B2:${m.matterId}:day7:sms`,
      ].sort(),
    );
    await runMattersDaily(); // No repeats.
    expect((await db().select().from(messages).where(eq(messages.automationId, "B2"))).length).toBe(
      sent.length,
    );
    await db()
      .update(checklistItems)
      .set({ requestedAt: new Date(Date.now() - 15 * DAY), remindersSent: 2 })
      .where(eq(checklistItems.matterId, m.matterId));
    await runMattersDaily();
    const t = await db()
      .select()
      .from(tasks)
      .where(and(eq(tasks.matterId, m.matterId), eq(tasks.automationId, "B2")));
    expect(t).toHaveLength(1);
  });

  it("B2 stops once the documents arrive", async () => {
    const m = await openTestMatter(owner);
    await db()
      .update(checklistItems)
      .set({ requestedAt: new Date(Date.now() - 4 * DAY) })
      .where(eq(checklistItems.matterId, m.matterId));
    await runMattersDaily();
    const [email] = await db()
      .select()
      .from(messages)
      .where(eq(messages.idempotencyKey, `B2:${m.matterId}:day3:email`));
    await db()
      .update(checklistItems)
      .set({ status: "received" })
      .where(eq(checklistItems.matterId, m.matterId));
    await db()
      .update(messages)
      .set({ status: "queued", scheduledFor: new Date() })
      .where(eq(messages.id, email!.id));
    await sendMessageJob(email!.id);
    const [after] = await db().select().from(messages).where(eq(messages.id, email!.id));
    expect(after).toMatchObject({ status: "suppressed", suppressedReason: "documents_received" });
  });

  it("B5 flags a matter stalled past its stage threshold, once", async () => {
    const m = await openTestMatter(owner);
    await db()
      .update(matters)
      .set({ stageChangedAt: new Date(Date.now() - 9 * DAY) })
      .where(eq(matters.id, m.matterId));
    await runMattersDaily();
    await runMattersDaily();
    const t = await db()
      .select()
      .from(tasks)
      .where(and(eq(tasks.matterId, m.matterId), eq(tasks.automationId, "B5")));
    expect(t).toHaveLength(1);
    expect(t[0]!.title).toMatch(/Stalled: Opening for 9 days \(threshold 7\)/);
  });

  it("B6 drafts a client update on a stage change, for approval", async () => {
    installScriptedModel({
      reply: () => ({
        output: {
          body: "Hi Pat, your matter is now in the documents stage. We still need the notice.",
        },
      }),
    });
    const m = await openTestMatter(owner);
    await run(changeStage, asUser(owner), { matterId: m.matterId, stage: "documents" });
    await runStatusUpdate(m.matterId, "stage_change");
    const [a] = await db()
      .select()
      .from(approvals)
      .where(and(eq(approvals.matterId, m.matterId), eq(approvals.automationId, "B6")));
    expect(a).toMatchObject({ status: "pending", kind: "message", channel: "email" });
  });

  it("B6 marks a draft the guard flags", async () => {
    installScriptedModel({
      reply: () => ({ output: { body: "Good news: you will definitely win and owe nothing." } }),
    });
    const m = await openTestMatter(owner);
    await runStatusUpdate(m.matterId, "no_contact");
    const [a] = await db()
      .select()
      .from(approvals)
      .where(and(eq(approvals.matterId, m.matterId), eq(approvals.automationId, "B6")));
    expect((a!.flags as { findings: string[] }).findings).toContain("outcome_prediction");
  });

  it("B8 drafts are labelled drafts and never sent", async () => {
    const m = await openTestMatter(owner);
    await runDraft(m.matterId, "irs_response", owner.id);
    const [a] = await db()
      .select()
      .from(approvals)
      .where(and(eq(approvals.matterId, m.matterId), eq(approvals.automationId, "B8")));
    expect(a).toMatchObject({ kind: "draft", channel: "none" });
    expect(a!.draftBody.startsWith("DRAFT.")).toBe(true);
  });

  it("B9 questionnaire answers are masked and submission creates a review task", async () => {
    const m = await openTestMatter(owner, {
      practiceArea: "estate",
      matterType: "estate_plan",
      first: "Harper",
    });
    const client = await clientUser(m.contactId);
    await run(saveQuestionnaire, asUser(client), {
      matterId: m.matterId,
      answers: {
        children: "Two children, born 04/12/2015 and 06/01/2018",
        unknown_field: "ignored",
      },
      submit: true,
    });
    const detail = await matterDetail(owner, m.matterId);
    const answers = detail!.questionnaire!.answers as Record<string, string>;
    expect(answers.children).not.toMatch(/04\/12\/2015/);
    expect(answers.unknown_field).toBeUndefined();
    expect(detail!.tasks.some((t) => t.automationId === "B9")).toBe(true);
    await expect(
      run(saveQuestionnaire, asUser(client), { matterId: m.matterId, answers: {}, submit: false }),
    ).rejects.toMatchObject({
      code: "invalid_state",
    });
  });

  it("B10 closes the matter with a retention date and a closing letter for approval", async () => {
    const m = await openTestMatter(owner);
    const r = (await run(closeMatter, asUser(owner), {
      matterId: m.matterId,
      note: "Response accepted",
    })) as { retentionUntil: string };
    const [after] = await db().select().from(matters).where(eq(matters.id, m.matterId));
    expect(after).toMatchObject({
      status: "closed",
      stage: "closed",
      retentionUntil: r.retentionUntil,
    });
    const [a] = await db()
      .select()
      .from(approvals)
      .where(and(eq(approvals.matterId, m.matterId), eq(approvals.automationId, "B10")));
    expect(a!.draftBody).toContain("representation of you in this matter has ended");
    expect(
      (
        await db()
          .select()
          .from(checklistItems)
          .where(
            and(eq(checklistItems.matterId, m.matterId), eq(checklistItems.status, "requested")),
          )
      ).length,
    ).toBe(0);
    expect(retentionDate("2024-02-29", 1)).toBe("2025-02-28");
    expect(retentionDate("2026-10-11", 7)).toBe("2033-10-11");
  });

  it("A6 checks new enquiries against parties on the firm's matters", async () => {
    const m = await openTestMatter(owner);
    await run(addParty, asUser(owner), {
      matterId: m.matterId,
      name: "Quentin Vasquez-Hale",
      kind: "person",
      role: "adverse",
    });
    const l = await seedLead({ first: "Quentin", last: "Vasquez-Hale", inbound: null });
    const c = (await run(rerunConflictCheck, asUser(owner), { leadId: l.leadId })) as {
      checkId: string;
    };
    const hits = await db().select().from(conflictHits).where(eq(conflictHits.checkId, c.checkId));
    expect(hits).toEqual([
      expect.objectContaining({ matchedType: "matter_party", matchedName: "Quentin Vasquez-Hale" }),
    ]);
    expect(hits[0]!.role).toContain("adverse on matter");
  });
});
