import type { Metadata } from "next";
import Link from "next/link";
import { Badge, StatusLabel } from "@/components/ui/badge";
import { CopyField } from "@/components/ui/copy-field";
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
import { requirePermission } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { loadFirmSettings } from "@/lib/firm.config";
import { LEXDESK_SECRET_HEADER } from "@/lib/ghl/endpoints";
import { formatCount, formatDateTime, formatRelative } from "@/lib/ui/format";
import { automationActivity, ghlConnection, recentWebhookEvents } from "@/modules/ghl/queries";
import { ReconcileNowButton, RetryWebhookButton } from "./integration-buttons";

export const metadata: Metadata = { title: "GoHighLevel" };

const AUTOMATION_NAMES: Record<string, string> = {
  A1: "A1 Missed-call text-back",
  A2: "A2 Instant lead response",
  A7: "A7 Consult booking and reminders",
};

function Check({ ok, children }: { ok: boolean; children: string }) {
  return <StatusLabel tone={ok ? "good" : "warning"}>{children}</StatusLabel>;
}

export default async function IntegrationsPage() {
  const { user } = await requirePermission("firm.settings.update");
  const tz = env().FIRM_TIMEZONE;
  const [conn, events, activity, firm] = await Promise.all([
    ghlConnection(user),
    recentWebhookEvents(user),
    automationActivity(user),
    loadFirmSettings(),
  ]);
  const reconcileStats = (conn.reconcile?.stats ?? null) as Record<string, number> | null;

  return (
    <>
      <PageHeader
        title="GoHighLevel"
        description="GoHighLevel handles the phone numbers, texts, email, calendars and forms. LexDesk mirrors its contacts, opportunities and appointments, and keeps the leads."
      />

      {conn.demoMode ? (
        <Notice tone="info" className="mb-5" title="Demo environment">
          A demo never connects to a live GoHighLevel account. Automatic messages are recorded as
          simulated and nothing is sent.
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Connection" />
            <PanelBody>
              <ul className="space-y-2">
                <li>
                  <Check ok={conn.apiConnected}>
                    {conn.apiConnected
                      ? `API connected to sub-account ${conn.locationId}`
                      : "API not connected (GHL_PRIVATE_TOKEN and GHL_LOCATION_ID)"}
                  </Check>
                </li>
                <li>
                  <Check ok={conn.webhookSecretSet}>
                    {conn.webhookSecretSet
                      ? "Webhook secret set"
                      : "Webhook secret missing (GHL_WEBHOOK_SECRET)"}
                  </Check>
                </li>
                <li>
                  <Check ok={conn.lastWebhookAt !== null}>
                    {conn.lastWebhookAt
                      ? `Last event received ${formatRelative(conn.lastWebhookAt)}`
                      : "No events received yet"}
                  </Check>
                </li>
                <li>
                  <Check ok={Boolean(firm.bookingUrl)}>
                    {firm.bookingUrl ? "Booking page link set" : "Booking page link missing"}
                  </Check>
                  {!firm.bookingUrl ? (
                    <Link
                      href="/settings/firm"
                      className="ml-2 text-[13px] text-accent hover:underline"
                    >
                      Set it in Firm settings
                    </Link>
                  ) : null}
                </li>
                <li>
                  <Check ok={Boolean(firm.intakeFormUrl)}>
                    {firm.intakeFormUrl
                      ? "Intake form link set"
                      : "Intake form link missing (needed for consult confirmations)"}
                  </Check>
                </li>
              </ul>
              <p className="mt-4 text-[12.5px] text-muted">
                Credentials live in the deployment&apos;s environment, never in the database. The
                setup steps are in the GoHighLevel runbook (docs/runbooks/ghl-setup.md).
              </p>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              title="Webhook setup"
              description="Paste these into the snapshot's workflows (Custom Webhook action)."
            />
            <PanelBody className="space-y-3">
              <div>
                <p className="mb-1.5 text-[12.5px] text-muted">URL (method POST)</p>
                <CopyField value={conn.webhookUrl} label="Webhook URL" />
              </div>
              <div>
                <p className="mb-1.5 text-[12.5px] text-muted">Header name</p>
                <CopyField value={LEXDESK_SECRET_HEADER} label="Header name" />
              </div>
              <p className="text-[12.5px] text-muted">
                The header value is the deployment&apos;s GHL_WEBHOOK_SECRET, from the provisioning
                output. It is not shown here.
              </p>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              title="Recent events"
              description="Type and outcome only. Payloads hold client data and are not shown."
            />
            {events.length === 0 ? (
              <EmptyState title="No events yet" />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Received</Th>
                    <Th>Event</Th>
                    <Th>Outcome</Th>
                    <Th className="text-right">
                      <span className="sr-only">Action</span>
                    </Th>
                  </tr>
                </THead>
                <TBody>
                  {events.map((e) => (
                    <Tr key={e.id}>
                      <Td className="whitespace-nowrap" title={formatDateTime(e.receivedAt, tz)}>
                        {formatRelative(e.receivedAt)}
                      </Td>
                      <Td>
                        <span className="font-mono text-[12px]">{e.eventType}</span>
                        {e.authMethod === "signature" ? (
                          <Badge tone="outline" className="ml-2">
                            signed
                          </Badge>
                        ) : null}
                      </Td>
                      <Td>
                        {e.status === "processed" ? (
                          <StatusLabel tone="good">Applied</StatusLabel>
                        ) : e.status === "failed" ? (
                          <StatusLabel tone="critical">
                            {`Failed (${e.attempts} attempt${e.attempts === 1 ? "" : "s"})`}
                          </StatusLabel>
                        ) : e.status === "ignored" ? (
                          <span className="text-[13px] text-muted" title={e.lastError ?? undefined}>
                            Not used
                          </span>
                        ) : (
                          <StatusLabel tone="info">Waiting</StatusLabel>
                        )}
                      </Td>
                      <Td className="text-right">
                        {e.status === "failed" ? <RetryWebhookButton eventId={e.id} /> : null}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Last 24 hours" />
            <PanelBody>
              <dl>
                <DataRow label="Events received">{formatCount(conn.webhooks24h.received)}</DataRow>
                <DataRow label="Failed">{formatCount(conn.webhooks24h.failed)}</DataRow>
                <DataRow label="Not used">{formatCount(conn.webhooks24h.ignored)}</DataRow>
              </dl>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              title="Nightly reconciliation"
              description="Re-reads contacts, opportunities and upcoming appointments and repairs anything a webhook missed."
            />
            <PanelBody>
              {conn.reconcile ? (
                <dl>
                  <DataRow label="Last success">
                    {conn.reconcile.lastSucceededAt
                      ? formatDateTime(conn.reconcile.lastSucceededAt, tz)
                      : "Never"}
                  </DataRow>
                  {conn.reconcile.lastFailedAt &&
                  (!conn.reconcile.lastSucceededAt ||
                    conn.reconcile.lastFailedAt > conn.reconcile.lastSucceededAt) ? (
                    <DataRow label="Last failure">
                      <span className="text-critical">
                        {formatDateTime(conn.reconcile.lastFailedAt, tz)}
                      </span>
                    </DataRow>
                  ) : null}
                  {reconcileStats ? (
                    <DataRow label="Last run">
                      {formatCount(reconcileStats.contacts ?? 0)} contacts ·{" "}
                      {formatCount(reconcileStats.opportunities ?? 0)} opportunities ·{" "}
                      {formatCount(reconcileStats.changes ?? 0)} changes
                    </DataRow>
                  ) : null}
                </dl>
              ) : (
                <p className="text-[13px] text-muted">
                  Not run yet. It runs nightly at 3:05am firm time.
                </p>
              )}
              {conn.reconcile?.lastError ? (
                <p className="mt-2 text-[12.5px] text-critical">{conn.reconcile.lastError}</p>
              ) : null}
              <div className="mt-4">
                <ReconcileNowButton disabled={!conn.apiConnected} />
              </div>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              title="Automations, 30 days"
              description="Messages queued, held back by a rule, or failed to deliver."
            />
            {activity.length === 0 ? (
              <EmptyState title="No automation runs yet" />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Automation</Th>
                    <Th className="text-right">Queued</Th>
                    <Th className="text-right">Held</Th>
                    <Th className="text-right">Failed</Th>
                  </tr>
                </THead>
                <TBody>
                  {activity.map((a) => (
                    <Tr key={a.automationId}>
                      <Td>{AUTOMATION_NAMES[a.automationId] ?? a.automationId}</Td>
                      <Td className="text-right tabular-nums">{a.succeeded}</Td>
                      <Td className="text-right tabular-nums">{a.skipped}</Td>
                      <Td className="text-right tabular-nums">
                        {a.failed > 0 ? <span className="text-critical">{a.failed}</span> : 0}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
