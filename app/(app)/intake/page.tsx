import type { Metadata, Route } from "next";
import Link from "next/link";
import { MetricTile } from "@/components/intake/metric-tile";
import { Notice } from "@/components/ui/notice";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import { Stat } from "@/components/ui/stat";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { can } from "@/lib/auth/can";
import { requirePermission } from "@/lib/auth/session";
import { pendingConflicts } from "@/modules/intake/ai-queries";
import { CONFLICT_FLAGS_PENDING } from "@/modules/metrics/definitions";
import { env } from "@/lib/env";
import { formatCount, formatDate, formatPercent } from "@/lib/ui/format";
import { cn } from "@/lib/ui/cn";
import { sourceDisplayName } from "@/modules/intake/attribution";
import { PRACTICE_AREA_LABELS } from "@/modules/intake/labels";
import { intakeDashboard, PERIODS, periodSchema } from "@/modules/intake/queries";
import { INTAKE_METRICS, type Breakdown } from "@/modules/metrics/definitions";
import { ghlConfigured } from "@/lib/ghl/client";

export const metadata: Metadata = { title: "Intake" };

function leadsHref(params: Record<string, string | number>): Route {
  return `/intake/leads?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}` as Route;
}

function BreakdownTable({
  title,
  description,
  rows,
  label,
  filterKey,
  days,
}: {
  title: string;
  description: string;
  rows: Breakdown[];
  label: (key: string) => string;
  filterKey: "source" | "practiceArea";
  days: number;
}) {
  const max = Math.max(1, ...rows.map((r) => r.leads));
  return (
    <Panel>
      <PanelHeader title={title} description={description} />
      {rows.length === 0 ? (
        <EmptyState title="No leads in this period" />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>{filterKey === "source" ? "Source" : "Practice area"}</Th>
              <Th className="text-right">Leads</Th>
              <Th className="w-[22%]">
                <span className="sr-only">Share</span>
              </Th>
              <Th className="text-right">Booked</Th>
              <Th className="text-right">Retained</Th>
            </tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <Tr key={r.key}>
                <Td className="whitespace-nowrap">
                  <Link
                    href={leadsHref({ [filterKey]: r.key, days })}
                    className="text-accent hover:underline"
                  >
                    {label(r.key)}
                  </Link>
                </Td>
                <Td className="text-right tabular-nums">{formatCount(r.leads)}</Td>
                <Td>
                  <div className="h-1.5 rounded-full bg-surface-2" aria-hidden>
                    <div
                      className="h-1.5 rounded-full bg-accent"
                      style={{ width: `${(r.leads / max) * 100}%` }}
                    />
                  </div>
                </Td>
                <Td className="whitespace-nowrap text-right tabular-nums">
                  {formatCount(r.booked)}{" "}
                  <span className="text-muted">({formatPercent(r.booked / r.leads)})</span>
                </Td>
                <Td className="text-right tabular-nums">{formatCount(r.retained)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Panel>
  );
}

export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { user, policy } = await requirePermission("leads.read");
  const days = periodSchema.parse((await searchParams).days);
  const tz = env().FIRM_TIMEZONE;
  const d = await intakeDashboard(user, days);
  const m = INTAKE_METRICS;
  const isOwner = can(user, "firm.settings.update", { policy });
  const conflicts = can(user, "conflicts.read", { policy }) ? await pendingConflicts(user) : null;

  return (
    <>
      <PageHeader
        title="Intake"
        description={`Leads first in touch from ${formatDate(d.period.from, tz)} to ${formatDate(d.period.to, tz)}. Hover a figure for its definition; select it to see the leads behind it.`}
        actions={
          <nav aria-label="Period" className="flex rounded-md border border-line bg-surface p-0.5">
            {PERIODS.map((p) => (
              <Link
                key={p}
                href={`/intake?days=${p}` as Route}
                aria-current={p === days ? "page" : undefined}
                className={cn(
                  "rounded px-2.5 py-1 text-[12.5px]",
                  p === days ? "bg-accent-soft text-accent" : "text-ink-2 hover:text-ink",
                )}
              >
                {p} days
              </Link>
            ))}
          </nav>
        }
      />

      {!ghlConfigured() && !env().DEMO_MODE ? (
        <Notice tone="warning" className="mb-5">
          GoHighLevel is not connected, so no new leads are arriving.{" "}
          {isOwner ? (
            <Link href="/settings/integrations" className="underline">
              Connect it in Settings
            </Link>
          ) : (
            "Ask the owner attorney to connect it."
          )}
        </Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile
          def={m.leads}
          current={d.current.leads}
          previous={d.previous.leads}
          days={days}
          href={leadsHref({ days })}
        />
        <MetricTile
          def={m.median_first_response}
          current={d.current.median_first_response}
          previous={d.previous.median_first_response}
          days={days}
          lowerIsBetter
        />
        <MetricTile
          def={m.missed_call_recovery_rate}
          current={d.current.missed_call_recovery_rate}
          previous={d.previous.missed_call_recovery_rate}
          days={days}
          href={leadsHref({ view: "missed", days })}
        />
        <MetricTile
          def={m.consult_booked_rate}
          current={d.current.consult_booked_rate}
          previous={d.previous.consult_booked_rate}
          days={days}
          href={leadsHref({ view: "booked", days })}
        />
        <MetricTile
          def={m.show_rate}
          current={d.current.show_rate}
          previous={d.previous.show_rate}
          days={days}
        />
        <MetricTile
          def={m.consult_to_retained_rate}
          current={d.current.consult_to_retained_rate}
          previous={d.previous.consult_to_retained_rate}
          days={days}
          href={leadsHref({ view: "retained", days })}
        />
        <MetricTile
          def={m.lead_to_retained_days}
          current={d.current.lead_to_retained_days}
          previous={d.previous.lead_to_retained_days}
          days={days}
          lowerIsBetter
        />
        <Stat
          label={CONFLICT_FLAGS_PENDING.label}
          value={conflicts ? String(conflicts.flagged) : "–"}
          definition={CONFLICT_FLAGS_PENDING.definition}
          context={
            conflicts
              ? `${conflicts.unflagged} more with no matches await sign-off`
              : "Not visible to your role."
          }
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile
          def={m.missed_calls}
          current={d.current.missed_calls}
          previous={d.previous.missed_calls}
          days={days}
          href={leadsHref({ view: "missed", days })}
          lowerIsBetter
        />
        <MetricTile
          def={m.median_first_human_response}
          current={d.current.median_first_human_response}
          previous={d.previous.median_first_human_response}
          days={days}
          lowerIsBetter
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <BreakdownTable
          title="Leads by source"
          description="First touch: the earliest source recorded for each lead (F1)."
          rows={d.bySource}
          label={sourceDisplayName}
          filterKey="source"
          days={days}
        />
        <BreakdownTable
          title="Leads by practice area"
          description="From the web form answer or the intake assistant (A3)."
          rows={d.byPracticeArea}
          label={(k) => PRACTICE_AREA_LABELS[k] ?? k}
          filterKey="practiceArea"
          days={days}
        />
      </div>

      <p className="mt-6 text-[12.5px] text-muted">
        <Link href="/intake/leads" className="text-accent hover:underline">
          All leads
        </Link>{" "}
        ·{" "}
        <Link href="/intake/leads?view=unanswered" className="text-accent hover:underline">
          Waiting for a reply from a person
        </Link>
      </p>
    </>
  );
}
