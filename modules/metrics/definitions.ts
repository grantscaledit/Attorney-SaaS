import { sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { conflictChecks, metricsConsults, metricsLeadFacts } from "@/db/schema";

/*
 * Intake metric definitions (spec Section 9). The SQL views live in migration
 * 0003; this file is the one place that turns them into numbers. The
 * dashboard, the briefs (G1, G2) and the monthly report (G3) must call these
 * functions rather than re-deriving a metric, so the numbers never disagree.
 *
 * Every metric is computed for a half-open period [from, to) and comes with
 * the plain-language definition shown in its tooltip.
 */

export type Period = { from: Date; to: Date };

export type MetricId =
  | "leads"
  | "median_first_response"
  | "median_first_human_response"
  | "missed_calls"
  | "missed_call_recovery_rate"
  | "consult_booked_rate"
  | "show_rate"
  | "consult_to_retained_rate"
  | "lead_to_retained_days";

export type MetricUnit = "count" | "seconds" | "rate" | "days";

export type MetricDefinition = {
  id: MetricId;
  label: string;
  unit: MetricUnit;
  definition: string;
};

export const INTAKE_METRICS: Record<MetricId, MetricDefinition> = {
  leads: {
    id: "leads",
    label: "New leads",
    unit: "count",
    definition:
      "Enquiries whose first contact (call, form, chat, email or text) falls in the period. A returning person with a new enquiry counts again.",
  },
  median_first_response: {
    id: "median_first_response",
    label: "Median first response",
    unit: "seconds",
    definition:
      "Half of the period's leads got a first reply faster than this: an automatic acknowledgement, a text-back, a call answered or a staff reply.",
  },
  median_first_human_response: {
    id: "median_first_human_response",
    label: "Median first reply by a person",
    unit: "seconds",
    definition:
      "As median first response, counting only replies from a person: an answered call or a message sent by staff from GoHighLevel.",
  },
  missed_calls: {
    id: "missed_calls",
    label: "Missed-call leads",
    unit: "count",
    definition:
      "Leads in the period whose first contact was a call nobody answered, including calls that went to voicemail.",
  },
  missed_call_recovery_rate: {
    id: "missed_call_recovery_rate",
    label: "Missed-call recovery",
    unit: "rate",
    definition:
      "Of missed-call leads, the share who within 7 days replied, booked a consult or had a call connect with the firm.",
  },
  consult_booked_rate: {
    id: "consult_booked_rate",
    label: "Consult booked rate",
    unit: "rate",
    definition: "Of the period's leads, the share that have booked a consultation so far.",
  },
  show_rate: {
    id: "show_rate",
    label: "Show rate",
    unit: "rate",
    definition:
      "Of consults scheduled in the period and marked showed or no-show in GoHighLevel, the share marked showed. Unmarked consults are left out.",
  },
  consult_to_retained_rate: {
    id: "consult_to_retained_rate",
    label: "Consult to retained",
    unit: "rate",
    definition:
      "Of leads whose consult was held in the period, the share since retained (their GoHighLevel opportunity marked won).",
  },
  lead_to_retained_days: {
    id: "lead_to_retained_days",
    label: "Lead to retained",
    unit: "days",
    definition: "Median days from first contact to retained, for leads retained in the period.",
  },
};

/** Point-in-time, not per period: the reviewer's backlog right now. */
export const CONFLICT_FLAGS_PENDING = {
  label: "Conflict flags pending",
  definition:
    "Conflict pre-screens (A6) that found at least one possible match and that no lawyer has cleared or confirmed yet. Checks with no matches also wait for sign-off but are not counted here.",
} as const;

export async function conflictFlagsPending(
  db: DbOrTx,
): Promise<{ flagged: number; unflagged: number }> {
  const [r] = await db
    .select({
      flagged: sql<number>`count(*) filter (where ${conflictChecks.hitCount} > 0)::int`,
      unflagged: sql<number>`count(*) filter (where ${conflictChecks.hitCount} = 0)::int`,
    })
    .from(conflictChecks)
    .where(sql`${conflictChecks.status} = 'awaiting_review'`);
  return { flagged: r?.flagged ?? 0, unflagged: r?.unflagged ?? 0 };
}

export type MetricValue = { value: number | null; numerator?: number; denominator?: number };
export type IntakeMetrics = Record<MetricId, MetricValue>;

const rate = (n: number, d: number): MetricValue => ({
  value: d > 0 ? n / d : null,
  numerator: n,
  denominator: d,
});

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** All intake metrics for one period. */
export async function intakeMetrics(db: DbOrTx, p: Period): Promise<IntakeMetrics> {
  const f = metricsLeadFacts;
  const inPeriod = sql`${f.firstInboundAt} >= ${p.from} and ${f.firstInboundAt} < ${p.to}`;
  const [cohort] = await db
    .select({
      leads: sql<number>`count(*)`,
      medianResponse: sql<
        number | null
      >`percentile_cont(0.5) within group (order by ${f.firstResponseSeconds}) filter (where ${f.firstResponseSeconds} is not null)`,
      medianHuman: sql<
        number | null
      >`percentile_cont(0.5) within group (order by extract(epoch from ${f.firstHumanResponseAt} - ${f.firstInboundAt})) filter (where ${f.firstHumanResponseAt} is not null)`,
      missed: sql<number>`count(*) filter (where ${f.missedCall})`,
      recovered: sql<number>`count(*) filter (where ${f.recovered})`,
      booked: sql<number>`count(*) filter (where ${f.consultBookedAt} is not null)`,
    })
    .from(f)
    .where(inPeriod);

  const [held] = await db
    .select({
      held: sql<number>`count(*)`,
      retained: sql<number>`count(*) filter (where ${f.retainedAt} is not null)`,
    })
    .from(f)
    .where(sql`${f.consultHeldAt} >= ${p.from} and ${f.consultHeldAt} < ${p.to}`);

  const [won] = await db
    .select({
      medianDays: sql<
        number | null
      >`percentile_cont(0.5) within group (order by extract(epoch from ${f.retainedAt} - ${f.firstInboundAt}) / 86400)`,
    })
    .from(f)
    .where(sql`${f.retainedAt} >= ${p.from} and ${f.retainedAt} < ${p.to}`);

  const c = metricsConsults;
  const [consults] = await db
    .select({
      showed: sql<number>`count(*) filter (where ${c.showed})`,
      noShow: sql<number>`count(*) filter (where ${c.noShow})`,
    })
    .from(c)
    .where(sql`${c.startsAt} >= ${p.from} and ${c.startsAt} < ${p.to}`);

  return {
    leads: { value: num(cohort?.leads) },
    median_first_response: { value: numOrNull(cohort?.medianResponse) },
    median_first_human_response: { value: numOrNull(cohort?.medianHuman) },
    missed_calls: { value: num(cohort?.missed) },
    missed_call_recovery_rate: rate(num(cohort?.recovered), num(cohort?.missed)),
    consult_booked_rate: rate(num(cohort?.booked), num(cohort?.leads)),
    show_rate: rate(num(consults?.showed), num(consults?.showed) + num(consults?.noShow)),
    consult_to_retained_rate: rate(num(held?.retained), num(held?.held)),
    lead_to_retained_days: { value: numOrNull(won?.medianDays) },
  };
}

export type Breakdown = { key: string; leads: number; booked: number; retained: number };

/** Leads in the period by first-touch source (F1) or practice area. */
export async function intakeBreakdown(
  db: DbOrTx,
  p: Period,
  by: "source" | "practice_area",
): Promise<Breakdown[]> {
  const f = metricsLeadFacts;
  const key =
    by === "source" ? f.firstTouchSource : sql<string>`coalesce(${f.practiceArea}, 'unassigned')`;
  const rows = await db
    .select({
      key: sql<string>`${key}`,
      leads: sql<number>`count(*)`,
      booked: sql<number>`count(*) filter (where ${f.consultBookedAt} is not null)`,
      retained: sql<number>`count(*) filter (where ${f.retainedAt} is not null)`,
    })
    .from(f)
    .where(sql`${f.firstInboundAt} >= ${p.from} and ${f.firstInboundAt} < ${p.to}`)
    .groupBy(sql`1`)
    .orderBy(sql`2 desc, 1`);
  return rows.map((r) => ({
    key: r.key,
    leads: num(r.leads),
    booked: num(r.booked),
    retained: num(r.retained),
  }));
}

/** The period of the same length immediately before `p`, for trends. */
export function previousPeriod(p: Period): Period {
  const len = p.to.getTime() - p.from.getTime();
  return { from: new Date(p.from.getTime() - len), to: p.from };
}

export function lastDays(days: number, now = new Date()): Period {
  return { from: new Date(now.getTime() - days * 86_400_000), to: now };
}

/*
 * Pipeline panel (spec Section 9): open matters by type and stage, days in
 * stage against the stage threshold, matters waiting on the client, unsigned
 * engagement letters, checklist completion. Point in time, not per period.
 * Stage thresholds and "waiting on client" come from the practice modules.
 */
export const PIPELINE_METRICS = {
  open: { label: "Open matters", definition: "Matters with status open." },
  stalled: {
    label: "Past stage threshold",
    definition:
      "Open matters that have been in their current stage longer than the stage's threshold (the B5 stalled-matter rule).",
  },
  waitingOnClient: {
    label: "Waiting on client",
    definition:
      "Open matters in a stage where the firm waits on the client, such as gathering documents or reviewing drafts.",
  },
  unsignedEngagements: {
    label: "Unsigned engagement letters",
    definition: "Engagement letters sent to the client (A9) and not yet signed or withdrawn.",
  },
  checklistCompletion: {
    label: "Checklist completion",
    definition:
      "Required checklist documents received, as a share of all required documents on open matters. Waived items are excluded.",
  },
} as const;

export type PipelineMetrics = {
  open: number;
  stalled: number;
  waitingOnClient: number;
  unsignedEngagements: number;
  checklist: { received: number; required: number; rate: number | null };
  byStage: {
    practiceArea: string;
    matterType: string;
    stage: string;
    matters: number;
    stalled: number;
    avgDaysInStage: number;
  }[];
};

export async function pipelineMetrics(
  db: DbOrTx,
  classify: (m: {
    practiceArea: string;
    matterType: string;
    stage: string;
    daysInStage: number;
  }) => { stalled: boolean; waitingOnClient: boolean },
): Promise<PipelineMetrics> {
  const rows = (
    await db.execute<{ practice_area: string; matter_type: string; stage: string; days: number }>(
      sql`select practice_area, matter_type, stage, floor(extract(epoch from now() - stage_changed_at) / 86400)::int as days
          from matters where status = 'open' and deleted_at is null`,
    )
  ).rows;
  const [eng] = (
    await db.execute<{ n: number }>(
      sql`select count(*)::int as n from engagements where status = 'sent'`,
    )
  ).rows;
  const [cl] = (
    await db.execute<{ received: number; required: number }>(
      sql`select count(*) filter (where c.status = 'received')::int as received,
                 count(*) filter (where c.status in ('received', 'requested'))::int as required
          from checklist_items c join matters m on m.id = c.matter_id
          where m.status = 'open' and m.deleted_at is null and c.required`,
    )
  ).rows;
  const groups = new Map<string, PipelineMetrics["byStage"][number] & { totalDays: number }>();
  let stalled = 0;
  let waiting = 0;
  for (const r of rows) {
    const c = classify({
      practiceArea: r.practice_area,
      matterType: r.matter_type,
      stage: r.stage,
      daysInStage: r.days,
    });
    if (c.stalled) stalled++;
    if (c.waitingOnClient) waiting++;
    const key = `${r.practice_area}|${r.matter_type}|${r.stage}`;
    const g = groups.get(key) ?? {
      practiceArea: r.practice_area,
      matterType: r.matter_type,
      stage: r.stage,
      matters: 0,
      stalled: 0,
      avgDaysInStage: 0,
      totalDays: 0,
    };
    g.matters++;
    g.totalDays += r.days;
    if (c.stalled) g.stalled++;
    groups.set(key, g);
  }
  return {
    open: rows.length,
    stalled,
    waitingOnClient: waiting,
    unsignedEngagements: eng?.n ?? 0,
    checklist: {
      received: cl?.received ?? 0,
      required: cl?.required ?? 0,
      rate: cl && cl.required > 0 ? cl.received / cl.required : null,
    },
    byStage: [...groups.values()].map(({ totalDays, ...g }) => ({
      ...g,
      avgDaysInStage: Math.round(totalDays / g.matters),
    })),
  };
}

/*
 * Deadlines panel (spec Section 9): deadlines in the next 7, 30 and 90 days
 * by severity, unacknowledged alerts, matters with no deadline. Point in
 * time, counted on the firm's date (rule 10). The top bar's "Deadlines in 7
 * days" reads the same function. `scope` limits rows to the matters a person
 * may see (null: all).
 */
export const DEADLINE_METRICS = {
  next7: {
    label: "Deadlines in 7 days",
    definition:
      "Open deadlines on open matters due within the next 7 days, including any already past due. Every date is advisory.",
  },
  next30: {
    label: "Next 30 days",
    definition:
      "Open deadlines on open matters due within the next 30 days, including any past due.",
  },
  next90: {
    label: "Next 90 days",
    definition:
      "Open deadlines on open matters due within the next 90 days, including any past due.",
  },
  overdue: {
    label: "Past due",
    definition: "Open deadlines whose date has passed and that nobody has marked done.",
  },
  unacknowledged: {
    label: "Unacknowledged alerts",
    definition:
      "Open deadlines with a C2 alert (30, 14, 7, 3 or 1 days out, or on the day) that nobody has acknowledged.",
  },
  noDeadline: {
    label: "Matters with no deadline",
    definition: "Open matters with no open deadline (the C7 deadline audit).",
  },
} as const;

export type DeadlineCounts = {
  windows: Record<"7" | "30" | "90", Record<"critical" | "high" | "normal", number>>;
  overdue: number;
  unacknowledged: number;
  noDeadline: number;
};

export async function deadlineCounts(
  db: DbOrTx,
  today: string,
  scope: SQL | null,
): Promise<DeadlineCounts> {
  const where = scope ?? sql`true`;
  const rows = (
    await db.execute<{
      severity: "critical" | "high" | "normal";
      d7: number;
      d30: number;
      d90: number;
      overdue: number;
    }>(
      sql`select d.severity,
                 count(*) filter (where d.due_on <= ${today}::date + 7)::int as d7,
                 count(*) filter (where d.due_on <= ${today}::date + 30)::int as d30,
                 count(*) filter (where d.due_on <= ${today}::date + 90)::int as d90,
                 count(*) filter (where d.due_on < ${today}::date)::int as overdue
          from deadlines d join matters on matters.id = d.matter_id
          where d.status = 'open' and matters.status = 'open' and matters.deleted_at is null and ${where}
          group by d.severity`,
    )
  ).rows;
  const [ack] = (
    await db.execute<{ n: number }>(
      sql`select count(distinct d.id)::int as n from deadline_alerts a
          join deadlines d on d.id = a.deadline_id join matters on matters.id = d.matter_id
          where a.acknowledged_at is null and d.status = 'open' and matters.status = 'open'
            and matters.deleted_at is null and ${where}`,
    )
  ).rows;
  const [none] = (
    await db.execute<{ n: number }>(
      sql`select count(*)::int as n from matters
          where matters.status = 'open' and matters.deleted_at is null and ${where}
            and not exists (select 1 from deadlines d where d.matter_id = matters.id and d.status = 'open')`,
    )
  ).rows;
  const empty = () => ({ critical: 0, high: 0, normal: 0 });
  const windows = { "7": empty(), "30": empty(), "90": empty() };
  let overdue = 0;
  for (const r of rows) {
    windows["7"][r.severity] = r.d7;
    windows["30"][r.severity] = r.d30;
    windows["90"][r.severity] = r.d90;
    overdue += r.overdue;
  }
  return { windows, overdue, unacknowledged: ack?.n ?? 0, noDeadline: none?.n ?? 0 };
}

export function windowTotal(c: DeadlineCounts, w: "7" | "30" | "90"): number {
  const x = c.windows[w];
  return x.critical + x.high + x.normal;
}
