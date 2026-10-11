"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { IDLE_STATE, type ActionState } from "@/lib/commands/action-state";
import { updateAiSettingsAction, updateIntakeProfileAction } from "./actions";

function Result({ state }: { state: ActionState<unknown> }) {
  if (state.status === "idle") return null;
  return (
    <Notice tone={state.status === "success" ? "good" : "critical"}>
      {state.message}
      {state.status === "error" && state.fieldErrors
        ? Object.values(state.fieldErrors)
            .flat()
            .map((e) => (
              <span key={e} className="block">
                {e}
              </span>
            ))
        : null}
    </Notice>
  );
}

export function AiSettingsForm({
  initial,
  canEdit,
}: {
  initial: { a3Mode: "review_all" | "auto_send_safe"; consultCalendarId: string; feeTable: string };
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(updateAiSettingsAction, IDLE_STATE);
  return (
    <form action={action} className="space-y-5">
      <fieldset className="space-y-2" disabled={!canEdit}>
        <legend className="text-[13px] font-medium">
          How the intake assistant&apos;s replies go out
        </legend>
        <label className="flex gap-2.5 text-[13px]">
          <input
            type="radio"
            name="a3Mode"
            value="review_all"
            defaultChecked={initial.a3Mode === "review_all"}
          />
          <span>
            <span className="font-medium">Review every reply.</span> Each draft waits in Approvals
            until a person approves it. Recommended while the firm gets to know the assistant.
          </span>
        </label>
        <label className="flex gap-2.5 text-[13px]">
          <input
            type="radio"
            name="a3Mode"
            value="auto_send_safe"
            defaultChecked={initial.a3Mode === "auto_send_safe"}
          />
          <span>
            <span className="font-medium">Send safe replies automatically.</span> Replies that only
            ask intake questions, offer consult times or acknowledge, and that pass every check,
            send without review. Anything else still waits in Approvals, and advice requests and
            urgent situations always go to a person.
          </span>
        </label>
      </fieldset>
      <Field
        id="consultCalendarId"
        label="Consult calendar (GoHighLevel calendar ID)"
        optional
        hint="The assistant offers open times from this calendar. Leave empty to offer the booking link only."
      >
        <Input
          id="consultCalendarId"
          name="consultCalendarId"
          defaultValue={initial.consultCalendarId}
          disabled={!canEdit}
        />
      </Field>
      <Field
        id="feeTable"
        label="Published fees"
        optional
        hint='One per line, as "Service | Fee", e.g. "Initial consultation | $150". The assistant may state only these, word for word; any other fee in a draft blocks it.'
      >
        <Textarea
          id="feeTable"
          name="feeTable"
          defaultValue={initial.feeTable}
          disabled={!canEdit}
        />
      </Field>
      <Result state={state} />
      {canEdit ? (
        <Button type="submit" disabled={pending}>
          Save
        </Button>
      ) : null}
    </form>
  );
}

export function RoutingForm({
  attorney,
  areas,
  canEdit,
}: {
  attorney: { id: string; name: string; practiceAreas: string[]; ghlContactId: string | null };
  areas: { value: string; label: string }[];
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(updateIntakeProfileAction, IDLE_STATE);
  return (
    <form action={action} className="space-y-3 px-5 py-4">
      <input type="hidden" name="userId" value={attorney.id} />
      <p className="text-[13.5px] font-medium">{attorney.name}</p>
      <fieldset className="flex flex-wrap gap-4" disabled={!canEdit}>
        <legend className="sr-only">Practice areas</legend>
        {areas.map((a) => (
          <label key={a.value} className="flex items-center gap-1.5 text-[13px]">
            <input
              type="checkbox"
              name="practiceAreas"
              value={a.value}
              defaultChecked={attorney.practiceAreas.includes(a.value)}
            />
            {a.label}
          </label>
        ))}
      </fieldset>
      <Field
        id={`ghl-${attorney.id}`}
        label="GoHighLevel contact for urgent alerts"
        optional
        hint="The contact ID of the attorney's own phone in GoHighLevel. Urgent leads page this number by text, with no client details."
      >
        <Input
          id={`ghl-${attorney.id}`}
          name="ghlContactId"
          defaultValue={attorney.ghlContactId ?? ""}
          disabled={!canEdit}
        />
      </Field>
      <Result state={state} />
      {canEdit ? (
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          Save
        </Button>
      ) : null}
    </form>
  );
}
