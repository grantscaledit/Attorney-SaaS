"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CheckSquare,
  FileClock,
  Handshake,
  ShieldAlert,
  Fingerprint,
  Inbox,
  Landmark,
  LayoutGrid,
  MessageSquareText,
  Plug,
  ToggleRight,
  Users,
} from "lucide-react";
import { cn } from "@/lib/ui/cn";
import type { NavItem } from "@/lib/nav";

const ICONS = {
  overview: LayoutGrid,
  intake: Inbox,
  approvals: CheckSquare,
  conflicts: ShieldAlert,
  referrals: Handshake,
  audit: FileClock,
  firm: Landmark,
  users: Users,
  features: ToggleRight,
  integrations: Plug,
  templates: MessageSquareText,
  security: Fingerprint,
} as const;

export function NavLink({ item }: { item: Pick<NavItem, "href" | "label" | "icon" | "prefix"> }) {
  const pathname = usePathname();
  const active = item.prefix
    ? pathname === item.href || pathname.startsWith(`${item.href}/`)
    : pathname === item.href;
  const Icon = ICONS[item.icon];
  return (
    <Link
      href={item.href as Route}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] transition-colors",
        active
          ? "bg-surface text-ink shadow-panel"
          : "text-ink-2 hover:bg-surface/60 hover:text-ink",
      )}
    >
      {active ? (
        <span className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-accent" aria-hidden />
      ) : null}
      <Icon
        className={cn("size-4", active ? "text-accent" : "text-muted group-hover:text-ink-2")}
        aria-hidden
      />
      {item.label}
    </Link>
  );
}
