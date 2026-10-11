import { desc, eq, gt, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { auditLog, firmSettings, messages, sessions, users } from "@/db/schema";
import type { AnyCommand, Principal, SessionUser } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";
import { COMMANDS } from "@/lib/commands/registry";
import { inviteUser } from "@/modules/users/commands/invite";
import { updateFirmSettings } from "@/modules/firm/commands/update-settings";
import { DEFAULT_AI_DISCLOSURE } from "@/modules/firm/schemas";
import { ingestGhlWebhook } from "@/modules/ghl/commands/ingest-webhook";
import { markGhlWebhookFailed, processGhlWebhook } from "@/modules/ghl/commands/process-webhook";
import { claimMessage } from "@/modules/messaging/commands/outbox";
import { setFeatureEnabled } from "@/modules/firm/commands/set-feature";
import { recordAiRun } from "@/modules/ai/commands/record-run";
import { addConflictParties, rerunConflictCheck } from "@/modules/intake/commands/conflicts";
import { saveReferralPartner } from "@/modules/intake/commands/followups";
import { conflictParties } from "@/db/schema";
import { a3Reply, seedAppointment, seedLead, seedPendingApproval } from "./ai-kit";
import { documentExtractions } from "@/db/schema";
import { decideApproval } from "@/modules/approvals/commands/decide";
import { applyProcessing, recordUpload } from "@/modules/documents/commands/documents";
import { draftEngagement } from "@/modules/matters/commands/engagements";
import { addParty, createTask } from "@/modules/matters/commands/matters";
import {
  clearedLead,
  clientUser,
  documentFor,
  installStore,
  openTestMatter,
  storedPdf,
} from "./matter-kit";
import {
  configureGhlEnv,
  daytimeZone,
  ghlContactPayload,
  missedCallPayload,
  prepareMessaging,
} from "./ghl-kit";
import {
  SYSTEM,
  asUser,
  provisionTestFirm,
  run,
  tokenFromSetupUrl,
  withFreshDatabase,
} from "./helpers";

/*
 * Phase 0 acceptance criterion: "Every mutation appears in the audit log."
 *
 * Every registered command has a fixture here. The test runs each command and
 * checks that it committed at least one audit row naming the actor, action and
 * entity. Adding a command without a fixture fails the first test.
 */

// Firm tier so the fixtures are not limited by the Solo seat cap (tested in users.test.ts).
process.env.FIRM_TIER = "firm";
configureGhlEnv();
const { db } = withFreshDatabase();

let owner: SessionUser;
let ownerSetupUrl: string;

type Fixture = {
  principal: () => Principal;
  input: () => Promise<unknown> | unknown;
  expectAction: string;
  /** Runs on a database without a firm. */
  needsEmptyDatabase?: boolean;
};

/** Stores a webhook (as the route does) and returns its id. */
async function ingest(dedupeKey: string, payload: Record<string, unknown>): Promise<string> {
  const r = (await run(ingestGhlWebhook, SYSTEM, {
    dedupeKey,
    eventType: String(payload.type),
    authMethod: "shared_secret",
    locationId: null,
    payload,
  })) as { eventId: string };
  return r.eventId;
}

/** A queued A1 text-back for a fresh missed call. */
async function queuedTextBack(ref: string): Promise<string> {
  await prepareMessaging(owner);
  // The flags.set fixture switched A1 off.
  await run(setFeatureEnabled, asUser(owner), { flag: "automation.A1", enabled: true }).catch(
    (e: unknown) => {
      if (!(e instanceof CommandError && e.code === "invalid_state")) throw e;
    },
  );
  const contactId = `fixture_${ref}`;
  const eventId = await ingest(`fixture:call:${ref}`, missedCallPayload(contactId, `call_${ref}`));
  const contact = ghlContactPayload(contactId, { timezone: daytimeZone() });
  await run(processGhlWebhook, SYSTEM, { eventId, enrichment: { contact } });
  const [m] = await db()
    .select({ id: messages.id })
    .from(messages)
    .where(sql`${messages.context}->>'callId' is not null and ${messages.status} = 'queued'`)
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return m!.id;
}

let claimedMessageId = "";
installStore();

const NOTICE_PAGES = [
  [
    "Department of the Treasury",
    "Internal Revenue Service",
    "September 30, 2026",
    "Notice CP2000",
    "Tax year 2024",
    "Amount due: $3,214.00",
    "Respond by: October 30, 2026",
  ],
];

/** A matter with one uploaded and processed IRS notice. */
async function processedNotice(): Promise<{ matterId: string; documentId: string }> {
  const m = await openTestMatter(owner);
  const up = (await run(
    recordUpload,
    asUser(owner),
    await storedPdf(m.matterId, NOTICE_PAGES),
  )) as { documentId: string };
  await run(applyProcessing, SYSTEM, {
    documentId: up.documentId,
    read: {
      engine: "text_layer",
      pageCount: 1,
      unreadablePages: [],
      confidence: null,
      maskedText: NOTICE_PAGES[0]!.join("\n"),
      missingPages: null,
    },
    classification: { docType: "irs_notice", confidence: 0.95, via: "rules" },
    notice: {
      fields: {
        agency: "IRS",
        noticeType: "CP2000",
        taxYears: ["2024"],
        amountDue: "3,214.00",
        noticeDate: "2026-09-30",
        respondBy: "2026-10-30",
      },
      provenance: { agency: "parser" },
      summary: null,
      aiRunId: null,
    },
  });
  return { matterId: m.matterId, documentId: up.documentId };
}

const SIGNING_URL = "https://sign.example.test/envelope/abc123";

async function draftedEngagement(
  first: string,
): Promise<{ engagementId: string; approvalId: string }> {
  await prepareMessaging(owner);
  const l = await clearedLead(owner, first);
  return (await run(draftEngagement, asUser(owner), {
    leadId: l.leadId,
    practiceArea: "tax",
    matterType: "notice_response",
    feeTerms: "Flat fee of $2,500 for the notice response.",
    signingUrl: SIGNING_URL,
    provider: "manual",
    envelopeId: null,
  })) as { engagementId: string; approvalId: string };
}

const AI_RUN_INPUT = {
  purpose: "fixture",
  automationId: "A3",
  model: "test-model",
  servedModel: "test-model",
  promptHash: "0".repeat(64),
  promptVersion: "fixture-1",
  status: "succeeded",
  stopReason: "end_turn",
  refusalCategory: null,
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  costUsd: 0.0001,
  latencyMs: 12,
  maskedCounts: {},
  output: { ok: true },
  error: null,
  entityType: null,
  entityId: null,
};

async function aiRunId(): Promise<string> {
  const r = (await run(recordAiRun, SYSTEM, AI_RUN_INPUT)) as { runId: string };
  return r.runId;
}

async function partnerId(name: string): Promise<string> {
  const r = (await run(saveReferralPartner, asUser(owner), {
    name,
    organization: "Example Family Law",
    handles: "family law, divorce",
    phone: "(214) 555-0199",
  })) as { id: string };
  return r.id;
}

async function makeStaff(email: string): Promise<string> {
  const r = (await run(inviteUser, asUser(owner), {
    name: "Staff Member",
    email,
    role: "paralegal",
  })) as { userId: string };
  return r.userId;
}

const FIXTURES: Record<string, Fixture> = {
  "firm.bootstrap": {
    principal: () => SYSTEM,
    input: () => ({}),
    expectAction: "firm.provisioned",
    needsEmptyDatabase: true,
  },
  "firm.settings.update": {
    principal: () => asUser(owner),
    input: () => ({
      legalName: "Test Firm PLLC",
      displayName: "Test Firm",
      practiceAreas: ["tax"],
      aiDisclosureText: DEFAULT_AI_DISCLOSURE,
      attorneysSeeFinancials: true,
      ipAllowlist: [],
    }),
    expectAction: "firm.settings.updated",
  },
  "flags.set": {
    principal: () => asUser(owner),
    input: () => ({ flag: "automation.A1", enabled: false, reason: "Not live yet" }),
    expectAction: "flags.disabled",
  },
  "users.invite": {
    principal: () => asUser(owner),
    input: () => ({
      name: "New Paralegal",
      email: "fixture.invite@test-firm.example",
      role: "paralegal",
    }),
    expectAction: "users.invited",
  },
  "users.update": {
    principal: () => asUser(owner),
    input: async () => ({
      userId: await makeStaff("fixture.update@test-firm.example"),
      name: "Renamed",
      role: "intake",
    }),
    expectAction: "users.role_changed",
  },
  "users.deactivate": {
    principal: () => asUser(owner),
    input: async () => ({ userId: await makeStaff("fixture.deactivate@test-firm.example") }),
    expectAction: "users.deactivated",
  },
  "users.reactivate": {
    principal: () => asUser(owner),
    input: async () => {
      const [u] = await db()
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, "fixture.deactivate@test-firm.example"));
      return { userId: u!.id };
    },
    expectAction: "users.reactivated",
  },
  "users.issue_setup_link": {
    principal: () => asUser(owner),
    input: async () => ({ userId: await makeStaff("fixture.link@test-firm.example") }),
    expectAction: "users.setup_link_issued",
  },
  "users.reset_mfa": {
    principal: () => asUser(owner),
    input: async () => ({ userId: await makeStaff("fixture.mfa@test-firm.example") }),
    expectAction: "users.mfa_reset",
  },
  "users.revoke_sessions": {
    principal: () => asUser(owner),
    input: () => ({ userId: owner.id }),
    expectAction: "users.sessions_revoked",
  },
  "users.accept_invite": {
    principal: () => ({ type: "anonymous" }),
    input: () => ({
      token: tokenFromSetupUrl(ownerSetupUrl),
      password: "correct horse battery staple",
      confirmPassword: "correct horse battery staple",
    }),
    expectAction: "users.invite_accepted",
  },
  "audit.verify_chain": {
    principal: () => asUser(owner),
    input: () => ({}),
    expectAction: "audit.chain_verified",
  },
  "audit.export": {
    principal: () => asUser(owner),
    input: () => ({ filters: { actor: "user" }, format: "csv" }),
    expectAction: "audit.exported",
  },
  "ghl.ingest_webhook": {
    principal: () => SYSTEM,
    input: () => ({
      dedupeKey: "fixture:ingest",
      eventType: "ContactCreate",
      authMethod: "shared_secret",
      locationId: null,
      payload: { ...ghlContactPayload("fixture_ingest"), type: "ContactCreate" },
    }),
    expectAction: "ghl.webhook_received",
  },
  "ghl.process_webhook": {
    principal: () => SYSTEM,
    input: async () => ({
      eventId: await ingest("fixture:process", {
        ...ghlContactPayload("fixture_process"),
        type: "ContactCreate",
      }),
    }),
    expectAction: "ghl.webhook_processed",
  },
  "ghl.mark_webhook_failed": {
    principal: () => SYSTEM,
    input: async () => ({
      eventId: await ingest("fixture:failed", {
        ...ghlContactPayload("fixture_failed"),
        type: "ContactCreate",
      }),
      error: "simulated failure",
    }),
    expectAction: "ghl.webhook_failed",
  },
  "ghl.retry_webhook": {
    principal: () => asUser(owner),
    input: async () => {
      const eventId = await ingest("fixture:retry", {
        ...ghlContactPayload("fixture_retry"),
        type: "ContactCreate",
      });
      await run(markGhlWebhookFailed, SYSTEM, { eventId, error: "simulated failure" });
      return { eventId };
    },
    expectAction: "ghl.webhook_retry_requested",
  },
  "ghl.reconcile_batch": {
    principal: () => SYSTEM,
    input: () => ({
      kind: "contacts",
      runId: "fixture-run",
      items: [ghlContactPayload("fixture_reconcile")],
    }),
    expectAction: "ghl.reconcile_batch",
  },
  "ghl.record_sync_run": {
    principal: () => SYSTEM,
    input: () => ({ key: "ghl.reconcile", runId: "fixture-run", phase: "started" }),
    expectAction: "ghl.sync_started",
  },
  "ghl.request_reconcile": {
    principal: () => asUser(owner),
    input: () => ({}),
    expectAction: "ghl.reconcile_requested",
  },
  "messaging.claim": {
    principal: () => SYSTEM,
    input: async () => {
      claimedMessageId = await queuedTextBack("claim");
      return { messageId: claimedMessageId };
    },
    expectAction: "messaging.send_started",
  },
  "messaging.record_result": {
    principal: () => SYSTEM,
    input: () => ({
      messageId: claimedMessageId,
      outcome: "sent",
      ghlMessageId: "fixture_ghl_msg",
    }),
    expectAction: "messaging.sent",
  },
  "messaging.mark_stale_send": {
    principal: () => SYSTEM,
    input: async () => {
      const messageId = await queuedTextBack("stale");
      await run(claimMessage, SYSTEM, { messageId });
      await db()
        .update(messages)
        .set({ updatedAt: new Date(Date.now() - 60 * 60_000) })
        .where(eq(messages.id, messageId));
      return { messageId };
    },
    expectAction: "messaging.send_outcome_unknown",
  },
  "messaging.template_save": {
    principal: () => asUser(owner),
    input: () => ({
      key: "A2.sms",
      body: "Thank you for contacting {{firmName}}. Book at {{bookingUrl}}. Reply STOP to opt out.",
    }),
    expectAction: "messaging.template_saved",
  },
  "messaging.template_approve": {
    principal: () => asUser(owner),
    input: () => ({
      key: "A2.sms",
      body: "Thank you for contacting {{firmName}}. Book at {{bookingUrl}}. Reply STOP to opt out.",
      subject: null,
    }),
    expectAction: "messaging.template_approved",
  },
  "messaging.template_withdraw": {
    principal: () => asUser(owner),
    input: () => ({ key: "A2.sms" }),
    expectAction: "messaging.template_approval_withdrawn",
  },
  // Phase 2
  "ai.record_run": {
    principal: () => SYSTEM,
    input: () => AI_RUN_INPUT,
    expectAction: "ai.run_recorded",
  },
  "approvals.decide": {
    principal: () => asUser(owner),
    input: async () => {
      await prepareMessaging(owner);
      const l = await seedLead();
      return { approvalId: await seedPendingApproval(l.leadId, l.contactId), decision: "approve" };
    },
    expectAction: "approvals.approved",
  },
  "firm.ai_settings.update": {
    principal: () => asUser(owner),
    input: () => ({
      a3Mode: "review_all",
      feeTable: [{ service: "Initial consultation", fee: "$150" }],
    }),
    expectAction: "firm.ai_settings.updated",
  },
  "users.intake_profile_update": {
    principal: () => asUser(owner),
    input: () => ({ userId: owner.id, practiceAreas: ["tax", "estate"] }),
    expectAction: "users.intake_profile_updated",
  },
  "intake.a3_handoff": {
    principal: () => SYSTEM,
    input: async () => {
      const l = await seedLead({ inbound: "The IRS put a levy on my account" });
      return { leadId: l.leadId, messageId: l.messageId, reasons: ["levy"], adviceSeeking: false };
    },
    expectAction: "intake.a3_handed_off",
  },
  "intake.a3_turn": {
    principal: () => SYSTEM,
    input: async () => {
      const l = await seedLead({ inbound: "I got a letter from the IRS" });
      return {
        leadId: l.leadId,
        messageId: l.messageId,
        aiRunId: await aiRunId(),
        output: a3Reply({ answers: [{ questionId: "agency", value: "IRS" }] }),
        findings: [],
        classifierSafe: true,
        classifierRunId: null,
      };
    },
    expectAction: "intake.a3_replied",
  },
  "intake.a3_skipped": {
    principal: () => SYSTEM,
    input: async () => {
      const l = await seedLead();
      return { leadId: l.leadId, messageId: l.messageId, reason: "ai_not_configured" };
    },
    expectAction: "intake.a3_skipped",
  },
  "conflicts.run": {
    principal: () => asUser(owner),
    input: async () => ({ leadId: (await seedLead({ inbound: null })).leadId }),
    expectAction: "conflicts.checked",
  },
  "conflicts.review": {
    principal: () => asUser(owner),
    input: async () => {
      const l = await seedLead({ inbound: null });
      const c = (await run(rerunConflictCheck, asUser(owner), { leadId: l.leadId })) as {
        checkId: string;
      };
      return { checkId: c.checkId, decision: "cleared", note: "No overlap with current clients" };
    },
    expectAction: "conflicts.cleared",
  },
  "conflicts.parties_add": {
    principal: () => asUser(owner),
    input: () => ({
      parties: [{ name: "Example Holdings LLC", kind: "organization", role: "adverse" }],
    }),
    expectAction: "conflicts.parties_added",
  },
  "conflicts.party_remove": {
    principal: () => asUser(owner),
    input: async () => {
      await run(addConflictParties, asUser(owner), {
        parties: [{ name: "Removable Party", kind: "person", role: "related" }],
      });
      const [p] = await db()
        .select({ id: conflictParties.id })
        .from(conflictParties)
        .where(eq(conflictParties.name, "Removable Party"));
      return { partyId: p!.id };
    },
    expectAction: "conflicts.party_removed",
  },
  "intake.a8_brief": {
    principal: () => SYSTEM,
    input: async () => {
      const l = await seedLead({
        status: "consult_booked",
        practiceArea: "tax",
        answers: { agency: "IRS" },
      });
      return {
        appointmentId: await seedAppointment(
          l.leadId,
          l.contactId,
          new Date(Date.now() + 6 * 3600_000),
        ),
        ai: null,
        aiRunId: null,
      };
    },
    expectAction: "intake.a8_brief_drafted",
  },
  "intake.a10_enroll": {
    principal: () => SYSTEM,
    input: async () => {
      await prepareMessaging(owner);
      const l = await seedLead({
        status: "consult_held",
        consultHeldAt: new Date(Date.now() - 8 * 86_400_000),
      });
      return { leadId: l.leadId };
    },
    expectAction: "intake.a10_enrolled",
  },
  "leads.decline": {
    principal: () => asUser(owner),
    input: async () => ({
      leadId: (await seedLead({ status: "consult_held" })).leadId,
      note: "Outside our current capacity",
    }),
    expectAction: "leads.declined",
  },
  "intake.a11_cold": {
    principal: () => SYSTEM,
    input: async () => ({
      leadId: (
        await seedLead({
          status: "consult_held",
          consultHeldAt: new Date(Date.now() - 50 * 86_400_000),
        })
      ).leadId,
    }),
    expectAction: "intake.a11_drafted",
  },
  "intake.refer_out": {
    principal: () => asUser(owner),
    input: async () => ({
      leadId: (await seedLead()).leadId,
      partnerId: await partnerId("Riley Referral"),
    }),
    expectAction: "intake.referral_drafted",
  },
  "referrals.partner_save": {
    principal: () => asUser(owner),
    input: () => ({ name: "Sam Partner", handles: "criminal defense", email: "sam@example.test" }),
    expectAction: "referrals.partner_added",
  },
  "referrals.partner_remove": {
    principal: () => asUser(owner),
    input: async () => ({ id: await partnerId("Removable Partner") }),
    expectAction: "referrals.partner_removed",
  },
  // Phase 3
  "matters.open": {
    principal: () => asUser(owner),
    input: async () => ({
      leadId: (await seedLead({ status: "consult_held", inbound: null })).leadId,
      practiceArea: "tax",
      matterType: "notice_response",
    }),
    expectAction: "matters.opened",
  },
  "matters.change_stage": {
    principal: () => asUser(owner),
    input: async () => ({ matterId: (await openTestMatter(owner)).matterId, stage: "documents" }),
    expectAction: "matters.stage_changed",
  },
  "matters.assign": {
    principal: () => asUser(owner),
    input: async () => ({
      matterId: (await openTestMatter(owner)).matterId,
      responsibleAttorneyId: owner.id,
      assignedUserIds: [],
    }),
    expectAction: "matters.assigned",
  },
  "matters.party_add": {
    principal: () => asUser(owner),
    input: async () => ({
      matterId: (await openTestMatter(owner)).matterId,
      name: "Example Adverse LLC",
      kind: "organization",
      role: "adverse",
    }),
    expectAction: "matters.party_added",
  },
  "matters.party_remove": {
    principal: () => asUser(owner),
    input: async () => {
      const m = await openTestMatter(owner);
      const r = (await run(addParty, asUser(owner), {
        matterId: m.matterId,
        name: "Removable Related",
        kind: "person",
        role: "related",
      })) as { partyId: string };
      return { partyId: r.partyId };
    },
    expectAction: "matters.party_removed",
  },
  "matters.note_add": {
    principal: () => asUser(owner),
    input: async () => ({
      matterId: (await openTestMatter(owner)).matterId,
      body: "Client called; SSN 123-45-6789 on file.",
    }),
    expectAction: "matters.note_added",
  },
  "tasks.create": {
    principal: () => asUser(owner),
    input: async () => ({
      matterId: (await openTestMatter(owner)).matterId,
      title: "Call the client",
      dueOn: "2026-11-02",
    }),
    expectAction: "tasks.created",
  },
  "tasks.set_status": {
    principal: () => asUser(owner),
    input: async () => {
      const m = await openTestMatter(owner);
      const t = (await run(createTask, asUser(owner), {
        matterId: m.matterId,
        title: "Finish this",
      })) as { taskId: string };
      return { taskId: t.taskId, status: "done" };
    },
    expectAction: "tasks.done",
  },
  "portal.reissue_link": {
    principal: () => asUser(owner),
    input: async () => ({ matterId: (await openTestMatter(owner)).matterId }),
    expectAction: "portal.link_reissued",
  },
  "documents.upload": {
    principal: () => asUser(owner),
    input: async () => storedPdf((await openTestMatter(owner)).matterId, NOTICE_PAGES),
    expectAction: "documents.uploaded",
  },
  "documents.apply_processing": {
    principal: () => SYSTEM,
    input: async () => {
      const m = await openTestMatter(owner);
      const up = (await run(
        recordUpload,
        asUser(owner),
        await storedPdf(m.matterId, [["A bank statement page", "Statement period August 2026"]]),
      )) as { documentId: string };
      return {
        documentId: up.documentId,
        read: {
          engine: "text_layer",
          pageCount: 1,
          unreadablePages: [],
          confidence: null,
          maskedText: "Statement period August 2026",
          missingPages: null,
        },
        classification: { docType: "bank_statement", confidence: 0.85, via: "rules" },
      };
    },
    expectAction: "documents.processed",
  },
  "documents.confirm_extraction": {
    principal: () => asUser(owner),
    input: async () => {
      const n = await processedNotice();
      const [ex] = await db()
        .select()
        .from(documentExtractions)
        .where(eq(documentExtractions.documentId, n.documentId));
      return { extractionId: ex!.id, fields: ex!.fields };
    },
    expectAction: "documents.extraction_confirmed",
  },
  "documents.set_type": {
    principal: () => asUser(owner),
    input: async () => ({
      documentId: (await processedNotice()).documentId,
      docType: "correspondence",
    }),
    expectAction: "documents.type_set",
  },
  "documents.share": {
    principal: () => asUser(owner),
    input: async () => ({ documentId: (await processedNotice()).documentId, shared: true }),
    expectAction: "documents.shared",
  },
  "documents.download": {
    principal: () => asUser(owner),
    input: async () => ({ documentId: (await documentFor((await processedNotice()).matterId)).id }),
    expectAction: "documents.downloaded",
  },
  "matters.apply_summary": {
    principal: () => SYSTEM,
    input: async () => ({
      matterId: (await openTestMatter(owner)).matterId,
      summary: "The matter is open.",
      timeline: [],
      aiRunId: null,
      trigger: "on_demand",
    }),
    expectAction: "matters.summary_updated",
  },
  "engagements.draft": {
    principal: () => asUser(owner),
    input: async () => {
      await prepareMessaging(owner);
      const l = await clearedLead(owner, "Drew");
      return {
        leadId: l.leadId,
        practiceArea: "tax",
        matterType: "notice_response",
        feeTerms: "Flat fee of $2,500 for the notice response.",
        signingUrl: SIGNING_URL,
        provider: "manual",
        envelopeId: null,
      };
    },
    expectAction: "engagements.drafted",
  },
  "engagements.mark_signed": {
    principal: () => asUser(owner),
    input: async () => {
      const e = await draftedEngagement("Morgan");
      await run(decideApproval, asUser(owner), { approvalId: e.approvalId, decision: "approve" });
      return { engagementId: e.engagementId };
    },
    expectAction: "engagements.signed",
  },
  "engagements.withdraw": {
    principal: () => asUser(owner),
    input: async () => ({
      engagementId: (await draftedEngagement("Jesse")).engagementId,
      reason: "Client chose another firm",
    }),
    expectAction: "engagements.withdrawn",
  },
  "engagements.remind": {
    principal: () => SYSTEM,
    input: async () => ({ engagementId: (await draftedEngagement("Riley")).engagementId }),
    expectAction: "engagements.reminders_checked",
  },
  "matters.close": {
    principal: () => asUser(owner),
    input: async () => ({
      matterId: (await openTestMatter(owner)).matterId,
      note: "Work complete",
    }),
    expectAction: "matters.closed",
  },
  "matters.draft_status_update": {
    principal: () => SYSTEM,
    input: async () => ({
      matterId: (await openTestMatter(owner)).matterId,
      reason: "stage_change",
      body: "Hi, a quick update on your matter.",
      aiRunId: null,
      findings: [],
    }),
    expectAction: "approvals.created",
  },
  "matters.apply_draft": {
    principal: () => SYSTEM,
    input: async () => ({
      matterId: (await openTestMatter(owner)).matterId,
      kind: "irs_response",
      body: "DRAFT. Skeleton.",
      aiRunId: null,
      requestedBy: owner.id,
    }),
    expectAction: "matters.draft_prepared",
  },
  "questionnaires.save": {
    principal: () => asUser(questionnaireClient!),
    input: async () => {
      const m = await openTestMatter(owner, {
        practiceArea: "estate",
        matterType: "estate_plan",
        first: "Quinn",
      });
      questionnaireClient = await clientUser(m.contactId);
      return {
        matterId: m.matterId,
        answers: { marital_status: "Married", children: "Two, ages 7 and 10" },
        submit: false,
      };
    },
    expectAction: "questionnaires.saved",
  },
  "matters.chase_documents": {
    principal: () => SYSTEM,
    input: async () => ({ matterId: (await openTestMatter(owner)).matterId }),
    expectAction: "matters.chase_checked",
  },
  "matters.flag_stalled": {
    principal: () => SYSTEM,
    input: async () => ({ matterId: (await openTestMatter(owner)).matterId }),
    expectAction: "matters.stall_checked",
  },
  "firm.engagement_template.update": {
    principal: () => asUser(owner),
    input: () => ({ template: "Dear {{clientName}}, please sign: {{signingUrl}}" }),
    expectAction: "firm.engagement_template.updated",
  },
};

