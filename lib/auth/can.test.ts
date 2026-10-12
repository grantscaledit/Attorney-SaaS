import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  type Action,
  type Actor,
  type MatterScope,
  can,
  assertCan,
  ForbiddenError,
} from "./can";
import { ROLES, type Role } from "./roles";

/*
 * The permission matrix, written out by hand. This is deliberately not derived
 * from the policy: any change to who can do what must change this table too,
 * which makes permission changes visible in code review.
 *
 * Values are the roles allowed with no resource context and default firm policy.
 */
const EXPECTED: Record<Action, readonly Role[]> = {
  "dashboard.view": ["owner_attorney", "attorney", "paralegal", "intake", "billing"],
  "firm.settings.read": ["owner_attorney", "attorney", "paralegal", "intake", "billing"],
  "firm.settings.update": ["owner_attorney"],
  "users.read": ["owner_attorney", "attorney", "paralegal"],
  "users.invite": ["owner_attorney"],
  "users.update": ["owner_attorney"],
  "users.deactivate": ["owner_attorney"],
  "audit.read": ["owner_attorney"],
  "audit.export": ["owner_attorney"],
  "flags.read": ["owner_attorney", "attorney"],
  "flags.update": ["owner_attorney"],
  "data.export": ["owner_attorney"],
  "break_glass.grant": ["owner_attorney"],
  "leads.read": ["owner_attorney", "attorney", "paralegal", "intake"],
  "leads.write": ["owner_attorney", "attorney", "intake"],
  "conflicts.read": ["owner_attorney", "attorney", "paralegal", "intake"],
  "conflicts.review": ["owner_attorney", "attorney"],
  "leads.decline": ["owner_attorney", "attorney"],
  "leads.retain": ["owner_attorney", "attorney"],
  "matters.read": ["owner_attorney", "attorney", "paralegal", "client"],
  "matters.write": ["owner_attorney", "attorney", "paralegal"],
  "documents.read": ["owner_attorney", "attorney", "paralegal", "client"],
  "documents.write": ["owner_attorney", "attorney", "paralegal", "client"],
  "drafts.write": ["owner_attorney", "attorney", "paralegal"],
  "approvals.read": ["owner_attorney", "attorney", "paralegal"],
  "approvals.decide": ["owner_attorney", "attorney"],
  "deadlines.read": ["owner_attorney", "attorney", "paralegal"],
  "deadlines.write": ["owner_attorney", "attorney", "paralegal"],
  "deadline_rules.verify": ["owner_attorney"],
  "revenue.read": ["owner_attorney", "attorney", "billing"],
  "revenue.write": ["owner_attorney", "billing"],
  "financials.view": ["owner_attorney", "billing"],
  "portal.access": ["owner_attorney", "client"],
};

const actor = (role: Role, id = `user-${role}`): Actor => ({ id, role, status: "active" });

describe("can(): role x action matrix", () => {
  it("covers every action", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...ACTIONS].sort());
  });

  for (const role of ROLES) {
    for (const action of ACTIONS) {
      const allowed = EXPECTED[action].includes(role);
      it(`${role} ${allowed ? "can" : "cannot"} ${action}`, () => {
        expect(can(actor(role), action)).toBe(allowed);
      });
    }
  }
});

describe("can(): account state", () => {
  it("denies everything to a disabled user, including the owner", () => {
    const disabled: Actor = { id: "u1", role: "owner_attorney", status: "disabled" };
    for (const action of ACTIONS) expect(can(disabled, action)).toBe(false);
  });

  it("denies everything to an anonymous caller", () => {
    for (const action of ACTIONS) {
      expect(can(null, action)).toBe(false);
      expect(can(undefined, action)).toBe(false);
    }
  });

  it("gives vendor_support nothing without break-glass", () => {
    for (const action of ACTIONS) expect(can(actor("vendor_support"), action)).toBe(false);
  });
});

describe("can(): matter scope", () => {
  const attorney = actor("attorney", "att-1");
  const own: MatterScope = { kind: "matter", responsibleAttorneyId: "att-1", assignedUserIds: [] };
  const assigned: MatterScope = {
    kind: "matter",
    responsibleAttorneyId: "att-2",
    assignedUserIds: ["att-1"],
  };
  const other: MatterScope = {
    kind: "matter",
    responsibleAttorneyId: "att-2",
    assignedUserIds: ["para-1"],
  };

  it.each([
    "matters.read",
    "matters.write",
    "documents.read",
    "deadlines.write",
    "approvals.decide",
  ] as const)("attorney %s: own and assigned matters only", (action) => {
    expect(can(attorney, action, { resource: own })).toBe(true);
    expect(can(attorney, action, { resource: assigned })).toBe(true);
    expect(can(attorney, action, { resource: other })).toBe(false);
  });

  it("owner attorney can act on any matter", () => {
    expect(can(actor("owner_attorney"), "approvals.decide", { resource: other })).toBe(true);
  });

  it("paralegal can never approve AI output to clients, even on an assigned matter", () => {
    const para = actor("paralegal", "para-1");
    expect(can(para, "approvals.decide", { resource: other })).toBe(false);
    expect(can(para, "matters.write", { resource: other })).toBe(true);
  });

  it("client sees only their own matter", () => {
    const client = actor("client", "client-1");
    const mine: MatterScope = { ...other, clientUserIds: ["client-1"] };
    const theirs: MatterScope = { ...other, clientUserIds: ["client-2"] };
    expect(can(client, "matters.read", { resource: mine })).toBe(true);
    expect(can(client, "matters.read", { resource: theirs })).toBe(false);
    expect(can(client, "documents.write", { resource: theirs })).toBe(false);
    expect(can(client, "matters.write", { resource: mine })).toBe(false);
  });

  it("intake has no matter documents", () => {
    expect(can(actor("intake"), "documents.read", { resource: own })).toBe(false);
  });
});

describe("can(): firm policy", () => {
  it("attorney financials visibility follows the firm setting", () => {
    const a = actor("attorney");
    expect(can(a, "financials.view", { policy: { attorneysSeeFinancials: false } })).toBe(false);
    expect(can(a, "financials.view", { policy: { attorneysSeeFinancials: true } })).toBe(true);
  });
});

describe("assertCan()", () => {
  it("throws ForbiddenError naming the action", () => {
    expect(() => assertCan(actor("intake"), "audit.read")).toThrow(ForbiddenError);
    expect(() => assertCan(actor("owner_attorney"), "audit.read")).not.toThrow();
  });
});
