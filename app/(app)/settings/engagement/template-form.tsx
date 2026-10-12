"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { IDLE_STATE } from "@/lib/commands/action-state";
import { saveEngagementTemplateAction } from "./actions";

export function EngagementTemplateForm({
  initial,
  canEdit,
}: {
  initial: string;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(saveEngagementTemplateAction, IDLE_STATE);
  return (
    <form action={action} className="space-y-3">
      <Field
        id="template"
        label="Engagement letter"
        hint="Leave empty to use the product default shown below. Saving requires {{signingUrl}}."
        errors={state.status === "error" ? state.fieldErrors?.template : undefined}
      >
        <Textarea
          id="template"
          name="template"
          defaultValue={initial}
          disabled={!canEdit}
          className="min-h-96 font-mono text-[12.5px]"
        />
      </Field>
      {state.status === "success" ? <Notice tone="good">{state.message}</Notice> : null}
      {state.status === "error" && !state.fieldErrors ? (
        <Notice tone="critical">{state.message}</Notice>
      ) : null}
      {canEdit ? (
        <Button type="submit" disabled={pending}>
          Save template
        </Button>
      ) : null}
    </form>
  );
}
