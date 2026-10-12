import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Notice } from "@/components/ui/notice";
import { getRawSession } from "@/lib/auth/session";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

const REASON_MESSAGES: Record<string, { tone: "info" | "warning"; text: string }> = {
  idle: { tone: "info", text: "You were signed out after 30 minutes without activity." },
  expired: {
    tone: "info",
    text: "Your session reached its 12-hour limit. Sign in again to continue.",
  },
  disabled: {
    tone: "warning",
    text: "This account is not active. Contact your firm's owner attorney.",
  },
  network: { tone: "warning", text: "Your firm only allows access from approved networks." },
  welcome: {
    tone: "info",
    text: "Your password is set. Sign in, then set up your authenticator app.",
  },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; email?: string }>;
}) {
  const { reason, email } = await searchParams;
  if (await getRawSession()) redirect("/");
  const message = reason ? REASON_MESSAGES[reason] : undefined;

  return (
    <>
      <h1 className="page-title">Sign in</h1>
      <p className="mt-1.5 text-[13.5px] text-ink-2">
        Use the email address your firm registered for you.
      </p>
      {message ? (
        <Notice tone={message.tone} className="mt-6">
          {message.text}
        </Notice>
      ) : null}
      <SignInForm defaultEmail={email ?? ""} />
    </>
  );
}
