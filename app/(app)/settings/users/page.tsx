import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/panel";
import { can } from "@/lib/auth/can";
import { ASSIGNABLE_STAFF_ROLES, ROLE_LABELS } from "@/lib/auth/roles";
import { requirePermission } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { userLimit } from "@/lib/flags";
import { formatDateTime, formatRelative } from "@/lib/ui/format";
import { listUsers, summarizeAccess } from "@/modules/users/queries";
import { InviteUserButton } from "./invite-user";
import { UsersTable, type UserRowView } from "./users-table";

export const metadata: Metadata = { title: "Users and roles" };

const ROLE_SUMMARIES: Record<(typeof ASSIGNABLE_STAFF_ROLES)[number], string> = {
  owner_attorney:
    "Everything, including approvals, user management, audit export and firm settings.",
  attorney:
    "Own and assigned matters, approvals on those matters, dashboards. Financials if the firm allows.",
  paralegal: "Matters, documents, deadlines and drafts. Cannot approve AI output to clients.",
  intake: "Leads, consultations and conflict pre-screen results. No matter documents.",
  billing: "Revenue, invoices, receivables and payment follow-up.",
};

export default async function UsersPage() {
  const { user, policy } = await requirePermission("users.read");
  const tz = env().FIRM_TIMEZONE;
  const people = await listUsers(user);
  const access = summarizeAccess(people);
  const limit = userLimit(env().FIRM_TIER);
  const manage = can(user, "users.update", { policy });

  const rows: UserRowView[] = people.map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    role: p.role,
    roleLabel: ROLE_LABELS[p.role],
    title: p.title,
    status: p.status,
    isSelf: p.id === user.id,
    state:
      p.status === "disabled"
        ? "disabled"
        : !p.hasPassword
          ? "invited"
          : !p.twoFactorEnabled
            ? "mfa_pending"
            : "active",
    inviteExpires: p.pendingInviteExpiresAt ? formatDateTime(p.pendingInviteExpiresAt, tz) : null,
    lastSignIn: p.lastSignInAt ? formatRelative(p.lastSignInAt) : null,
    lastSignInExact: p.lastSignInAt ? formatDateTime(p.lastSignInAt, tz) : null,
    activeSessions: p.activeSessions,
  }));

  return (
    <>
      <PageHeader
        title="Users and roles"
        description={
          limit
            ? `${access.activeUsers} of ${limit} users on the Solo plan. Every account must use two-step verification.`
            : `${access.activeUsers} active users. Every account must use two-step verification.`
        }
        actions={
          can(user, "users.invite", { policy }) ? (
            <InviteUserButton
              disabled={limit !== null && access.activeUsers >= limit}
              roles={ASSIGNABLE_STAFF_ROLES.map((r) => ({
                value: r,
                label: ROLE_LABELS[r],
                summary: ROLE_SUMMARIES[r],
              }))}
            />
          ) : null
        }
      />
      <UsersTable
        rows={rows}
        manage={manage}
        roles={ASSIGNABLE_STAFF_ROLES.map((r) => ({
          value: r,
          label: ROLE_LABELS[r],
          summary: ROLE_SUMMARIES[r],
        }))}
      />
      <section className="mt-8">
        <h2 className="eyebrow mb-3">What each role can do</h2>
        <dl className="grid gap-x-8 gap-y-3 text-[13px] md:grid-cols-2">
          {ASSIGNABLE_STAFF_ROLES.map((r) => (
            <div key={r} className="border-l-2 border-line pl-3">
              <dt className="font-medium text-ink">{ROLE_LABELS[r]}</dt>
              <dd className="text-ink-2">{ROLE_SUMMARIES[r]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
