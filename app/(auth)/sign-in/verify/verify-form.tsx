"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { authClient } from "@/lib/auth/client";

export function VerifyForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\s+/g, "");
    const { error: err } =
      mode === "totp"
        ? await authClient.twoFactor.verifyTotp({ code })
        : await authClient.twoFactor.verifyBackupCode({ code });
    if (err) {
      setPending(false);
      if (err.status === 401 && /cookie/i.test(err.message ?? "")) {
        setError("This sign-in attempt expired. Start again.");
      } else if (err.status === 429) {
        setError("Too many attempts. The account is locked for 15 minutes.");
      } else {
        setError(
          mode === "totp"
            ? "That code is not valid. Codes change every 30 seconds."
            : "That backup code is not valid.",
        );
      }
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
      {error ? <Notice tone="critical">{error}</Notice> : null}
      {mode === "totp" ? (
        <Field id="code" label="Authentication code">
          <Input
            key="totp"
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoFocus
            className="h-11 text-center font-mono text-lg tracking-[0.5em]"
          />
        </Field>
      ) : (
        <Field id="code" label="Backup code" hint="Each backup code works once.">
          <Input
            key="backup"
            id="code"
            name="code"
            autoComplete="off"
            required
            autoFocus
            className="font-mono"
          />
        </Field>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Verifying…" : "Verify"}
      </Button>
      <div className="flex items-center justify-between text-[12.5px]">
        <button
          type="button"
          className="text-accent underline-offset-4 hover:underline"
          onClick={() => {
            setMode(mode === "totp" ? "backup" : "totp");
            setError(null);
          }}
        >
          {mode === "totp" ? "Use a backup code" : "Use authenticator app"}
        </button>
        <Link href="/sign-in" className="text-muted hover:text-ink">
          Start over
        </Link>
      </div>
    </form>
  );
}
