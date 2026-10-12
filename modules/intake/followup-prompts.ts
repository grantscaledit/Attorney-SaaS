import { z } from "zod";

/*
 * Prompts and fixed drafts for the intake follow-ups (A8, A11, A12). Pure, so
 * tests and evals exercise what production produces.
 */

export const A8_PROMPT_VERSION = "a8-2026-10-11";

/** The model's part of a pre-consult brief. Everything else in the brief is copied from records. */
export const a8Output = z.object({
  summary: z.string().min(1).max(800),
  suggestedQuestions: z.array(z.string().min(3).max(240)).max(8),
});
export type A8Output = z.output<typeof a8Output>;

export const A8_SYSTEM = [
  "You prepare a short pre-consultation brief for an attorney at a law firm.",
  "Use only the facts given. Do not add facts, assume amounts or dates, or draw legal conclusions.",
  "summary: two to four plain sentences on who the person is and what they say their issue is.",
  "suggestedQuestions: up to eight questions the attorney may want to ask to fill gaps or check facts. Questions only, no advice.",
].join("\n");

export type LetterReason = "declined" | "no_response";

/**
 * A11 non-engagement letter. A fixed draft rather than a model's: what the
 * letter says about representation is the firm's professional statement, and
 * the attorney edits it in the approval queue before it sends. VERIFY the
 * wording with the firm's attorney before enabling A11.
 */
export function nonEngagementLetter(v: {
  firmName: string;
  firstName: string | null;
  consultDate: string | null;
  reason: LetterReason;
}): { subject: string; body: string } {
  const met = v.consultDate
    ? `Thank you for consulting with ${v.firmName} on ${v.consultDate}.`
    : `Thank you for contacting ${v.firmName}.`;
  const why =
    v.reason === "declined"
      ? "After reviewing your enquiry, we have decided not to take on this matter."
      : "We have not heard from you since our consultation, so we are closing our file.";
  return {
    subject: `Your enquiry with ${v.firmName}`,
    body: [
      `Dear ${v.firstName?.trim() || "Sir or Madam"},`,
      "",
      `${met} This letter confirms that ${v.firmName} has not been engaged to represent you and does not represent you in this matter. ${why}`,
      "",
      "Our decision is not an opinion on the merits of your matter. Legal matters can be subject to deadlines that may affect your rights. If you wish to pursue this matter, you should consult another attorney promptly.",
      "",
      "If we hold any documents of yours, we will return them on request.",
      "",
      "Sincerely,",
      v.firmName,
    ].join("\n"),
  };
}

/** A12 referral message to the prospect: who to contact instead. Fixed text; reviewed before sending. */
export function referralMessage(v: {
  firmName: string;
  firstName: string | null;
  partner: {
    name: string;
    organization: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
  };
  channel: "sms" | "chat" | "email";
}): { subject: string | null; body: string } {
  const who = [v.partner.name, v.partner.organization].filter(Boolean).join(", ");
  const reach = [v.partner.phone, v.partner.email, v.partner.website].filter(Boolean).join(", ");
  const line = `Thank you for contacting ${v.firmName}. Your enquiry is outside the areas our firm handles, so we are not able to help with it. You may wish to contact ${who}${reach ? ` (${reach})` : ""}. ${v.firmName} does not represent you in this matter.`;
  if (v.channel !== "email") return { subject: null, body: line };
  return {
    subject: `Your enquiry with ${v.firmName}`,
    body: [`Hi ${v.firstName?.trim() || "there"},`, "", line, "", v.firmName].join("\n"),
  };
}

/** Best referral partner for an out-of-scope topic: most shared words with what they handle. */
export function pickPartner<P extends { handles: string[] }>(
  topic: string | null,
  partners: readonly P[],
): P | null {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter(
          (w) =>
            w.length > 3 &&
            !["with", "about", "matter", "issue", "help", "need", "from", "that", "this"].includes(
              w,
            ),
        ),
    );
  const t = words(topic ?? "");
  let best: P | null = null;
  let bestScore = 0;
  for (const p of partners) {
    const h = words(p.handles.join(" "));
    let score = 0;
    for (const w of t)
      if (h.has(w) || [...h].some((x) => x.startsWith(w.slice(0, 5)) && w.length >= 5)) score++;
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}
