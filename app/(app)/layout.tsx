import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { IdleGuard } from "@/components/shell/idle-guard";
import { NavLink } from "@/components/shell/nav-link";
import { OpsCounters } from "@/components/shell/ops-counters";
import { UserMenu } from "@/components/shell/user-menu";
import { can } from "@/lib/auth/can";
import { AUTH_POLICY } from "@/lib/auth/config";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { requireSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { loadFirmSettings } from "@/lib/firm.config";
import { hasFeature } from "@/lib/flags";
import { NAV } from "@/lib/nav";
import { THEME_COOKIE, parseTheme } from "@/lib/ui/theme";
import { loadOpsCounters } from "@/modules/overview/counters";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const { user, policy } = session;
  const [firm, counters, theme] = await Promise.all([
    loadFirmSettings(),
    loadOpsCounters(user),
    cookies().then((c) => parseTheme(c.get(THEME_COOKIE)?.value)),
  ]);

  const sections = (
    await Promise.all(
      NAV.map(async (section) => ({
        label: section.label,
        items: (
          await Promise.all(
            section.items.map(async (item) =>
              can(user, item.permission, { policy }) &&
              (!item.flag || (await hasFeature(item.flag)))
                ? item
                : null,
            ),
          )
        ).filter((i) => i !== null),
      })),
    )
  ).filter((s) => s.items.length > 0);

  const { DEMO_MODE, FIRM_TIER } = env();

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface-2 md:flex">
        <div className="border-b border-line px-4 py-4">
          <p
            className="truncate font-serif text-[16px] font-semibold leading-tight text-ink"
            title={firm.legalName}
          >
            {firm.displayName}
          </p>
          <p className="eyebrow mt-1">
            {FIRM_TIER === "firm" ? "Firm plan" : "Solo plan"}
            {DEMO_MODE ? " · Demo" : ""}
          </p>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-2.5 py-4" aria-label="Main">
          {sections.map((section) => (
            <div key={section.label}>
              <p className="eyebrow mb-1.5 px-2.5">{section.label}</p>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <NavLink
                      item={{
                        href: item.href,
                        label: item.label,
                        icon: item.icon,
                        prefix: item.prefix,
                      }}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-line p-2">
          <UserMenu
            name={user.name}
            email={user.email}
            roleLabel={ROLE_LABELS[user.role]}
            theme={theme}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {DEMO_MODE ? (
          <div className="border-b border-warning/30 bg-warning-soft px-6 py-1.5 text-center text-[12px] text-warning">
            Demo environment. Every person, matter and figure here is fictional. No messages are
            sent.
          </div>
        ) : null}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-line bg-bg/90 px-6 py-2.5 backdrop-blur">
          <div className="md:hidden">
            <p className="font-serif text-[15px] font-semibold">{firm.displayName}</p>
          </div>
          <div className="ml-auto overflow-x-auto">
            <OpsCounters counters={counters} />
          </div>
        </header>
        <nav
          className="flex gap-1 overflow-x-auto border-b border-line bg-surface-2 px-3 py-2 md:hidden"
          aria-label="Main (compact)"
        >
          {sections
            .flatMap((s) => s.items)
            .map((item) => (
              <NavLink
                key={item.href}
                item={{ href: item.href, label: item.label, icon: item.icon, prefix: item.prefix }}
              />
            ))}
        </nav>
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-7 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>

      <IdleGuard
        idleTimeoutSeconds={AUTH_POLICY.idleTimeoutSeconds}
        warningSeconds={AUTH_POLICY.idleWarningSeconds}
        refreshIntervalSeconds={AUTH_POLICY.refreshIntervalSeconds}
      />
    </div>
  );
}
