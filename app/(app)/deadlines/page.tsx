import type { Metadata, Route } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { z } from "zod";
import { Badge, StatusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { EmptyState, PageHeader, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Stat } from "@/components/ui/stat";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { requirePermission } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/ui/format";
import { addDays, addMonths, formatDate } from "@/modules/deadlines/date-math";
import { dueInWords } from "@/modules/deadlines/engine";
import { deadlinesPanel, type PanelDeadline } from "@/modules/deadlines/queries";
import { DEADLINE_NOTICE } from "@/modules/deadlines/rules";
import { firmToday } from "@/modules/matters/scope";
import { DEADLINE_METRICS as D, windowTotal } from "@/modules/metrics/definitions";
import { SEVERITY_LABELS, SEVERITIES } from "@/practice";
import { SEVERITY_TONE } from "./tones";

export const metadata: Metadata = { title: "Deadlines" };

const searchSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional()
    .catch(undefined),
  mine: z.enum(["1"]).optional().catch(undefined),
  window: z.enum(["7", "30", "90"]).optional().catch(undefined),
});

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function href(params: Record<string, string | undefined>): Route {
  const q = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  return `/deadlines${q ? `?${q}` : ""}` as Route;
}

function DeadlineLine({ x, today }: { x: PanelDeadline; today: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone={SEVERITY_TONE[x.d.severity]}>{SEVERITY_LABELS[x.d.severity]}</Badge>
      {!x.d.confirmed ? <Badge tone="warning">Not confirmed</Badge> : null}
      <Link
        href={`/matters/${x.matter.id}#deadlines` as Route}
        className="font-medium text-accent hover:underline"
      >
        {x.d.label}
      </Link>
      <span className="text-[12.5px] text-muted">
        {x.matter.number} · {dueInWords(today, x.d.dueOn)}
      </span>
    </div>
  );
}

