import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import {
  checklistItems,
  contacts,
  engagements,
  leads,
  matterParties,
  matters,
  notes,
  OPEN_LEAD_STATUSES,
  PARTY_ROLES,
  PRACTICE_AREAS,
  questionnaires,
  tasks,
  users,
  type MatterRow,
} from "@/db/schema";
import type { AuditSpec, Principal } from "@/lib/commands/define";
import { defineCommand } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";
import { maskText } from "@/lib/masking";
import { automationEnabled, recordAutomationRun } from "@/modules/messaging/commands/outbox";
import { issueSetupLink } from "@/modules/users/commands/setup-link";
import { matterType, stagesOf } from "@/practice";
import { firmToday, lockMatter, nextMatterNumber, scopeOf, typeOf } from "../scope";

/*
 * Matters (spec Sections 7 and 10). Attorneys act on matters they own or are
 * assigned to; paralegals on all matters; clients only read their own
 * (lib/auth/can.ts). Every change is audited by execute().
 */

const actorId = (p: Principal): string | null => (p.type === "user" ? p.user.id : null);

async function assertLawyer(tx: Tx, id: string): Promise<void> {
  const [u] = await tx
    .select({ role: users.role, status: users.status })
    .from(users)
    .where(eq(users.id, id));
  if (!u || u.status !== "active" || (u.role !== "owner_attorney" && u.role !== "attorney")) {
    throw new CommandError("validation", "Some fields need attention.", {
      responsibleAttorneyId: ["Choose an active attorney."],
    });
  }
}

async function assertStaff(tx: Tx, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, [...ids]), eq(users.status, "active"), isNull(users.deletedAt)));
  const staff = await tx
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(inArray(users.id, [...ids]));
  if (
    rows.length !== ids.length ||
    staff.some((s) => s.role === "client" || s.role === "vendor_support")
  ) {
    throw new CommandError("validation", "Some fields need attention.", {
      assignedUserIds: ["Choose active staff."],
    });
  }
}

export type PortalSetup =
  { userId: string; setupUrl: string; expiresAt: Date } | { skipped: string };

/**
 * B1: portal access and the document checklist for a new matter. The client
 * account gets a one-time setup link that is returned to the person who
 * opened the matter (never put in an automatic message: it is a credential).
 */
export async function setUpPortalAndChecklist(
  tx: Tx,
  matter: MatterRow,
  createdBy: string | null,
): Promise<{ audit: AuditSpec[]; portal: PortalSetup; checklist: number }> {
  const audit: AuditSpec[] = [];
  const t = typeOf(matter);
  const inserted = await tx
    .insert(checklistItems)
    .values(
      t.checklist.map((c) => ({
        matterId: matter.id,
        key: c.key,
        label: c.label,
        hint: c.hint ?? null,
        docType: c.docType,
        required: c.required,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: checklistItems.id });
  if (t.questionnaire) {
    await tx
      .insert(questionnaires)
      .values({ matterId: matter.id, kind: t.questionnaire })
      .onConflictDoNothing();
  }

  let portal: PortalSetup = { skipped: "already has portal access" };
  const [contact] = await tx.select().from(contacts).where(eq(contacts.id, matter.contactId));
  const [existing] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.contactId, matter.contactId), eq(users.role, "client"), isNull(users.deletedAt)),
    );
  if (!existing) {
    const email = contact?.email?.trim().toLowerCase();
    const [taken] = email
      ? await tx.select({ id: users.id }).from(users).where(eq(users.email, email))
      : [];
    if (!email) portal = { skipped: "no email address for the client" };
    else if (taken) portal = { skipped: "the client's email already belongs to another account" };
    else {
      const [u] = await tx
        .insert(users)
        .values({
          name: contact?.fullName ?? email,
          email,
          role: "client",
          status: "active",
          contactId: matter.contactId,
        })
        .returning({ id: users.id });
      const link = await issueSetupLink(tx, u!.id, createdBy);
      portal = { userId: u!.id, setupUrl: link.url, expiresAt: link.expiresAt };
      audit.push({
        action: "portal.client_invited",
        entityType: "user",
        entityId: u!.id,
        after: { role: "client", matterId: matter.id },
        metadata: { setupLinkId: link.inviteId, expiresAt: link.expiresAt.toISOString() },
      });
    }
    if ("skipped" in portal) {
      await tx
        .insert(tasks)
        .values({
          matterId: matter.id,
          title: `Set up portal access: ${portal.skipped}`,
          assigneeId: matter.responsibleAttorneyId,
          automationId: "B1",
          dedupeKey: `B1:portal:${matter.id}`,
        })
        .onConflictDoNothing();
    }
  }
  await recordAutomationRun(tx, {
    automationId: "B1",
    trigger: "matter_opened",
    status: "succeeded",
    entityType: "matter",
    entityId: matter.id,
    detail: {
      checklist: inserted.length,
      portal: "skipped" in portal ? portal.skipped : "invited",
    },
  });
  audit.push({
    action: "matters.checklist_created",
    entityType: "matter",
    entityId: matter.id,
    after: { items: inserted.length },
  });
  return { audit, portal, checklist: inserted.length };
}

