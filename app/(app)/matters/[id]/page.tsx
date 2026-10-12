import type { Metadata, Route } from "next";
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
import { requirePermission } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { formatDate, formatDateTime } from "@/lib/ui/format";
import type { NoticeFields } from "@/modules/documents/notice-parser";
import { DEADLINE_NOTICE } from "@/modules/intake/commands/followups";
import { PRACTICE_AREA_LABELS } from "@/modules/intake/labels";
import { DRAFT_KINDS } from "@/modules/matters/drafts";
import { matterDetail } from "@/modules/matters/queries";
import { ESTATE_QUESTIONNAIRE } from "@/modules/matters/questionnaire";
import { DOC_TYPE_LABELS, DOC_TYPES, type DocType } from "@/practice";
import { DeadlinesSection } from "./deadlines-section";
import {
  AssignForm,
  CloseMatter,
  DocTypeSelect,
  ExtractionForm,
  NoteForm,
  PartyForm,
  PortalLink,
  RefreshSummary,
  RemoveParty,
  RequestDraft,
  ShareToggle,
  StageSelect,
  TaskForm,
  TaskToggle,
  UploadForm,
} from "./matter-actions";

export const metadata: Metadata = { title: "Matter" };

const TYPES = DOC_TYPES.map((t) => [t, DOC_TYPE_LABELS[t]] as [string, string]);
const sizeLabel = (n: number) =>
  n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;

