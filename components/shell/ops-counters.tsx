import type { Route } from "next";
import Link from "next/link";
import { Tooltip } from "@/components/ui/tooltip";
import type { OpsCounter } from "@/modules/overview/counters";
import { cn } from "@/lib/ui/cn";

/**
 * Top bar on every screen (spec Section 9): approvals waiting, deadlines in 7
 * days, unanswered leads. Each links to its list. A counter whose module has
 * not shipped shows a dash, never a made-up zero.
 */
export function OpsCounters({ counters }: { counters: OpsCounter[] }) {
  return (
    <ul className="flex items-stretch divide-x divide-line rounded-md border border-line bg-surface">
      {counters.map((c) => {
        const body = (
          <span className="flex items-baseline gap-2 px-3 py-1.5">
            <span
              className={cn(
                "text-[15px] font-semibold",
                c.value === null
                  ? "text-muted"
                  : c.value > 0 && c.attention
                    ? "text-accent"
                    : "text-ink",
              )}
            >
              {c.value === null ? "–" : c.value}
            </span>
            <span className="text-[12px] text-muted">{c.label}</span>
          </span>
        );
        return (
          <li key={c.key} className="flex">
            {c.value === null || !c.href ? (
              <Tooltip content={c.unavailableReason ?? "Not available yet"}>
                <span tabIndex={0} className="flex cursor-default rounded-md">
                  {body}
                </span>
              </Tooltip>
            ) : (
              <Link href={c.href as Route} className="flex rounded-md hover:bg-surface-2">
                {body}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
