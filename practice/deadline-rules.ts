/*
 * Deadline rules (spec Section 8, "SEED VALUES, ATTORNEY MUST VERIFY").
 *
 * Each practice module exports the trigger events its matters record and the
 * seed rules that compute deadlines from them. The seed values below are
 * starting points copied from the spec. They are not legal advice and never
 * ship as verified: the firm's database holds its own copy of every rule, and
 * the engine refuses to compute from a rule until the owner attorney has
 * checked it against the source and signed it off (modules/deadlines).
 */

export const SEVERITIES = ["critical", "high", "normal"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
};

/** How a rule turns the trigger date into a due date. */
export type RuleOffset =
  | { unit: "days" | "months" | "years"; amount: number }
  /** The next given calendar date strictly after the trigger date (for example May 15). */
  | { unit: "annual"; month: number; day: number };

export type RollForward = "next_business_day" | "none";

/** A flag recorded with a trigger event that selects between rule variants. */
export type EventFlag = { key: string; label: string };

export type TriggerEventDef = {
  key: string;
  label: string;
  /** Matter types (in this area) that record this event. */
  matterTypes: string[];
  /** Flags asked for when the event is recorded. */
  flags?: EventFlag[];
  /** Ask for the notice or letter number (rules can be limited to notice types). */
  asksNoticeType?: boolean;
};

export type DeadlineRuleSeed = {
  /** Stable key, unique across practice areas. */
  key: string;
  label: string;
  /** Plain description of what the deadline is, shown on the rule and the deadline. */
  description: string;
  trigger: string;
  offset: RuleOffset;
  rollForward: RollForward;
  severity: Severity;
  /** Matter types the rule applies to. */
  matterTypes: string[];
  /** Only for these notice or letter numbers (trigger events that ask for one). Empty: any. */
  noticeTypes?: string[];
  /** Only when the event flag has this value. */
  condition?: { flag: string; equals: boolean };
  /**
   * The document usually prints its own date. When it does, the printed date
   * is the deadline and this rule is recorded only as a cross-check.
   */
  preferPrinted?: boolean;
  /** Repeats every year (C3): the next occurrence is created when one is done or passes. */
  recurring?: "annual";
  /** Days can be added for tolling events entered by staff (C5, collection statute). */
  allowsTolling?: boolean;
  /** Where the seed value came from, for the attorney checking it. */
  seedNote: string;
};

export type DeadlineModule = {
  events: TriggerEventDef[];
  rules: DeadlineRuleSeed[];
};

/** The parameters the attorney verifies. Changing any of them clears the verification. */
export type RuleParams = {
  label: string;
  description: string;
  trigger: string;
  offset: RuleOffset;
  rollForward: RollForward;
  severity: Severity;
  matterTypes: string[];
  noticeTypes: string[];
  condition: { flag: string; equals: boolean } | null;
  preferPrinted: boolean;
  recurring: "annual" | null;
  allowsTolling: boolean;
};

export function paramsOfSeed(s: DeadlineRuleSeed): RuleParams {
  return {
    label: s.label,
    description: s.description,
    trigger: s.trigger,
    offset: s.offset,
    rollForward: s.rollForward,
    severity: s.severity,
    matterTypes: s.matterTypes,
    noticeTypes: s.noticeTypes ?? [],
    condition: s.condition ?? null,
    preferPrinted: s.preferPrinted ?? false,
    recurring: s.recurring ?? null,
    allowsTolling: s.allowsTolling ?? false,
  };
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "90 days after", "the next May 15 after". */
export function describeOffset(o: RuleOffset): string {
  if (o.unit === "annual") return `the next ${MONTHS[o.month - 1]} ${o.day} after`;
  const unit = o.amount === 1 ? o.unit.slice(0, -1) : o.unit;
  return `${o.amount} ${unit} after`;
}

/** Notice numbers compared without case, spaces or punctuation: "Letter 1058" = "LETTER1058". */
export function normalizeNoticeType(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
