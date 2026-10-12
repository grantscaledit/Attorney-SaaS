"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, fieldControlProps } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { IDLE_STATE } from "@/lib/commands/action-state";
import { acceptInviteAction } from "./actions";

export function AcceptInviteForm({
  token,
  email,
  minLength,
}: {
  token: string;
  email: string;
  minLength: number;
}) {
  const [state, action, pending] = useActionState(acceptInviteAction, IDLE_STATE);
  const errors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <form action={action} className="mt-8 space-y-4">
      {state.status === "error" && !errors ? (
        <Notice tone="critical">{state.message}</Notice>
      ) : null}
      <input type="hidden" name="token" value={token} />
      {/* Lets password managers save the credential against the right account. */}
      <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
      <Field
        id="password"
        label="New password"
        hint={`At least ${minLength} characters. A short sentence works well.`}
        errors={errors?.password}
      >
        <Input
          {...fieldControlProps("password", errors?.password, true)}
          type="password"
          autoComplete="new-password"
          minLength={minLength}
          required
          autoFocus
        />
      </Field>
      <Field id="confirmPassword" label="Confirm password" errors={errors?.confirmPassword}>
        <Input
          {...fieldControlProps("confirmPassword", errors?.confirmPassword)}
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Set password"}
      </Button>
    </form>
  );
}
