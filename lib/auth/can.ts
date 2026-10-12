import type { Role, UserStatus } from "./roles";

/**
 * The single permission policy for LexDesk (spec Section 5).
 *
 * Every page, query and command asks `can()`; nothing else decides access.
 * Actions for modules that ship in later phases are defined now so the policy
 * and its test matrix are reviewed once, as a whole.
 */
export const ACTIONS = [
  // Phase 0: foundation
  "dashboard.view",
  "firm.settings.read",
  "firm.settings.update",
  "users.read",
  "users.invite",
  "users.update",
  "users.deactivate",
  "audit.read",
  "audit.export",
  "flags.read",
  "flags.update",
  "data.export",
  "break_glass.grant",
  // Intake (Phase 1-2)
  "leads.read",
  "leads.write",
  "conflicts.read",
  /** Clear or confirm a conflict pre-screen (A6). Lawyers only: it is a professional judgment. */
  "conflicts.review",
  /** Decline to take a lead on (A11). Lawyers only: the firm's decision not to represent. */
  "leads.decline",
  /** Mark a lead retained and draft the engagement letter (A9). Lawyers only. */
  "leads.retain",
  // Matters and documents (Phase 3)
  "matters.read",
  "matters.write",
  "documents.read",
  "documents.write",
  "drafts.write",
  // AI approval queue (Phase 2)
  "approvals.read",
  "approvals.decide",
  // Deadlines (Phase 4)
  "deadlines.read",
  "deadlines.write",
  "deadline_rules.verify",
  // Revenue (Phase 5)
  "revenue.read",
  "revenue.write",
  "financials.view",
  // Client portal (Phase 3)
  "portal.access",
] as const;

export type Action = (typeof ACTIONS)[number];

export type Actor = {
  id: string;
  role: Role;
  status: UserStatus;
};

/** A matter-scoped resource. Attorneys act on matters they own or are assigned to. */
export type MatterScope = {
  kind: "matter";
  responsibleAttorneyId: string | null;
  assignedUserIds: readonly string[];
  /** For the client portal: the contact's user id(s) linked to this matter. */
  clientUserIds?: readonly string[];
};

export type FirmPolicy = {
  /** Spec Section 5: attorneys see all dashboards except firm financials (configurable). */
  attorneysSeeFinancials: boolean;
};

export type CanContext = {
  resource?: MatterScope;
  policy?: FirmPolicy;
};

type Rule = boolean | ((actor: Actor, ctx: CanContext) => boolean);

const isOnMatter = (actor: Actor, ctx: CanContext): boolean => {
  const m = ctx.resource;
  if (!m) return false;
  return m.responsibleAttorneyId === actor.id || m.assignedUserIds.includes(actor.id);
};

/** Without a resource, "matter-scoped" means "may use the module"; row filtering happens in queries. */
const ownOrAssignedMatter = (actor: Actor, ctx: CanContext): boolean =>
  ctx.resource ? isOnMatter(actor, ctx) : true;

const ownClientMatter = (actor: Actor, ctx: CanContext): boolean =>
  ctx.resource ? (ctx.resource.clientUserIds ?? []).includes(actor.id) : true;

const ALL_ACTIONS_TRUE = Object.fromEntries(ACTIONS.map((a) => [a, true])) as Record<Action, Rule>;

const POLICY: Record<Role, Partial<Record<Action, Rule>>> = {
  owner_attorney: ALL_ACTIONS_TRUE,

  attorney: {
    "dashboard.view": true,
    "firm.settings.read": true,
    "users.read": true,
    "flags.read": true,
    "leads.read": true,
    "leads.write": true,
    "conflicts.read": true,
    "conflicts.review": true,
    "leads.decline": true,
    "leads.retain": true,
    "matters.read": ownOrAssignedMatter,
    "matters.write": ownOrAssignedMatter,
    "documents.read": ownOrAssignedMatter,
    "documents.write": ownOrAssignedMatter,
    "drafts.write": ownOrAssignedMatter,
    "approvals.read": true,
    "approvals.decide": ownOrAssignedMatter,
    "deadlines.read": ownOrAssignedMatter,
    "deadlines.write": ownOrAssignedMatter,
    "revenue.read": true,
    "financials.view": (_a, ctx) => ctx.policy?.attorneysSeeFinancials === true,
  },

  paralegal: {
    "dashboard.view": true,
    "firm.settings.read": true,
    "users.read": true,
    "leads.read": true,
    "conflicts.read": true,
    "matters.read": true,
    "matters.write": true,
    "documents.read": true,
    "documents.write": true,
    "drafts.write": true,
    "approvals.read": true,
    "deadlines.read": true,
    "deadlines.write": true,
  },

  intake: {
    "dashboard.view": true,
    "firm.settings.read": true,
    "leads.read": true,
    "leads.write": true,
    "conflicts.read": true,
  },

  billing: {
    "dashboard.view": true,
    "firm.settings.read": true,
    "revenue.read": true,
    "revenue.write": true,
    "financials.view": true,
  },

  client: {
    "portal.access": true,
    "matters.read": ownClientMatter,
    "documents.read": ownClientMatter,
    "documents.write": ownClientMatter,
  },

  // Nothing by default. Access comes only from a time-boxed break-glass grant (Phase 8),
  // which is evaluated outside this table.
  vendor_support: {},
};

export function can(
  actor: Actor | null | undefined,
  action: Action,
  ctx: CanContext = {},
): boolean {
  if (!actor || actor.status !== "active") return false;
  const rule = POLICY[actor.role][action];
  if (rule === undefined) return false;
  return typeof rule === "boolean" ? rule : rule(actor, ctx);
}

export class ForbiddenError extends Error {
  readonly action: Action;
  constructor(action: Action) {
    super(`Not permitted: ${action}`);
    this.name = "ForbiddenError";
    this.action = action;
  }
}

export function assertCan(
  actor: Actor | null | undefined,
  action: Action,
  ctx: CanContext = {},
): void {
  if (!can(actor, action, ctx)) throw new ForbiddenError(action);
}
