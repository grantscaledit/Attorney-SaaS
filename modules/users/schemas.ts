import { z } from "zod";
import { AUTH_POLICY } from "@/lib/auth/config";
import { ASSIGNABLE_STAFF_ROLES } from "@/lib/auth/roles";

export const personName = z.string().trim().min(2, "Enter a full name").max(120);
export const email = z
  .email("Enter a valid email address")
  .trim()
  .max(254)
  .transform((v) => v.toLowerCase());
export const staffRole = z.enum(ASSIGNABLE_STAFF_ROLES, { message: "Choose a role" });
export const jobTitle = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((v) => (v ? v : null));
export const userId = z.uuid("Unknown user");

export const newPassword = z
  .string()
  .min(AUTH_POLICY.minPasswordLength, `Use at least ${AUTH_POLICY.minPasswordLength} characters`)
  .max(AUTH_POLICY.maxPasswordLength, `Use at most ${AUTH_POLICY.maxPasswordLength} characters`);
