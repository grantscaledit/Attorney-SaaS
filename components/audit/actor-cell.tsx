import type { AuditRow } from "@/db/schema";

export function ActorCell({ row }: { row: Pick<AuditRow, "actorType" | "actorLabel"> }) {
  if (row.actorType === "system") {
    return (
      <span className="text-ink-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted">System</span>{" "}
        {row.actorLabel}
      </span>
    );
  }
  if (row.actorType === "anonymous") {
    return (
      <span className="text-ink-2">
        {row.actorLabel ? `${row.actorLabel} (not signed in)` : "Not signed in"}
      </span>
    );
  }
  return <span className="text-ink">{row.actorLabel}</span>;
}

/** Visual weight for security-relevant events. */
export function actionTone(action: string): "critical" | "warning" | "neutral" {
  if (action === "access.denied" || action.endsWith("_failed")) return "critical";
  if (
    action.includes("deactivated") ||
    action.includes("mfa_reset") ||
    action.includes("revoked") ||
    action === "flags.disabled"
  ) {
    return "warning";
  }
  return "neutral";
}
