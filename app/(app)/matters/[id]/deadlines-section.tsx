import { Badge, StatusLabel } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { EmptyState, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import type { Actor } from "@/lib/auth/can";
import type { MatterRow } from "@/db/schema";
import { formatDate } from "@/modules/deadlines/date-math";
import { dueInWords, VERIFICATION_LABELS } from "@/modules/deadlines/engine";
import { matterDeadlines } from "@/modules/deadlines/queries";
import { SEVERITY_LABELS } from "@/practice";
import {
  AddDeadlineForm,
  DeadlineRowActions,
  EventForm,
  PaymentPlanForm,
  RemoveEvent,
  RemoveTolling,
  TollingForm,
} from "../../deadlines/deadline-controls";
import { SEVERITY_TONE } from "../../deadlines/tones";

const ORIGIN_LABELS = {
  rule: "Computed from a verified rule",
  document: "Printed on the document",
  manual: "Entered by staff",
  schedule: "Payment plan",
} as const;

/** Deadlines on a matter (C1, C2, C4, C5). Every view carries the rule 7 line. */
export async function DeadlinesSection({
  actor,
  matter,
  staff,
}: {
  actor: Actor;
  matter: MatterRow;
  staff: { id: string; name: string; role: string }[];
}) {
  const v = await matterDeadlines(actor, matter);
  if (!v) return null;
  const open = matter.status === "open";
  const write = v.canWrite && open;
  const unack = new Map<string, number>();
  for (const a of v.alerts) unack.set(a.deadlineId, (unack.get(a.deadlineId) ?? 0) + 1);
  const people = staff.map((s) => ({ id: s.id, name: s.name }));

  return (
    <Panel id="deadlines">
      <PanelHeader
        title="Deadlines"
        description="Trigger events, the deadlines computed from them by verified rules (C1), and alerts (C2)."
      />
      <PanelBody className="space-y-3 border-b border-line">
        <Notice tone="warning">{v.notice}</Notice>
        {v.waiting.length > 0 ? (
          <Notice tone="critical" title="Rules not verified: no date computed">
            {v.waiting.map((w) => (
              <span key={w.rule} className="block">
                {w.rule} (from the {w.event.toLowerCase()}). The owner attorney verifies rules in
                Settings &gt; Deadline rules.
              </span>
            ))}
          </Notice>
        ) : null}
        {write ? (
          <EventForm
            matterId={matter.id}
            defs={v.eventDefs.map((e) => ({
              key: e.key,
              label: e.label,
              asksNoticeType: e.asksNoticeType ?? false,
              flags: e.flags ?? [],
            }))}
          />
        ) : null}
      </PanelBody>

      {v.events.length > 0 ? (
        <PanelBody className="border-b border-line">
          <p className="eyebrow mb-2">Trigger events</p>
          <ul className="space-y-1.5 text-[13px]">
            {v.events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {v.eventDefs.find((d) => d.key === e.kind)?.label ?? e.kind}:{" "}
                  <span className="tabular-nums">{formatDate(e.occurredOn)}</span>
                  {e.noticeType ? <span className="text-muted"> · {e.noticeType}</span> : null}
                  {e.documentId ? (
                    <span className="text-muted"> · read from a document</span>
                  ) : null}
                </span>
                {write && !e.documentId ? (
                  <RemoveEvent matterId={matter.id} eventId={e.id} />
                ) : null}
              </li>
            ))}
          </ul>
        </PanelBody>
      ) : null}

      {v.deadlines.length === 0 ? (
        <EmptyState title="No deadlines">
          Record a trigger event, or add a deadline the firm has calculated itself.
        </EmptyState>
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
            {v.deadlines.map(({ d, owner }) => {
              const tolling = v.tolling.filter((t) => t.deadlineId === d.id);
              return (
                <Tr key={d.id} className={d.status !== "open" ? "text-muted" : undefined}>
                  <Td className="whitespace-nowrap align-top">
                    <span className="tabular-nums">{formatDate(d.dueOn)}</span>
                    {d.status === "open" ? (
                      <span className="block text-[12px]">
                        <StatusLabel
                          tone={
                            d.dueOn < v.today
                              ? "critical"
                              : d.dueOn <= v.today
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {dueInWords(v.today, d.dueOn)}
                        </StatusLabel>
                      </span>
                    ) : (
                      <span className="block text-[12px]">
                        {d.status === "done" ? "Done" : d.status}
                      </span>
                    )}
                  </Td>
                  <Td className="align-top">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={SEVERITY_TONE[d.severity]}>{SEVERITY_LABELS[d.severity]}</Badge>
                      {!d.confirmed ? <Badge tone="warning">Not confirmed</Badge> : null}
                      {d.ruleChanged ? (
                        <Badge tone="critical">Rule changed; re-verify</Badge>
                      ) : null}
                      {unack.get(d.id) ? (
                        <Badge tone="critical">Alert not acknowledged</Badge>
                      ) : null}
                      <span className="font-medium">{d.label}</span>
                    </div>
                    <p className="mt-1 text-[12px] text-muted">
                      {ORIGIN_LABELS[d.origin]}
                      {d.computation?.length ? `: ${d.computation.join(". ")}.` : "."}
                    </p>
                    {d.crossCheck ? (
                      <p
                        className={`mt-0.5 text-[12px] ${d.crossCheck.matches ? "text-muted" : "text-critical"}`}
                      >
                        Cross-check, {d.crossCheck.ruleLabel}: {formatDate(d.crossCheck.dueOn)}
                        {d.crossCheck.matches ? " (matches)" : " (differs from the printed date)"}
                      </p>
                    ) : null}
                    {tolling.length ? (
                      <ul className="mt-1 space-y-0.5 text-[12px]">
                        {tolling.map((t) => (
                          <li key={t.id} className="flex items-center gap-2">
                            <span>
                              Tolling +{t.days} days: {t.reason}
                              {t.fromOn ? ` (${t.fromOn} to ${t.toOn ?? "…"})` : ""}
                            </span>
                            {write ? <RemoveTolling matterId={matter.id} tollingId={t.id} /> : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {write ? (
                      <div className="mt-2">
                        <DeadlineRowActions
                          matterId={matter.id}
                          deadline={{
                            id: d.id,
                            origin: d.origin,
                            status: d.status,
                            ownerId: d.ownerId,
                            dueOn: d.dueOn,
                            unacknowledged: unack.get(d.id) ?? 0,
                          }}
                          staff={people}
                        />
                      </div>
                    ) : null}
                    {write && d.status === "open" && d.ruleId && v.tollable.has(d.ruleId) ? (
                      <div className="mt-3">
                        <TollingForm matterId={matter.id} deadlineId={d.id} />
                      </div>
                    ) : null}
                  </Td>
                  <Td className="align-top">
                    {owner ?? <span className="text-critical">No owner</span>}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}

      {v.milestones ? (
        <PanelBody className="border-t border-line">
          <p className="eyebrow mb-2">Probate milestones (C4)</p>
          <ol className="space-y-1.5 text-[13px]">
            {v.milestones.map((ms) => (
              <li key={ms.ruleId} className="flex flex-wrap items-baseline justify-between gap-2">
                <span>{ms.label}</span>
                <span className="text-[12.5px]">
                  {ms.verification !== "verified" ? (
                    <StatusLabel tone="warning">{VERIFICATION_LABELS[ms.verification]}</StatusLabel>
                  ) : !ms.event ? (
                    <span className="text-muted">Waiting for: {ms.trigger.toLowerCase()}</span>
                  ) : ms.deadline ? (
                    <StatusLabel
                      tone={
                        ms.deadline.status === "done"
                          ? "good"
                          : ms.deadline.dueOn < v.today
                            ? "critical"
                            : "info"
                      }
                    >
                      {ms.deadline.status === "done"
                        ? "Done"
                        : `Due ${formatDate(ms.deadline.dueOn)}`}
                    </StatusLabel>
                  ) : (
                    <span className="text-muted">Not computed</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </PanelBody>
      ) : null}

      {v.showPaymentPlan ? (
        <PanelBody className="border-t border-line">
          <p className="eyebrow mb-2">Installment agreement payments (C5)</p>
          {v.paymentPlan ? (
            <p className="mb-2 text-[13px]">
              {v.paymentPlan.status === "active" ? "Tracking" : "Ended"}: monthly on day{" "}
              {v.paymentPlan.dayOfMonth} from {formatDate(v.paymentPlan.firstDueOn)}
              {v.paymentPlan.amount ? `, ${v.paymentPlan.amount}` : ""}. Mark each payment done when
              it is made.
            </p>
          ) : null}
          {write ? (
            <PaymentPlanForm
              matterId={matter.id}
              plan={
                v.paymentPlan
                  ? {
                      firstDueOn: v.paymentPlan.firstDueOn,
                      dayOfMonth: v.paymentPlan.dayOfMonth,
                      amount: v.paymentPlan.amount,
                      status: v.paymentPlan.status,
                    }
                  : null
              }
            />
          ) : null}
        </PanelBody>
      ) : null}

      {write ? (
        <PanelBody className="border-t border-line">
          <p className="eyebrow mb-2">Add a deadline</p>
          <AddDeadlineForm matterId={matter.id} staff={people} />
        </PanelBody>
      ) : null}
    </Panel>
  );
}
