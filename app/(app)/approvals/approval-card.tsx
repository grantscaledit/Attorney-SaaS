"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState, useTransition } from "react";
import { Badge, StatusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Panel, PanelBody } from "@/components/ui/panel";
import type { ActionState } from "@/lib/commands/action-state";
import { decideApprovalAction } from "./actions";

export type ApprovalCardData = {
  id: string;
  automationId: string;
  kind: string;
  priority: "urgent" | "normal";
  title: string;
  channel: "sms" | "email" | "chat" | "none";
  subject: string | null;
  draftBody: string;
  leadId: string | null;
  contactLabel: string | null;
  createdLabel: string;
  flags: string[];
  sources: { label: string; value: string }[];
};

type Mode = "view" | "edit" | "reject";

export function ApprovalCard({ item, canDecide }: { item: ApprovalCardData; canDecide: boolean }) {
  const [mode, setMode] = useState<Mode>("view");
  const [body, setBody] = useState(item.draftBody);
  const [subject, setSubject] = useState(item.subject ?? "");
  const [reason, setReason] = useState("");
  const [state, setState] = useState<ActionState<unknown> | null>(null);
  const [pending, start] = useTransition();
  const done = state?.status === "success";
  const sends = item.channel !== "none";

  const decide = (input: Parameters<typeof decideApprovalAction>[0]) =>
    start(async () => setState(await decideApprovalAction(input)));

  return (
    <Panel className={item.priority === "urgent" ? "border-critical/40" : undefined}>
      <PanelBody className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">
              {item.priority === "urgent" ? <Badge tone="critical">Urgent</Badge> : null}
              <Badge tone="outline">{item.automationId}</Badge>
              {item.title}
            </p>
            <p className="mt-0.5 text-[12.5px] text-muted">
              {item.contactLabel ? (
                item.leadId ? (
                  <Link
                    href={`/intake/leads/${item.leadId}` as Route}
                    className="text-accent hover:underline"
                  >
                    {item.contactLabel}
                  </Link>
                ) : (
                  item.contactLabel
                )
              ) : null}
              {item.contactLabel ? " · " : ""}
              {sends
                ? item.channel === "sms"
                  ? "Text message"
                  : item.channel === "chat"
                    ? "Web chat reply"
                    : "Email"
                : "Internal, nothing is sent"}{" "}
              · queued {item.createdLabel}
            </p>
          </div>
        </div>

        {item.flags.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {item.flags.map((f) => (
              <li key={f}>
                <StatusLabel tone="warning">{f}</StatusLabel>
              </li>
            ))}
          </ul>
        ) : null}

        {mode === "edit" ? (
          <div className="space-y-2">
            {item.channel === "email" ? (
              <Field id={`${item.id}-subject`} label="Subject">
                <Input
                  id={`${item.id}-subject`}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </Field>
            ) : null}
            <Field id={`${item.id}-body`} label="Text">
              <Textarea
                id={`${item.id}-body`}
                rows={8}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </Field>
          </div>
        ) : (
          <div className="whitespace-pre-line rounded-md bg-surface-2 px-3 py-2 text-[13px] text-ink">
            {item.subject ? <span className="block font-medium">{item.subject}</span> : null}
            {item.draftBody}
          </div>
        )}

        {item.sources.length > 0 ? (
          <details>
            <summary className="cursor-pointer text-[12.5px] text-accent hover:underline">
              What the draft was based on
            </summary>
            <dl className="mt-2 space-y-1 text-[12.5px]">
              {item.sources.map((s) => (
                <div key={s.label} className="flex gap-2">
                  <dt className="w-40 shrink-0 text-muted">{s.label}</dt>
                  <dd className="whitespace-pre-line text-ink-2">{s.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}

        {mode === "reject" ? (
          <Field
            id={`${item.id}-reason`}
            label="Why is this being rejected?"
            hint="Kept with the draft so the prompts can be improved. Nothing is sent."
            errors={state?.status === "error" ? state.fieldErrors?.reason : undefined}
          >
            <Textarea
              id={`${item.id}-reason`}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        ) : null}

        {state?.status === "success" ? <Notice tone="good">{state.message}</Notice> : null}
        {state?.status === "error" && !state.fieldErrors ? (
          <Notice tone="critical">{state.message}</Notice>
        ) : null}

        {canDecide && !done ? (
          <div className="flex flex-wrap gap-2">
            {mode === "view" ? (
              <>
                <Button
                  disabled={pending}
                  onClick={() => decide({ approvalId: item.id, decision: "approve" })}
                >
                  {sends ? "Approve and send" : "Mark reviewed"}
                </Button>
                {sends ? (
                  <Button variant="secondary" disabled={pending} onClick={() => setMode("edit")}>
                    Edit
                  </Button>
                ) : null}
                <Button variant="ghost" disabled={pending} onClick={() => setMode("reject")}>
                  Reject
                </Button>
              </>
            ) : mode === "edit" ? (
              <>
                <Button
                  disabled={pending}
                  onClick={() =>
                    decide({
                      approvalId: item.id,
                      decision: "approve",
                      body,
                      subject: item.channel === "email" ? subject : undefined,
                    })
                  }
                >
                  Approve edited text
                </Button>
                <Button variant="ghost" onClick={() => setMode("view")}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => decide({ approvalId: item.id, decision: "reject", reason })}
                >
                  Reject
                </Button>
                <Button variant="ghost" onClick={() => setMode("view")}>
                  Cancel
                </Button>
              </>
            )}
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
