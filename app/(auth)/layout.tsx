import type { ReactNode } from "react";
import { env } from "@/lib/env";
import { loadFirmSettings } from "@/lib/firm.config";

export const dynamic = "force-dynamic";

async function firmName(): Promise<string | null> {
  try {
    return (await loadFirmSettings()).displayName;
  } catch {
    return null;
  }
}

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const name = await firmName();
  const demo = env().DEMO_MODE;
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden flex-col justify-between border-r border-line bg-surface-2 px-12 py-10 lg:flex">
        <div className="flex items-center gap-2.5">
          <Mark />
          <span className="font-serif text-[17px] font-semibold tracking-tight">LexDesk</span>
        </div>
        <div className="max-w-md">
          <p className="eyebrow mb-4">{name ?? "Law firm operations"}</p>
          <p className="font-serif text-[28px] leading-[1.2] text-ink">
            Intake, matters, deadlines and revenue in one place, with every action on the record.
          </p>
        </div>
        <ul className="space-y-1.5 text-[12.5px] text-muted">
          <li>Multi-factor authentication is required for every account.</li>
          <li>Sessions end after 30 minutes without activity.</li>
          <li>Every sign-in and change is written to the firm&apos;s audit log.</li>
        </ul>
      </aside>
      <main className="flex flex-col px-4 py-10 sm:px-8">
        <div className="mb-10 flex items-center gap-2.5 lg:hidden">
          <Mark />
          <span className="font-serif text-[17px] font-semibold">LexDesk</span>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
          {demo ? (
            <p className="mb-6 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-[12.5px] text-warning">
              Demo environment. All people and data are fictional.
            </p>
          ) : null}
          {children}
        </div>
        <p className="mx-auto mt-10 text-[12px] text-muted">LexDesk by Giddens Systems</p>
      </main>
    </div>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 24 24" className="size-6 text-accent" aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="4" fill="currentColor" />
      <path
        d="M8 6.5v11h8"
        stroke="var(--accent-ink)"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="square"
      />
    </svg>
  );
}