let questionnaireClient: SessionUser | null = null;

describe("every command writes an audit row", () => {
  beforeAll(async () => {
    ({ owner, setupUrl: ownerSetupUrl } = await provisionTestFirm());
  });

  it("has a fixture for every registered command", () => {
    const missing = COMMANDS.map((c) => c.name).filter((name) => !FIXTURES[name]);
    expect(missing).toEqual([]);
  });

  for (const command of COMMANDS as readonly AnyCommand[]) {
    const fixture = FIXTURES[command.name];
    if (!fixture || fixture.needsEmptyDatabase) continue;

    it(`${command.name} -> ${fixture.expectAction}`, async () => {
      const input = await fixture.input();
      const [head] = await db()
        .select({ seq: auditLog.seq })
        .from(auditLog)
        .orderBy(desc(auditLog.seq))
        .limit(1);
      await run(command, fixture.principal(), input);
      const rows = await db()
        .select()
        .from(auditLog)
        .where(gt(auditLog.seq, head?.seq ?? 0))
        .orderBy(auditLog.seq);
      const row = rows.find((r) => r.action === fixture.expectAction);
      expect(row, `no ${fixture.expectAction} row`).toBeDefined();
      expect(row!.actorType).not.toBeNull();
      expect(row!.requestId).toBe("test-request");
      expect(row!.ip).toBe("203.0.113.10");
      expect(row!.entityType).not.toBeNull();
    });
  }

  it("firm.bootstrap is covered by provisionTestFirm (it wrote firm.provisioned)", async () => {
    const [row] = await db().select().from(auditLog).where(eq(auditLog.action, "firm.provisioned"));
    expect(row).toMatchObject({ actorType: "system", entityType: "firm_settings" });
  });
});

