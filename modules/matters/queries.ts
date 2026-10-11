import "server-only";
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import {
  approvals,
  checklistItems,
  contacts,
  documentExtractions,
  documents,
  engagements,
  matterParties,
  matters,
  notes,
  questionnaires,
  tasks,
  users,
  type MatterRow,
} from "@/db/schema";
import { assertCan, can, type Actor } from "@/lib/auth/can";
import { pipelineMetrics } from "@/modules/metrics/definitions";
import { matterType, stagesOf } from "@/practice";
import { scopeOf, stageLabel } from "./scope";

/*
 * Matter reads. Visibility follows lib/auth/can.ts: owner attorneys and
 * paralegals see every matter, attorneys their own and assigned matters,
 * clients (portal) only matters for their own contact. Row filtering happens
 * here in SQL as well as through can(), so a list never leaks a row.
 */

/** SQL condition limiting matters to what the actor may see, or null for all. */
async function visibility(actor: Actor): Promise<SQL | null> {
  if (actor.role === "owner_attorney" || actor.role === "paralegal") return null;
  if (actor.role === "attorney") {
    return or(
      eq(matters.responsibleAttorneyId, actor.id),
      sql`${actor.id} = any(${matters.assignedUserIds})`,
    )!;
  }
  if (actor.role === "client") {
    const [u] = await getDb()
      .select({ contactId: users.contactId })
      .from(users)
      .where(eq(users.id, actor.id));
    return u?.contactId ? eq(matters.contactId, u.contactId) : sql`false`;
  }
  return sql`false`;
}

export const matterFilterSchema = z.object({
  status: z.enum(["open", "closed"]).optional().default("open"),
  practiceArea: z.enum(["tax", "business", "estate"]).optional(),
  stage: z.string().max(60).optional(),
  view: z.enum(["stalled", "waiting_on_client", "mine"]).optional(),
});
export type MatterFilters = z.infer<typeof matterFilterSchema>;

export type MatterListItem = {
  id: string;
  number: string;
  title: string;
  clientName: string | null;
  practiceArea: MatterRow["practiceArea"];
  typeLabel: string;
  stage: string;
  stageLabel: string;
  daysInStage: number;
  thresholdDays: number | null;
  stalled: boolean;
  waitingOnClient: boolean;
  responsibleName: string | null;
  openTasks: number;
  checklistOpen: number;
  openedAt: Date;
};

const DAY = 86_400_000;

export function stageFacts(
  m: Pick<MatterRow, "practiceArea" | "matterType" | "stage" | "stageChangedAt" | "status">,
  now = Date.now(),
) {
  const t = matterType(m.practiceArea, m.matterType);
  const s = t ? stagesOf(t).find((x) => x.key === m.stage) : undefined;
  const daysInStage = Math.floor((now - m.stageChangedAt.getTime()) / DAY);
  const thresholdDays = s?.thresholdDays ?? null;
  return {
    typeLabel: t?.label ?? m.matterType,
    daysInStage,
    thresholdDays,
    stalled: m.status === "open" && thresholdDays !== null && daysInStage > thresholdDays,
    waitingOnClient: m.status === "open" && Boolean(s?.waitingOnClient),
  };
}

