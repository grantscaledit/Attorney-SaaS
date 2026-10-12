"use client";

import { UserPlus } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { Tooltip } from "@/components/ui/tooltip";
import { IDLE_STATE, type ActionState } from "@/lib/commands/action-state";
import { inviteUserAction } from "./actions";
import { PersonFields, type RoleOption } from "./role-fields";
import { SetupLinkResult } from "./setup-link-result";

export function InviteUserButton({ roles, disabled }: { roles: RoleOption[]; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);

  // The dialog stays mounted even when the plan becomes full: inviting the last
  // seat revalidates the page (disabling the button), and the one-time setup
  // link must still be shown.
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setFormKey((k) => k + 1);
      }}
    >
      {disabled && !open ? (
        <Tooltip content="All Solo plan seats are in use. Deactivate a user or move to the Firm plan.">
          <span tabIndex={0}>
            <Button disabled>
              <UserPlus /> Invite user
            </Button>
          </span>
        </Tooltip>
      ) : (
        <DialogTrigger asChild>
          <Button disabled={disabled}>
            <UserPlus /> Invite user
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        title="Invite a user"
        description="They receive a one-time link to set a password, then enroll an authenticator app."
      >
        <InviteForm key={formKey} roles={roles} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({ roles, onDone }: { roles: RoleOption[]; onDone: () => void }) {
  const [state, action, pending] = useActionState<
    ActionState<{ setupUrl: string; expiresAt: Date }>,
    FormData
  >(inviteUserAction, IDLE_STATE);
  const [name, setName] = useState("");

  if (state.status === "success") {
    return (
      <div className="space-y-4">
        <SetupLinkResult url={state.data.setupUrl} expiresAt={state.data.expiresAt} name={name} />
        <div className="flex justify-end">
          <Button onClick={onDone}>Done</Button>
        </div>
      </div>
    );
  }

  const errors = state.status === "error" ? state.fieldErrors : undefined;
  return (
    <form
      action={action}
      onSubmit={(e) => setName(String(new FormData(e.currentTarget).get("name") ?? ""))}
      className="space-y-4"
    >
      {state.status === "error" && !errors ? (
        <Notice tone="critical">{state.message}</Notice>
      ) : null}
      <PersonFields errors={errors} roles={roles} includeEmail />
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create setup link"}
        </Button>
      </div>
    </form>
  );
}