describe("denials and failures", () => {
  it("audits a permission denial and changes nothing", async () => {
    const intake: SessionUser = {
      id: owner.id,
      email: "intake@test-firm.example",
      name: "I",
      role: "intake",
      status: "active",
    };
    await expect(
      run(inviteUser, asUser(intake), {
        name: "Nope",
        email: "denied@test-firm.example",
        role: "paralegal",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const [row] = await db().select().from(auditLog).orderBy(desc(auditLog.seq)).limit(1);
    expect(row).toMatchObject({
      action: "access.denied",
      metadata: { command: "users.invite", permission: "users.invite" },
    });
    const created = await db()
      .select()
      .from(users)
      .where(eq(users.email, "denied@test-firm.example"));
    expect(created).toHaveLength(0);
  });

  it("rejects invalid input before touching the database", async () => {
    const before = await db()
      .select({ seq: auditLog.seq })
      .from(auditLog)
      .orderBy(desc(auditLog.seq))
      .limit(1);
    const err = await run(updateFirmSettings, asUser(owner), { legalName: "" }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CommandError);
    expect((err as CommandError).fieldErrors?.legalName).toBeDefined();
    const after = await db()
      .select({ seq: auditLog.seq })
      .from(auditLog)
      .orderBy(desc(auditLog.seq))
      .limit(1);
    expect(after[0]!.seq).toBe(before[0]!.seq);
  });

  it("users cannot run bootstrap", async () => {
    const bootstrap = COMMANDS.find((c) => c.name === "firm.bootstrap")!;
    await expect(
      run(bootstrap, asUser(owner), {
        slug: "x-firm",
        legalName: "X PLLC",
        displayName: "X Firm",
        practiceAreas: ["tax"],
        owner: { name: "Some One", email: "x@x.example" },
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("bootstrap refuses a database that already holds a firm", async () => {
    const bootstrap = COMMANDS.find((c) => c.name === "firm.bootstrap")!;
    await expect(
      run(bootstrap, SYSTEM, {
        slug: "x-firm",
        legalName: "X PLLC",
        displayName: "X Firm",
        practiceAreas: ["tax"],
        owner: { name: "Some One", email: "x@x.example" },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    const rows = await db().select().from(firmSettings);
    expect(rows).toHaveLength(1);
  });

  it("revoking sessions removes them", async () => {
    const remaining = await db().select().from(sessions).where(eq(sessions.userId, owner.id));
    expect(remaining).toHaveLength(0);
  });
});
