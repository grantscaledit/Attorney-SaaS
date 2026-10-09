"use client";

import QRCode from "qrcode";
import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { CopyField } from "@/components/ui/copy-field";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { authClient } from "@/lib/auth/client";

type Step =
  | { kind: "password" }
  | { kind: "scan"; qr: string; secret: string; backupCodes: string[] }
  | { kind: "codes"; backupCodes: string[] };

function secretFromUri(uri: string): string {
  return new URL(uri).searchParams.get("secret") ?? "";
}

export function MfaEnrollment({ email }: { email: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "password" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  async function start(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    const { data, error: err } = await authClient.twoFactor.enable({ password, issuer: "LexDesk" });
    setPending(false);
    if (err || !data || !("totpURI" in data) || !data.totpURI) {
      setError("That password is not correct.");
      return;
    }
    const qr = await QRCode.toDataURL(data.totpURI, {
      margin: 1,
      width: 200,
      errorCorrectionLevel: "M",
    });
    setStep({
      kind: "scan",
      qr,
      secret: secretFromUri(data.totpURI),
      backupCodes: data.backupCodes ?? [],
    });
  }

  async function verify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step.kind !== "scan") return;
    setError(null);
    setPending(true);
    const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\s+/g, "");
    const { error: err } = await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (err) {
      setError("That code is not valid. Check the time on your phone and try the next code.");
      return;
    }
    setStep({ kind: "codes", backupCodes: step.backupCodes });
  }

  function downloadCodes(codes: string[]) {
    const body = [
      "LexDesk backup codes",
      `Account: ${email}`,
      `Generated: ${new Date().toISOString()}`,
      "",
      "Each code works once. Store them somewhere safe and offline.",
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
    <div className="mt-8 space-y-5">
      <ol className="flex gap-4 text-[12px]" aria-label="Steps">
        {["Confirm password", "Scan and verify", "Save backup codes"].map((label, i) => {
          const current = { password: 0, scan: 1, codes: 2 }[step.kind];
          return (
            <li
              key={label}
              className={
                i === current ? "font-medium text-ink" : i < current ? "text-good" : "text-muted"
              }
              aria-current={i === current ? "step" : undefined}
            >
              <span className="font-mono">{i + 1}.</span> {label}
            </li>
          );
        })}
      </ol>

      {error ? <Notice tone="critical">{error}</Notice> : null}

      {step.kind === "password" ? (
        <form onSubmit={start} className="space-y-4">
          <Field id="password" label="Confirm your password">
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
            />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? "Preparing…" : "Continue"}
          </Button>
        </form>
      ) : null}

      {step.kind === "scan" ? (
        <form onSubmit={verify} className="space-y-4">
          <div className="flex items-start gap-4 rounded-md border border-line bg-surface p-4">
            {/* Data URL generated in the browser; the secret never leaves this page. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={step.qr}
              alt="QR code for your authenticator app"
              width={148}
              height={148}
              className="rounded-sm bg-white p-1"
            />
            <div className="min-w-0 space-y-2 text-[13px] text-ink-2">
              <p>Scan this code with your authenticator app.</p>
              <p className="text-muted">Can&apos;t scan? Enter this key manually:</p>
            </div>
          </div>
          <CopyField value={step.secret} label="Setup key" />
          <Field id="code" label="6-digit code from the app">
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              autoFocus
              className="h-11 text-center font-mono text-lg tracking-[0.5em]"
            />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? "Verifying…" : "Verify and turn on"}
          </Button>
        </form>
      ) : null}

      {step.kind === "codes" ? (
        <div className="space-y-4">
          <Notice tone="good" title="Two-step verification is on.">
            Save these backup codes. Each one signs you in once if you lose your phone. They will
            not be shown again.
          </Notice>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-md border border-line bg-sunken px-4 py-3 font-mono text-[13px]">
            {step.backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => downloadCodes(step.backupCodes)}
          >
            <Download /> Download as text file
          </Button>
          <label className="flex items-start gap-2 text-[13px] text-ink-2">
            <input
              type="checkbox"
              className="mt-0.5 accent-[var(--accent)]"
              checked={saved}
              onChange={(e) => setSaved(e.target.checked)}
            />
            I have stored these codes somewhere safe.
          </label>
          <Button
            size="lg"
            className="w-full"
            disabled={!saved}
            onClick={() => {
              router.replace("/");
              router.refresh();
            }}
          >
            Continue to LexDesk
          </Button>
        </div>
      ) : null}
    </div>
  );
}
