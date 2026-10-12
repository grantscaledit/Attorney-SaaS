import "server-only";
import { and, asc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  calendarFeeds,
  deadlineAlerts,
  deadlineHolidays,
  deadlineRules,
  deadlineTolling,
  deadlines,
  matterEvents,
  matters,
  paymentPlans,
  users,
  type DeadlineRow,
  type MatterRow,
} from "@/db/schema";
import { assertCan, can, type Actor } from "@/lib/auth/can";
import { env } from "@/lib/env";
import { hasFeature } from "@/lib/flags";
import { firmToday, scopeOf } from "@/modules/matters/scope";
import { matterVisibility } from "@/modules/matters/queries";
import { deadlineCounts } from "@/modules/metrics/definitions";
import { allRuleSeeds, eventsFor, paramsOfSeed } from "@/practice";
import { addDays, weekday } from "./date-math";
import { ruleHash, rulesForEvent, verificationOf } from "./engine";
import { feedTokenHash } from "./commands/calendar";
import { renderCalendar, type FeedEvent } from "./ics";
import { deadlineAuditReport } from "./report";
import { DEADLINE_NOTICE, hashOfRow, stateOf } from "./rules";

/*
 * Deadline reads. Visibility is the matter's (lib/auth/can.ts, deadlines.read):
 * owner attorneys and paralegals see every matter's deadlines, attorneys
 * their own and assigned matters. Rows are filtered in SQL as well.
 */

const ONE_YEAR = 366;

export async function deadlinesInSevenDays(actor: Actor): Promise<number> {
  assertCan(actor, "deadlines.read");
  const c = await deadlineCounts(getDb(), firmToday(), await matterVisibility(actor));
  return c.windows["7"].critical + c.windows["7"].high + c.windows["7"].normal;
}

export type PanelDeadline = {
  d: DeadlineRow;
  matter: Pick<MatterRow, "id" | "number" | "title" | "practiceArea">;
  owner: string | null;
  unacknowledged: number;
};

async function listDeadlines(
  actor: Actor,
  opts: { from?: string; to: string; ownerId?: string },
): Promise<PanelDeadline[]> {
  const vis = await matterVisibility(actor);
  const rows = await getDb()
    .select({
      d: deadlines,
      matter: {
        id: matters.id,
        number: matters.number,
        title: matters.title,
        practiceArea: matters.practiceArea,
      },
      owner: users.name,
      unacknowledged: sql<number>`(select count(*)::int from deadline_alerts a where a.deadline_id = ${deadlines.id} and a.acknowledged_at is null)`,
    })
    .from(deadlines)
    .innerJoin(matters, eq(matters.id, deadlines.matterId))
    .leftJoin(users, eq(users.id, deadlines.ownerId))
    .where(
      and(
        eq(deadlines.status, "open"),
        eq(matters.status, "open"),
        isNull(matters.deletedAt),
        lte(deadlines.dueOn, opts.to),
        opts.from ? gte(deadlines.dueOn, opts.from) : undefined,
        opts.ownerId ? eq(deadlines.ownerId, opts.ownerId) : undefined,
        vis ?? undefined,
      ),
    )
    .orderBy(asc(deadlines.dueOn), asc(matters.number));
  return rows;
}

export async function deadlinesPanel(actor: Actor, opts: { month: string; mine: boolean }) {
  assertCan(actor, "deadlines.read");
  const db = getDb();
  const today = firmToday();
  const vis = await matterVisibility(actor);
  // The month grid starts on the Sunday on or before the 1st and shows six weeks.
  const first = `${opts.month}-01`;
  const gridStart = addDays(first, -weekday(first));
  const [counts, upcoming, calendar, audit] = await Promise.all([
    deadlineCounts(db, today, vis),
    listDeadlines(actor, { to: addDays(today, 90), ownerId: opts.mine ? actor.id : undefined }),
    listDeadlines(actor, {
      from: gridStart,
      to: addDays(gridStart, 41),
      ownerId: opts.mine ? actor.id : undefined,
    }),
    deadlineAuditReport(db),
  ]);
  // The audit is firm-wide; an attorney sees the rows for matters they can see.
  const visibleIds = vis
    ? new Set((await db.select({ id: matters.id }).from(matters).where(vis)).map((r) => r.id))
    : null;
  const keep = <T extends { matterId: string }>(xs: T[]) =>
    visibleIds ? xs.filter((x) => visibleIds.has(x.matterId)) : xs;
  return {
    today,
    gridStart,
    counts,
    upcoming,
    calendar,
    alerts: upcoming.filter((u) => u.unacknowledged > 0),
    audit: {
      mattersWithoutDeadline: keep(audit.mattersWithoutDeadline),
      withoutOwner: keep(audit.withoutOwner),
      changedThisWeek: keep(audit.changedThisWeek),
    },
    canWrite: can(actor, "deadlines.write"),
  };
}