export async function listMatters(actor: Actor, filters: MatterFilters): Promise<MatterListItem[]> {
  assertCan(actor, "matters.read");
  const where: SQL[] = [isNull(matters.deletedAt), eq(matters.status, filters.status)];
  const vis = await visibility(actor);
  if (vis) where.push(vis);
  if (filters.practiceArea) where.push(eq(matters.practiceArea, filters.practiceArea));
  if (filters.stage) where.push(eq(matters.stage, filters.stage));
  if (filters.view === "mine") {
    where.push(
      or(
        eq(matters.responsibleAttorneyId, actor.id),
        sql`${actor.id} = any(${matters.assignedUserIds})`,
      )!,
    );
  }
  const rows = await getDb()
    .select({
      m: matters,
      clientName: contacts.fullName,
      company: contacts.companyName,
      responsibleName: users.name,
      openTasks: sql<number>`(select count(*)::int from tasks t where t.matter_id = ${matters.id} and t.status = 'open')`,
      checklistOpen: sql<number>`(select count(*)::int from checklist_items c where c.matter_id = ${matters.id} and c.status = 'requested')`,
    })
    .from(matters)
    .innerJoin(contacts, eq(contacts.id, matters.contactId))
    .leftJoin(users, eq(users.id, matters.responsibleAttorneyId))
    .where(and(...where))
    .orderBy(desc(matters.openedAt))
    .limit(500);
  const items = rows.map((r) => {
    const f = stageFacts(r.m);
    return {
      id: r.m.id,
      number: r.m.number,
      title: r.m.title,
      clientName: r.clientName ?? r.company,
      practiceArea: r.m.practiceArea,
      typeLabel: f.typeLabel,
      stage: r.m.stage,
      stageLabel: stageLabel(r.m),
      daysInStage: f.daysInStage,
      thresholdDays: f.thresholdDays,
      stalled: f.stalled,
      waitingOnClient: f.waitingOnClient,
      responsibleName: r.responsibleName,
      openTasks: r.openTasks,
      checklistOpen: r.checklistOpen,
      openedAt: r.m.openedAt,
    };
  });
  if (filters.view === "stalled") return items.filter((i) => i.stalled);
  if (filters.view === "waiting_on_client") return items.filter((i) => i.waitingOnClient);
  return items;
}

/** Everything the staff matter page shows, or null when the actor may not see the matter. */
export async function matterDetail(actor: Actor, matterId: string) {
  assertCan(actor, "matters.read");
  if (actor.role === "client") return null;
  if (!z.uuid().safeParse(matterId).success) return null;
  const db = getDb();
  const [m] = await db
    .select()
    .from(matters)
    .where(and(eq(matters.id, matterId), isNull(matters.deletedAt)));
  if (!m) return null;
  const scope = await scopeOf(db, m);
  if (!can(actor, "matters.read", { resource: scope })) return null;
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, m.contactId));
  const [
    parties,
    taskRows,
    noteRows,
    docRows,
    checklist,
    extractions,
    drafts,
    staff,
    q,
    engagement,
  ] = await Promise.all([
    db
      .select()
      .from(matterParties)
      .where(and(eq(matterParties.matterId, m.id), isNull(matterParties.deletedAt)))
      .orderBy(asc(matterParties.createdAt)),
    db
      .select()
      .from(tasks)
      .where(eq(tasks.matterId, m.id))
      .orderBy(asc(tasks.status), asc(tasks.dueOn), desc(tasks.createdAt)),
    db
      .select({ id: notes.id, body: notes.body, createdAt: notes.createdAt, author: users.name })
      .from(notes)
      .leftJoin(users, eq(users.id, notes.authorId))
      .where(eq(notes.matterId, m.id))
      .orderBy(desc(notes.createdAt)),
    db
      .select()
      .from(documents)
      .where(and(eq(documents.matterId, m.id), isNull(documents.deletedAt)))
      .orderBy(desc(documents.createdAt)),
    db
      .select()
      .from(checklistItems)
      .where(eq(checklistItems.matterId, m.id))
      .orderBy(asc(checklistItems.createdAt)),
    db
      .select({ ex: documentExtractions })
      .from(documentExtractions)
      .innerJoin(documents, eq(documents.id, documentExtractions.documentId))
      .where(eq(documents.matterId, m.id)),
    can(actor, "approvals.read")
      ? db
          .select({
            id: approvals.id,
            automationId: approvals.automationId,
            kind: approvals.kind,
            status: approvals.status,
            title: approvals.title,
            createdAt: approvals.createdAt,
          })
          .from(approvals)
          .where(eq(approvals.matterId, m.id))
          .orderBy(desc(approvals.createdAt))
          .limit(30)
      : Promise.resolve([]),
    db
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(
        and(
          inArray(users.role, ["owner_attorney", "attorney", "paralegal"]),
          eq(users.status, "active"),
          isNull(users.deletedAt),
        ),
      )
      .orderBy(asc(users.name)),
    db.select().from(questionnaires).where(eq(questionnaires.matterId, m.id)),
    m.leadId
      ? db.select().from(engagements).where(eq(engagements.leadId, m.leadId))
      : Promise.resolve([]),
  ]);
  const t = matterType(m.practiceArea, m.matterType);
  return {
    matter: m,
    facts: stageFacts(m),
    stages: t ? stagesOf(t) : [],
    contact: contact ?? null,
    parties,
    tasks: taskRows,
    notes: noteRows,
    documents: docRows,
    checklist,
    extractions: new Map(extractions.map((e) => [e.ex.documentId, e.ex])),
    drafts,
    staff,
    questionnaire: q[0] ?? null,
    engagement: engagement[0] ?? null,
    portalUserIds: scope.clientUserIds ?? [],
    canWrite: can(actor, "matters.write", { resource: scope }),
    canDraft: can(actor, "drafts.write", { resource: scope }),
  };
}
export type MatterDetail = NonNullable<Awaited<ReturnType<typeof matterDetail>>>;

