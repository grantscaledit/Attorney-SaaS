/**
 * Deterministic guardrails for conversational AI (spec Section 6 and rule 5).
 * They run before and after every model call and do not depend on the model
 * behaving: a model mistake can make a reply less useful, never let advice
 * out.
 *
 * - escalationReasons(): inbound triggers that hand the conversation to a
 *   person at once.
 * - seeksAdvice(): inbound questions only a lawyer may answer; the assistant
 *   does not attempt them.
 * - checkDraft(): blocks a draft reply that gives advice, predicts an outcome,
 *   quotes a fee outside the firm's published table or says the firm
 *   represents the person.
 *
 * The lists are intentionally broad; a false positive costs a person a few
 * seconds in the approval queue, a false negative is an ethics problem.
 */

export type EscalationReason =
  | "deadline_within_10_days"
  | "levy"
  | "garnishment"
  | "seizure"
  | "criminal_investigation"
  | "recent_death"
  | "asked_for_human";

export const ESCALATION_LABELS: Record<EscalationReason, string> = {
  deadline_within_10_days: "Deadline within 10 days",
  levy: "Levy",
  garnishment: "Garnishment",
  seizure: "Seizure",
  criminal_investigation: "Criminal investigation",
  recent_death: "Death in the last 30 days",
  asked_for_human: "Asked for a person",
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  couple: 2,
  few: 3,
};

function num(word: string): number | null {
  const n = Number(word);
  if (Number.isFinite(n)) return n;
  return NUMBER_WORDS[word] ?? null;
}

/** Dates written in a message, resolved to the nearest sensible year. */
function datesIn(text: string, now: Date): Date[] {
  const out: Date[] = [];
  const year = now.getUTCFullYear();
  for (const m of text.matchAll(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/g)) {
    const mo = Number(m[1]) - 1;
    const d = Number(m[2]);
    let y = m[3] ? Number(m[3]) : year;
    if (y < 100) y += 2000;
    if (mo >= 0 && mo < 12 && d >= 1 && d <= 31) out.push(new Date(Date.UTC(y, mo, d)));
  }
  const monthRe = new RegExp(
    String.raw`\b(${MONTHS.join("|")})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?`,
    "g",
  );
  for (const m of text.matchAll(monthRe)) {
    const mo = MONTHS.indexOf(m[1]!.slice(0, 3));
    const y = m[3] ? Number(m[3]) : year;
    out.push(new Date(Date.UTC(y, mo, Number(m[2]))));
  }
  return out;
}

const DAY = 86_400_000;

/** Words that make a nearby time or date a deadline rather than availability. */
const DEADLINE_CUE = String.raw`(?:deadline|due|respond|response|reply|answer|file|filed|by|before|no later than|until|expires?|expiring|hearing|court|trial|sale|auction|cutoff|last day)`;

function deadlineSoon(text: string, now: Date): boolean {
  const near = (what: string) =>
    new RegExp(String.raw`\b${DEADLINE_CUE}\b[^.?!]{0,30}\b${what}`).test(text);
  if (
    near(
      String.raw`(today|tonight|tomorrow|this week|next week|end of (the )?week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b`,
    )
  ) {
    return true;
  }
  for (const m of text.matchAll(
    new RegExp(
      String.raw`\b${DEADLINE_CUE}\b[^.?!]{0,30}\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple|few)\s+(day|days|business days)\b`,
      "g",
    ),
  )) {
    const n = num(m[1]!);
    if (n !== null && n <= 10) return true;
  }
  const left = text.match(
    /\b(\d+|a|one|two|three|four|five|six|seven|eight|nine|ten|couple|few) days? (left|to respond|to reply|to file|until)\b/,
  );
  if (left) {
    const n = num(left[1]!);
    if (n !== null && n <= 10) return true;
  }
  if (!new RegExp(String.raw`\b${DEADLINE_CUE}\b`).test(text)) return false;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return datesIn(text, now).some(
    (d) => d.getTime() >= today - DAY && d.getTime() <= today + 10 * DAY,
  );
}

