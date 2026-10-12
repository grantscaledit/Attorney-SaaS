import type { PracticeArea } from "@/db/schema";
import type { EscalationReason } from "@/lib/ai/guard";
import { PRACTICE_MODULES, type Answers } from "@/practice";

/**
 * A5 lead score, 0-100 (spec Section 7: "urgency, matter value band, fit").
 * Deterministic: the practice module scores its own answers; escalations
 * force urgency; a practice area the firm does not offer has no fit.
 */

export const URGENT_SCORE = 75;

export type LeadScore = {
  score: number;
  urgent: boolean;
  parts: { urgency: number; value: number; fit: number };
  notes: string[];
};

export function scoreLead(input: {
  practiceArea: PracticeArea | null;
  answers: Answers;
  escalations: readonly EscalationReason[];
  firmAreas: readonly PracticeArea[];
  now: Date;
}): LeadScore {
  const practice = input.practiceArea ? PRACTICE_MODULES[input.practiceArea] : null;
  const base = practice
    ? practice.score(input.answers, input.now)
    : { urgency: 10, value: 10, fit: 5, notes: ["Practice area not yet known"] };
  let { urgency } = base;
  const notes = [...base.notes];
  const hard = input.escalations.filter((e) => e !== "asked_for_human");
  if (hard.length > 0) {
    urgency = 40;
    notes.unshift(`Escalation: ${hard.join(", ").replace(/_/g, " ")}`);
  }
  const offered = input.practiceArea !== null && input.firmAreas.includes(input.practiceArea);
  const fit = offered ? base.fit : 0;
  if (input.practiceArea && !offered) notes.push("Practice area not offered by the firm");
  const score = Math.max(0, Math.min(100, Math.round(urgency + base.value + fit)));
  return {
    score,
    urgent: hard.length > 0 || (offered && score >= URGENT_SCORE),
    parts: { urgency, value: base.value, fit },
    notes,
  };
}
