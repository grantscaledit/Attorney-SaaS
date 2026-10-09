"use client";

import { ChevronsUpDown, Fingerprint, LogOut, Monitor, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import type { ThemePreference } from "@/lib/ui/theme";
import { hardNavigate } from "@/lib/ui/navigate";
import { setThemeAction } from "./theme-action";

export function UserMenu({
  name,
  email,
  roleLabel,
  theme,
}: {
  name: string;
  email: string;
  roleLabel: string;
  theme: ThemePreference;
}) {
  const [, startTransition] = useTransition();
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const themeItem = (value: ThemePreference, label: string, Icon: typeof Sun) => (
    <MenuItem onSelect={() => startTransition(() => setThemeAction(value))}>
      <Icon className="text-muted" /> {label}
      {theme === value ? <span className="ml-auto text-[11px] text-muted">Current</span> : null}
    </MenuItem>
  );

  return (
    <Menu>
      <MenuTrigger className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-surface/60 focus-visible:outline-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-[11px] font-medium text-accent">
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{name}</span>
          <span className="block truncate text-[11.5px] text-muted">{roleLabel}</span>
        </span>
        <ChevronsUpDown className="size-3.5 text-muted" aria-hidden />
      </MenuTrigger>
      <MenuContent align="start">
        <MenuLabel>{email}</MenuLabel>
        <MenuItem>
          <Link href="/settings/security" className="flex w-full items-center gap-2">
            <Fingerprint className="text-muted" /> Sign-in and security
          </Link>
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Appearance</MenuLabel>
        {themeItem("system", "Match system", Monitor)}
        {themeItem("light", "Light", Sun)}
        {themeItem("dark", "Dark", Moon)}
        <MenuSeparator />
        <MenuItem
          onSelect={() => {
            hardNavigate("/sign-out");
          }}
        >
          <LogOut className="text-muted" /> Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
