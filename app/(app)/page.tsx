import type { Metadata } from "next";
import Link from "next/link";
import { ActorCell, actionTone } from "@/components/audit/actor-cell";
import { Badge, StatusLabel } from "@/components/ui/badge";
import {
  DataRow,
  EmptyState,
  PageHeader,
  Panel,
  PanelBody,
  PanelHeader,
} from "@/components/ui/panel";
import { Stat } from "@/components/ui/stat";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { can } from "@/lib/auth/can";
import { requirePermission } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { loadFirmSettings } from "@/lib/firm.config";
import { allFeatureStates, userLimit } from "@/lib/flags";
import {
  actionLabel,
  formatCount,
  formatDateTime,
  formatRelative,
  timeZoneAbbreviation,
} from "@/lib/ui/format";
import {
  auditCountLastHours,
  auditHead,
  failedSignInsLastHours,
  recentAuditEvents,
} from "@/modules/audit/queries";
import { listUsers, myRecentAuthEvents, summarizeAccess } from "@/modules/users/queries";
import { DEFAULT_AI_DISCLOSURE } from "@/modules/firm/schemas";
import { ghlConfigured } from "@/lib/ghl/client";
import { listTemplates } from "@/modules/messaging/queries";

export const metadata: Metadata = { title: "Overview" };

function greeting(timeZone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).format(
      new Date(),
    ),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const PRACTICE_LABELS = { tax: "Tax", business: "Business", estate: "Estate and probate" } as const;

