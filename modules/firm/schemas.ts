import { z } from "zod";
import { PRACTICE_AREAS } from "@/db/schema";
import { isValidAllowlistEntry } from "@/lib/auth/ip-allowlist";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const DEFAULT_AI_DISCLOSURE =
  "This firm uses an AI assistant to help collect information and schedule consultations. " +
  "The assistant cannot give legal advice. No attorney-client relationship exists until you and the firm " +
  "sign an engagement letter.";

export const firmSettingsInput = z.object({
  legalName: z.string().trim().min(2, "Enter the firm's legal name").max(200),
  displayName: z.string().trim().min(2, "Enter a display name").max(120),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(100),
  state: optionalText(2).refine(
    (v) => v === null || /^[A-Z]{2}$/.test(v),
    "Use the two-letter state code",
  ),
  postalCode: optionalText(10).refine(
    (v) => v === null || /^\d{5}(-\d{4})?$/.test(v),
    "Use a 5 or 9 digit ZIP code",
  ),
  phone: optionalText(30),
  website: optionalText(200).refine(
    (v) => v === null || /^https:\/\/\S+$/.test(v),
    "Use a full https:// address",
  ),
  bookingUrl: optionalText(300).refine(
    (v) => v === null || /^https:\/\/\S+$/.test(v),
    "Use a full https:// address",
  ),
  intakeFormUrl: optionalText(300).refine(
    (v) => v === null || /^https:\/\/\S+$/.test(v),
    "Use a full https:// address",
  ),
  practiceAreas: z.array(z.enum(PRACTICE_AREAS)).min(1, "Choose at least one practice area"),
  aiDisclosureText: z
    .string()
    .trim()
    .min(
      80,
      "The disclosure must explain AI use, no legal advice, and no attorney-client relationship",
    )
    .max(2000),
  attorneysSeeFinancials: z.boolean(),
  ipAllowlist: z
    .array(z.string().trim().min(1))
    .max(50)
    .refine(
      (list) => list.every(isValidAllowlistEntry),
      "Each entry must be an IP address or CIDR range",
    ),
});

export type FirmSettingsInput = z.infer<typeof firmSettingsInput>;
