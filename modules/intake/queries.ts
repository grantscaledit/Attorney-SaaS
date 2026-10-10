import "server-only";
import { and, asc, desc, eq, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import {
  appointments,
  calls,
  consents,
  contacts,
  LEAD_STATUSES,
  leads,
  leadTouches,
  messages,
  metricsLeadFacts,
  opportunities,
} from "@/db/schema";
import { assertCan, type Actor } from "@/lib/auth/can";
import {
  intakeBreakdown,
  intakeMetrics,
  lastDays,
  previousPeriod,
  type Breakdown,
  type IntakeMetrics,
  type Period,
} from "@/modules/metrics/definitions";

/** Statuses where the firm still owes the person a reply (top bar "Unanswered leads"). */
const AWAITING_REPLY = ["new", "contacted"] as const;

/**
 * Open enquiries no person at the firm has replied to yet. Automatic
 * acknowledgements do not count as an answer; a booked consult does.
 */
const unanswered = and(
  inArray(leads.status, [...AWAITING_REPLY]),
  isNull(leads.firstHumanResponseAt),
  isNull(leads.deletedAt),
);

export async function unansweredLeadCount(actor: Actor): Promise<number> {
  assertCan(actor, "leads.read");
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(unanswered);
  return r?.n ?? 0;
}

export const PERIODS = [7, 30, 90] as const;
export const periodSchema = z.coerce
  .number()
  .refine((n) => (PERIODS as readonly number[]).includes(n))
  .catch(30);

export type IntakeDashboard = {
  period: Period;
  days: number;
  current: IntakeMetrics;
  previous: IntakeMetrics;
  bySource: Breakdown[];
  byPracticeArea: Breakdown[];
};

export async function intakeDashboard(actor: Actor, days: number): Promise<IntakeDashboard> {
  assertCan(actor, "leads.read");
  const db = getDb();
  const period = lastDays(days);
  const [current, previous, bySource, byPracticeArea] = await Promise.all([
    intakeMetrics(db, period),
    intakeMetrics(db, previousPeriod(period)),
    intakeBreakdown(db, period, "source"),
    intakeBreakdown(db, period, "practice_area"),
  ]);
  return { period, days, current, previous, bySource, byPracticeArea };
}

export const leadFilterSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional().catch(undefined),
  source: z.string().max(50).optional().catch(undefined),
  practiceArea: z.string().max(20).optional().catch(undefined),
  view: z
    .enum(["unanswered", "missed", "recovered", "booked", "retained"])
    .optional()
    .catch(undefined),
  days: z.coerce.number().int().min(1).max(366).optional().catch(undefined),
  before: z.iso.datetime().optional().catch(undefined),
});
export type LeadFilters = z.infer<typeof leadFilterSchema>;

export type LeadListItem = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: (typeof LEAD_STATUSES)[number];
  channel: string;
  practiceArea: string | null;
  missedCall: boolean;
  recovered: boolean;
  firstInboundAt: Date;
  firstResponseSeconds: number | null;
  firstHumanResponseAt: Date | null;
  source: string;
};

const PAGE = 50;

export async function listLeads(
  actor: Actor,
  filters: LeadFilters,
): Promise<{ rows: LeadListItem[]; nextBefore: string | null }> {
  assertCan(actor, "leads.read");
  const f = metricsLeadFacts;
  const where: SQL[] = [];
  if (filters.status) where.push(eq(f.status, filters.status));
  if (filters.source) where.push(eq(f.firstTouchSource, filters.source));
  if (filters.practiceArea) {
    where.push(
      filters.practiceArea === "unassigned"
        ? isNull(f.practiceArea)
        : sql`${f.practiceArea} = ${filters.practiceArea}`,
    );
  }
  if (filters.days)
    where.push(sql`${f.firstInboundAt} >= now() - make_interval(days => ${filters.days})`);
  if (filters.before) where.push(lt(f.firstInboundAt, new Date(filters.before)));
  switch (filters.view) {
    case "unanswered":
      where.push(sql`${f.status} in ('new', 'contacted') and ${f.firstHumanResponseAt} is null`);
      break;
    case "missed":
      where.push(eq(f.missedCall, true));
      break;
    case "recovered":
      where.push(eq(f.recovered, true));
      break;
    case "booked":
      where.push(sql`${f.consultBookedAt} is not null`);
      break;
    case "retained":
      where.push(sql`${f.retainedAt} is not null`);
      break;
  }

  const rows = await getDb()
    .select({
      id: f.leadId,
      name: contacts.fullName,
      phone: contacts.phone,
      email: contacts.email,
      status: f.status,
      channel: f.channel,
      practiceArea: f.practiceArea,
      missedCall: f.missedCall,
      recovered: f.recovered,
      firstInboundAt: f.firstInboundAt,
      firstResponseSeconds: f.firstResponseSeconds,
      firstHumanResponseAt: f.firstHumanResponseAt,
      source: f.firstTouchSource,
    })
    .from(f)
    .innerJoin(contacts, eq(contacts.id, f.contactId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(f.firstInboundAt))
    .limit(PAGE + 1);

  const page = rows.slice(0, PAGE);
  return {
    rows: page,
    nextBefore: rows.length > PAGE ? page.at(-1)!.firstInboundAt.toISOString() : null,
  };
}

export async function leadDetail(actor: Actor, leadId: string) {
  assertCan(actor, "leads.read");
  if (!z.uuid().safeParse(leadId).success) return null;
  const db = getDb();
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), isNull(leads.deletedAt)));
  if (!lead) return null;

  const [[contact], touches, callRows, messageRows, appointmentRows, opportunity, consentRows] =
    await Promise.all([
      db.select().from(contacts).where(eq(contacts.id, lead.contactId)),
      db
        .select()
        .from(leadTouches)
        .where(eq(leadTouches.leadId, lead.id))
        .orderBy(asc(leadTouches.occurredAt)),
      db.select().from(calls).where(eq(calls.leadId, lead.id)).orderBy(asc(calls.occurredAt)),
      db
        .select()
        .from(messages)
        .where(eq(messages.leadId, lead.id))
        .orderBy(
          asc(
            sql`coalesce(${messages.sentAt}, ${messages.occurredAt}, ${messages.scheduledFor}, ${messages.createdAt})`,
          ),
        ),
      db
        .select()
        .from(appointments)
        .where(and(eq(appointments.leadId, lead.id), isNull(appointments.deletedAt)))
        .orderBy(asc(appointments.startsAt)),
      lead.opportunityId
        ? db.select().from(opportunities).where(eq(opportunities.id, lead.opportunityId))
        : Promise.resolve([]),
      db
        .select()
        .from(consents)
        .where(eq(consents.contactId, lead.contactId))
        .orderBy(desc(consents.capturedAt)),
    ]);

  return {
    lead,
    contact: contact ?? null,
    touches,
    calls: callRows,
    messages: messageRows,
    appointments: appointmentRows,
    opportunity: opportunity[0] ?? null,
    consents: consentRows,
  };
}

export type LeadDetail = NonNullable<Awaited<ReturnType<typeof leadDetail>>>;
