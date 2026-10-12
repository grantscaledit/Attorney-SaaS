import type { Metadata } from "next";
import { Notice } from "@/components/ui/notice";
import { PageHeader, Panel, PanelBody, PanelHeader, EmptyState } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import type { PracticeArea } from "@/db/schema";
import { DEFAULT_MODELS } from "@/lib/ai/models";
import { can } from "@/lib/auth/can";
import { requirePermission } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { loadFirmSettings } from "@/lib/firm.config";
import { aiUsage, attorneyRouting } from "@/modules/intake/ai-queries";
import { PRACTICE_AREA_LABELS } from "@/modules/intake/labels";
import { AiSettingsForm, RoutingForm } from "./ai-forms";

export const metadata: Metadata = { title: "AI intake" };

export default async function AiSettingsPage() {
  const { user } = await requirePermission("firm.settings.read");
  const e = env();
  const [firm, usage, lawyers] = await Promise.all([
    loadFirmSettings(),
    aiUsage(user),
    can(user, "users.read") ? attorneyRouting(user) : Promise.resolve([]),
  ]);
  const canEdit = can(user, "firm.settings.update");
  const fees = (firm.feeTable as { service: string; fee: string }[])
    .map((f) => `${f.service} | ${f.fee}`)
    .join("\n");
  const areas = firm.practiceAreas.map((a: PracticeArea) => ({
    value: a,
    label: PRACTICE_AREA_LABELS[a] ?? a,
  }));
  const configured = Boolean(e.ANTHROPIC_API_KEY) && !e.DEMO_MODE;

  return (
    <>
      <PageHeader
        title="AI intake"
        description="The intake assistant (A3), lead routing (A5) and the drafts that wait in Approvals. The assistant never gives legal advice, predicts outcomes or confirms representation."
      />
      {!configured ? (
        <Notice
          tone="info"
          className="mb-5"
          title={e.DEMO_MODE ? "Demo environment" : "AI not configured"}
        >
          {e.DEMO_MODE
            ? "The demo uses scripted replies and never calls a live model."
            : "ANTHROPIC_API_KEY is not set. The assistant does not reply; enquiries wait for staff as before, and briefs are built from records only."}
        </Notice>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Assistant settings" />
            <PanelBody>
              <AiSettingsForm
                canEdit={canEdit}
                initial={{
                  a3Mode: firm.a3Mode,
                  consultCalendarId: firm.consultCalendarId ?? "",
                  feeTable: fees,
                }}
              />
            </PanelBody>
          </Panel>
          {lawyers.length > 0 ? (
            <Panel>
              <PanelHeader
                title="Lead routing (A5)"
                description="Practice areas each attorney takes. With multi-attorney routing on, new leads go to the least-loaded attorney for the area; otherwise to the owner."
              />
              <div className="divide-y divide-line">
                {lawyers.map((l) => (
                  <RoutingForm
                    key={l.id}
                    attorney={l}
                    areas={areas}
                    canEdit={can(user, "users.update")}
                  />
                ))}
              </div>
            </Panel>
          ) : null}
        </div>
        <div className="space-y-6">
          <Panel>
            <PanelHeader
              title="Models"
              description="Set by the deployment (MODEL_FAST, MODEL_STANDARD, MODEL_DEEP)."
            />
            <PanelBody>
              <dl className="space-y-1 text-[13px]">
                <div>Classifier: {e.MODEL_FAST ?? DEFAULT_MODELS.fast}</div>
                <div>Replies and briefs: {e.MODEL_STANDARD ?? DEFAULT_MODELS.standard}</div>
                <div>Deep work: {e.MODEL_DEEP ?? DEFAULT_MODELS.deep}</div>
              </dl>
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader
              title="Model calls, last 30 days"
              description="Every call is logged with its cost. Prompts are stored only as a hash."
            />
            {usage.length === 0 ? (
              <EmptyState title="No calls yet" />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Purpose</Th>
                    <Th className="text-right">Calls</Th>
                    <Th className="text-right">Cost</Th>
                  </tr>
                </THead>
                <TBody>
                  {usage.map((u) => (
                    <Tr key={u.purpose}>
                      <Td>
                        {u.purpose}
                        {u.failed ? (
                          <span className="block text-[12px] text-muted">{u.failed} failed</span>
                        ) : null}
                      </Td>
                      <Td className="text-right tabular-nums">{u.calls}</Td>
                      <Td className="text-right tabular-nums">${Number(u.costUsd).toFixed(2)}</Td>
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