const partyInput = z.object({
  name: z.string().trim().min(2).max(200),
  kind: z.enum(["person", "organization"]),
  role: z.enum(PARTY_ROLES),
});

export async function openMatterTx(
  ctx: { tx: Tx; authorize: (a: "matters.write") => void },
  input: {
    leadId?: string | null;
    contactId?: string | null;
    practiceArea: (typeof PRACTICE_AREAS)[number];
    matterType: string;
    title?: string | null;
    responsibleAttorneyId?: string | null;
    parties?: z.infer<typeof partyInput>[];
  },
  createdBy: string | null,
) {
  const tx = ctx.tx;
  const t = matterType(input.practiceArea, input.matterType);
  if (!t)
    throw new CommandError("validation", "Some fields need attention.", {
      matterType: ["Choose a matter type for this practice area."],
    });
  const [lead] = input.leadId
    ? await tx.select().from(leads).where(eq(leads.id, input.leadId)).for("update")
    : [];
  if (input.leadId && !lead) throw new CommandError("not_found", "Lead not found.");
  const contactId = lead?.contactId ?? input.contactId;
  if (!contactId)
    throw new CommandError("validation", "Some fields need attention.", {
      contactId: ["Choose the client."],
    });
  if (lead) {
    const [already] = await tx
      .select({ id: matters.id, number: matters.number })
      .from(matters)
      .where(eq(matters.leadId, lead.id));
    if (already)
      throw new CommandError("conflict", `This lead already has matter ${already.number}.`);
  }
  const [contact] = await tx.select().from(contacts).where(eq(contacts.id, contactId));
  if (!contact) throw new CommandError("not_found", "Client contact not found.");
  const responsible = input.responsibleAttorneyId ?? lead?.assignedUserId ?? createdBy;
  if (responsible) await assertLawyer(tx, responsible);

  const now = new Date();
  const [m] = await tx
    .insert(matters)
    .values({
      number: await nextMatterNumber(tx),
      title:
        input.title?.trim() || `${t.label}: ${contact.fullName ?? contact.companyName ?? "client"}`,
      contactId,
      leadId: lead?.id ?? null,
      practiceArea: input.practiceArea,
      matterType: t.key,
      stage: stagesOf(t)[0]!.key,
      responsibleAttorneyId: responsible,
      openedAt: now,
    })
    .returning();
  if (!m) throw new Error("matter insert returned no row");
  await tx.insert(matterParties).values([
    {
      matterId: m.id,
      name: contact.fullName ?? contact.companyName ?? "Client",
      kind: contact.fullName ? ("person" as const) : ("organization" as const),
      role: "client" as const,
      contactId,
    },
    ...(input.parties ?? []).map((p) => ({ matterId: m.id, ...p })),
  ]);
  const audit: AuditSpec[] = [
    {
      action: "matters.opened",
      entityType: "matter",
      entityId: m.id,
      after: {
        number: m.number,
        practiceArea: m.practiceArea,
        matterType: m.matterType,
        responsibleAttorneyId: responsible,
        leadId: m.leadId,
      },
    },
  ];
  if (lead && (OPEN_LEAD_STATUSES as readonly string[]).includes(lead.status)) {
    await tx
      .update(leads)
      .set({ status: "retained", retainedAt: lead.retainedAt ?? now, updatedAt: now })
      .where(eq(leads.id, lead.id));
    audit.push({
      action: "leads.retained",
      entityType: "lead",
      entityId: lead.id,
      before: { status: lead.status },
      after: { status: "retained", matterId: m.id },
    });
  }
  if (lead)
    await tx
      .update(engagements)
      .set({ matterId: m.id, updatedAt: now })
      .where(eq(engagements.leadId, lead.id));
  let portal: PortalSetup | null = null;
  if (await automationEnabled(tx, "B1")) {
    const b1 = await setUpPortalAndChecklist(tx, m, createdBy);
    audit.push(...b1.audit);
    portal = b1.portal;
  }
  return { matter: m, portal, audit: audit as [AuditSpec, ...AuditSpec[]] };
}