export default async function MatterPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requirePermission("matters.read");
  const tz = env().FIRM_TIMEZONE;
  const d = await matterDetail(user, (await params).id);
  if (!d) notFound();
  const m = d.matter;
  const open = m.status === "open";
  const clientName = d.contact?.fullName ?? d.contact?.companyName ?? "Client";
  const openTasks = d.tasks.filter((t) => t.status === "open");
  const doneTasks = d.tasks.filter((t) => t.status !== "open");
  const draftKinds = Object.entries(DRAFT_KINDS)
    .filter(([, v]) => v.area === m.practiceArea)
    .map(([key, v]) => ({ key, label: v.label }));
  const requested = d.checklist.filter((c) => c.status === "requested");
  const timeline = (m.summaryTimeline ?? []) as {
    date: string;
    event: string;
    source: { type: string; id: string };
  }[];

  return (
    <>
      <PageHeader
        eyebrow={`Matter ${m.number} · ${PRACTICE_AREA_LABELS[m.practiceArea]} · ${d.facts.typeLabel}`}
        title={m.title}
        description={`${clientName} · opened ${formatDate(m.openedAt, tz)}${m.closedAt ? ` · closed ${formatDate(m.closedAt, tz)}, keep until ${m.retentionUntil}` : ""}`}
        actions={
          <Button variant="ghost" asChild>
            <Link href="/matters">
              <ArrowLeft /> Matters
            </Link>
          </Button>
        }
      />
      {d.facts.stalled ? (
        <Notice tone="warning" className="mb-5" title="Past the stage threshold">
          {d.facts.daysInStage} days in this stage; the threshold is {d.facts.thresholdDays}.
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Panel>
            <PanelHeader
              title="Summary (B7)"
              description="From notes, documents and messages. Each timeline line names its source."
            />
            <PanelBody className="space-y-3">
              {m.summary ? (
                <p className="whitespace-pre-line text-[13.5px]">{m.summary}</p>
              ) : (
                <p className="text-[13px] text-muted">No summary yet.</p>
              )}
              {timeline.length ? (
                <ol className="space-y-1 border-l border-line pl-4 text-[13px]">
                  {timeline.map((t, i) => (
                    <li key={i}>
                      <span className="tabular-nums text-muted">{t.date}</span> {t.event}{" "}
                      <span className="text-[11.5px] text-muted">[{t.source.type}]</span>
                    </li>
                  ))}
                </ol>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12px] text-muted">
                  {m.summaryUpdatedAt ? `Updated ${formatDateTime(m.summaryUpdatedAt, tz)}` : ""}
                </span>
                <RefreshSummary matterId={m.id} />
              </div>
            </PanelBody>
          </Panel>

          <DeadlinesSection actor={user} matter={m} staff={d.staff} />

          <Panel>
            <PanelHeader
              title="Documents"
              description="Read, classified and named automatically (B4). Tax notices are triaged (B3); confirm the fields."
            />
            {d.canWrite && open ? (
              <PanelBody className="border-b border-line">
                <UploadForm
                  matterId={m.id}
                  checklist={requested.map((c) => ({ id: c.id, label: c.label }))}
                />
              </PanelBody>
            ) : null}
            {d.documents.length === 0 ? (
              <EmptyState title="No documents yet" />
            ) : (
              <ul className="divide-y divide-line">
                {d.documents.map((doc) => {
                  const ex = d.extractions.get(doc.id);
                  const flags = doc.flags as {
                    unreadablePages?: number[];
                    incomplete?: string;
                    error?: string;
                  } | null;
                  const conflicts = ex
                    ? Object.entries((ex.provenance ?? {}) as Record<string, string | null>)
                        .filter(([, v]) => v === "conflict")
                        .map(([k]) => k)
                    : [];
                  return (
                    <li key={doc.id} className="space-y-2 px-5 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <a
                          href={`/api/documents/${doc.id}/download`}
                          className="text-[13.5px] font-medium text-accent hover:underline"
                        >
                          {doc.displayName}
                        </a>
                        <span className="text-[12px] text-muted">
                          {doc.uploadedVia === "portal" ? "From client · " : ""}
                          {formatDateTime(doc.createdAt, tz)} · {sizeLabel(doc.sizeBytes)}
                          {doc.pageCount
                            ? ` · ${doc.pageCount} page${doc.pageCount > 1 ? "s" : ""}`
                            : ""}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        {doc.status === "processed" ? (
                          d.canWrite ? (
                            <div className="w-56">
                              <DocTypeSelect
                                matterId={m.id}
                                documentId={doc.id}
                                docType={doc.docType ?? "other"}
                                types={TYPES}
                              />
                            </div>
                          ) : (
                            <Badge tone="outline">
                              {DOC_TYPE_LABELS[(doc.docType ?? "other") as DocType]}
                            </Badge>
                          )
                        ) : (
                          <StatusLabel tone={doc.status === "failed" ? "critical" : "info"}>
                            {doc.status === "failed" ? "Could not be read" : "Processing"}
                          </StatusLabel>
                        )}
                        {d.canWrite ? (
                          <ShareToggle
                            matterId={m.id}
                            documentId={doc.id}
                            shared={doc.sharedWithClient}
                          />
                        ) : null}
                        {flags?.unreadablePages?.length ? (
                          <StatusLabel tone="warning">
                            Unreadable page(s) {flags.unreadablePages.join(", ")}
                          </StatusLabel>
                        ) : null}
                        {flags?.incomplete ? (
                          <StatusLabel tone="warning">{flags.incomplete}</StatusLabel>
                        ) : null}
                      </div>
                      {ex ? (
                        <div className="rounded-md bg-surface-2 px-3 py-2.5">
                          <p className="text-[13px] font-medium">
                            Notice triage (B3) ·{" "}
                            {ex.status === "proposed" ? (
                              <StatusLabel tone="warning">To confirm</StatusLabel>
                            ) : (
                              <StatusLabel tone="good">
                                {ex.status === "corrected" ? "Corrected" : "Confirmed"}
                              </StatusLabel>
                            )}
                          </p>
                          {ex.summary ? (
                            <p className="mt-1 text-[13px] text-ink-2">{ex.summary}</p>
                          ) : null}
                          <p className="mt-1 text-[12px] text-muted">{DEADLINE_NOTICE}</p>
                          {d.canWrite && ex.status === "proposed" ? (
                            <div className="mt-2">
                              <ExtractionForm
                                matterId={m.id}
                                extractionId={ex.id}
                                fields={ex.fields as NoticeFields}
                                conflicts={conflicts}
                              />
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Tasks" />
            {d.canWrite && open ? (
              <PanelBody className="border-b border-line">
                <TaskForm matterId={m.id} staff={d.staff} />
              </PanelBody>
            ) : null}
            {d.tasks.length === 0 ? (
              <EmptyState title="No tasks" />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th className="w-10">{""}</Th>
                    <Th>Task</Th>
                    <Th>Due</Th>
                    <Th>Assignee</Th>
                  </tr>
                </THead>
                <TBody>
                  {[...openTasks, ...doneTasks].map((t) => (
                    <Tr key={t.id} className={t.status !== "open" ? "text-muted" : undefined}>
                      <Td>
                        {d.canWrite && t.status !== "cancelled" ? (
                          <TaskToggle matterId={m.id} taskId={t.id} done={t.status === "done"} />
                        ) : null}
                      </Td>
                      <Td>
                        {t.priority === "urgent" && t.status === "open" ? (
                          <Badge tone="critical" className="mr-1.5">
                            Urgent
                          </Badge>
                        ) : null}
                        {t.automationId ? (
                          <span className="mr-1.5 font-mono text-[11.5px] text-muted">
                            {t.automationId}
                          </span>
                        ) : null}
                        <span className={t.status !== "open" ? "line-through" : undefined}>
                          {t.title}
                        </span>
                        {t.dueFromDocument ? (
                          <span className="block text-[11.5px] text-muted">{DEADLINE_NOTICE}</span>
                        ) : null}
                      </Td>
                      <Td className="tabular-nums">{t.dueOn ?? "–"}</Td>
                      <Td>{d.staff.find((s) => s.id === t.assigneeId)?.name ?? "–"}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Notes" description="Internal. Never shown in the portal." />
            {d.canWrite ? (
              <PanelBody className="border-b border-line">
                <NoteForm matterId={m.id} />
              </PanelBody>
            ) : null}
            {d.notes.length === 0 ? (
              <EmptyState title="No notes" />
            ) : (
              <ul className="divide-y divide-line">
                {d.notes.map((n) => (
                  <li key={n.id} className="px-5 py-3">
                    <p className="text-[12px] text-muted">
                      {n.author ?? "System"} · {formatDateTime(n.createdAt, tz)}
                    </p>
                    <p className="mt-1 whitespace-pre-line text-[13.5px]">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {d.questionnaire ? (
            <Panel>
              <PanelHeader
                title="Estate planning questionnaire (B9)"
                description={
                  d.questionnaire.status === "submitted"
                    ? `Submitted ${formatDateTime(d.questionnaire.submittedAt!, tz)}`
                    : "Not yet submitted by the client."
                }
              />
              <PanelBody>
                {ESTATE_QUESTIONNAIRE.map((s) => (
                  <div key={s.key} className="mb-3">
                    <p className="text-[13px] font-medium">{s.title}</p>
                    <dl>
                      {s.questions.map((q) => (
                        <DataRow key={q.id} label={q.label}>
                          {(d.questionnaire!.answers as Record<string, string>)[q.id] ?? (
                            <span className="text-muted">–</span>
                          )}
                        </DataRow>
                      ))}
                    </dl>
                  </div>
                ))}
              </PanelBody>
            </Panel>
          ) : null}
        </div>

        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Matter" />
            <PanelBody className="space-y-4">
              {d.canWrite && open ? (
                <StageSelect matterId={m.id} stage={m.stage} stages={d.stages} />
              ) : (
                <DataRow label="Stage">
                  {d.stages.find((s) => s.key === m.stage)?.label ?? m.stage}
                </DataRow>
              )}
              <p className="text-[12.5px] text-muted">
                {d.facts.daysInStage} day(s) in this stage
                {d.facts.thresholdDays !== null ? `, threshold ${d.facts.thresholdDays}` : ""}.
              </p>
              {d.canWrite ? (
                <AssignForm
                  matterId={m.id}
                  responsible={m.responsibleAttorneyId}
                  assigned={m.assignedUserIds}
                  staff={d.staff}
                />
              ) : null}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              title="Document checklist (B1, B2)"
              description="Reminders go out on days 3, 7 and 14 while required items are missing."
            />
            {d.checklist.length === 0 ? (
              <EmptyState title="No checklist" />
            ) : (
              <ul className="divide-y divide-line">
                {d.checklist.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-start justify-between gap-2 px-5 py-2.5 text-[13px]"
                  >
                    <span>
                      {c.label}
                      {c.required ? "" : <span className="text-muted"> (optional)</span>}
                    </span>
                    <StatusLabel
                      tone={
                        c.status === "received"
                          ? "good"
                          : c.status === "waived"
                            ? "neutral"
                            : "warning"
                      }
                    >
                      {c.status === "received"
                        ? "Received"
                        : c.status === "waived"
                          ? "Waived"
                          : `Requested${c.remindersSent ? `, ${c.remindersSent} reminder(s)` : ""}`}
                    </StatusLabel>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Client portal" />
            <PanelBody className="space-y-2">
              <p className="text-[13px]">
                {d.portalUserIds.length
                  ? "The client has portal access."
                  : "The client has no portal access yet."}
              </p>
              {d.canWrite ? (
                <PortalLink matterId={m.id} hasAccess={d.portalUserIds.length > 0} />
              ) : null}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              title="Parties"
              description="Adverse and related parties are checked against every new enquiry (A6)."
            />
            <ul className="divide-y divide-line">
              {d.parties.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2 px-5 py-2 text-[13px]"
                >
                  <span>
                    {p.name} <span className="text-muted">({p.role.replace("_", " ")})</span>
                  </span>
                  {d.canWrite && p.role !== "client" ? (
                    <RemoveParty matterId={m.id} partyId={p.id} name={p.name} />
                  ) : null}
                </li>
              ))}
            </ul>
            {d.canWrite ? (
              <PanelBody className="border-t border-line">
                <PartyForm matterId={m.id} />
              </PanelBody>
            ) : null}
          </Panel>

          {d.canDraft && draftKinds.length ? (
            <Panel>
              <PanelHeader
                title="Drafting assist (B8)"
                description="First drafts for the attorney, always labelled DRAFT. Never sent to the client."
              />
              <PanelBody>
                <RequestDraft matterId={m.id} kinds={draftKinds} />
              </PanelBody>
            </Panel>
          ) : null}

          {d.drafts.length ? (
            <Panel>
              <PanelHeader title="Drafts and approvals" />
              <ul className="divide-y divide-line">
                {d.drafts.map((a) => (
                  <li key={a.id} className="px-5 py-2.5 text-[13px]">
                    <span className="font-medium">{a.automationId}</span> · {a.title}
                    <span className="block text-[12px] capitalize text-muted">
                      {a.status} · {formatDateTime(a.createdAt, tz)}
                    </span>
                  </li>
                ))}
              </ul>
              <PanelBody className="pt-0">
                <Link
                  href={"/approvals" as Route}
                  className="text-[13px] text-accent hover:underline"
                >
                  Open the approval queue
                </Link>
              </PanelBody>
            </Panel>
          ) : null}

          {d.engagement ? (
            <Panel>
              <PanelHeader title="Engagement letter (A9)" />
              <PanelBody>
                <dl>
                  <DataRow label="Status">
                    <span className="capitalize">{d.engagement.status}</span>
                  </DataRow>
                  {d.engagement.signedAt ? (
                    <DataRow label="Signed">{formatDateTime(d.engagement.signedAt, tz)}</DataRow>
                  ) : null}
                  <DataRow label="Fee terms">{d.engagement.feeTerms}</DataRow>
                </dl>
              </PanelBody>
            </Panel>
          ) : null}

          {d.canWrite && open ? (
            <Panel>
              <PanelHeader title="Close (B10)" />
              <PanelBody>
                <CloseMatter matterId={m.id} />
              </PanelBody>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