// ------------------------------------------------------------- portal --

/** A client's own matters. Nothing internal: no notes, tasks, drafts or unshared documents. */
export async function portalMatters(actor: Actor) {
  assertCan(actor, "portal.access");
  const vis = await visibility(actor);
  const rows = await getDb()
    .select()
    .from(matters)
    .where(and(isNull(matters.deletedAt), vis ?? sql`false`))
    .orderBy(desc(matters.openedAt));
  return rows.map((m) => ({
    id: m.id,
    number: m.number,
    title: m.title,
    stageLabel: stageLabel(m),
    status: m.status,
    openedAt: m.openedAt,
  }));
}

export async function portalMatter(actor: Actor, matterId: string) {
  assertCan(actor, "portal.access");
  if (!z.uuid().safeParse(matterId).success) return null;
  const db = getDb();
  const [m] = await db
    .select()
    .from(matters)
    .where(and(eq(matters.id, matterId), isNull(matters.deletedAt)));
  if (!m || !can(actor, "matters.read", { resource: await scopeOf(db, m) })) return null;
  const [checklist, docs, q] = await Promise.all([
    db
      .select({
        id: checklistItems.id,
        label: checklistItems.label,
        hint: checklistItems.hint,
        required: checklistItems.required,
        status: checklistItems.status,
      })
      .from(checklistItems)
      .where(
        and(
          eq(checklistItems.matterId, m.id),
          inArray(checklistItems.status, ["requested", "received"]),
        ),
      )
      .orderBy(asc(checklistItems.createdAt)),
    db
      .select({
        id: documents.id,
        displayName: documents.displayName,
        createdAt: documents.createdAt,
        uploadedVia: documents.uploadedVia,
      })
      .from(documents)
      .where(
        and(
          eq(documents.matterId, m.id),
          eq(documents.sharedWithClient, true),
          eq(documents.isDraft, false),
          isNull(documents.deletedAt),
        ),
      )
      .orderBy(desc(documents.createdAt)),
    db
      .select({ status: questionnaires.status, answers: questionnaires.answers })
      .from(questionnaires)
      .where(eq(questionnaires.matterId, m.id)),
  ]);
  return {
    id: m.id,
    number: m.number,
    title: m.title,
    status: m.status,
    stageLabel: stageLabel(m),
    stages: (() => {
      const t = matterType(m.practiceArea, m.matterType);
      return t
        ? stagesOf(t).map((s) => ({ key: s.key, label: s.label, current: s.key === m.stage }))
        : [];
    })(),
    checklist,
    documents: docs,
    questionnaire: q[0]
      ? { status: q[0].status, answers: q[0].answers as Record<string, string> }
      : null,
  };
}
export type PortalMatter = NonNullable<Awaited<ReturnType<typeof portalMatter>>>;

/** Pipeline panel numbers, from the shared definitions (modules/metrics). */
export async function pipeline(actor: Actor) {
  assertCan(actor, "matters.read");
  if (actor.role === "client") throw new Error("not for portal users");
  return pipelineMetrics(getDb(), (m) =>
    stageFacts({
      practiceArea: m.practiceArea as MatterRow["practiceArea"],
      matterType: m.matterType,
      stage: m.stage,
      status: "open",
      stageChangedAt: new Date(Date.now() - m.daysInStage * DAY),
    }),
  );
}