export default async function DeadlinesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await requirePermission("deadlines.read");
  const sp = searchSchema.parse(await searchParams);
  const tz = env().FIRM_TIMEZONE;
  const month = sp.month ?? firmToday().slice(0, 7);
  const p = await deadlinesPanel(user, { month, mine: sp.mine === "1" });
  const win = sp.window ?? "90";
  const list = p.upcoming.filter((x) => x.d.dueOn <= addDays(p.today, Number(win)));
  const prev = addMonths(`${month}-01`, -1).slice(0, 7);
  const next = addMonths(`${month}-01`, 1).slice(0, 7);
  const byDay = new Map<string, PanelDeadline[]>();
  for (const x of p.calendar) byDay.set(x.d.dueOn, [...(byDay.get(x.d.dueOn) ?? []), x]);
  const days = Array.from({ length: 42 }, (_, i) => addDays(p.gridStart, i));
  const monthLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));

  return (
    <>
      <PageHeader
        title="Deadlines"
        description="Open deadlines on open matters, counted on the firm's date. Hover a figure for its definition."
        actions={
          <div className="flex gap-2">
            <Button variant={sp.mine ? "primary" : "secondary"} size="sm" asChild>
              <Link
                href={href({ month: sp.month, window: sp.window, mine: sp.mine ? undefined : "1" })}
              >
                {sp.mine ? "Showing mine" : "Only mine"}
              </Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href={"/settings/calendar" as Route}>Calendar link</Link>
            </Button>
          </div>
        }
      />
      <Notice tone="warning" className="mb-5">
        {DEADLINE_NOTICE}
      </Notice>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {(["7", "30", "90"] as const).map((w) => (
          <Link key={w} href={href({ ...sp, window: w })}>
            <Stat
              label={D[`next${w}`].label}
              definition={D[`next${w}`].definition}
              value={windowTotal(p.counts, w)}
              context={`${p.counts.windows[w].critical} critical`}
            />
          </Link>
        ))}
        <Stat label={D.overdue.label} definition={D.overdue.definition} value={p.counts.overdue} />
        <Stat
          label={D.unacknowledged.label}
          definition={D.unacknowledged.definition}
          value={p.counts.unacknowledged}
        />
        <Stat
          label={D.noDeadline.label}
          definition={D.noDeadline.definition}
          value={p.counts.noDeadline}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          {p.alerts.length > 0 ? (
            <Panel>
              <PanelHeader
                title="Unacknowledged alerts"
                description="Critical alerts nobody acknowledges within 4 hours go to the owner attorney (C2). Acknowledge on the matter."
              />
              <ul className="divide-y divide-line">
                {p.alerts.map((x) => (
                  <li key={x.d.id} className="px-5 py-2.5">
                    <DeadlineLine x={x} today={p.today} />
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader
              title={`Due in the next ${win} days`}
              description="Including anything past due. By date, then matter."
            />
            {list.length === 0 ? (
              <EmptyState title="Nothing due" />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Due</Th>
                    <Th>Deadline</Th>
                    <Th>Owner</Th>
                  </tr>
                </THead>
                <TBody>
                  {list.map((x) => (
                    <Tr key={x.d.id}>
                      <Td className="whitespace-nowrap tabular-nums">
                        {formatDate(x.d.dueOn)}
                        {x.d.dueOn < p.today ? (
                          <span className="block text-[12px]">
                            <StatusLabel tone="critical">Past due</StatusLabel>
                          </span>
                        ) : null}
                      </Td>
                      <Td>
                        <DeadlineLine x={x} today={p.today} />
                        <span className="text-[12px] text-muted">{x.matter.title}</span>
                      </Td>
                      <Td>{x.owner ?? <span className="text-critical">No owner</span>}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Panel>

          <Panel>
            <PanelHeader
              title={monthLabel}
              description="Calendar view."
              actions={
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" asChild>
                    <Link href={href({ ...sp, month: prev })} aria-label="Previous month">
                      <ChevronLeft />
                    </Link>
                  </Button>
                  <Button variant="ghost" size="icon" asChild>
                    <Link href={href({ ...sp, month: next })} aria-label="Next month">
                      <ChevronRight />
                    </Link>
                  </Button>
                </div>
              }
            />
            <div className="overflow-x-auto">
              <div className="grid min-w-[640px] grid-cols-7 border-t border-line text-[12px]">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="eyebrow border-b border-line px-2 py-1.5">
                    {w}
                  </div>
                ))}
                {days.map((day) => {
                  const inMonth = day.startsWith(month);
                  const items = byDay.get(day) ?? [];
                  return (
                    <div
                      key={day}
                      className={`min-h-[84px] border-b border-r border-line px-1.5 py-1 ${inMonth ? "" : "bg-surface-2 text-muted"}`}
                    >
                      <p
                        className={`tabular-nums ${day === p.today ? "font-semibold text-accent" : ""}`}
                      >
                        {Number(day.slice(8))}
                      </p>
                      <ul className="mt-0.5 space-y-0.5">
                        {items.map((x) => (
                          <li key={x.d.id}>
                            <Link
                              href={`/matters/${x.matter.id}#deadlines` as Route}
                              className={`block truncate rounded-sm px-1 hover:underline ${
                                x.d.severity === "critical"
                                  ? "bg-critical-soft text-critical"
                                  : x.d.severity === "high"
                                    ? "bg-warning-soft text-warning"
                                    : "bg-surface-2 text-ink-2"
                              }`}
                              title={`${x.matter.number}: ${x.d.label} (${SEVERITY_LABELS[x.d.severity]})`}
                            >
                              {x.matter.number} {x.d.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel>
            <PanelHeader title="By severity" description="Open deadlines due within each window." />
            <Table>
              <THead>
                <tr>
                  <Th>Severity</Th>
                  <Th className="text-right">7 days</Th>
                  <Th className="text-right">30 days</Th>
                  <Th className="text-right">90 days</Th>
                </tr>
              </THead>
              <TBody>
                {SEVERITIES.map((s) => (
                  <Tr key={s}>
                    <Td>{SEVERITY_LABELS[s]}</Td>
                    <Td className="text-right tabular-nums">{p.counts.windows["7"][s]}</Td>
                    <Td className="text-right tabular-nums">{p.counts.windows["30"][s]}</Td>
                    <Td className="text-right tabular-nums">{p.counts.windows["90"][s]}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </Panel>

          <Panel>
            <PanelHeader
              title="Deadline audit (C7)"
              description="Runs weekly; shown here as it stands now."
            />
            <PanelBody className="space-y-4 text-[13px]">
              <div>
                <p className="font-medium">
                  Deadlines with no owner ({p.audit.withoutOwner.length})
                </p>
                <ul className="mt-1 space-y-0.5">
                  {p.audit.withoutOwner.slice(0, 10).map((x) => (
                    <li key={x.deadlineId}>
                      <Link
                        href={`/matters/${x.matterId}#deadlines` as Route}
                        className="text-accent hover:underline"
                      >
                        {x.number}
                      </Link>{" "}
                      {x.label}, {formatDate(x.dueOn)}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-medium">
                  Dates changed in the last 7 days ({p.audit.changedThisWeek.length})
                </p>
                <ul className="mt-1 space-y-0.5">
                  {p.audit.changedThisWeek.slice(0, 10).map((x) => (
                    <li key={x.deadlineId}>
                      <Link
                        href={`/matters/${x.matterId}#deadlines` as Route}
                        className="text-accent hover:underline"
                      >
                        {x.number}
                      </Link>{" "}
                      {x.label}, now {formatDate(x.dueOn)}{" "}
                      <span className="text-muted">
                        (changed {formatDateTime(x.changedAt, tz)})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-medium">
                  Open matters with no deadline ({p.audit.mattersWithoutDeadline.length})
                </p>
                <ul className="mt-1 space-y-0.5">
                  {p.audit.mattersWithoutDeadline.slice(0, 10).map((x) => (
                    <li key={x.matterId}>
                      <Link
                        href={`/matters/${x.matterId}#deadlines` as Route}
                        className="text-accent hover:underline"
                      >
                        {x.number}
                      </Link>{" "}
                      {x.title}
                    </li>
                  ))}
                </ul>
              </div>
            </PanelBody>
          </Panel>
        </div>
      </div>
    </>
  );
}
