import type { Tier } from "@/lib/env";

/**
 * Feature catalog: every gated capability and the tiers that include it
 * (spec Section 1, "Tiers"). Automation IDs match spec Section 7.
 *
 * Code never branches on FIRM_TIER directly. It calls hasFeature(flag).
 */
export type FeatureGroup =
  | "platform"
  | "intake"
  | "matters"
  | "deadlines"
  | "revenue"
  | "lifecycle"
  | "marketing"
  | "executive";

export type FeatureDefinition = {
  label: string;
  group: FeatureGroup;
  tiers: readonly Tier[];
  /** Build phase that delivers it (spec Section 11). Not shown to firm users. */
  phase: number;
};

const BOTH = ["solo", "firm"] as const satisfies readonly Tier[];
const FIRM_ONLY = ["firm"] as const satisfies readonly Tier[];

export const FEATURES = {
  // Platform
  "platform.sso": {
    label: "Single sign-on (Microsoft Entra, Google)",
    group: "platform",
    tiers: FIRM_ONLY,
    phase: 8,
  },
  "platform.unlimited_users": {
    label: "Unlimited users",
    group: "platform",
    tiers: FIRM_ONLY,
    phase: 0,
  },
  "platform.voice_receptionist": {
    label: "AI voice receptionist",
    group: "platform",
    tiers: FIRM_ONLY,
    phase: 8,
  },
  "platform.multi_attorney_routing": {
    label: "Multi-attorney routing",
    group: "platform",
    tiers: FIRM_ONLY,
    phase: 2,
  },
  "platform.staff_workload": {
    label: "Staff workload views",
    group: "platform",
    tiers: FIRM_ONLY,
    phase: 7,
  },

  // A. Intake and conversion
  "automation.A1": { label: "A1 Missed-call text-back", group: "intake", tiers: BOTH, phase: 1 },
  "automation.A2": { label: "A2 Instant lead response", group: "intake", tiers: BOTH, phase: 1 },
  "automation.A3": { label: "A3 AI intake assistant", group: "intake", tiers: BOTH, phase: 2 },
  "automation.A4": {
    label: "A4 AI voice receptionist",
    group: "intake",
    tiers: FIRM_ONLY,
    phase: 8,
  },
  "automation.A5": { label: "A5 Lead scoring and routing", group: "intake", tiers: BOTH, phase: 2 },
  "automation.A6": { label: "A6 Conflict pre-screen", group: "intake", tiers: BOTH, phase: 2 },
  "automation.A7": {
    label: "A7 Consult booking and reminders",
    group: "intake",
    tiers: BOTH,
    phase: 1,
  },
  "automation.A8": { label: "A8 Pre-consult brief", group: "intake", tiers: BOTH, phase: 2 },
  "automation.A9": {
    label: "A9 Engagement letter draft and chase",
    group: "intake",
    tiers: BOTH,
    phase: 3,
  },
  "automation.A10": {
    label: "A10 Unconverted lead nurture",
    group: "intake",
    tiers: BOTH,
    phase: 2,
  },
  "automation.A11": { label: "A11 Non-engagement letter", group: "intake", tiers: BOTH, phase: 2 },
  "automation.A12": { label: "A12 Referral-out routing", group: "intake", tiers: BOTH, phase: 2 },

  // B. Matter and documents
  "automation.B1": {
    label: "B1 Portal and checklist setup",
    group: "matters",
    tiers: BOTH,
    phase: 3,
  },
  "automation.B2": { label: "B2 Document chasing", group: "matters", tiers: BOTH, phase: 3 },
  "automation.B3": { label: "B3 Notice triage", group: "matters", tiers: BOTH, phase: 3 },
  "automation.B4": {
    label: "B4 Document classification and naming",
    group: "matters",
    tiers: BOTH,
    phase: 3,
  },
  "automation.B5": { label: "B5 Stalled matter alert", group: "matters", tiers: BOTH, phase: 3 },
  "automation.B6": {
    label: "B6 Client status update drafts",
    group: "matters",
    tiers: BOTH,
    phase: 3,
  },
  "automation.B7": {
    label: "B7 Matter summary and timeline",
    group: "matters",
    tiers: BOTH,
    phase: 3,
  },
  "automation.B8": { label: "B8 Drafting assist", group: "matters", tiers: BOTH, phase: 3 },
  "automation.B9": {
    label: "B9 Estate planning questionnaire",
    group: "matters",
    tiers: BOTH,
    phase: 3,
  },
  "automation.B10": { label: "B10 Closing package", group: "matters", tiers: BOTH, phase: 3 },

  // C. Deadlines
  "automation.C1": { label: "C1 Deadline rules engine", group: "deadlines", tiers: BOTH, phase: 4 },
  "automation.C2": { label: "C2 Escalating alerts", group: "deadlines", tiers: BOTH, phase: 4 },
  "automation.C3": {
    label: "C3 Entity compliance calendar",
    group: "deadlines",
    tiers: BOTH,
    phase: 4,
  },
  "automation.C4": {
    label: "C4 Probate milestone tracker",
    group: "deadlines",
    tiers: BOTH,
    phase: 4,
  },
  "automation.C5": {
    label: "C5 Collection and compliance tracking",
    group: "deadlines",
    tiers: BOTH,
    phase: 4,
  },
  "automation.C6": { label: "C6 Calendar push", group: "deadlines", tiers: BOTH, phase: 4 },
  "automation.C7": { label: "C7 Deadline audit", group: "deadlines", tiers: BOTH, phase: 4 },

  // D. Revenue and billing
  "automation.D1": { label: "D1 Receivables follow-up", group: "revenue", tiers: BOTH, phase: 5 },
  "automation.D2": { label: "D2 Unbilled time nudge", group: "revenue", tiers: BOTH, phase: 5 },
  "automation.D3": { label: "D3 Retainer balance alert", group: "revenue", tiers: BOTH, phase: 5 },
  "automation.D4": {
    label: "D4 Flat-fee profitability",
    group: "revenue",
    tiers: FIRM_ONLY,
    phase: 5,
  },
  "automation.D5": {
    label: "D5 General counsel utilization report",
    group: "revenue",
    tiers: FIRM_ONLY,
    phase: 5,
  },
  "automation.D6": { label: "D6 Revenue forecast", group: "revenue", tiers: FIRM_ONLY, phase: 5 },

  // E. Client lifecycle
  "automation.E1": {
    label: "E1 Cross-sell gap detection",
    group: "lifecycle",
    tiers: BOTH,
    phase: 6,
  },
  "automation.E2": {
    label: "E2 Estate plan review cycle",
    group: "lifecycle",
    tiers: BOTH,
    phase: 6,
  },
  "automation.E3": {
    label: "E3 Annual business checkup",
    group: "lifecycle",
    tiers: BOTH,
    phase: 6,
  },
  "automation.E4": {
    label: "E4 Law-change client alerts",
    group: "lifecycle",
    tiers: BOTH,
    phase: 6,
  },
  "automation.E5": {
    label: "E5 Dormant client reactivation",
    group: "lifecycle",
    tiers: BOTH,
    phase: 6,
  },
  "automation.E6": {
    label: "E6 Referral partner tracking",
    group: "lifecycle",
    tiers: BOTH,
    phase: 6,
  },
  "automation.E7": { label: "E7 Review requests", group: "lifecycle", tiers: BOTH, phase: 6 },
  "automation.E8": {
    label: "E8 Review monitoring and replies",
    group: "lifecycle",
    tiers: BOTH,
    phase: 6,
  },
  "automation.E9": { label: "E9 Satisfaction check", group: "lifecycle", tiers: BOTH, phase: 6 },

  // F. Marketing
  "automation.F1": { label: "F1 Source attribution", group: "marketing", tiers: BOTH, phase: 1 },
  "automation.F2": {
    label: "F2 Spend to retained client",
    group: "marketing",
    tiers: FIRM_ONLY,
    phase: 6,
  },
  "automation.F3": { label: "F3 Content drafts", group: "marketing", tiers: BOTH, phase: 6 },
  "automation.F4": {
    label: "F4 Local visibility tracking",
    group: "marketing",
    tiers: FIRM_ONLY,
    phase: 6,
  },

  // G. Executive
  "automation.G1": { label: "G1 Daily brief", group: "executive", tiers: BOTH, phase: 7 },
  "automation.G2": { label: "G2 Weekly brief", group: "executive", tiers: BOTH, phase: 7 },
  "automation.G3": { label: "G3 Monthly owner report", group: "executive", tiers: BOTH, phase: 7 },
  "automation.G4": {
    label: "G4 Ask the dashboard",
    group: "executive",
    tiers: FIRM_ONLY,
    phase: 7,
  },
  "automation.G5": { label: "G5 Anomaly alerts", group: "executive", tiers: FIRM_ONLY, phase: 7 },
  "automation.G6": {
    label: "G6 Workload and capacity",
    group: "executive",
    tiers: FIRM_ONLY,
    phase: 7,
  },
  "automation.G7": { label: "G7 Task generation", group: "executive", tiers: BOTH, phase: 7 },
} as const satisfies Record<string, FeatureDefinition>;

export type FeatureFlag = keyof typeof FEATURES;

export const FEATURE_FLAGS = Object.keys(FEATURES) as FeatureFlag[];

export function isFeatureFlag(value: string): value is FeatureFlag {
  return Object.prototype.hasOwnProperty.call(FEATURES, value);
}

/** Solo tier user cap (spec Section 1: "Up to 5"). Firm tier has `platform.unlimited_users`. */
export const SOLO_USER_LIMIT = 5;

export const FEATURE_GROUP_LABELS: Record<FeatureGroup, string> = {
  platform: "Platform",
  intake: "Intake and conversion",
  matters: "Matters and documents",
  deadlines: "Deadlines",
  revenue: "Revenue and billing",
  lifecycle: "Client lifecycle",
  marketing: "Marketing",
  executive: "Executive",
};
