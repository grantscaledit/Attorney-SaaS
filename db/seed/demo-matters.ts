/**
 * Demo matters (Phase 3): a client who went through A9 and has portal access,
 * an IRS notice uploaded and triaged (B3), a stalled matter (B5), outstanding
 * documents being chased (B2) and a closed matter (B10). Rule 12: fictional
 * people, DEMO_MODE only, nothing is sent, and the demo model stands in for
 * any model call.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { checklistItems, contacts, leads, matters, users } from "@/db/schema";
import type { AnyCommand, Command, Principal } from "@/lib/commands/define";
import { execute } from "@/lib/commands/execute";
import { env } from "@/lib/env";
import { setJobQueue } from "@/lib/jobs/queue";
import { getBlobStore } from "@/lib/storage";
import { processDocument } from "@/jobs/documents/process";
import { runDraft, runMattersDaily } from "@/jobs/matters/drafts";
import { runSummary } from "@/jobs/matters/summary";
import { decideApproval } from "@/modules/approvals/commands/decide";
import { recordUpload } from "@/modules/documents/commands/documents";
import { rerunConflictCheck, reviewConflictCheck } from "@/modules/intake/commands/conflicts";
import { draftEngagement, markEngagementSigned } from "@/modules/matters/commands/engagements";
import { closeMatter, saveQuestionnaire } from "@/modules/matters/commands/lifecycle";
import { addNote, addParty, changeStage, openMatter } from "@/modules/matters/commands/matters";
import type { z } from "zod";
import { deliver } from "./demo-intake";
import { textPdf } from "./text-pdf";

const REQUEST = { ip: "127.0.0.1", userAgent: "lexdesk-demo-seed", requestId: "script:demo-seed" };
const DAY = 86_400_000;

function run(command: AnyCommand, principal: Principal, input: unknown) {
  return execute(command as unknown as Command<z.ZodType, unknown>, principal, input, {
    request: REQUEST,
  });
}

export const DEMO_CLIENT_EMAIL = "jamie.rivera@demo-client.example.test";

const SAMPLE_NOTICE = [
  [
    "Department of the Treasury",
    "Internal Revenue Service",
    "Kansas City, MO 64999-0025",
    "September 30, 2026",
    "Notice CP2000",
    "Tax year 2024",
    "Taxpayer: DEMO, MORGAN   SSN: 123-45-6789",
    "Proposed changes to your 2024 Form 1040",
    "Amount due: $3,214.00",
    "Respond by: October 30, 2026",
  ],
];

async function newContact(key: string, first: string, last: string, email: string) {
  await deliver("ContactCreate", `${key}:create`, {
    id: key,
    firstName: first,
    lastName: last,
    name: `${first} ${last}`,
    email,
    phone: `+1214555${String(180 + Math.floor(Math.random() * 15)).padStart(4, "0")}`,
    source: "Referral",
    dateAdded: new Date(Date.now() - 20 * DAY).toISOString(),
    timezone: "America/Chicago",
  });
  await deliver("InboundMessage", `${key}:sms`, {
    contactId: key,
    messageType: "SMS",
    direction: "inbound",
    messageId: `${key}_sms_1`,
    body: "Hello, I would like to talk to an attorney.",
    dateAdded: new Date(Date.now() - 20 * DAY).toISOString(),
  });
  const [lead] = await getDb()
    .select({ id: leads.id, contactId: leads.contactId })
    .from(leads)
    .innerJoin(contacts, eq(contacts.id, leads.contactId))
    .where(eq(contacts.sourceId, key));
  return lead!;
}

async function uploadNotice(owner: Principal, matterId: string): Promise<string> {
  const store = getBlobStore();
  if (!store) throw new Error("no store");
  const bytes = textPdf(SAMPLE_NOTICE);
  const storageKey = `matters/${matterId}/${randomUUID()}`;
  await store.put(storageKey, bytes, "application/pdf");
  const up = (await run(recordUpload, owner, {
    matterId,
    originalName: "IRS letter.pdf",
    storageKey,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mimeType: "application/pdf",
    sizeBytes: bytes.byteLength,
  })) as { documentId: string };
  await processDocument(up.documentId);
  return up.documentId;
}

export async function seedDemoMatters(owner: Principal): Promise<{
  clientSetupUrl: string;
  matters: number;
  ids: { estatePlan: string; notice: string; formation: string; probate: string };
}> {
  if (!env().DEMO_MODE) throw new Error("demo matters seed requires DEMO_MODE=true");
  setJobQueue({ send: async () => {} });
  const db = getDb();

  // 1. Jamie Rivera: conflicts cleared, engagement letter approved and signed (A9), portal access (B1).
  const jamie = await newContact("demo_matter_jamie", "Jamie", "Rivera", DEMO_CLIENT_EMAIL);
  const check = (await run(rerunConflictCheck, owner, { leadId: jamie.id })) as { checkId: string };
  await run(reviewConflictCheck, owner, {
    checkId: check.checkId,
    decision: "cleared",
    note: "No overlap with clients or adverse parties.",
  });
  const e = (await run(draftEngagement, owner, {
    leadId: jamie.id,
    practiceArea: "estate",
    matterType: "estate_plan",
    feeTerms: "Flat fee of $3,500 for a revocable trust plan, payable at signing.",
    signingUrl: "https://sign.example.test/demo/jamie-rivera",
    provider: "manual",
    envelopeId: null,
  })) as { engagementId: string; approvalId: string };
  await run(decideApproval, owner, { approvalId: e.approvalId, decision: "approve" });
  const signed = (await run(markEngagementSigned, owner, { engagementId: e.engagementId })) as {
    matterId: string;
    portal: { setupUrl?: string };
  };
  if (!signed.portal.setupUrl) throw new Error("demo client portal link was not issued");
  await run(addParty, owner, {
    matterId: signed.matterId,
    name: "Sam Rivera",
    kind: "person",
    role: "spouse",
  });
  await run(changeStage, owner, { matterId: signed.matterId, stage: "questionnaire" });

  // 2. A notice response with the IRS letter uploaded and triaged (B3), then summarized (B7) and a draft (B8).
  const morgan = await newContact(
    "demo_matter_morgan",
    "Morgan",
    "Demo",
    "morgan.demo@example.test",
  );
  const notice = (await run(openMatter, owner, {
    leadId: morgan.id,
    practiceArea: "tax",
    matterType: "notice_response",
  })) as { matterId: string };
  await run(changeStage, owner, { matterId: notice.matterId, stage: "documents" });
  await uploadNotice(owner, notice.matterId);
  await run(addNote, owner, {
    matterId: notice.matterId,
    body: "Client says the 1099-K income was reported on Schedule C. Ask for the bank statements.",
  });
  await runSummary(notice.matterId, "on_demand");
  await runDraft(notice.matterId, "irs_response", null);

  // 3. A stalled entity formation (B5) and 4. a probate matter chasing documents (B2).
  const casey = await newContact(
    "demo_matter_casey",
    "Casey",
    "Lindgren",
    "casey.lindgren@example.test",
  );
  const formation = (await run(openMatter, owner, {
    leadId: casey.id,
    practiceArea: "business",
    matterType: "entity_formation",
  })) as { matterId: string };
  await run(changeStage, owner, { matterId: formation.matterId, stage: "drafting" });
  await db
    .update(matters)
    .set({ stageChangedAt: new Date(Date.now() - 19 * DAY) })
    .where(eq(matters.id, formation.matterId));

  const avery = await newContact(
    "demo_matter_avery",
    "Avery",
    "Okafor",
    "avery.okafor@example.test",
  );
  const probate = (await run(openMatter, owner, {
    leadId: avery.id,
    practiceArea: "estate",
    matterType: "probate",
  })) as { matterId: string };
  await run(changeStage, owner, { matterId: probate.matterId, stage: "documents" });
  await db
    .update(checklistItems)
    .set({ requestedAt: new Date(Date.now() - 8 * DAY) })
    .where(eq(checklistItems.matterId, probate.matterId));

  // 5. A closed matter (B10).
  const drew = await newContact(
    "demo_matter_drew",
    "Drew",
    "Halvorsen",
    "drew.halvorsen@example.test",
  );
  const done = (await run(openMatter, owner, {
    leadId: drew.id,
    practiceArea: "business",
    matterType: "contract",
  })) as { matterId: string };
  await run(closeMatter, owner, {
    matterId: done.matterId,
    note: "Contract signed by both parties.",
  });

  // Daily automations: B2 reminders, B5 stall alerts, B6 updates for quiet matters.
  await runMattersDaily();

  // The client starts the questionnaire (as the client).
  const [client] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, DEMO_CLIENT_EMAIL), inArray(users.role, ["client"])));
  await run(
    saveQuestionnaire,
    {
      type: "user",
      user: {
        id: client!.id,
        email: client!.email,
        name: client!.name,
        role: "client",
        status: "active",
      },
    },
    {
      matterId: signed.matterId,
      answers: {
        marital_status: "Married",
        spouse_name: "Sam Rivera",
        children: "Two, ages 9 and 12",
      },
      submit: false,
    },
  );
  return {
    clientSetupUrl: signed.portal.setupUrl,
    matters: 5,
    ids: {
      estatePlan: signed.matterId,
      notice: notice.matterId,
      formation: formation.matterId,
      probate: probate.matterId,
    },
  };
}
