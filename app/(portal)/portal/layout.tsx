import type { ReactNode } from "react";
import { IdleGuard } from "@/components/shell/idle-guard";
import { AUTH_POLICY } from "@/lib/auth/config";
import { requireClient } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { loadFirmSettings } from "@/lib/firm.config";

export const dynamic = "force-dynamic";

/** Client portal shell (Phase 3). Clients see only their own matters. */
export default async function PortalLayout({ children }: { children: ReactNode }) {
  const { user } = await requireClient();
  const firm = await loadFirmSettings();
  return (
    <div className="min-h-dvh bg-bg">
      {env().DEMO_MODE ? (
        <div className="border-b border-warning/30 bg-warning-soft px-6 py-1.5 text-center text-[12px] text-warning">
          Demo environment. Every person and matter here is fictional.
        </div>
      ) : null}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[900px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href="/portal" className="font-serif text-[16px] font-semibold text-ink">
            {firm.displayName}
          </a>
          <div className="flex items-center gap-3 text-[13px]">
            <span className="text-muted">{user.name}</span>
            <a href="/sign-out" className="text-accent hover:underline">
              Sign out
            </a>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[900px] px-4 py-7 sm:px-6">{children}</main>
      <footer className="mx-auto max-w-[900px] px-4 pb-8 text-[12px] text-muted sm:px-6">
        <p>{firm.aiDisclosureText}</p>
      </footer>
      <IdleGuard
        idleTimeoutSeconds={AUTH_POLICY.idleTimeoutSeconds}
        warningSeconds={AUTH_POLICY.idleWarningSeconds}
        refreshIntervalSeconds={AUTH_POLICY.refreshIntervalSeconds}
      />
    </div>
  );
}
