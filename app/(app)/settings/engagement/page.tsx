import type { Metadata } from "next";
import { Notice } from "@/components/ui/notice";
import { PageHeader, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { can } from "@/lib/auth/can";
import { requirePermission } from "@/lib/auth/session";
import { loadFirmSettings } from "@/lib/firm.config";
import { DEFAULT_ENGAGEMENT_TEMPLATE, ENGAGEMENT_FIELDS } from "@/modules/matters/engagement";
import { EngagementTemplateForm } from "./template-form";

export const metadata: Metadata = { title: "Engagement letter" };

export default async function EngagementTemplatePage() {
  const { user } = await requirePermission("firm.settings.read");
  const firm = await loadFirmSettings();
  return (
    <>
      <PageHeader
        title="Engagement letter"
        description="The letter A9 drafts when an attorney retains a lead. Each draft still waits for an attorney's approval before it is sent."
      />
      {!firm.engagementTemplate ? (
        <Notice tone="warning" className="mb-5" title="Using the product default">
          The default letter is a starting point, not the firm&apos;s terms. Have the firm&apos;s attorney
          review it or paste the firm&apos;s own letter.
        </Notice>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel>
          <PanelBody>
            <EngagementTemplateForm
              initial={firm.engagementTemplate ?? ""}
              canEdit={can(user, "firm.settings.update")}
            />
          </PanelBody>
        </Panel>
        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Merge fields" />
            <PanelBody>
              <dl className="space-y-1.5 text-[13px]">
                {Object.entries(ENGAGEMENT_FIELDS).map(([k, v]) => (
                  <div key={k}>
                    <dt className="font-mono text-[12px]">{`{{${k}}}`}</dt>
                    <dd className="text-muted">{v}</dd>
                  </div>
                ))}
              </dl>
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader title="Product default" />
            <PanelBody>
              <pre className="whitespace-pre-wrap text-[12px] text-ink-2">
                {DEFAULT_ENGAGEMENT_TEMPLATE}
              </pre>
            </PanelBody>
          </Panel>
        </div>
      </div>
    </>
  );
}