export default async function OverviewPage() {
  const { user, policy } = await requirePermission("dashboard.view");
  const { FIRM_TIMEZONE: tz, FIRM_TIER: tier, DEMO_MODE } = env();
  const isOwner = can(user, "audit.read", { policy });
  const canSeeUsers = can(user, "users.read", { policy });

  const [firm, people, head, events24h, failed24h, features, activity, mine, templates] =
    await Promise.all([
      loadFirmSettings(),
      canSeeUsers ? listUsers(user) : Promise.resolve(null),
      auditHead(),
      auditCountLastHours(24),
      failedSignInsLastHours(24),
      allFeatureStates(),
      isOwner ? recentAuditEvents(user, 10) : Promise.resolve(null),
      myRecentAuthEvents(user, 6),
      isOwner ? listTemplates(user) : Promise.resolve([]),
    ]);

  const access = people ? summarizeAccess(people) : null;
  const seatLimit = userLimit(tier);
  const featuresOn = features.filter((f) => f.enabled).length;
  const featuresInPlan = features.filter((f) => f.inTier).length;
  const today = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
  const firstName = user.name.split(/\s+/)[0];

  const checklist = [
    {
      label: "Firm profile and address",
      done: Boolean(firm.addressLine1 && firm.city && firm.phone),
      href: "/settings/firm",
    },
    {
      label: "AI disclosure reviewed by the firm",
      done: firm.aiDisclosureText !== DEFAULT_AI_DISCLOSURE,
      href: "/settings/firm",
    },
    {
      label: "Every user signed in with MFA",
      done: access ? access.awaitingSetup === 0 && access.activeUsers > 1 : false,
      href: "/settings/users",
    },
    {
      label: DEMO_MODE ? "GoHighLevel connected (not in demo)" : "GoHighLevel connected",
      done: ghlConfigured() && Boolean(firm.bookingUrl),
      href: "/settings/integrations",
    },
    {
      label: "Automatic message templates approved",
      done: templates.length > 0 && templates.every((t) => t.approvedAt !== null),
      href: "/settings/templates",
    },
    {
      label: "Deadline rules verified by an attorney",
      done: false,
      later: "Available with the deadline engine",
    },
  ] as const;

  return (
    <>
      <PageHeader
        eyebrow={today}
        title={`${greeting(tz)}, ${firstName}`}
        description={
          <>
            {firm.legalName}
            {firm.city ? ` · ${firm.city}, ${firm.state ?? ""}` : ""} · Times shown in{" "}
            {timeZoneAbbreviation(tz)} ({tz})
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {access ? (
          <Stat
            label="Active users"
            value={formatCount(access.activeUsers)}
            context={
              seatLimit ? `of ${seatLimit} included in the Solo plan` : "Firm plan: no user limit"
            }
            definition="Staff accounts that can sign in. Deactivated accounts are excluded."
          />
        ) : null}
        {access ? (
          <Stat
            label="MFA enrolled"
            value={`${access.mfaEnrolled} / ${access.activeUsers}`}
            context={
              access.awaitingSetup === 0 ? (
                <StatusLabel tone="good">Everyone is enrolled</StatusLabel>
              ) : (
                <StatusLabel tone="warning">{access.awaitingSetup} awaiting setup</StatusLabel>
              )
            }
            definition="Active users who have completed authenticator app enrollment. Users cannot reach firm data until they do."
          />
        ) : null}
        <Stat
          label="Audit events, 24h"
          value={formatCount(events24h)}
          context={head ? `${formatCount(head.seq)} recorded since provisioning` : "None yet"}
          definition="Rows written to the audit log in the last 24 hours: sign-ins, changes and denials."
        />
        <Stat
          label="Failed sign-ins, 24h"
          value={formatCount(failed24h)}
          context={
            failed24h > 10 ? (
              <StatusLabel tone="warning">Above normal</StatusLabel>
            ) : (
              "Wrong passwords and MFA codes"
            )
          }
          definition="Rejected password or MFA attempts in the last 24 hours, from any network."
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          {activity ? (
            <Panel>
              <PanelHeader
                title="Recent activity"
                description="Latest entries in the firm's audit log."
                actions={
                  <Link href="/audit" className="text-[13px] text-accent hover:underline">
                    Open audit log
                  </Link>
                }
              />
              {activity.length === 0 ? (
                <EmptyState title="No activity yet" />
              ) : (
                <Table>
                  <THead>
                    <tr>
                      <Th>When</Th>
                      <Th>Who</Th>
                      <Th>What</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {activity.map((row) => (
                      <Tr key={row.id}>
                        <Td
                          className="whitespace-nowrap text-ink-2"
                          title={formatDateTime(row.occurredAt, tz)}
                        >
                          {formatRelative(row.occurredAt)}
                        </Td>
                        <Td className="max-w-[220px] truncate">
                          <ActorCell row={row} />
                        </Td>
                        <Td>
                          {actionTone(row.action) === "neutral" ? (
                            actionLabel(row.action)
                          ) : (
                            <StatusLabel
                              tone={actionTone(row.action) === "critical" ? "critical" : "warning"}
                            >
                              {actionLabel(row.action)}
                            </StatusLabel>
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </Panel>
          ) : (
            <Panel>
              <PanelHeader
                title="Your recent sign-ins"
                description="Tell your owner attorney about anything you do not recognize."
              />
              {mine.length === 0 ? (
                <EmptyState title="No sign-in history yet" />
              ) : (
                <Table>
                  <THead>
                    <tr>
                      <Th>When</Th>
                      <Th>Event</Th>
                      <Th>Network</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {mine.map((e, i) => (
                      <Tr key={i}>
                        <Td className="whitespace-nowrap">{formatDateTime(e.occurredAt, tz)}</Td>
                        <Td>{actionLabel(e.action)}</Td>
                        <Td className="font-mono text-[12px] text-ink-2">{e.ip ?? "–"}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </Panel>
          )}

          {isOwner ? (
            <Panel>
              <PanelHeader
                title="Setup checklist"
                description="What remains before the firm relies on LexDesk day to day."
              />
              <ul className="divide-y divide-line">
                {checklist.map((item) => (
                  <li
                    key={item.label}
                    className="flex items-center justify-between gap-4 px-5 py-3"
                  >
                    {item.done ? (
                      <StatusLabel tone="good">{item.label}</StatusLabel>
                    ) : "later" in item ? (
                      <StatusLabel tone="neutral">{item.label}</StatusLabel>
                    ) : (
                      <StatusLabel tone="warning">{item.label}</StatusLabel>
                    )}
                    {"later" in item ? (
                      <span className="text-[12px] text-muted">{item.later}</span>
                    ) : item.done ? null : (
                      <Link href={item.href} className="text-[13px] text-accent hover:underline">
                        Review
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>

        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Audit integrity" />
            <PanelBody>
              {head ? (
                <dl>
                  <DataRow label="Entries">{formatCount(head.seq)}</DataRow>
                  <DataRow label="Latest">{formatDateTime(head.occurredAt, tz)}</DataRow>
                  <DataRow label="Chain head">
                    <span className="font-mono text-[12px]" title={head.hash}>
                      {head.hash.slice(0, 16)}…
                    </span>
                  </DataRow>
                </dl>
              ) : (
                <p className="text-[13px] text-muted">No entries yet.</p>
              )}
              <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
                Entries cannot be edited or deleted. Each one carries a hash of the one before it,
                so any alteration is detectable.
                {isOwner ? (
                  <>
                    {" "}
                    <Link href="/audit" className="text-accent hover:underline">
                      Verify the chain
                    </Link>
                  </>
                ) : null}
              </p>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Deployment" />
            <PanelBody>
              <dl>
                <DataRow label="Plan">{tier === "firm" ? "Firm" : "Solo"}</DataRow>
                <DataRow label="Environment">
                  {DEMO_MODE ? (
                    <Badge tone="warning">Demo</Badge>
                  ) : (
                    <Badge tone="good">Production</Badge>
                  )}
                </DataRow>
                <DataRow label="Time zone">{tz}</DataRow>
                <DataRow label="Practice areas">
                  {firm.practiceAreas.map((a) => PRACTICE_LABELS[a]).join(", ") || "–"}
                </DataRow>
                <DataRow label="Features switched on">
                  {featuresOn} of {featuresInPlan} in plan
                </DataRow>
                <DataRow label="Session timeout">30 min idle</DataRow>
                <DataRow label="Network restriction">
                  {firm.ipAllowlist.length ? `${firm.ipAllowlist.length} allowed range(s)` : "None"}
                </DataRow>
              </dl>
            </PanelBody>
          </Panel>
        </div>
      </div>
    </>
  );
}