function recentDeath(text: string, now: Date): boolean {
  const death =
    /\b(died|passed away|passed on|death of|deceased|funeral|killed|lost my (mother|father|mom|dad|husband|wife|spouse|son|daughter|brother|sister|parent|grandmother|grandfather|partner))\b/;
  if (!death.test(text)) return false;
  if (/\b(yesterday|today|last night|this week|last week|this month|recently|just)\b/.test(text))
    return true;
  for (const m of text.matchAll(
    /\b(\d+|a|an|one|two|three|four|five|six|couple|few)\s+(day|days|week|weeks)\s+ago\b/g,
  )) {
    const n = num(m[1]!);
    if (n === null) continue;
    const days = m[2]!.startsWith("week") ? n * 7 : n;
    if (days <= 30) return true;
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return datesIn(text, now).some(
    (d) => d.getTime() <= today + DAY && d.getTime() >= today - 30 * DAY,
  );
}

export function escalationReasons(message: string, now: Date = new Date()): EscalationReason[] {
  const t = message.toLowerCase().replace(/\s+/g, " ");
  const reasons = new Set<EscalationReason>();
  if (/\blev(y|ies|ied|ying)\b/.test(t)) reasons.add("levy");
  if (/\bgarnish(ed|ing|ment|ments)?\b|\bwage (withholding|garn)/.test(t))
    reasons.add("garnishment");
  if (
    /\b(seiz(e|ed|ing|ure)|confiscat|repossess|took my (car|house|truck)|froze|frozen)\b/.test(t)
  ) {
    reasons.add("seizure");
  }
  if (
    /\b(criminal|special agent|irs[- ]?ci\b|investigat(ion|or|ing)|indict|arrest|grand jury|subpoena|prosecut|fbi|search warrant)/.test(
      t,
    )
  ) {
    reasons.add("criminal_investigation");
  }
  if (recentDeath(t, now)) reasons.add("recent_death");
  if (deadlineSoon(t, now)) reasons.add("deadline_within_10_days");
  if (
    /\b(speak|talk|chat)\s+(to|with)\s+(a |an |the |your )?(real |actual |live )?(person|human|attorney|lawyer|someone|somebody|agent|people)\b|\b(real|live|actual) person\b|\bnot a (bot|robot|machine)\b|\bare you (a )?(bot|robot|real|human)\b|\bcall me\b|\bhave (an attorney|a lawyer|someone) call\b/.test(
      t,
    )
  ) {
    reasons.add("asked_for_human");
  }
  return [...reasons];
}

/** A question only a lawyer may answer (the assistant hands it to a person). */
export function seeksAdvice(message: string): boolean {
  const t = message.toLowerCase().replace(/\s+/g, " ");
  return (
    /\b(should|shall|must|do|does|can|could|would|will|am|is|are|have)\s+(i|we|my|they|the irs|the state|my (wife|husband|spouse|business|company|llc|kids?|family))\b[^?.!]*\b(pay|file|sign|sue|settle|owe|go to jail|lose|keep|qualify|need|have to|be able|win|be liable|liable|responsible|appeal|ignore|respond|agree|accept|do|get|claim|deduct|dissolve|form|transfer|inherit|contest|challenge|be penalized|be charged|take|seize|foreclose|garnish|levy|come after)\b/.test(
      t,
    ) ||
    /\bwhat (are|is) (my|our) (chances|odds|options|best option|rights|liability)\b/.test(t) ||
    /\bis (it|that|this|my|the|our|their)\b[^?.!]{0,30}\b(legal|illegal|allowed|a crime|enforceable|valid|binding)\b/.test(
      t,
    ) ||
    /\b(would|do|can|could) you (recommend|suggest|advise)\b/.test(t) ||
    // "tell me if I should file", "wondering whether we need to pay"
    /\b(if|whether) (i|we|my \w+) (should|need to|have to|must|ought to|can legally)\b/.test(t) ||
    /\b(how much|how long) (will|would|could|do) (i|we)\b/.test(t) ||
    /\bwhat (should|would you|do you suggest|do you recommend)\b/.test(t) ||
    /\b(your|legal) (advice|opinion|recommendation)\b/.test(t) ||
    /\b(advise|recommend)\s+(me|us)\b/.test(t)
  );
}

export type DraftFinding =
  "advice" | "outcome_prediction" | "fee_quote" | "representation" | "identifier";

export const DRAFT_FINDING_LABELS: Record<DraftFinding, string> = {
  advice: "Gives legal advice",
  outcome_prediction: "Predicts an outcome",
  fee_quote: "Mentions an amount not in the firm's published fee table",
  representation: "Says the firm represents the person",
  identifier: "Contains a full identifier",
};

export type FeeEntry = { service: string; fee: string };

function dollarAmounts(text: string): string[] {
  return [
    ...text.matchAll(/\$\s?\d[\d,]*(?:\.\d{2})?|\b\d[\d,]*(?:\.\d{2})?\s?(?:dollars|usd)\b/gi),
  ].map((m) => m[0].replace(/[^\d.]/g, "").replace(/\.00$/, ""));
}

/**
 * Checks a draft reply to a prospect. Returns the reasons it must not go out
 * as written; an empty list means the deterministic rules found nothing.
 */
export function checkDraft(draft: string, feeTable: readonly FeeEntry[] = []): DraftFinding[] {
  const t = draft.toLowerCase().replace(/\s+/g, " ");
  const findings = new Set<DraftFinding>();

  if (
    /\byou (should|shouldn't|should not|must|need to|have to|don't have to|do not have to|ought to|are required to|aren't required to)\s+(not\s+)?(pay|file|sign|sue|settle|respond|ignore|accept|agree|appeal|claim|deduct|dissolve|form|transfer|contest|wait|hire|stop|send|amend|request|submit)\b/.test(
      t,
    ) ||
    /\b(i|we) (recommend|advise|suggest) (that )?(you|filing|paying|signing|settling|forming|setting up|creating)\b/.test(
      t,
    ) ||
    /\b(my|our) (advice|recommendation|legal opinion)\b/.test(t) ||
    /\byou (qualify|are eligible|are entitled|have a (good|strong|valid) (case|claim|defense))\b/.test(
      t,
    ) ||
    /\b(that|this|it) (is|isn't|is not) (legal|illegal|enforceable|a crime|valid)\b/.test(t) ||
    /\byour best option\b/.test(t)
  ) {
    findings.add("advice");
  }
  if (
    /\byou (will|won't|will not|would|wouldn't|are (likely|unlikely) to|are going to|stand to) (?:(?:definitely|certainly|surely|probably|likely|almost certainly|most likely|easily) )?(win|lose|owe|go to jail|be (charged|penalized|liable|fine|approved|denied|forgiven|prosecuted|audited))\b/.test(
      t,
    ) ||
    /\b(good|high|low|strong|excellent) (chance|chances|odds|likelihood)\b/.test(t) ||
    /\b(likely|probably|almost certainly|guarantee[ds]?) (that )?(you|the irs|the court|the judge|it will|they will)\b/.test(
      t,
    ) ||
    /\bwe (will|can) (win|get (this|it|the penalties) (dismissed|removed|reduced|forgiven))\b/.test(
      t,
    ) ||
    /\bguarantee(d|s)?\b/.test(t)
  ) {
    findings.add("outcome_prediction");
  }
  if (
    /\b(we|the firm|this firm|our firm|the attorney|i) (represent|am representing|are representing|will represent|now represents?) you\b/.test(
      t,
    ) ||
    /\byou are (now )?(our|a|the firm's) client\b/.test(t) ||
    /\battorney[- ]client relationship (is|has been|now) (formed|established|in place|created)\b/.test(
      t,
    ) ||
    /\bwe('ll| will) (take|handle) your (case|matter)\b/.test(t)
  ) {
    findings.add("representation");
  }
  const published = new Set(feeTable.flatMap((f) => dollarAmounts(f.fee)));
  if (dollarAmounts(draft).some((amount) => !published.has(amount))) findings.add("fee_quote");
  if (/\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b|\b\d{2}-\d{7}\b/.test(draft)) findings.add("identifier");
  return [...findings];
}
