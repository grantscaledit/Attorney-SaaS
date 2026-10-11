"use client";

import { useActionState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { IDLE_STATE } from "@/lib/commands/action-state";
import { addConflictPartyAction, removeConflictPartyAction } from "./actions";

export function AddConflictParties() {
  const [state, action, pending] = useActionState(addConflictPartyAction, IDLE_STATE);
  return (
    <form action={action} className="space-y-4">
      <Field id="names" label="Names" hint="One person or business per line.">
        <Textarea id="names" name="names" required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="kind" label="Type">
          <Select id="kind" name="kind" defaultValue="person">
            <option value="person">Person</option>
            <option value="organization">Business or organization</option>
          </Select>
        </Field>
        <Field id="role" label="Role">
          <Select id="role" name="role" defaultValue="adverse">
            <option value="client">Current or former client</option>
            <option value="adverse">Adverse party</option>
            <option value="related">Related party</option>
          </Select>
        </Field>
        <Field id="matterReference" label="Matter reference" optional>
          <Input id="matterReference" name="matterReference" />
        </Field>
      </div>
      {state.status !== "idle" ? (
        <Notice tone={state.status === "success" ? "good" : "critical"}>{state.message}</Notice>
      ) : null}
      <Button type="submit" disabled={pending}>
        Add to the list
      </Button>
    </form>
  );
}

export function RemoveConflictParty({ partyId, name }: { partyId: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      aria-label={`Remove ${name}`}
      onClick={() => start(async () => void (await removeConflictPartyAction(partyId)))}
    >
      Remove
    </Button>
  );
}
