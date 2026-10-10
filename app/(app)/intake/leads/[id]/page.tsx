import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge, StatusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
};

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
