import { sql } from "drizzle-orm";
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
