import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { MfaEnrollment } from "./mfa-enrollment";

export const metadata: Metadata = { title: "Set up two-step verification" };

export default async function MfaSetupPage() {
  const { user } = await requireSession({ allowPendingMfa: true });
  if (user.twoFactorEnabled) redirect("/");
  return (
    <>
      <p className="eyebrow mb-2">Required before you continue</p>
      <h1 className="page-title">Set up two-step verification</h1>
      <p className="mt-1.5 text-[13.5px] text-ink-2">
        Every LexDesk account uses an authenticator app (Microsoft Authenticator, Google
        Authenticator, 1Password or similar) in addition to a password.
      </p>
      <MfaEnrollment email={user.email} />
    </>
  );
}
