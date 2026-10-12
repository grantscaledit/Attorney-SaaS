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
  icon:
    | "overview"
    | "intake"
    | "approvals"
    | "conflicts"
    | "referrals"
    | "ai"
    | "matters"
    | "pipeline"
    | "letter"
    | "audit"
    | "firm"
    | "users"
    | "features"
    | "integrations"
    | "templates"
    | "security"
    | "deadlines"
    | "rules"
    | "calendar";
  permission: Action;
  flag?: FeatureFlag;
  /** Match nested routes as active. */
  prefix?: boolean;
};

export type NavSection = { label: string; items: NavItem[] };

export const NAV: NavSection[] = [
  {
    label: "Workspace",
    items: [
      { href: "/", label: "Overview", icon: "overview", permission: "dashboard.view" },
      { href: "/intake", label: "Intake", icon: "intake", permission: "leads.read", prefix: true },
      {
        href: "/matters",
        label: "Matters",
        icon: "matters",
        permission: "matters.read",
        prefix: true,
      },
      { href: "/pipeline", label: "Pipeline", icon: "pipeline", permission: "matters.read" },
      {
        href: "/deadlines",
        label: "Deadlines",
        icon: "deadlines",
        permission: "deadlines.read",
      },
      { href: "/approvals", label: "Approvals", icon: "approvals", permission: "approvals.read" },
    ],
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
      {
        href: "/settings/integrations",
        label: "GoHighLevel",
        icon: "integrations",
        permission: "firm.settings.update",
      },
      {
        href: "/settings/ai",
        label: "AI intake",
        icon: "ai",
        permission: "firm.settings.read",
      },
      {
        href: "/settings/engagement",
        label: "Engagement letter",
        icon: "letter",
        permission: "firm.settings.read",
      },
      {
        href: "/settings/deadline-rules",
        label: "Deadline rules",
        icon: "rules",
        permission: "deadlines.read",
        prefix: true,
      },
      {
        href: "/settings/conflicts",
        label: "Conflict list",
        icon: "conflicts",
        permission: "conflicts.read",
      },
      {
        href: "/settings/referrals",
        label: "Referral partners",
        icon: "referrals",
        permission: "firm.settings.read",
      },
      {
        href: "/settings/templates",
        label: "Message templates",
        icon: "templates",
        permission: "firm.settings.read",
      },
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
      {
        href: "/settings/calendar",
        label: "Calendar link",
        icon: "calendar",
        permission: "deadlines.read",
      },
    ],
  },
];
