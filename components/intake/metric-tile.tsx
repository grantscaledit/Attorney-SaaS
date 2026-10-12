import type { Route } from "next";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Stat } from "@/components/ui/stat";
import { formatCount, formatDuration, formatPercent } from "@/lib/ui/format";
import type { MetricDefinition, MetricValue } from "@/modules/metrics/definitions";

function display(def: MetricDefinition, v: number | null): string {
  if (v === null) return "–";
  switch (def.unit) {
    case "count":
      return formatCount(v);
    case "rate":
      return formatPercent(v);
    case "seconds":
      return formatDuration(v);
    case "days":
      return `${v.toFixed(1).replace(/\.0$/, "")} days`;
  }
}

/** Trend vs the previous period. Direction is shown with an arrow and words, never color alone. */
function Trend({
  def,
  current,
  previous,
  lowerIsBetter,
  days,
}: {
  def: MetricDefinition;
  current: number | null;
  previous: number | null;
  lowerIsBetter?: boolean;
  days: number;
}) {
  if (current === null || previous === null) return <span>No prior {days}-day figure</span>;
  const diff = current - previous;
  if (Math.abs(diff) < 1e-9) {
    return (
      <span className="inline-flex items-center gap-1">
        <Minus className="size-3.5" aria-hidden /> Same as prior {days} days
      </span>
    );
  }
  const better = lowerIsBetter ? diff < 0 : diff > 0;
  const Icon = diff > 0 ? ArrowUpRight : ArrowDownRight;
  const amount =
    def.unit === "rate"
      ? `${Math.abs(Math.round(diff * 100))} ${Math.abs(Math.round(diff * 100)) === 1 ? "pt" : "pts"}`
      : def.unit === "count"
        ? formatCount(Math.abs(diff))
        : def.unit === "seconds"
          ? formatDuration(Math.abs(diff))
          : `${Math.abs(diff).toFixed(1)} days`;
  return (
    <span className={`inline-flex items-center gap-1 ${better ? "text-good" : "text-warning"}`}>
      <Icon className="size-3.5" aria-hidden />
      {diff > 0 ? "Up" : "Down"} {amount} vs prior {days} days
    </span>
  );
}

export function MetricTile({
  def,
  current,
  previous,
  days,
  href,
  lowerIsBetter,
}: {
  def: MetricDefinition;
  current: MetricValue;
  previous: MetricValue;
  days: number;
  href?: Route;
  lowerIsBetter?: boolean;
}) {
  const ratio =
    def.unit === "rate" && current.denominator !== undefined
      ? `${formatCount(current.numerator ?? 0)} of ${formatCount(current.denominator)}`
      : null;
  const value = display(def, current.value);
  return (
    <Stat
      label={def.label}
      definition={def.definition}
      value={
        href ? (
          <Link href={href} className="hover:text-accent hover:underline">
            {value}
          </Link>
        ) : (
          value
        )
      }
      context={
        <span className="flex flex-col gap-0.5">
          {ratio ? <span>{ratio}</span> : null}
          <Trend
            def={def}
            current={current.value}
            previous={previous.value}
            lowerIsBetter={lowerIsBetter}
            days={days}
          />
        </span>
      }
    />
  );
}