export const openMatter = defineCommand({
  name: "matters.open",
  permission: "matters.write",
  input: z.object({
    leadId: z.uuid().optional(),
    contactId: z.uuid().optional(),
    practiceArea: z.enum(PRACTICE_AREAS),
    matterType: z.string().min(1).max(60),
    title: z.string().trim().max(200).optional(),
    responsibleAttorneyId: z.uuid().optional(),
    parties: z.array(partyInput).max(50).optional(),
  }),
  async run(ctx, input) {
    const r = await openMatterTx(ctx, input, actorId(ctx.principal));
    return {
      result: { matterId: r.matter.id, number: r.matter.number, portal: r.portal },
      audit: r.audit,
    };
  },
});

export const changeStage = defineCommand({
  name: "matters.change_stage",
  permission: "matters.write",
  input: z.object({ matterId: z.uuid(), stage: z.string().min(1).max(60) }),
  async run(ctx, input) {
    const m = await lockMatter(ctx.tx, input.matterId);
    ctx.authorize("matters.write", { resource: await scopeOf(ctx.tx, m) });
    if (m.status === "closed") throw new CommandError("invalid_state", "This matter is closed.");
    const stages = stagesOf(typeOf(m));
    if (input.stage === "closed")
      throw new CommandError("validation", "Use Close matter to close it.");
    if (!stages.some((s) => s.key === input.stage)) {
      throw new CommandError("validation", "Some fields need attention.", {
        stage: ["Not a stage of this matter type."],
      });
    }
    if (m.stage === input.stage) {
      return {
        result: { changed: false, b6: false },
        audit: [{ action: "matters.stage_unchanged", entityType: "matter", entityId: m.id }],
      };
    }
    const now = new Date();
    await ctx.tx
      .update(matters)
      .set({ stage: input.stage, stageChangedAt: now, updatedAt: now })
      .where(eq(matters.id, m.id));
    return {
      // B6 drafts a client update after commit (it calls a model).
      result: { changed: true, b6: await automationEnabled(ctx.tx, "B6") },
      audit: [
        {
          action: "matters.stage_changed",
          entityType: "matter",
          entityId: m.id,
          before: { stage: m.stage },
          after: { stage: input.stage },
        },
      ],
    };
  },
});

