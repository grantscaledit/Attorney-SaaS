import type { PracticeArea } from "@/db/schema";

/**
 * A practice module (spec Section 8). Everything practice-specific lives in
 * /practice/<area>/; adding an area means adding a folder and one line in
 * practice/index.ts. Later phases add matter types, checklists, deadline rules
 * and cross-sell rules to the same object.
 */

export type IntakeQuestion = {
  id: string;
  /** Short label for staff screens and the pre-consult brief. */
  label: string;
  /** What the assistant needs to learn, phrased for the model, not the person. */
  intent: string;
  required: boolean;
  /** Money and date answers are listed separately in the pre-consult brief (A8). */
  kind?: "money" | "date";
  /** Only asked when another answer makes it relevant. */
  askWhen?: (answers: Answers) => boolean;
};

export type Answers = Record<string, string>;

export type ScoreParts = {
  /** 0-40: how soon harm happens without help. */
  urgency: number;
  /** 0-35: likely size of the matter. */
  value: number;
  /** 0-25: how well it fits the firm. */
  fit: number;
  notes: string[];
};

export type PracticeModule = {
  area: PracticeArea;
  label: string;
  /** For classifying a free-text enquiry into this area. */
  scope: string;
  questions: IntakeQuestion[];
  score: (answers: Answers, now: Date) => ScoreParts;
  /** Practice-specific guidance appended to the A3 system prompt. */
  promptFragment: string;
};

/**
 * Calendar days from today to a date written in an answer (negative when it
 * is past), or null if no date can be read. Date-only, as deadlines are (rule 10).
 */
export function daysUntil(value: string | undefined, now: Date): number | null {
  if (!value) return null;
  const iso = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const us = value.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  let d: Date | null = null;
  if (iso) d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  else if (us) {
    const y = Number(us[3]) < 100 ? 2000 + Number(us[3]) : Number(us[3]);
    d = new Date(Date.UTC(y, Number(us[1]) - 1, Number(us[2])));
  } else {
    const t = Date.parse(value);
    if (!Number.isNaN(t)) d = new Date(t);
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((day - today) / 86_400_000);
}

/** Dollar figure written in an answer ("$12,500", "about 40k"), or null. */
export function dollars(value: string | undefined): number | null {
  if (!value) return null;
  const m = value.replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)\s*(k|thousand|m|million)?/i);
  if (!m) return null;
  let n = Number(m[1]);
  const unit = m[2]?.toLowerCase();
  if (unit === "k" || unit === "thousand") n *= 1_000;
  if (unit === "m" || unit === "million") n *= 1_000_000;
  return n;
}

export const yes = (v: string | undefined) =>
  /^\s*(y|yes|true|yeah|yep|there is|there are)\b/i.test(v ?? "");
