import "server-only";
import { can, type Actor } from "@/lib/auth/can";
import { pendingApprovalCount } from "@/modules/approvals/queries";
import { unansweredLeadCount } from "@/modules/intake/queries";

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
 * queries as the module's own pages keeps the numbers identical (spec Section 9).
 */
export async function loadOpsCounters(actor: Actor): Promise<OpsCounter[]> {
  const leadsVisible = can(actor, "leads.read");
  const approvalsVisible = can(actor, "approvals.read");
  const [unanswered, approvalsWaiting] = await Promise.all([
    leadsVisible ? unansweredLeadCount(actor) : null,
    approvalsVisible ? pendingApprovalCount(actor) : null,
  ]);
  return [
    {
      key: "approvals",
      label: "Approvals waiting",
      value: approvalsWaiting,
      href: approvalsVisible ? "/approvals" : null,
      attention: true,
      unavailableReason: "Approvals are not part of your role.",
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
      value: unanswered,
      href: leadsVisible ? "/intake/leads?view=unanswered" : null,
      attention: true,
      unavailableReason: "Leads are not part of your role.",
    },
  ];
}
