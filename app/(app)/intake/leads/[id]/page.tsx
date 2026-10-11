import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge, StatusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import {
  DataRow,
  EmptyState,
  PageHeader,
  Panel,
  PanelBody,
  PanelHeader,
} from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import type { MessageRow } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { formatDateTime, formatDuration } from "@/lib/ui/format";
import { sourceDisplayName } from "@/modules/intake/attribution";
import {
  LEAD_CHANNEL_LABELS,
  LEAD_STATUS_LABELS,
  PRACTICE_AREA_LABELS,
  suppressionLabel,
} from "@/modules/intake/labels";
import { leadDetail } from "@/modules/intake/queries";
import { leadIntake } from "@/modules/intake/ai-queries";
import { can } from "@/lib/auth/can";
import { DEADLINE_NOTICE } from "@/modules/intake/commands/followups";
import { ConflictReview, DeclineLead, ReferOut, RerunConflict } from "./intake-actions";

export const metadata: Metadata = { title: "Lead" };

const MESSAGE_STATUS: Record<
  MessageRow["status"],
  { label: string; tone: "good" | "warning" | "critical" | "neutral" | "info" }
> = {
  queued: { label: "Scheduled", tone: "info" },
  sending: { label: "Sending", tone: "info" },
  sent: { label: "Sent", tone: "good" },
  simulated: { label: "Simulated (demo)", tone: "neutral" },
  failed: { label: "Failed", tone: "critical" },
  unknown: { label: "Outcome unknown: check GoHighLevel", tone: "critical" },
  suppressed: { label: "Not sent", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  received: { label: "Received", tone: "neutral" },
  observed: { label: "Sent from GoHighLevel", tone: "neutral" },
};

const TEMPLATE_NAMES: Record<string, string> = {
  "A1.sms": "Missed-call text-back",
  "A2.sms": "Enquiry acknowledgement (text)",
  "A2.email": "Enquiry acknowledgement (email)",
  "A7.confirmation.sms": "Consult confirmation",
  "A7.reminder_24h.sms": "Consult reminder, 24 hours",
  "A7.reminder_2h.sms": "Consult reminder, 2 hours",
  "A7.no_show.sms": "No-show rebooking",
  "A7.no_show_followup.sms": "No-show follow-up",
  "A3.handoff.sms": "Hand-off to a person",
  "A5.urgent.sms": "Urgent enquiry alert",
  "A10.day30.email": "Nurture, 30 days",
  "A10.day60.email": "Nurture, 60 days",
  "A10.day90.email": "Nurture, 90 days",
};

const MATCH_REASONS: Record<string, string> = {
  exact: "Same name",
  nickname: "Nickname of the same name",
  reordered: "Same names in a different order",
  same_surname_initial: "Same surname and first initial",
  similar_spelling: "Similar spelling",
  name_contains: "One business name contains the other",
};

const CHECK_STATUS = {
  awaiting_review: { label: "Awaiting a lawyer's review", tone: "warning" },
  cleared: { label: "Cleared", tone: "good" },
  conflict: { label: "Conflict recorded", tone: "critical" },
} as const;

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requirePermission("leads.read");
  const tz = env().FIRM_TIMEZONE;
  const detail = await leadDetail(user, (await params).id);
  if (!detail) notFound();
  const { lead, contact, touches } = detail;
  const name = contact?.fullName ?? contact?.phone ?? contact?.email ?? "Unknown caller";
  const first = touches[0];
  const last = touches.at(-1);
  const smsConsent = detail.consents.find((c) => c.channel === "sms");
  const intake = await leadIntake(user, lead.id);
  const open = ["new", "contacted", "consult_booked", "consult_held"].includes(lead.status);

  return (
    <>
      <PageHeader
        eyebrow={`Lead · ${LEAD_CHANNEL_LABELS[lead.channel]}${lead.missedCall ? " · missed call" : ""}`}
        title={name}
        description={`First in touch ${formatDateTime(lead.firstInboundAt, tz)}`}
        actions={
          <Button variant="ghost" asChild>
            <Link href="/intake/leads">
              <ArrowLeft /> Leads
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Panel>
            <PanelHeader
              title="Intake record"
              description="Collected by the intake assistant (A3) or staff. Identifiers are masked."
            />
            {!intake.record ? (
              <EmptyState title="No intake answers yet" />
            ) : (
              <PanelBody>
                {intake.record.escalations.length > 0 ? (
                  <Notice tone="critical" title="Escalated to a person" className="mb-3">
                    {intake.record.escalations.join(", ")}
                  </Notice>
                ) : null}
                {intake.record.outOfScope ? (
                  <Notice tone="warning" title="Outside the firm's practice areas" className="mb-3">
                    {intake.record.outOfScopeTopic ?? "Topic not recorded"}
                  </Notice>
                ) : null}
                <dl>
                  <DataRow label="Practice area">
                    {intake.record.practiceArea
                      ? PRACTICE_AREA_LABELS[intake.record.practiceArea]
                      : "Not yet known"}
                  </DataRow>
                  {intake.questions.map((q) => (
                    <DataRow key={q.id} label={q.label}>
                      {q.value ?? (
                        <span className="text-muted">{q.required ? "Not yet answered" : "–"}</span>
                      )}
                    </DataRow>
                  ))}
                  <DataRow label="Status">
                    {intake.record.complete
                      ? "Complete"
                      : `${intake.record.missing.length} required answer(s) missing`}
                    {intake.record.handedOffAt
                      ? ` · handed to a person ${formatDateTime(intake.record.handedOffAt, tz)}`
                      : ""}
                  </DataRow>
                </dl>
                {intake.questions.some((q) => q.id === "respond_by" || q.id === "date_of_death") ? (
                  <p className="mt-3 text-[12px] text-muted">{DEADLINE_NOTICE}</p>
                ) : null}
              </PanelBody>
            )}
          </Panel>

          {intake.canConflicts ? (
            <Panel>
              <PanelHeader
                title="Conflict pre-screen (A6)"
                description="Possible matches against contacts and the firm's conflict list. A lawyer decides; it never clears on its own."
              />
              <PanelBody>
                {!intake.conflict ? (
                  <div className="space-y-3">
                    <p className="text-[13px] text-muted">
                      Not run yet. It runs when the intake record is complete.
                    </p>
                    {can(user, "leads.write") ? <RerunConflict leadId={lead.id} /> : null}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <StatusLabel tone={CHECK_STATUS[intake.conflict.status].tone}>
                        {CHECK_STATUS[intake.conflict.status].label}
                      </StatusLabel>
                      <span className="text-[12px] text-muted">
                        Checked {intake.conflict.names.length} name(s){" "}
                        {formatDateTime(intake.conflict.createdAt, tz)}
                      </span>
                    </div>
                    {intake.conflict.hits.length === 0 ? (
                      <p className="mt-3 text-[13px]">No possible matches found.</p>
                    ) : (
                      <Table className="mt-3">
                        <THead>
                          <tr>
                            <Th>Name given</Th>
                            <Th>Possible match</Th>
                            <Th>Why</Th>
                          </tr>
                        </THead>
                        <TBody>
                          {intake.conflict.hits.map((h) => (
                            <Tr key={h.id}>
                              <Td>{h.queryName}</Td>
                              <Td>
                                {h.matchedName} <span className="text-muted">({h.role})</span>
                              </Td>
                              <Td className="text-[12.5px]">
                                {MATCH_REASONS[h.reason] ?? h.reason} ·{" "}
                                {Math.round(h.similarity * 100)}%
                              </Td>
                            </Tr>
                          ))}
                        </TBody>
                      </Table>
                    )}
                    {intake.conflict.status !== "awaiting_review" ? (
                      <p className="mt-3 text-[13px] text-ink-2">
                        {intake.conflict.reviewedBy ?? "A lawyer"} ·{" "}
                        {intake.conflict.reviewedAt
                          ? formatDateTime(intake.conflict.reviewedAt, tz)
                          : ""}
                        : {intake.conflict.reviewNote}
                      </p>
                    ) : can(user, "conflicts.review") ? (
                      <ConflictReview leadId={lead.id} checkId={intake.conflict.id} />
                    ) : (
                      <p className="mt-3 text-[13px] text-muted">
                        Waiting for an attorney to review.
                      </p>
                    )}
                  </>
                )}
              </PanelBody>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader
              title="Messages"
              description="Automatic messages and anything seen in GoHighLevel."
            />
            {detail.messages.length === 0 ? (
              <EmptyState title="No messages yet" />
            ) : (
              <ul className="divide-y divide-line">
                {detail.messages.map((m) => {
                  const s = MESSAGE_STATUS[m.status];
                  const when = m.sentAt ?? m.occurredAt ?? m.scheduledFor ?? m.createdAt;
                  return (
                    <li key={m.id} className="px-5 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-[13px] font-medium">
                          {m.direction === "inbound"
                            ? `Inbound ${m.channel}`
                            : m.templateKey
                              ? `${m.automationId} · ${TEMPLATE_NAMES[m.templateKey] ?? m.templateKey}`
                              : `Outbound ${m.channel}`}
                        </span>
                        <span className="text-[12px] text-muted">
                          {m.status === "queued" ? "Due " : ""}
                          {formatDateTime(when, tz)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <StatusLabel tone={s.tone}>{s.label}</StatusLabel>
                        {m.suppressedReason ? (
                          <span className="text-[12px] text-muted">
                            {suppressionLabel(m.suppressedReason)}
                          </span>
                        ) : null}
                        {m.deferredFrom ? (
                          <span className="text-[12px] text-muted">
                            Held for quiet hours from {formatDateTime(m.deferredFrom, tz)}
                          </span>
                        ) : null}
                      </div>
                      {m.body ? (
                        <p className="mt-2 whitespace-pre-line rounded-md bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
                          {m.subject ? (
                            <span className="block font-medium text-ink">{m.subject}</span>
                          ) : null}
                          {m.body}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Calls" />
            {detail.calls.length === 0 ? (
              <EmptyState title="No calls" />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>When</Th>
                    <Th>Direction</Th>
                    <Th>Outcome</Th>
                    <Th className="text-right">Length</Th>
                  </tr>
                </THead>
                <TBody>
                  {detail.calls.map((c) => (
                    <Tr key={c.id}>
                      <Td>{formatDateTime(c.occurredAt, tz)}</Td>
                      <Td className="capitalize">{c.direction}</Td>
                      <Td>
                        {c.outcome === "answered" ? (
                          "Answered"
                        ) : (
                          <StatusLabel tone="warning">
                            {c.outcome === "voicemail" ? "Voicemail" : "Missed"}
                          </StatusLabel>
                        )}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {c.durationSeconds ? formatDuration(c.durationSeconds) : "–"}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Consults" />
            {detail.appointments.length === 0 ? (
              <EmptyState title="No consult booked" />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>When</Th>
                    <Th>Status</Th>
                  </tr>
                </THead>
                <TBody>
                  {detail.appointments.map((a) => (
                    <Tr key={a.id}>
                      <Td>{formatDateTime(a.startsAt, tz)}</Td>
                      <Td className="capitalize">{a.status === "noshow" ? "No-show" : a.status}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          {intake.record?.score !== null && intake.record?.score !== undefined ? (
            <Panel>
              <PanelHeader title="Score (A5)" description="Urgency, matter value and fit." />
              <PanelBody>
                <p className="text-2xl font-semibold tabular-nums">
                  {intake.record.score}
                  <span className="text-[13px] font-normal text-muted"> / 100</span>
                  {intake.record.urgent ? (
                    <Badge tone="critical" className="ml-2 align-middle">
                      Urgent
                    </Badge>
                  ) : null}
                </p>
                {intake.record.breakdown ? (
                  <dl className="mt-2">
                    <DataRow label="Urgency">{intake.record.breakdown.urgency} / 40</DataRow>
                    <DataRow label="Value">{intake.record.breakdown.value} / 35</DataRow>
                    <DataRow label="Fit">{intake.record.breakdown.fit} / 25</DataRow>
                  </dl>
                ) : null}
                {intake.record.breakdown?.notes.length ? (
                  <ul className="mt-2 list-disc pl-5 text-[12.5px] text-ink-2">
                    {intake.record.breakdown.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                ) : null}
              </PanelBody>
            </Panel>
          ) : null}

          {intake.drafts.length > 0 ? (
            <Panel>
              <PanelHeader title="Drafts and approvals" />
              <ul className="divide-y divide-line">
                {intake.drafts.map((d) => (
                  <li key={d.id} className="px-5 py-2.5 text-[13px]">
                    <span className="font-medium">{d.automationId}</span> · {d.title}
                    <span className="block text-[12px] capitalize text-muted">
                      {d.status} · {formatDateTime(d.createdAt, tz)}
                    </span>
                  </li>
                ))}
              </ul>
              <PanelBody className="pt-0">
                <Link href="/approvals" className="text-[13px] text-accent hover:underline">
                  Open the approval queue
                </Link>
              </PanelBody>
            </Panel>
          ) : null}

          {open && (can(user, "leads.decline") || can(user, "leads.write")) ? (
            <Panel>
              <PanelHeader title="Next steps" />
              <PanelBody className="space-y-5">
                {can(user, "leads.write") ? (
                  <div>
                    <p className="mb-2 text-[13px] font-medium">Refer out (A12)</p>
                    {intake.referred.length > 0 ? (
                      <p className="mb-2 text-[12.5px] text-muted">
                        Referred to{" "}
                        {intake.referred
                          .map((r) => `${r.partner}${r.sentAt ? " (sent)" : " (draft)"}`)
                          .join(", ")}
                      </p>
                    ) : null}
                    <ReferOut leadId={lead.id} partners={intake.partners} />
                  </div>
                ) : null}
                {can(user, "leads.decline") ? (
                  <div>
                    <p className="mb-2 text-[13px] font-medium">Decline (A11)</p>
                    <DeclineLead leadId={lead.id} />
                  </div>
                ) : null}
              </PanelBody>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader title="Lead" />
            <PanelBody>
              <dl>
                <DataRow label="Status">{LEAD_STATUS_LABELS[lead.status]}</DataRow>
                <DataRow label="Practice area">
                  {lead.practiceArea ? PRACTICE_AREA_LABELS[lead.practiceArea] : "Not yet assigned"}
                </DataRow>
                <DataRow label="First response">
                  {lead.firstResponseAt
                    ? formatDuration(
                        (lead.firstResponseAt.getTime() - lead.firstInboundAt.getTime()) / 1000,
                      )
                    : "None yet"}
                </DataRow>
                <DataRow label="First reply by a person">
                  {lead.firstHumanResponseAt
                    ? formatDuration(
                        (lead.firstHumanResponseAt.getTime() - lead.firstInboundAt.getTime()) /
                          1000,
                      )
                    : "None yet"}
                </DataRow>
                <DataRow label="Consult booked">
                  {lead.consultBookedAt ? formatDateTime(lead.consultBookedAt, tz) : "–"}
                </DataRow>
                <DataRow label="Retained">
                  {lead.retainedAt ? formatDateTime(lead.retainedAt, tz) : "–"}
                </DataRow>
                {detail.opportunity ? (
                  <DataRow label="GoHighLevel opportunity">
                    <span className="capitalize">{detail.opportunity.status}</span>
                    {detail.opportunity.monetaryValue
                      ? ` · $${detail.opportunity.monetaryValue}`
                      : ""}
                  </DataRow>
                ) : null}
              </dl>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Contact" />
            <PanelBody>
              <dl>
                <DataRow label="Phone">{contact?.phone ?? "–"}</DataRow>
                <DataRow label="Email">{contact?.email ?? "–"}</DataRow>
                {contact?.companyName ? (
                  <DataRow label="Company">{contact.companyName}</DataRow>
                ) : null}
                <DataRow label="Texts">
                  {contact?.dnd || contact?.dndSms ? (
                    <Badge tone="warning">Do not disturb</Badge>
                  ) : smsConsent ? (
                    smsConsent.status === "granted" ? (
                      `Opted in ${formatDateTime(smsConsent.capturedAt, tz)}`
                    ) : (
                      "Opted out"
                    )
                  ) : (
                    "No opt-in on record"
                  )}
                </DataRow>
              </dl>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              title="Source (F1)"
              description="First and last touch recorded for this lead."
            />
            <PanelBody>
              {first ? (
                <dl>
                  <DataRow label="First touch">{sourceDisplayName(first.sourceLabel)}</DataRow>
                  <DataRow label="Last touch">{sourceDisplayName(last!.sourceLabel)}</DataRow>
                  {first.utmCampaign ? (
                    <DataRow label="Campaign">{first.utmCampaign}</DataRow>
                  ) : null}
                  {first.landingUrl ? (
                    <DataRow label="Landing page">
                      <span className="break-all">{first.landingUrl}</span>
                    </DataRow>
                  ) : null}
                  {first.trackingNumber ? (
                    <DataRow label="Number dialed">{first.trackingNumber}</DataRow>
                  ) : null}
                  {first.ghlSource ? (
                    <DataRow label="GoHighLevel source">{first.ghlSource}</DataRow>
                  ) : null}
                </dl>
              ) : (
                <p className="text-[13px] text-muted">No source recorded.</p>
              )}
            </PanelBody>
          </Panel>
        </div>
      </div>
    </>
  );
}