export type DeadlinesPanel = Awaited<ReturnType<typeof deadlinesPanel>>;

/** Deadlines, events, trackers (C4, C5) and rule status for one matter. */
export async function matterDeadlines(actor: Actor, m: MatterRow) {
  const db = getDb();
  const scope = await scopeOf(db, m);
  if (!can(actor, "deadlines.read", { resource: scope })) return null;
  const [rows, events, ruleRows, plan] = await Promise.all([
    db
      .select({ d: deadlines, owner: users.name })
      .from(deadlines)
      .leftJoin(users, eq(users.id, deadlines.ownerId))
      .where(and(eq(deadlines.matterId, m.id), ne(deadlines.status, "cancelled")))
      .orderBy(asc(deadlines.status), asc(deadlines.dueOn)),
    db
      .select()
      .from(matterEvents)
      .where(and(eq(matterEvents.matterId, m.id), isNull(matterEvents.deletedAt)))
      .orderBy(asc(matterEvents.occurredOn)),
    db.select().from(deadlineRules).orderBy(asc(deadlineRules.key)),
    db.select().from(paymentPlans).where(eq(paymentPlans.matterId, m.id)),
  ]);
  const ids = rows.map((r) => r.d.id);
  const [alerts, tolling] = ids.length
    ? await Promise.all([
        db
          .select()
          .from(deadlineAlerts)
          .where(
            and(inArray(deadlineAlerts.deadlineId, ids), isNull(deadlineAlerts.acknowledgedAt)),
          ),
        db
          .select()
          .from(deadlineTolling)
          .where(and(inArray(deadlineTolling.deadlineId, ids), isNull(deadlineTolling.deletedAt)))
          .orderBy(asc(deadlineTolling.createdAt)),
      ])
    : [[], []];
  const rules = ruleRows.map(stateOf);
  const eventDefs = eventsFor(m.practiceArea, m.matterType);
  // Rules that apply to this matter's events, and the ones waiting on verification.
  const waiting = new Map<string, { rule: string; event: string }>();
  for (const ev of events) {
    for (const r of rulesForEvent(rules, m, {
      kind: ev.kind,
      noticeType: ev.noticeType,
      flags: ev.flags,
    })) {
      const state = verificationOf(r);
      if (state === "unverified" || state === "changed_since_verified")
        waiting.set(r.id, {
          rule: r.label,
          event: eventDefs.find((e) => e.key === ev.kind)?.label ?? ev.kind,
        });
    }
  }
  const typeRules = rules.filter((r) => r.matterTypes.includes(m.matterType) && r.active);
  // C4: probate milestones, one per rule, in trigger order.
  const milestones =
    m.practiceArea === "estate" && m.matterType === "probate" && (await hasFeature("automation.C4"))
      ? typeRules.map((r) => {
          const ev = events.find((e) => e.kind === r.trigger);
          const d = rows.find((x) => x.d.ruleId === r.id && x.d.status !== "cancelled")?.d ?? null;
          return {
            ruleId: r.id,
            label: r.label,
            trigger: eventDefs.find((e) => e.key === r.trigger)?.label ?? r.trigger,
            event: ev ?? null,
            deadline: d,
            verification: verificationOf(r),
          };
        })
      : null;
  const c5 = m.practiceArea === "tax" && (await hasFeature("automation.C5"));
  return {
    deadlines: rows,
    events,
    eventDefs,
    alerts,
    tolling,
    tollable: new Set(rules.filter((r) => r.allowsTolling).map((r) => r.id)),
    waiting: [...waiting.values()],
    milestones,
    paymentPlan: c5 ? (plan[0] ?? null) : null,
    showPaymentPlan: c5 && m.matterType === "collections",
    canWrite: can(actor, "deadlines.write", { resource: scope }),
    today: firmToday(),
    notice: DEADLINE_NOTICE,
  };
}

export type MatterDeadlines = NonNullable<Awaited<ReturnType<typeof matterDeadlines>>>;

