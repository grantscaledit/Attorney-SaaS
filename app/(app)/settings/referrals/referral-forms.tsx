"use client";

import { useActionState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { IDLE_STATE } from "@/lib/commands/action-state";
import { removeReferralPartnerAction, saveReferralPartnerAction } from "./actions";

export function AddReferralPartner() {
  const [state, action, pending] = useActionState(saveReferralPartnerAction, IDLE_STATE);
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="name" label="Attorney or contact name" errors={errors?.name}>
          <Input id="name" name="name" required />
        </Field>
        <Field id="organization" label="Firm" optional>
          <Input id="organization" name="organization" />
        </Field>
      </div>
      <Field
        id="handles"
        label="Areas they take"
        hint='Comma separated, e.g. "family law, divorce, custody". Out-of-scope enquiries are matched on these words.'
        errors={errors?.handles}
      >
        <Input id="handles" name="handles" required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="phone" label="Phone" optional>
          <Input id="phone" name="phone" />
        </Field>
        <Field id="email" label="Email" optional errors={errors?.email}>
          <Input id="email" name="email" type="email" />
        </Field>
        <Field id="website" label="Website" optional errors={errors?.website}>
          <Input id="website" name="website" type="url" />
        </Field>
      </div>
      {state.status !== "idle" ? (
        <Notice tone={state.status === "success" ? "good" : "critical"}>{state.message}</Notice>
      ) : null}
      <Button type="submit" disabled={pending}>
        Add partner
      </Button>
    </form>
  );
}

export function RemoveReferralPartner({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      aria-label={`Remove ${name}`}
      onClick={() => start(async () => void (await removeReferralPartnerAction(id)))}
    >
      Remove
    </Button>
  );
}
