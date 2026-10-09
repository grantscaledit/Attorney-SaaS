/** Roles from spec Section 5. Order is display order. */
export const ROLES = [
  "owner_attorney",
  "attorney",
  "paralegal",
  "intake",
  "billing",
  "client",
  "vendor_support",
] as const;

export type Role = (typeof ROLES)[number];

/** Staff roles can be assigned from Settings > Users. `client` comes from the portal (Phase 3), `vendor_support` only via break-glass (Phase 8). */
export const ASSIGNABLE_STAFF_ROLES = [
  "owner_attorney",
  "attorney",
  "paralegal",
  "intake",
  "billing",
] as const satisfies readonly Role[];

export type AssignableStaffRole = (typeof ASSIGNABLE_STAFF_ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner_attorney: "Owner attorney",
  attorney: "Attorney",
  paralegal: "Paralegal",
  intake: "Intake",
  billing: "Billing",
  client: "Client",
  vendor_support: "Vendor support",
};

export const USER_STATUSES = ["active", "disabled"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
