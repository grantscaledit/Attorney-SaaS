import { z } from "zod";
import { DOC_TYPES } from "@/practice";

/*
 * Model prompts for B3 and B4. The model only ever sees masked text
 * (lib/ai/call.ts masks again; ALLOW_RAW_DOCUMENT_TO_LLM is off). Its values
 * are checked against the text before they are used (notice-parser.ts).
 */

export const B4_PROMPT_VERSION = "b4-2026-10-11";
export const B3_PROMPT_VERSION = "b3-2026-10-11";

export const b4Output = z.object({
  docType: z.enum(DOC_TYPES),
  confidence: z.number().min(0).max(1),
});

export const B4_SYSTEM = [
  "You classify one document a law firm received, from the first part of its text (identifiers are masked).",
  `Choose docType from: ${DOC_TYPES.join(", ")}. Use "other" when none fits.`,
  "confidence is your probability that docType is right.",
].join("\n");

export const b3Output = z.object({
  agency: z.enum(["IRS", "Texas Comptroller", "Other"]).nullable(),
  noticeType: z.string().max(40).nullable(),
  taxYears: z.array(z.string().regex(/^(19|20)\d{2}$/)).max(20),
  amountDue: z.string().max(30).nullable(),
  noticeDate: z.string().max(40).nullable(),
  respondBy: z.string().max(40).nullable(),
  summary: z.string().min(1).max(800),
});
export type B3Output = z.output<typeof b3Output>;

export const B3_SYSTEM = [
  "You read one tax notice for a law firm and report what it says. Identifiers are masked; never guess them.",
  "Copy values exactly as printed. Use null when a value is not printed. Never compute a date: respondBy is a date printed on the notice as the date to respond, pay, petition or request a hearing by.",
  "amountDue: the amount the notice says is due, digits and commas as printed, without the dollar sign.",
  'noticeDate and respondBy: as printed, e.g. "October 30, 2026".',
  "summary: two to four plain sentences for the attorney on what the notice says and what it asks the taxpayer to do. Do not give advice, assess the merits, or predict an outcome.",
].join("\n");
