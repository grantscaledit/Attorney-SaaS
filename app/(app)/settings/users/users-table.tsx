"use client";

import {
  KeyRound,
  Link2,
  LogOut,
  MoreHorizontal,
  Pencil,
  ShieldOff,
  UserCheck,
  UserX,
} from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { Badge, StatusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { IDLE_STATE, type ActionState } from "@/lib/commands/action-state";
import {
  deactivateUserAction,
  issueSetupLinkAction,
  reactivateUserAction,
  resetMfaAction,
  revokeSessionsAction,
  updateUserAction,
} from "./actions";
import { PersonFields, type RoleOption } from "./role-fields";
import { SetupLinkResult } from "./setup-link-result";

export type UserRowView = {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  title: string | null;
  status: "active" | "disabled";
  isSelf: boolean;
  state: "active" | "invited" | "mfa_pending" | "disabled";
  inviteExpires: string | null;
  lastSignIn: string | null;
  lastSignInExact: string | null;
  activeSessions: number;
};

type Confirm = {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  run: () => Promise<ActionState<unknown>>;
};

type Dialogs =
  | { kind: "none" }
  | { kind: "edit"; row: UserRowView }
  | { kind: "confirm"; confirm: Confirm }
  | { kind: "link"; row: UserRowView; url: string; expiresAt: Date };

function StateCell({ row }: { row: UserRowView }) {
  switch (row.state) {
    case "active":
      return <StatusLabel tone="good">Active</StatusLabel>;
    case "invited":
      return (
        <div>
          <StatusLabel tone="info">Invited</StatusLabel>
          <p className="text-[11.5px] text-muted">
            {row.inviteExpires ? `Link expires ${row.inviteExpires}` : "Link expired"}
          </p>
        </div>
      );
    case "mfa_pending":
      return <StatusLabel tone="warning">MFA not set up</StatusLabel>;
    case "disabled":
      return <StatusLabel tone="neutral">Deactivated</StatusLabel>;
  }
}

export function UsersTable({
  rows,
  manage,
  roles,
}: {
  rows: UserRowView[];
  manage: boolean;
  roles: RoleOption[];
}) {
  const [dialog, setDialog] = useState<Dialogs>({ kind: "none" });
  const [notice, setNotice] = useState<{ tone: "good" | "critical"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const close = () => setDialog({ kind: "none" });

  const runConfirm = (confirm: Confirm) =>
    startTransition(async () => {
      const result = await confirm.run();
      close();
      setNotice(
        result.status === "success"
          ? { tone: "good", text: result.message ?? "Done." }
          : result.status === "error"
            ? { tone: "critical", text: result.message }
            : null,
      );
    });

  const issueLink = (row: UserRowView) =>
    startTransition(async () => {
      const result = await issueSetupLinkAction(row.id);
      if (result.status === "success")
        setDialog({
          kind: "link",
          row,
          url: result.data.setupUrl,
          expiresAt: result.data.expiresAt,
        });
      else if (result.status === "error") setNotice({ tone: "critical", text: result.message });
    });

  return (
    <>
      {notice ? (
        <Notice tone={notice.tone} className="mb-4">
          {notice.text}
        </Notice>
      ) : null}
      <Panel>
        <Table>
          <THead>
            <tr>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Last sign-in</Th>
              {manage ? (
                <Th className="w-12">
                  <span className="sr-only">Actions</span>
                </Th>
              ) : null}
            </tr>
          </THead>
          <TBody>
            {rows.map((row) => (
              <Tr key={row.id} className={row.status === "disabled" ? "opacity-60" : undefined}>
                <Td>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{row.name}</span>
                    {row.isSelf ? <Badge tone="outline">You</Badge> : null}
                  </div>
                  <div className="text-[12px] text-muted">
                    {row.email}
                    {row.title ? ` · ${row.title}` : ""}
                  </div>
                </Td>
                <Td>{row.roleLabel}</Td>
                <Td>
                  <StateCell row={row} />
                </Td>
                <Td
                  className="whitespace-nowrap text-ink-2"
                  title={row.lastSignInExact ?? undefined}
                >
                  {row.lastSignIn ?? "Never"}
                  {row.activeSessions > 0 ? (
                    <span className="block text-[11.5px] text-muted">
                      {row.activeSessions} active session{row.activeSessions === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </Td>
                {manage ? (
                  <Td className="text-right">
                    <Menu>
                      <MenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Actions for ${row.name}`}
                          disabled={pending}
                        >
                          <MoreHorizontal />
                        </Button>
                      </MenuTrigger>
                      <MenuContent>
                        <MenuItem
                          onSelect={() => setDialog({ kind: "edit", row })}
                          disabled={row.status === "disabled"}
                        >
                          <Pencil className="text-muted" /> Edit name and role
                        </MenuItem>
                        <MenuItem
                          onSelect={() => issueLink(row)}
                          disabled={row.status === "disabled"}
                        >
                          <Link2 className="text-muted" />{" "}
                          {row.state === "invited" ? "New invite link" : "Password reset link"}
                        </MenuItem>
                        <MenuItem
                          disabled={
                            row.isSelf || row.state === "invited" || row.status === "disabled"
                          }
                          onSelect={() =>
                            setDialog({
                              kind: "confirm",
                              confirm: {
                                title: `Reset MFA for ${row.name}?`,
                                body: "Use this when someone loses their phone. Their authenticator and backup codes stop working, they are signed out everywhere, and they must enroll again at next sign-in.",
                                confirmLabel: "Reset MFA",
                                danger: true,
                                run: () => resetMfaAction(row.id),
                              },
                            })
                          }
                        >
                          <KeyRound className="text-muted" /> Reset MFA
                        </MenuItem>
                        <MenuItem
                          disabled={row.activeSessions === 0}
                          onSelect={() =>
                            setDialog({
                              kind: "confirm",
                              confirm: {
                                title: `Sign ${row.name} out everywhere?`,
                                body: "Ends every active session on every device. They can sign in again immediately.",
                                confirmLabel: "End sessions",
                                run: () => revokeSessionsAction(row.id),
                              },
                            })
                          }
                        >
                          <LogOut className="text-muted" /> End all sessions
                        </MenuItem>
                        <MenuSeparator />
                        {row.status === "active" ? (
                          <MenuItem
                            danger
                            disabled={row.isSelf}
                            onSelect={() =>
                              setDialog({
                                kind: "confirm",
                                confirm: {
                                  title: `Deactivate ${row.name}?`,
                                  body: "They are signed out immediately and cannot sign in. Their history stays in the audit log. You can reactivate them later.",
                                  confirmLabel: "Deactivate",
                                  danger: true,
                                  run: () => deactivateUserAction(row.id),
                                },
                              })
                            }
                          >
                            <UserX /> Deactivate
                          </MenuItem>
                        ) : (
                          <MenuItem
                            onSelect={() =>
                              runConfirm({
                                title: "",
                                body: "",
                                confirmLabel: "",
                                run: () => reactivateUserAction(row.id),
                              })
                            }
                          >
                            <UserCheck className="text-muted" /> Reactivate
                          </MenuItem>
                        )}
                      </MenuContent>
                    </Menu>
                  </Td>
                ) : null}
              </Tr>
            ))}
          </TBody>
        </Table>
      </Panel>

      <Dialog open={dialog.kind === "edit"} onOpenChange={(o) => (!o ? close() : undefined)}>
        {dialog.kind === "edit" ? (
          <DialogContent title={`Edit ${dialog.row.name}`} description={dialog.row.email}>
            <EditForm
              row={dialog.row}
              roles={roles}
              onDone={close}
              onSaved={() => setNotice({ tone: "good", text: "Saved." })}
            />
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={dialog.kind === "confirm"} onOpenChange={(o) => (!o ? close() : undefined)}>
        {dialog.kind === "confirm" ? (
          <DialogContent title={dialog.confirm.title}>
            <p className="text-[13.5px] text-ink-2">{dialog.confirm.body}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button
                variant={dialog.confirm.danger ? "danger" : "primary"}
                disabled={pending}
                onClick={() => runConfirm(dialog.confirm)}
              >
                {pending ? (
                  "Working…"
                ) : (
                  <>
                    {dialog.confirm.danger ? <ShieldOff /> : null}
                    {dialog.confirm.confirmLabel}
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={dialog.kind === "link"} onOpenChange={(o) => (!o ? close() : undefined)}>
        {dialog.kind === "link" ? (
          <DialogContent title="Setup link created">
            <SetupLinkResult url={dialog.url} expiresAt={dialog.expiresAt} name={dialog.row.name} />
            <div className="mt-4 flex justify-end">
              <Button onClick={close}>Done</Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

function EditForm({
  row,
  roles,
  onDone,
  onSaved,
}: {
  row: UserRowView;
  roles: RoleOption[];
  onDone: () => void;
  onSaved: () => void;
}) {
  const [state, action, pending] = useActionState(
    async (prev: ActionState<unknown>, form: FormData) => {
      const result = await updateUserAction(prev, form);
      if (result.status === "success") {
        onSaved();
        onDone();
      }
      return result;
    },
    IDLE_STATE,
  );
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  return (
    <form action={action} className="space-y-4">
      {state.status === "error" && !errors ? (
        <Notice tone="critical">{state.message}</Notice>
      ) : null}
      <input type="hidden" name="userId" value={row.id} />
      <PersonFields
        errors={errors}
        roles={roles}
        defaults={{ name: row.name, role: row.role, title: row.title }}
        lockRole={
          row.isSelf ? "You cannot change your own role. Ask another owner attorney." : undefined
        }
      />
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
