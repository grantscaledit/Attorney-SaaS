import type { Route } from "next";
import type { Action } from "@/lib/auth/can";
import type { FeatureFlag } from "@/lib/flags/catalog";

/**
 * Navigation registry. A module adds its entry here with the permission (and
 * optional feature flag) that gates it; the shell filters per user.
 */
export type NavItem = {
  href: Route;
  label: string;
  icon: "overview" | "audit" | "firm" | "users" | "features" | "security";
  permission: Action;
  flag?: FeatureFlag;
  /** Match nested routes as active. */
  prefix?: boolean;
};

export type NavSection = { label: string; items: NavItem[] };

export const NAV: NavSection[] = [
  {
    label: "Workspace",
    items: [{ href: "/", label: "Overview", icon: "overview", permission: "dashboard.view" }],
  },
  {
    label: "Administration",
    items: [
      { href: "/audit", label: "Audit log", icon: "audit", permission: "audit.read", prefix: true },
      {
        href: "/settings/firm",
        label: "Firm settings",
        icon: "firm",
        permission: "firm.settings.read",
      },
      {
        href: "/settings/users",
        label: "Users and roles",
        icon: "users",
        permission: "users.read",
      },
      { href: "/settings/features", label: "Features", icon: "features", permission: "flags.read" },
    ],
  },
  {
    label: "Account",
    items: [
      {
        href: "/settings/security",
        label: "Sign-in and security",
        icon: "security",
        permission: "dashboard.view",
      },
    ],
  },
];
