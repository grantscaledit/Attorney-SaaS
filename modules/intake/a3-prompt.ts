import { z } from "zod";
import type { PracticeArea } from "@/db/schema";
import type { FeeEntry } from "@/lib/ai/guard";
import { applicableQuestions, PRACTICE_MODULES, type Answers } from "@/practice";

/*
 * A3 AI intake assistant prompts (spec Sections 6 and 8). Pure functions so
 * the evals exercise exactly what production sends. Bump the version when the
 * wording changes; ai_runs records it.
 */

export const A3_PROMPT_VERSION = "a3-2026-10-11";
export const A3_CLASSIFIER_VERSION = "a3-classifier-2026-10-11";

export const a3Output = z.object({
  reply: z.string().min(1).max(600),
  replyType: z.enum(["question", "offer_times", "acknowledge", "handoff"]),
  practiceArea: z.enum(["tax", "business", "estate", "other"]).nullable(),
  outOfScopeTopic: z.string().max(120).nullable(),
  answers: z
    .array(z.object({ questionId: z.string().max(40), value: z.string().max(300) }))
    .max(20),
  wantsConsult: z.boolean(),
});
export type A3Output = z.output<typeof a3Output>;

export const a3Classification = z.object({
  givesAdvice: z.boolean(),
  predictsOutcome: z.boolean(),
  quotesFee: z.boolean(),
  claimsRepresentation: z.boolean(),
  describesTheirLegalSituation: z.boolean(),
});
export type A3Classification = z.output<typeof a3Classification>;

/** Reply types that may send without a person when the firm allows it and every check passes. */
export const AUTO_SENDABLE: ReadonlySet<A3Output["replyType"]> = new Set([
  "question",
  "offer_times",
  "acknowledge",
]);

export type A3Context = {
  firmName: string;
  firmAreas: readonly PracticeArea[];
  disclosure: string;
  feeTable: readonly FeeEntry[];
  practiceArea: PracticeArea | null;
  answers: Answers;
  slots: string[];
  bookingUrl: string | null;
  channel: "sms" | "chat";
};

export function buildA3System(c: A3Context): string {
  const areas = c.firmAreas.map((a) => PRACTICE_MODULES[a]);
  const practice = c.practiceArea ? PRACTICE_MODULES[c.practiceArea] : null;
  const questions = practice ? applicableQuestions(practice, c.answers) : [];
  const unanswered = questions.filter((q) => !c.answers[q.id]?.trim());
  return [
    `You are the intake assistant for ${c.firmName}, a law firm. You collect information and help people book a consultation with an attorney. You are not a lawyer.`,
    "",
    "Rules you must always follow:",
    "- Never give legal advice, tell the person what they should or should not do, or say what the law allows.",
    "- Never predict an outcome, chances, amounts owed, or how long anything will take.",
    "- Never quote a fee unless it appears word for word in the fee table below.",
    "- Never say or imply that the firm represents the person or that an attorney-client relationship exists.",
    "- If asked for advice or an opinion, say an attorney can address that at a consultation, and offer to book one.",
    "- Never ask for Social Security numbers, EINs, bank or card numbers, or dates of birth. Never repeat any that the person sends.",
    `- Keep replies short${c.channel === "sms" ? " (one or two sentences; this is a text message)" : ""}, plain and polite. Ask one question at a time.`,
    "",
    `Practice areas the firm handles:`,
    ...areas.map((m) => `- ${m.area}: ${m.label}. ${m.scope}`),
    'If the enquiry is outside these areas, set practiceArea to "other", put a short description in outOfScopeTopic, thank them and say someone from the firm will follow up. Do not suggest other lawyers yourself.',
    "",
    practice
      ? [
          `This enquiry is ${practice.label}. Information still needed (ask in this order, skip anything already given):`,
          ...unanswered.map((q) => `- ${q.id}: ${q.intent}${q.required ? "" : " (optional)"}`),
          unanswered.length === 0 ? "- Nothing; offer to book a consultation." : "",
          "",
          practice.promptFragment,
        ].join("\n")
      : "First work out which practice area this is, then ask the first question for that area.",
    "",
    "Record every fact the person has given in `answers`, using the question ids above and their own words, briefly.",
    c.slots.length > 0
      ? `Consultation times you may offer (offer two or three; do not invent others): ${c.slots.join("; ")}.`
      : "No consultation times are available to offer right now.",
    c.bookingUrl ? `The person can also book directly at ${c.bookingUrl}.` : "",
    "",
    "Published fee table:",
    ...(c.feeTable.length
      ? c.feeTable.map((f) => `- ${f.service}: ${f.fee}`)
      : ["- (none; never mention fees)"]),
    "",
    `The firm's disclosure, already shown to the person: "${c.disclosure}"`,
    "",
    "Set replyType: question when you ask for information, offer_times when you offer consultation times, acknowledge for a short closing reply, handoff when a person at the firm must take over.",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

export const A3_CLASSIFIER_SYSTEM = [
  "You review one reply that a law firm's intake assistant drafted for a prospective client.",
  "Answer each question about the reply only (not the conversation) strictly; when unsure, answer true.",
  "- givesAdvice: does it tell the person what they should or should not do about a legal or tax matter, or what the law allows?",
  "- predictsOutcome: does it predict a result, chances, an amount owed or saved, or timing of a legal outcome?",
  "- quotesFee: does it state any price or fee?",
  "- claimsRepresentation: does it say or imply the firm represents them or an attorney-client relationship exists?",
  "- describesTheirLegalSituation: does it characterize or summarize their legal situation, rather than only ask questions, offer times or acknowledge?",
].join("\n");
