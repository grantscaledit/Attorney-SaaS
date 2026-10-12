"use client";

import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Badge, StatusLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { authClient } from "@/lib/auth/client";
import { revokeOwnSessionAction } from "./actions";

export type SessionView = {
  id: string;
  device: string;
  ip: string | null;
  signedIn: string;
  lastActive: string;
  current: boolean;
};

type Msg = { tone: "good" | "critical"; text: string } | null;

export function SecurityPanels({
  sessions,
  minPasswordLength,
}: {
  sessions: SessionView[];
  minPasswordLength: number;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ChangePassword minLength={minPasswordLength} />
      <BackupCodes />
      <div className="lg:col-span-2">
        <Sessions sessions={sessions} />
      </div>
    </div>
  );
}

function ChangePassword({ minLength }: { minLength: number }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const next = String(form.get("newPassword") ?? "");
    if (next !== String(form.get("confirm") ?? "")) {
      setMsg({ tone: "critical", text: "The new passwords do not match." });
      return;
    }
    if (next.length < minLength) {
      setMsg({ tone: "critical", text: `Use at least ${minLength} characters.` });
      return;
    }
    setPending(true);
    const { error } = await authClient.changePassword({
      currentPassword: String(form.get("currentPassword") ?? ""),
      newPassword: next,
      revokeOtherSessions: true,
    });
    setPending(false);
    if (error) {
      setMsg({
        tone: "critical",
        text:
          error.status === 400
            ? "Your current password is not correct."
            : "The password was not changed. Try again.",
      });
      return;
    }
    formEl.reset();
    setMsg({ tone: "good", text: "Password changed. Your other sessions were signed out." });
  }

  return (
    <Panel>
      <PanelHeader title="Password" />
      <PanelBody>
        <form onSubmit={onSubmit} className="space-y-4">
          {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
          <input type="text" name="username" autoComplete="username" hidden readOnly />
          <Field id="currentPassword" label="Current password">
            <Input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <Field id="newPassword" label="New password" hint={`At least ${minLength} characters.`}>
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={minLength}
            />
          </Field>
          <Field id="confirm" label="Confirm new password">
            <Input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
            />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="secondary" disabled={pending}>
              {pending ? "Saving…" : "Change password"}
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}

function BackupCodes() {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    setPending(true);
    const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
    setPending(false);
    if (error || !data) {
      setMsg({ tone: "critical", text: "That password is not correct." });
      return;
    }
    setMsg(null);
    setCodes(data.backupCodes);
  }

  function download() {
    if (!codes) return;
    const body = [
      "LexDesk backup codes",
      `Generated: ${new Date().toISOString()}`,
      "",
      ...codes,
      "",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "lexdesk-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Panel>
      <PanelHeader
        title="Two-step verification"
        actions={<StatusLabel tone="good">On</StatusLabel>}
      />
      <PanelBody className="space-y-4">
        <p className="text-[13px] text-ink-2">
          Two-step verification is required for every account and cannot be turned off. If you get a
          new phone, ask your owner attorney to reset it so you can enroll the new device.
        </p>
        {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
        {codes ? (
          <div className="space-y-3">
            <Notice tone="good" title="New backup codes">
              Your previous codes no longer work. Store these somewhere safe; they will not be shown
              again.
            </Notice>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border border-line bg-sunken px-4 py-3 font-mono text-[13px]">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <Button variant="secondary" onClick={download}>
              <Download /> Download
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <Field
              id="bc-password"
              label="Password"
              hint="Generating new codes invalidates the old ones."
            >
              <Input
                id="bc-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="secondary" disabled={pending}>
                {pending ? "Generating…" : "Generate new backup codes"}
              </Button>
            </div>
          </form>
        )}
      </PanelBody>
    </Panel>
  );
}

function Sessions({ sessions }: { sessions: SessionView[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, setPending] = useState(false);
  const others = sessions.filter((s) => !s.current).length;

  async function revokeOthers() {
    setPending(true);
    const { error } = await authClient.revokeOtherSessions();
    setPending(false);
    setMsg(
      error
        ? { tone: "critical", text: "Could not end the other sessions." }
        : { tone: "good", text: "Other sessions ended." },
    );
    router.refresh();
  }

  async function revokeOne(sessionId: string) {
    setPending(true);
    const { ok } = await revokeOwnSessionAction(sessionId);
    setPending(false);
    setMsg(
      ok
        ? { tone: "good", text: "Session ended." }
        : { tone: "critical", text: "Could not end that session." },
    );
    router.refresh();
  }

  return (
    <Panel>
      <PanelHeader
        title="Where you're signed in"
        description="Sign out of anything you don't recognize, then change your password."
        actions={
          others > 0 ? (
            <Button variant="secondary" size="sm" disabled={pending} onClick={revokeOthers}>
              Sign out all other sessions
            </Button>
          ) : null
        }
      />
      {msg ? (
        <div className="px-5 pt-4">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      ) : null}
      <Table>
        <THead>
          <tr>
            <Th>Device</Th>
            <Th>Network</Th>
            <Th>Signed in</Th>
            <Th>Last active</Th>
            <Th className="w-24">
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </THead>
        <TBody>
          {sessions.map((s) => (
            <Tr key={s.id}>
              <Td>
                {s.device} {s.current ? <Badge tone="accent">This device</Badge> : null}
              </Td>
              <Td className="font-mono text-[12px] text-ink-2">{s.ip ?? "–"}</Td>
              <Td className="whitespace-nowrap">{s.signedIn}</Td>
              <Td className="whitespace-nowrap text-ink-2">{s.lastActive}</Td>
              <Td className="text-right">
                {s.current ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => revokeOne(s.id)}
                  >
                    Sign out
                  </Button>
                )}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </Panel>
  );
}
