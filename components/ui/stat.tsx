import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * Stat tile: label, value, optional context line. Value uses the sans face
 * with proportional figures (tabular figures are for table columns only).
 */
export function Stat({
  label,
  value,
  context,
  definition,
  className,
}: {
  label: string;
  value: ReactNode;
  context?: ReactNode;
  /** Plain-language metric definition (spec Section 9: every metric has one). */
  definition?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("rounded-lg border border-line bg-surface px-4 py-3.5 shadow-panel", className)}
    >
      <p className="eyebrow" title={definition}>
        {label}
      </p>
      <p className="mt-2 text-[26px] font-semibold leading-none tracking-tight text-ink">{value}</p>
      {context ? <div className="mt-2 text-[12.5px] text-muted">{context}</div> : null}
    </div>
  );
}
