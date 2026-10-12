import "server-only";

export type OpsCounter = {
  key: "approvals" | "deadlines_7d" | "unanswered_leads";
  label: string;
  /** null until the module that owns the number exists. */
  value: number | null;
  href: string | null;
  attention: boolean;
  unavailableReason?: string;
};

/**
 * Values for the top-bar counters. Each module replaces its stub when it ships:
 * approvals (Phase 2), deadlines (Phase 4), leads (Phase 1). Reading the same
 * metric views as the dashboard keeps the numbers identical (spec Section 9).
 */
export async function loadOpsCounters(): Promise<OpsCounter[]> {
  return [
    {
      key: "approvals",
      label: "Approvals waiting",
      value: null,
      href: null,
      attention: true,
      unavailableReason: "The approval queue opens with AI intake.",
    },
    {
      key: "deadlines_7d",
      label: "Deadlines in 7 days",
      value: null,
      href: null,
      attention: true,
      unavailableReason: "Deadline tracking opens with the deadline engine.",
    },
    {
      key: "unanswered_leads",
      label: "Unanswered leads",
      value: null,
      href: null,
      attention: true,
      unavailableReason: "Lead counts start once GoHighLevel is connected.",
    },
  ];
}
