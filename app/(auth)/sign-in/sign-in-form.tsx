"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { authClient } from "@/lib/auth/client";

export function SignInForm({ defaultEmail }: { defaultEmail: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const { data, error: err } = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      rememberMe: true,
    });
    if (err) {
      setPending(false);
      setError(
        err.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : err.status === 403
            ? (err.message ?? "Sign-in is not allowed from this network.")
            : "That email and password do not match an active account.",
      );
      return;
    }
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      router.push("/sign-in/verify");
      return;
    }
    // First sign-in: the app will route to MFA enrollment.
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
      {error ? <Notice tone="critical">{error}</Notice> : null}
      <Field id="email" label="Email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={defaultEmail}
          autoFocus={!defaultEmail}
        />
      </Field>
      <Field id="password" label="Password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus={!!defaultEmail}
        />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Continue"}
      </Button>
      <p className="text-[12.5px] text-muted">
        Forgot your password or lost your authenticator? Your firm&apos;s owner attorney can send
        you a new setup link.
      </p>
    </form>
  );
}
