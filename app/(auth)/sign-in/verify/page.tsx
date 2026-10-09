import type { Metadata } from "next";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = { title: "Verify sign-in" };

export default function VerifyPage() {
  return (
    <>
      <h1 className="page-title">Two-step verification</h1>
      <p className="mt-1.5 text-[13.5px] text-ink-2">
        Enter the 6-digit code from your authenticator app.
      </p>
      <VerifyForm />
    </>
  );
}
