import type { Metadata, Route } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { ActorCell, actionTone } from "@/components/audit/actor-cell";
import { StatusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { EmptyState, PageHeader, Panel } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { diffSnapshots } from "@/lib/audit/diff";
import { requirePermission } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { actionLabel, formatDateTime, timeZoneAbbreviation } from "@/lib/ui/format";
import { auditFilterSchema, distinctAuditActions, listAuditEvents } from "@/modules/audit/queries";
import { VerifyChainButton } from "./verify-chain-button";

export const metadata: Metadata = { title: "Audit log" };

function toQuery(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "–";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { user } = await requirePermission("audit.read");
  const tz = env().FIRM_TIMEZONE;
  const filters = auditFilterSchema.parse(await searchParams);
  const [{ rows, nextBefore }, actions] = await Promise.all([
    listAuditEvents(user, filters, tz),
    distinctAuditActions(user),
  ]);
  const { before: _before, ...filterOnly } = filters;
  const filtered = Object.values(filterOnly).some((v) => v !== undefined);

  return (
    <>
      <PageHeader
        title="Audit log"
        description={`Every sign-in, change and denied attempt, in order. Entries cannot be edited or deleted. Times in ${timeZoneAbbreviation(tz)}.`}
        actions={
          <>
            <VerifyChainButton />
            <Button variant="secondary" asChild>
              <a href={`/api/audit/export${toQuery(filterOnly)}`}>
                <Download /> Export CSV
              </a>
            </Button>
          </>
        }
      />

      <form
        method="get"
        className="mb-4 grid grid-cols-2 items-end gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto_auto_auto]"
      >
        <div className="col-span-2 flex flex-col gap-1.5 md:col-span-1">
          <Label htmlFor="q">Search</Label>
          <Input
            id="q"
            name="q"
            defaultValue={filters.q}
            placeholder="Email, record id or action"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="action">Event</Label>
          <Select id="action" name="action" defaultValue={filters.action ?? ""}>
            <option value="">All events</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="actor">Actor</Label>
          <Select id="actor" name="actor" defaultValue={filters.actor ?? ""}>
            <option value="">Anyone</option>
            <option value="user">People</option>
            <option value="system">System</option>
            <option value="anonymous">Not signed in</option>
            <option value="vendor">Vendor support</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="date" defaultValue={filters.from} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="to">To</Label>
          <Input id="to" name="to" type="date" defaultValue={filters.to} />
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          {filtered ? (
            <Button variant="ghost" asChild>
              <Link href="/audit">Clear</Link>
            </Button>
          ) : null}
        </div>
      </form>

      <Panel>
        {rows.length === 0 ? (
          <EmptyState title={filtered ? "No entries match these filters" : "No entries yet"} />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th className="w-16">#</Th>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>What</Th>
                <Th>Record</Th>
                <Th>Network</Th>
              </tr>
            </THead>
            <TBody>
              {rows.map((row) => {
                const changes = diffSnapshots(row.before, row.after);
                const meta =
                  row.metadata && typeof row.metadata === "object"
                    ? Object.entries(row.metadata as Record<string, unknown>)
                    : [];
                const tone = actionTone(row.action);
                return (
                  <Tr key={row.id} className="align-top">
                    <Td className="font-mono text-[12px] text-muted">{row.seq}</Td>
                    <Td className="whitespace-nowrap">{formatDateTime(row.occurredAt, tz)}</Td>
                    <Td className="max-w-[220px] truncate">
                      <ActorCell row={row} />
                    </Td>
                    <Td className="min-w-[260px]">
                      {tone === "neutral" ? (
                        <span>{actionLabel(row.action)}</span>
                      ) : (
                        <StatusLabel tone={tone}>{actionLabel(row.action)}</StatusLabel>
                      )}
                      {changes.length > 0 || meta.length > 0 ? (
                        <details className="group mt-1">
                          <summary className="cursor-pointer list-none text-[12px] text-accent hover:underline">
                            <span className="group-open:hidden">Show details</span>
                            <span className="hidden group-open:inline">Hide details</span>
                          </summary>
                          <dl className="mt-2 space-y-1 rounded-md border border-line bg-sunken px-3 py-2 text-[12px]">
                            {changes.map((c) => (
                              <div
                                key={c.field}
                                className="grid grid-cols-[120px_minmax(0,1fr)] gap-2"
                              >
                                <dt className="font-mono text-muted">{c.field}</dt>
                                <dd className="break-words">
                                  {row.before !== null ? (
                                    <>
                                      <span className="text-critical line-through decoration-critical/50">
                                        {renderValue(c.before)}
                                      </span>
                                      <span className="mx-1.5 text-muted">→</span>
                                    </>
                                  ) : null}
                                  <span className="text-ink">{renderValue(c.after)}</span>
                                </dd>
                              </div>
                            ))}
                            {meta.map(([k, v]) => (
                              <div key={k} className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
                                <dt className="font-mono text-muted">{k}</dt>
                                <dd className="break-words text-ink-2">{renderValue(v)}</dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      ) : null}
                    </Td>
                    <Td className="font-mono text-[12px] text-ink-2">
                      {row.entityType ? (
                        <span title={row.entityId ?? undefined}>
                          {row.entityType}
                          {row.entityId ? `:${row.entityId.slice(0, 8)}` : ""}
                        </span>
                      ) : (
                        "–"
                      )}
                    </Td>
                    <Td className="font-mono text-[12px] text-ink-2">{row.ip ?? "–"}</Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </Panel>

      <div className="mt-4 flex items-center justify-between text-[13px] text-muted">
        <span>Showing {rows.length} entries, newest first.</span>
        {nextBefore ? (
          <Link
            href={`/audit${toQuery({ ...filterOnly, before: nextBefore })}` as Route}
            className="text-accent hover:underline"
          >
            Older entries
          </Link>
        ) : null}
      </div>
    </>
  );
}