// --------------------------------------------------------------- rules --

export async function deadlineRuleList(actor: Actor) {
  assertCan(actor, "deadlines.read");
  const db = getDb();
  const rows = await db
    .select({ r: deadlineRules, verifier: users.name })
    .from(deadlineRules)
    .leftJoin(users, eq(users.id, deadlineRules.verifiedBy))
    .orderBy(asc(deadlineRules.practiceArea), asc(deadlineRules.key));
  const seeds = new Map(allRuleSeeds().map((s) => [s.key, s]));
  const holidays = await db
    .select()
    .from(deadlineHolidays)
    .where(gte(deadlineHolidays.date, addDays(firmToday(), -ONE_YEAR)))
    .orderBy(asc(deadlineHolidays.date));
  return {
    rules: rows.map(({ r, verifier }) => ({
      row: r,
      verifier,
      verification: verificationOf(stateOf(r)),
      hash: hashOfRow(r),
      seedChanged: (() => {
        const s = seeds.get(r.key);
        return s ? ruleHash(paramsOfSeed(s)) !== ruleHash(stateOf(r)) : false;
      })(),
    })),
    missingSeeds: [...seeds.keys()].filter((k) => !rows.some((x) => x.r.key === k)),
    holidays,
    canVerify: can(actor, "deadline_rules.verify"),
  };
}

export async function deadlineRuleDetail(actor: Actor, id: string) {
  assertCan(actor, "deadlines.read");
  const list = await deadlineRuleList(actor);
  const item = list.rules.find((r) => r.row.id === id);
  if (!item) return null;
  const seed = allRuleSeeds().find((s) => s.key === item.row.key) ?? null;
  const [usage] = (
    await getDb().execute<{ open: number }>(
      sql`select count(*)::int as open from deadlines where rule_id = ${id} and status = 'open'`,
    )
  ).rows;
  return { ...item, seed, openDeadlines: usage?.open ?? 0, canVerify: list.canVerify };
}

// ---------------------------------------------------------------- C6 --

export async function myCalendarFeed(actor: Actor) {
  assertCan(actor, "deadlines.read");
  const [f] = await getDb()
    .select({ createdAt: calendarFeeds.createdAt, updatedAt: calendarFeeds.updatedAt })
    .from(calendarFeeds)
    .where(eq(calendarFeeds.userId, actor.id));
  return f ?? null;
}

/**
 * The feed for a token, or null. Lists open deadlines the person owns or that
 * sit on matters they are responsible for, from a month back to a year ahead.
 * Events carry the matter number and the deadline label, not client names.
 */
export async function calendarFeedFor(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  if (!(await hasFeature("automation.C6"))) return null;
  const db = getDb();
  const [row] = await db
    .select({ user: users })
    .from(calendarFeeds)
    .innerJoin(users, eq(users.id, calendarFeeds.userId))
    .where(eq(calendarFeeds.tokenHash, feedTokenHash(token)));
  if (!row || row.user.deletedAt) return null;
  const actor: Actor = { id: row.user.id, role: row.user.role, status: row.user.status };
  if (!can(actor, "deadlines.read")) return null;
  const today = firmToday();
  const rows = await db
    .select({ d: deadlines, number: matters.number })
    .from(deadlines)
    .innerJoin(matters, eq(matters.id, deadlines.matterId))
    .where(
      and(
        eq(deadlines.status, "open"),
        eq(matters.status, "open"),
        isNull(matters.deletedAt),
        gte(deadlines.dueOn, addDays(today, -31)),
        lte(deadlines.dueOn, addDays(today, ONE_YEAR)),
        sql`(${deadlines.ownerId} = ${actor.id} or ${matters.responsibleAttorneyId} = ${actor.id})`,
      ),
    )
    .orderBy(asc(deadlines.dueOn))
    .limit(1_000);
  const base = env().APP_URL;
  const events: FeedEvent[] = rows.map(({ d, number }) => ({
    uid: `${d.id}@lexdesk`,
    dueOn: d.dueOn,
    summary: `${number}: ${d.label}`,
    description: `${DEADLINE_NOTICE}\nOpen in LexDesk: ${new URL(`/matters/${d.matterId}#deadlines`, base)}`,
    url: new URL(`/matters/${d.matterId}#deadlines`, base).toString(),
    sequence: d.version,
    updatedAt: d.updatedAt,
  }));
  return renderCalendar("LexDesk deadlines", events);
}
