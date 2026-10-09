import { and, eq, gt, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { userInvites, users } from "@/db/schema";
import { Notice } from "@/components/ui/notice";
import { AUTH_POLICY } from "@/lib/auth/config";
import { hashSetupToken } from "@/modules/users/commands/setup-link";
import { AcceptInviteForm } from "./accept-invite-form";

export const metadata: Metadata = { title: "Set your password", referrer: "no-referrer" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [row] = await getDb()
    .select({ email: users.email, name: users.name, status: users.status })
    .from(userInvites)
    .innerJoin(users, eq(users.id, userInvites.userId))
    .where(
      and(
        eq(userInvites.tokenHash, hashSetupToken(token)),
        isNull(userInvites.acceptedAt),
        isNull(userInvites.revokedAt),
        gt(userInvites.expiresAt, new Date()),
      ),
    );

  if (!row || row.status !== "active") {
    return (
      <>
        <h1 className="page-title">Link not valid</h1>
        <Notice tone="warning" className="mt-6">
          This setup link has expired or was already used. Ask your firm&apos;s owner attorney to
          send a new one.
        </Notice>
      </>
    );
  }

  return (
    <>
      <h1 className="page-title">Set your password</h1>
      <p className="mt-1.5 text-[13.5px] text-ink-2">
        Welcome, {row.name}. Choose a password for{" "}
        <span className="font-medium text-ink">{row.email}</span>. Next you will set up two-step
        verification.
      </p>
      <AcceptInviteForm token={token} email={row.email} minLength={AUTH_POLICY.minPasswordLength} />
    </>
  );
}