export const assignMatter = defineCommand({
  name: "matters.assign",
  permission: "matters.write",
  input: z.object({
    matterId: z.uuid(),
    responsibleAttorneyId: z.uuid(),
    assignedUserIds: z.array(z.uuid()).max(20),
  }),
  async run(ctx, input) {
    const m = await lockMatter(ctx.tx, input.matterId);
    ctx.authorize("matters.write", { resource: await scopeOf(ctx.tx, m) });
    await assertLawyer(ctx.tx, input.responsibleAttorneyId);
    const assigned = [...new Set(input.assignedUserIds)].filter(
      (id) => id !== input.responsibleAttorneyId,
    );
    await assertStaff(ctx.tx, assigned);
    await ctx.tx
      .update(matters)
      .set({
        responsibleAttorneyId: input.responsibleAttorneyId,
        assignedUserIds: assigned,
        updatedAt: new Date(),
      })
      .where(eq(matters.id, m.id));
    return {
      result: { updated: true },
      audit: [
        {
          action: "matters.assigned",
          entityType: "matter",
          entityId: m.id,
          before: {
            responsibleAttorneyId: m.responsibleAttorneyId,
            assignedUserIds: m.assignedUserIds,
          },
          after: { responsibleAttorneyId: input.responsibleAttorneyId, assignedUserIds: assigned },
        },
      ],
    };
  },
});

export const addParty = defineCommand({
  name: "matters.party_add",
  permission: "matters.write",
  input: partyInput.extend({ matterId: z.uuid() }),
  async run(ctx, input) {
    const m = await lockMatter(ctx.tx, input.matterId);
    ctx.authorize("matters.write", { resource: await scopeOf(ctx.tx, m) });
    const { matterId, ...party } = input;
    const [p] = await ctx.tx
      .insert(matterParties)
      .values({ matterId, ...party })
      .returning({ id: matterParties.id });
    return {
      result: { partyId: p!.id },
      audit: [
        {
          action: "matters.party_added",
          entityType: "matter",
          entityId: m.id,
          after: { role: party.role, kind: party.kind },
        },
      ],
    };
  },
});

export const removeParty = defineCommand({
  name: "matters.party_remove",
  permission: "matters.write",
  input: z.object({ partyId: z.uuid() }),
  async run(ctx, input) {
    const [p] = await ctx.tx
      .select()
      .from(matterParties)
      .where(and(eq(matterParties.id, input.partyId), isNull(matterParties.deletedAt)));
    if (!p) throw new CommandError("not_found", "Party not found.");
    if (p.role === "client")
      throw new CommandError(
        "invalid_state",
        "The client cannot be removed from their own matter.",
      );
    const m = await lockMatter(ctx.tx, p.matterId);
    ctx.authorize("matters.write", { resource: await scopeOf(ctx.tx, m) });
    await ctx.tx
      .update(matterParties)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(matterParties.id, p.id));
    return {
      result: { removed: true },
      audit: [
        {
          action: "matters.party_removed",
          entityType: "matter",
          entityId: m.id,
          before: { name: p.name, role: p.role },
        },
      ],
    };
  },
});

export const addNote = defineCommand({
  name: "matters.note_add",
  permission: "matters.write",
  input: z.object({ matterId: z.uuid(), body: z.string().trim().min(1).max(20_000) }),
  async run(ctx, input) {
    const m = await lockMatter(ctx.tx, input.matterId);
    ctx.authorize("matters.write", { resource: await scopeOf(ctx.tx, m) });
    // Rule 6: identifiers typed into a note are masked before storage.
    const masked = maskText(input.body);
    const [n] = await ctx.tx
      .insert(notes)
      .values({ matterId: m.id, authorId: actorId(ctx.principal), body: masked.text })
      .returning({ id: notes.id });
    return {
      result: { noteId: n!.id, masked: Object.keys(masked.found).length > 0 },
      audit: [
        {
          action: "matters.note_added",
          entityType: "matter",
          entityId: m.id,
          metadata: { noteId: n!.id, masked: masked.found },
        },
      ],
    };
  },
});

const dateOnly = z.iso.date();

