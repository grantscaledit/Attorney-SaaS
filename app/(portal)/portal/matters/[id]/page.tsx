import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusLabel } from "@/components/ui/badge";
import { EmptyState, PageHeader, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { requireClient } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/ui/format";
import { portalMatter } from "@/modules/matters/queries";
import { PortalUpload } from "./upload";

export const metadata: Metadata = { title: "Your matter" };

export default async function PortalMatterPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireClient();
  const m = await portalMatter(user, (await params).id);
  if (!m) notFound();
  const tz = env().FIRM_TIMEZONE;
  const open = m.status === "open";
  return (
    <>
      <PageHeader
        eyebrow={`Matter ${m.number}`}
        title={m.title}
        description={open ? `Current stage: ${m.stageLabel}` : "This matter is closed."}
      />
      <div className="space-y-6">
        <Panel>
          <PanelHeader title="Where your matter stands" />
          <PanelBody>
            <ol className="flex flex-wrap gap-2 text-[12.5px]">
              {m.stages.map((s) => (
                <li
                  key={s.key}
                  aria-current={s.current ? "step" : undefined}
                  className={
                    s.current
                      ? "rounded-md bg-accent-soft px-2.5 py-1 font-medium text-accent"
                      : "rounded-md px-2.5 py-1 text-muted"
                  }
                >
                  {s.label}
                </li>
              ))}
            </ol>
          </PanelBody>
        </Panel>

        {m.questionnaire ? (
          <Panel>
            <PanelHeader title="Estate planning questionnaire" />
            <PanelBody className="flex items-center justify-between gap-3">
              <StatusLabel tone={m.questionnaire.status === "submitted" ? "good" : "warning"}>
                {m.questionnaire.status === "submitted" ? "Submitted" : "Not finished"}
              </StatusLabel>
              {m.questionnaire.status !== "submitted" && open ? (
                <Link
                  href={`/portal/matters/${m.id}/questionnaire` as Route}
                  className="text-[13px] text-accent hover:underline"
                >
                  Continue the questionnaire
                </Link>
              ) : null}
            </PanelBody>
          </Panel>
        ) : null}

        <Panel>
          <PanelHeader
            title="Documents we need from you"
            description="Upload each item below. You can take a clear photo of a paper document."
          />
          {m.checklist.length === 0 ? (
            <EmptyState title="Nothing needed right now" />
          ) : (
            <ul className="divide-y divide-line">
              {m.checklist.map((c) => (
                <li key={c.id} className="space-y-2 px-5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[13.5px] font-medium">
                      {c.label}
                      {c.required ? (
                        ""
                      ) : (
                        <span className="font-normal text-muted"> (if you have it)</span>
                      )}
                    </span>
                    <StatusLabel tone={c.status === "received" ? "good" : "warning"}>
                      {c.status === "received" ? "Received" : "Needed"}
                    </StatusLabel>
                  </div>
                  {c.hint ? <p className="text-[12.5px] text-muted">{c.hint}</p> : null}
                  {c.status === "requested" && open ? (
                    <PortalUpload
                      matterId={m.id}
                      checklistItemId={c.id}
                      label={`Upload: ${c.label}`}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {open ? (
            <PanelBody className="border-t border-line">
              <p className="mb-2 text-[13px] font-medium">Something else to send?</p>
              <PortalUpload matterId={m.id} label="Upload another document" />
            </PanelBody>
          ) : null}
        </Panel>

        <Panel>
          <PanelHeader
            title="Your documents"
            description="Files you sent and files the firm shared with you."
          />
          {m.documents.length === 0 ? (
            <EmptyState title="No documents yet" />
          ) : (
            <ul className="divide-y divide-line">
              {m.documents.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-[13px]"
                >
                  <a
                    href={`/api/documents/${d.id}/download`}
                    className="text-accent hover:underline"
                  >
                    {d.displayName}
                  </a>
                  <span className="text-muted">
                    {d.uploadedVia === "portal" ? "Sent by you" : "From the firm"} ·{" "}
                    {formatDate(d.createdAt, tz)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
