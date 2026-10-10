"use client";

import { useState, useTransition } from "react";
import { StatusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, fieldControlProps } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { IDLE_STATE, type ActionState } from "@/lib/commands/action-state";
import { approveTemplateAction, saveTemplateAction, withdrawTemplateAction } from "./actions";

export type TemplateCardData = {
  key: string;
  label: string;
  when: string;
  channel: "sms" | "email";
  subject: string | null;
  body: string;
  preview: string;
  previewSubject: string | null;
  approved: boolean;
  approvedLabel: string | null;
  isDefault: boolean;
};

export function TemplateCard({ t, editable }: { t: TemplateCardData; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [saveState, setSaveState] = useState<ActionState<unknown>>(IDLE_STATE);
  const [saving, startSave] = useTransition();
  const [decision, setDecision] = useState<ActionState<unknown> | null>(null);
  const [deciding, start] = useTransition();
  const errors = saveState.status === "error" ? saveState.fieldErrors : undefined;

  const status = t.approved ? (
    <StatusLabel tone="good">{t.approvedLabel ?? "Approved"}</StatusLabel>
  ) : (
    <StatusLabel tone="warning">
      {t.isDefault ? "Default text, not approved" : "Edited, not approved"}
    </StatusLabel>
  );

  return (
    <Panel>
      <PanelHeader title={`${t.key.split(".")[0]} · ${t.label}`} description={t.when} />
      <PanelBody className="space-y-3">
        <div>{status}</div>
        {editing ? (
          <form
            action={(fd) =>
              startSave(async () => {
                const r = await saveTemplateAction(IDLE_STATE, fd);
                setSaveState(r);
                setDecision(null);
                if (r.status === "success") setEditing(false);
              })
            }
            className="space-y-3"
          >
            <input type="hidden" name="key" value={t.key} />
            {t.channel === "email" ? (
              <Field id={`${t.key}-subject`} label="Subject" errors={errors?.subject}>
                <Input
                  defaultValue={t.subject ?? ""}
                  {...fieldControlProps(`${t.key}-subject`, errors?.subject)}
                  name="subject"
                />
              </Field>
            ) : null}
            <Field
              id={`${t.key}-body`}
              label={t.channel === "sms" ? "Text message" : "Email body"}
              hint="Saving clears the approval. The message stops sending until it is approved again."
              errors={errors?.body}
            >
              <Textarea
                rows={t.channel === "sms" ? 4 : 10}
                defaultValue={t.body}
                {...fieldControlProps(`${t.key}-body`, errors?.body, true)}
                name="body"
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <>
            <div>
              <p className="eyebrow mb-1.5">As the recipient sees it (sample values)</p>
              <div className="whitespace-pre-line rounded-md bg-surface-2 px-3 py-2 text-[13px] text-ink">
                {t.previewSubject ? (
                  <span className="block font-medium">{t.previewSubject}</span>
                ) : null}
                {t.preview}
              </div>
            </div>
            <details>
              <summary className="cursor-pointer text-[12.5px] text-accent hover:underline">
                Show the template with its placeholders
              </summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-md border border-line px-3 py-2 font-mono text-[12px] text-ink-2">
                {t.subject ? `Subject: ${t.subject}\n\n` : ""}
                {t.body}
              </pre>
            </details>
          </>
        )}

        {saveState.status === "success" ? <Notice tone="good">{saveState.message}</Notice> : null}
        {saveState.status === "error" && !errors ? (
          <Notice tone="critical">{saveState.message}</Notice>
        ) : null}
        {decision?.status === "success" ? <Notice tone="good">{decision.message}</Notice> : null}
        {decision?.status === "error" ? <Notice tone="critical">{decision.message}</Notice> : null}

        {editable && !editing ? (
          <div className="flex flex-wrap gap-2">
            {!t.approved ? (
              <Button
                disabled={deciding}
                onClick={() =>
                  start(async () => {
                    setSaveState(IDLE_STATE);
                    setDecision(await approveTemplateAction(t.key, t.body, t.subject));
                  })
                }
              >
                Approve this text
              </Button>
            ) : (
              <Button
                variant="secondary"
                disabled={deciding}
                onClick={() => start(async () => setDecision(await withdrawTemplateAction(t.key)))}
              >
                Withdraw approval
              </Button>
            )}
            <Button variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