export const createTask = defineCommand({
  name: "tasks.create",
  permission: "matters.write",
  input: z.object({
    matterId: z.uuid(),
    title: z.string().trim().min(2).max(200),
    detail: z.string().trim().max(5_000).optional(),
    dueOn: dateOnly.optional(),
    assigneeId: z.uuid().optional(),
    priority: z.enum(["urgent", "normal"]).default("normal"),
  }),
  async run(ctx, input) {
    const m = await lockMatter(ctx.tx, input.matterId);
    ctx.authorize("matters.write", { resource: await scopeOf(ctx.tx, m) });
    if (input.assigneeId) await assertStaff(ctx.tx, [input.assigneeId]);
    const [t] = await ctx.tx
      .insert(tasks)
      .values({
        matterId: m.id,
        title: maskText(input.title).text,
        detail: input.detail ? maskText(input.detail).text : null,
        dueOn: input.dueOn ?? null,
        assigneeId: input.assigneeId ?? null,
        priority: input.priority,
        createdBy: actorId(ctx.principal),
      })
      .returning({ id: tasks.id });
    return {
      result: { taskId: t!.id },
      audit: [
        {
          action: "tasks.created",
          entityType: "task",
          entityId: t!.id,
          after: {
            matterId: m.id,
            dueOn: input.dueOn ?? null,
            assigneeId: input.assigneeId ?? null,
          },
        },
      ],
    };
  },
});

export const setTaskStatus = defineCommand({
  name: "tasks.set_status",
  permission: "matters.write",
  input: z.object({ taskId: z.uuid(), status: z.enum(["open", "done", "cancelled"]) }),
  async run(ctx, input) {
    const [t] = await ctx.tx.select().from(tasks).where(eq(tasks.id, input.taskId)).for("update");
    if (!t) throw new CommandError("not_found", "Task not found.");
    if (t.matterId) {
      const m = await lockMatter(ctx.tx, t.matterId);
      ctx.authorize("matters.write", { resource: await scopeOf(ctx.tx, m) });
    }
    const now = new Date();
    const done = input.status === "done";
    await ctx.tx
      .update(tasks)
      .set({
        status: input.status,
        completedAt: done ? now : null,
        completedBy: done ? actorId(ctx.principal) : null,
        updatedAt: now,
      })
      .where(eq(tasks.id, t.id));
    return {
      result: { updated: true },
      audit: [
        {
          action: `tasks.${input.status === "open" ? "reopened" : input.status}`,
          entityType: "task",
          entityId: t.id,
          before: { status: t.status },
          after: { status: input.status },
        },
      ],
    };
  },
});

/** Re-issues a client's portal setup link (lost email, expired link). Shown once to the caller. */
export const reissuePortalLink = defineCommand({
  name: "portal.reissue_link",
  permission: "matters.write",
  input: z.object({ matterId: z.uuid() }),
  async run(ctx, input) {
    const m = await lockMatter(ctx.tx, input.matterId);
    ctx.authorize("matters.write", { resource: await scopeOf(ctx.tx, m) });
    const [u] = await ctx.tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.contactId, m.contactId), eq(users.role, "client"), isNull(users.deletedAt)),
      );
    if (!u) {
      const b1 = await setUpPortalAndChecklist(ctx.tx, m, actorId(ctx.principal));
      const [first, ...rest] = b1.audit;
      return { result: { portal: b1.portal }, audit: [first!, ...rest] };
    }
    const link = await issueSetupLink(ctx.tx, u.id, actorId(ctx.principal));
    return {
      result: {
        portal: { userId: u.id, setupUrl: link.url, expiresAt: link.expiresAt } as PortalSetup,
      },
      audit: [
        {
          action: "portal.link_reissued",
          entityType: "user",
          entityId: u.id,
          metadata: { matterId: m.id, setupLinkId: link.inviteId },
        },
      ],
    };
  },
});

export { firmToday };
