import type { Metadata, Route } from "next";
import Link from "next/link";
import { ArrowLeft, PhoneMissed } from "lucide-react";
import { StatusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/field";
import { EmptyState, PageHeader, Panel } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { LEAD_STATUSES } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { formatDateTime, formatDuration, formatRelative } from "@/lib/ui/format";
import { SOURCE_LABELS, sourceDisplayName } from "@/modules/intake/attribution";
import {
  LEAD_CHANNEL_LABELS,
  LEAD_STATUS_LABELS,
  PRACTICE_AREA_LABELS,
} from "@/modules/intake/labels";
import { leadFilterSchema, listLeads, type LeadFilters } from "@/modules/intake/queries";

export const metadata: Metadata = { title: "Leads" };

const VIEW_TITLES: Record<NonNullable<LeadFilters["view"]>, string> = {
  unanswered: "Waiting for a reply from a person",
  missed: "Missed-call leads",
  recovered: "Recovered missed calls",
  booked: "Leads with a consult booked",
  retained: "Retained leads",
};

function toQuery(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { user } = await requirePermission("leads.read");
  const tz = env().FIRM_TIMEZONE;
  const filters = leadFilterSchema.parse(await searchParams);
  const { rows, nextBefore } = await listLeads(user, filters);
  const { before: _before, ...filterOnly } = filters;
  const filtered = Object.values(filterOnly).some((v) => v !== undefined);

  return (
    <>
      <PageHeader
        eyebrow="Intake"
        title={filters.view ? VIEW_TITLES[filters.view] : "Leads"}
        description={
          filters.view === "unanswered"
            ? "Open enquiries nobody at the firm has replied to yet. Automatic acknowledgements do not count; a booked consult does."
            : `Newest first. Times in ${tz}.`
        }
        actions={
          <Button variant="ghost" asChild>
            <Link href="/intake">
              <ArrowLeft /> Intake
            </Link>
          </Button>
        }
      />

      <form method="get" className="mb-4 grid grid-cols-2 items-end gap-3 md:grid-cols-5">
        {filters.view ? <input type="hidden" name="view" value={filters.view} /> : null}
        {filters.days ? <input type="hidden" name="days" value={filters.days} /> : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="status">Status</Label>
          <Select id="status" name="status" defaultValue={filters.status ?? ""}>
            <option value="">Any status</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="source">Source</Label>
          <Select id="source" name="source" defaultValue={filters.source ?? ""}>
            <option value="">Any source</option>
            {Object.keys(SOURCE_LABELS).map((s) => (
              <option key={s} value={s}>
                {sourceDisplayName(s)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="practiceArea">Practice area</Label>
          <Select id="practiceArea" name="practiceArea" defaultValue={filters.practiceArea ?? ""}>
            <option value="">Any</option>
            {Object.entries(PRACTICE_AREA_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          {filtered ? (
            <Button variant="ghost" asChild>
              <Link href="/intake/leads">Clear</Link>
            </Button>
          ) : null}
        </div>
      </form>

      <Panel>
        {rows.length === 0 ? (
          <EmptyState title={filtered ? "No leads match" : "No leads yet"}>
            {filtered
              ? null
              : "Leads appear here as calls, forms and messages arrive from GoHighLevel."}
          </EmptyState>
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>First contact</Th>
                <Th>Person</Th>
                <Th>How</Th>
                <Th>Source</Th>
                <Th>Status</Th>
                <Th className="text-right">First response</Th>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="whitespace-nowrap" title={formatDateTime(r.firstInboundAt, tz)}>
                    {formatRelative(r.firstInboundAt)}
                  </Td>
                  <Td className="max-w-[240px]">
                    <Link
                      href={`/intake/leads/${r.id}` as Route}
                      className="block truncate text-accent hover:underline"
                    >
                      {r.name ?? r.phone ?? r.email ?? "Unknown caller"}
                    </Link>
                    {r.name && (r.phone || r.email) ? (
                      <span className="block truncate text-[12px] text-muted">
                        {r.phone ?? r.email}
                      </span>
                    ) : null}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {r.missedCall ? (
                      <span className="inline-flex items-center gap-1">
                        <PhoneMissed className="size-3.5 text-warning" aria-hidden /> Missed call
                        {r.recovered ? <span className="text-muted">, recovered</span> : null}
                      </span>
                    ) : (
                      LEAD_CHANNEL_LABELS[r.channel as keyof typeof LEAD_CHANNEL_LABELS]
                    )}
                  </Td>
                  <Td>{sourceDisplayName(r.source)}</Td>
                  <Td>
                    {r.status === "new" || (r.status === "contacted" && !r.firstHumanResponseAt) ? (
                      <StatusLabel tone="warning">{LEAD_STATUS_LABELS[r.status]}</StatusLabel>
                    ) : r.status === "retained" ? (
                      <StatusLabel tone="good">{LEAD_STATUS_LABELS[r.status]}</StatusLabel>
                    ) : (
                      LEAD_STATUS_LABELS[r.status]
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatDuration(r.firstResponseSeconds)}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
      {nextBefore ? (
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" asChild>
            <Link href={`/intake/leads${toQuery({ ...filterOnly, before: nextBefore })}` as Route}>
              Older leads
            </Link>
          </Button>
        </div>
      ) : null}
    </>
  );
}
