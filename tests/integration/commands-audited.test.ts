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
};

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
