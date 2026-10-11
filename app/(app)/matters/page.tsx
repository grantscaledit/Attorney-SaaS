import type { Metadata, Route } from "next";
import Link from "next/link";
import { Badge, StatusLabel } from "@/components/ui/badge";
import { EmptyState, PageHeader, Panel } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { requirePermission } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { cn } from "@/lib/ui/cn";
import { formatDate } from "@/lib/ui/format";
import { PRACTICE_AREA_LABELS } from "@/modules/intake/labels";
import { listMatters, matterFilterSchema, type MatterFilters } from "@/modules/matters/queries";

export const metadata: Metadata = { title: "Matters" };

const VIEWS: { key: MatterFilters["view"] | undefined; label: string }[] = [
  { key: undefined, label: "All open" },
  { key: "mine", label: "Mine" },
  { key: "stalled", label: "Past stage threshold" },
  { key: "waiting_on_client", label: "Waiting on client" },
];

export default async function MattersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { user } = await requirePermission("matters.read");
  const tz = env().FIRM_TIMEZONE;
  const filters = matterFilterSchema.parse(await searchParams);
  const rows = await listMatters(user, filters);
  return (
    <>
      <PageHeader
        title={filters.status === "closed" ? "Closed matters" : "Matters"}
        description="Open a matter from a retained lead's page. Days in stage turn red past the stage's threshold."
        actions={
          <Link
            href={(filters.status === "closed" ? "/matters" : "/matters?status=closed") as Route}
            className="text-[13px] text-accent hover:underline"
          >
            {filters.status === "closed" ? "Open matters" : "Closed matters"}
          </Link>
        }
      />
      {filters.status === "open" ? (
        <nav aria-label="View" className="mb-4 flex flex-wrap gap-1">
          {VIEWS.map((v) => (
            <Link
              key={v.label}
              href={(v.key ? `/matters?view=${v.key}` : "/matters") as Route}
              aria-current={filters.view === v.key ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1 text-[12.5px]",
                filters.view === v.key
                  ? "bg-accent-soft text-accent"
                  : "text-ink-2 hover:bg-surface-2",
              )}
            >
              {v.label}
            </Link>
          ))}
        </nav>
      ) : null}
      <Panel>
        {rows.length === 0 ? (
          <EmptyState title="No matters here" />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Matter</Th>
                <Th>Client</Th>
                <Th>Type</Th>
                <Th>Stage</Th>
                <Th className="text-right">Days in stage</Th>
                <Th>Attorney</Th>
                <Th className="text-right">Open tasks</Th>
                <Th className="text-right">Documents needed</Th>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link
                      href={`/matters/${r.id}` as Route}
                      className="font-medium text-accent hover:underline"
                    >
                      {r.number}
                    </Link>
                    <span className="block text-[12px] text-muted">
                      Opened {formatDate(r.openedAt, tz)}
                    </span>
                  </Td>
                  <Td>{r.clientName ?? "–"}</Td>
                  <Td>
                    {r.typeLabel}
                    <span className="block text-[12px] text-muted">
                      {PRACTICE_AREA_LABELS[r.practiceArea]}
                    </span>
                  </Td>
                  <Td>
                    {r.stageLabel}
                    {r.waitingOnClient ? (
                      <Badge tone="outline" className="ml-1.5">
                        Client
                      </Badge>
                    ) : null}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {r.stalled ? (
                      <StatusLabel tone="critical">
                        {r.daysInStage} / {r.thresholdDays}
                      </StatusLabel>
                    ) : (
                      `${r.daysInStage}${r.thresholdDays !== null ? ` / ${r.thresholdDays}` : ""}`
                    )}
                  </Td>
                  <Td>{r.responsibleName ?? "Unassigned"}</Td>
                  <Td className="text-right tabular-nums">{r.openTasks}</Td>
                  <Td className="text-right tabular-nums">{r.checklistOpen}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
    </>
  );
}
