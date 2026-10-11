import type { Metadata, Route } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import {
  DRAFT_FINDING_LABELS,
  ESCALATION_LABELS,
  type DraftFinding,
  type EscalationReason,
} from "@/lib/ai/guard";
import { can } from "@/lib/auth/can";
import { requirePermission } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { cn } from "@/lib/ui/cn";
import { formatDateTime, formatDuration, formatPercent, formatRelative } from "@/lib/ui/format";
import { approvalMetrics, listApprovals } from "@/modules/approvals/queries";
import { ApprovalCard, type ApprovalCardData } from "./approval-card";

export const metadata: Metadata = { title: "Approvals" };

const AUTOMATION_NAMES: Record<string, string> = {
  A3: "A3 AI intake assistant",
  A5: "A5 Lead scoring and routing",
  A8: "A8 Pre-consult brief",
  A11: "A11 Non-engagement letter",
  A12: "A12 Referral-out",
};

function flagLabels(flags: unknown): string[] {
  if (!flags || typeof flags !== "object") return [];
  const f = flags as { findings?: string[]; escalations?: string[]; notes?: string[] };
  return [
    ...(f.escalations ?? []).map((e) => ESCALATION_LABELS[e as EscalationReason] ?? e),
    ...(f.findings ?? []).map((d) => DRAFT_FINDING_LABELS[d as DraftFinding] ?? d),
    ...(f.notes ?? []),
  ];
}

function sourceRows(sources: unknown): { label: string; value: string }[] {
  if (!sources || typeof sources !== "object") return [];
  return Object.entries(sources as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => ({
      label: k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()),
      value: typeof v === "string" ? v : JSON.stringify(v),
    }));
}

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { user, policy } = await requirePermission("approvals.read");
  const view = (await searchParams).view === "decided" ? "decided" : "pending";
  const tz = env().FIRM_TIMEZONE;
  const [items, metrics] = await Promise.all([listApprovals(user, view), approvalMetrics(user)]);
  const canDecide = can(user, "approvals.decide", { policy });

  const cards: ApprovalCardData[] = items.map((i) => ({
    id: i.id,
    automationId: i.automationId,
    kind: i.kind,
    priority: i.priority,
    title: i.title,
    channel: i.channel,
    subject: i.subject,
    draftBody: i.draftBody,
    leadId: i.leadId,
    contactLabel: i.contactName ?? i.contactPhone,
    createdLabel: formatRelative(i.createdAt),
    flags: flagLabels(i.flags),
    sources: sourceRows(i.sources),
  }));

  return (
    <>
      <PageHeader
        title="Approvals"
        description="AI drafts that need a person before they reach a client or prospect: anything about their situation, letters, briefs and conversations handed off by the assistant."
        actions={
          <nav aria-label="View" className="flex rounded-md border border-line bg-surface p-0.5">
            {(["pending", "decided"] as const).map((v) => (
              <Link
                key={v}
                href={(v === "pending" ? "/approvals" : "/approvals?view=decided") as Route}
                aria-current={v === view ? "page" : undefined}
                className={cn(
                  "rounded px-2.5 py-1 text-[12.5px]",
                  v === view ? "bg-accent-soft text-accent" : "text-ink-2 hover:text-ink",
                )}
              >
                {v === "pending" ? "Waiting" : "Decided"}
              </Link>
            ))}
          </nav>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {view === "pending" ? (
            cards.length === 0 ? (
              <Panel>
                <EmptyState title="Nothing is waiting for approval" />
              </Panel>
            ) : (
              cards.map((c) => <ApprovalCard key={c.id} item={c} canDecide={canDecide} />)
            )
          ) : (
            <Panel>
              {items.length === 0 ? (
                <EmptyState title="No decisions yet" />
              ) : (
                <Table>
                  <THead>
                    <tr>
                      <Th>Decided</Th>
                      <Th>Item</Th>
                      <Th>Outcome</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {items.map((i) => (
                      <Tr key={i.id} className="align-top">
                        <Td className="whitespace-nowrap">
                          {i.decidedAt ? formatDateTime(i.decidedAt, tz) : "–"}
                        </Td>
                        <Td>
                          <span className="font-mono text-[12px] text-muted">{i.automationId}</span>{" "}
                          {i.title}
                        </Td>
                        <Td>
                          {i.status === "rejected"
                            ? `Rejected: ${i.rejectReason ?? ""}`
                            : i.decidedBy
                              ? i.edited
                                ? "Approved with edits"
                                : "Approved"
                              : "Sent under firm policy (passed every check)"}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </Panel>
          )}
        </div>

        <Panel className="self-start">
          <PanelHeader
            title="Last 30 days"
            description="By automation. Edits and rejection reasons feed prompt review."
          />
          {metrics.length === 0 ? (
            <EmptyState title="No drafts yet" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Automation</Th>
                  <Th className="text-right">Approved</Th>
                  <Th className="text-right">Edited</Th>
                  <Th className="text-right">In queue</Th>
                </tr>
              </THead>
              <TBody>
                {metrics.map((m) => (
                  <Tr key={m.automationId}>
                    <Td title={AUTOMATION_NAMES[m.automationId]}>
                      {m.automationId}
                      {m.pending ? (
                        <span className="text-muted"> · {m.pending} waiting</span>
                      ) : null}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {m.decided ? formatPercent(m.approved / m.decided) : "–"}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {m.approved ? formatPercent(m.edited / m.approved) : "–"}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {m.medianMinutes === null
                        ? "–"
                        : formatDuration(Number(m.medianMinutes) * 60)}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Panel>
      </div>
    </>
  );
}
