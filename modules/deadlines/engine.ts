import { createHash } from "node:crypto";
import {
  describeOffset,
  normalizeNoticeType,
  type RuleParams,
  type Severity,
} from "@/practice/deadline-rules";
import {
  addDays,
  addMonths,
  addYears,
  daysBetween,
  formatDate,
  nextAnnual,
  nextBusinessDay,
  type IsoDate,
} from "./date-math";

/*
 * C1: the deadline rules engine. Pure functions, no database.
 *
 * A rule may compute only when it is verified: the owner attorney signed it
 * off (verified_by, verified_at) AND the parameters they signed are the
 * parameters in the row now (verified_hash). Editing a rule, or changing the
 * row behind the application's back, makes the hashes differ and the engine
 * refuses. The database adds a trigger that rejects any rule-computed
 * deadline whose rule has no verification (migration 0009).
 */

export type RuleState = RuleParams & {
  id: string;
  key: string;
  active: boolean;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  verifiedHash: string | null;
};

export type Verification = "verified" | "unverified" | "changed_since_verified" | "inactive";

function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}

/** SHA-256 of the parameters an attorney verifies, independent of key order. */
export function ruleHash(p: RuleParams): string {
  const params: RuleParams = {
    label: p.label,
    description: p.description,
    trigger: p.trigger,
    offset: p.offset,
    rollForward: p.rollForward,
    severity: p.severity,
    matterTypes: [...p.matterTypes].sort(),
    noticeTypes: [...p.noticeTypes].map(normalizeNoticeType).sort(),
    condition: p.condition,
    preferPrinted: p.preferPrinted,
    recurring: p.recurring,
    allowsTolling: p.allowsTolling,
  };
  return createHash("sha256").update(canonical(params)).digest("hex");
}

export function verificationOf(r: RuleState): Verification {
  if (!r.active) return "inactive";
  if (!r.verifiedBy || !r.verifiedAt || !r.verifiedHash) return "unverified";
  return r.verifiedHash === ruleHash(r) ? "verified" : "changed_since_verified";
}

export const VERIFICATION_LABELS: Record<Verification, string> = {
  verified: "Verified",
  unverified: "Not verified",
  changed_since_verified: "Changed since verified",
  inactive: "Switched off",
};

export type EventFacts = {
  kind: string;
  noticeType: string | null;
  flags: Record<string, boolean>;
};

/** Rules whose trigger, matter type, notice number and flags match the event, verified or not. */
export function rulesForEvent<R extends RuleState>(
  rules: readonly R[],
  matter: { matterType: string },
  event: EventFacts,
): R[] {
  const notice = event.noticeType ? normalizeNoticeType(event.noticeType) : null;
  return rules.filter((r) => {
    if (r.trigger !== event.kind) return false;
    if (!r.matterTypes.includes(matter.matterType)) return false;
    if (r.noticeTypes.length > 0) {
      if (!notice || !r.noticeTypes.some((t) => normalizeNoticeType(t) === notice)) return false;
    }
    if (r.condition && (event.flags[r.condition.flag] ?? false) !== r.condition.equals)
      return false;
    return true;
  });
}

export type Computation = {
  ok: true;
  dueOn: IsoDate;
  /** Due date before tolling and rolling. */
  baseOn: IsoDate;
  /** How the date was reached, for the screen and the audit log. */
  steps: string[];
  rolled: boolean;
};

export type Refusal = { ok: false; reason: Exclude<Verification, "verified"> };

export type ComputeInput = {
  triggerOn: IsoDate;
  holidays: ReadonlySet<IsoDate>;
  /** Days added by tolling events (rules that allow tolling only). */
  tollingDays?: number;
  /** Annual rules: 0 for the first occurrence after the trigger, 1 for the next year... */
  occurrence?: number;
};

/** Compute a due date, or refuse when the rule is not verified as it stands. */
export function computeDue(rule: RuleState, input: ComputeInput): Computation | Refusal {
  const v = verificationOf(rule);
  if (v !== "verified") return { ok: false, reason: v };
  const o = rule.offset;
  const steps = [`Trigger date ${formatDate(input.triggerOn)}`];
  let base: IsoDate;
  if (o.unit === "annual") {
    base = addYears(nextAnnual(input.triggerOn, o.month, o.day), input.occurrence ?? 0);
    steps.push(
      `${describeOffset(o).replace(/ after$/, "")} after the trigger${input.occurrence ? `, plus ${input.occurrence} year(s)` : ""}: ${formatDate(base)}`,
    );
  } else {
    base =
      o.unit === "days"
        ? addDays(input.triggerOn, o.amount)
        : o.unit === "months"
          ? addMonths(input.triggerOn, o.amount)
          : addYears(input.triggerOn, o.amount);
    steps.push(`${describeOffset(o)} the trigger: ${formatDate(base)}`);
  }
  let due = base;
  const tolling = rule.allowsTolling ? (input.tollingDays ?? 0) : 0;
  if (tolling !== 0) {
    due = addDays(due, tolling);
    steps.push(`Plus ${tolling} tolling day(s): ${formatDate(due)}`);
  }
  let rolled = false;
  if (rule.rollForward === "next_business_day") {
    const next = nextBusinessDay(due, input.holidays);
    if (next !== due) {
      steps.push(`Falls on a weekend or holiday; moved to ${formatDate(next)}`);
      due = next;
      rolled = true;
    }
  }
  return { ok: true, dueOn: due, baseOn: base, steps, rolled };
}

// ---------------------------------------------------------------- C2 --

/** Alert points, in days before the due date (spec C2). 0 means due today or overdue. */
export const ALERT_THRESHOLDS = [30, 14, 7, 3, 1, 0] as const;
export type AlertThreshold = (typeof ALERT_THRESHOLDS)[number];

/** The alert point a deadline has reached, or null when it is more than 30 days out. */
export function thresholdFor(daysLeft: number): AlertThreshold | null {
  let hit: AlertThreshold | null = null;
  for (const t of ALERT_THRESHOLDS) if (daysLeft <= t) hit = t;
  return hit;
}

/** The attorney is also texted at these points (spec C2: 3 and 1 days, and on the day). */
export function smsAt(t: AlertThreshold): boolean {
  return t <= 3;
}

/** Critical alerts escalate to the owner attorney when nobody acknowledges them. */
export function isCritical(t: AlertThreshold, severity: Severity): boolean {
  return t <= 3 || (severity === "critical" && t <= 7);
}

export function daysLeft(today: IsoDate, dueOn: IsoDate): number {
  return daysBetween(today, dueOn);
}

export function dueInWords(today: IsoDate, dueOn: IsoDate): string {
  const d = daysBetween(today, dueOn);
  if (d < 0) return `${-d} day${d === -1 ? "" : "s"} overdue`;
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  return `Due in ${d} days`;
}
