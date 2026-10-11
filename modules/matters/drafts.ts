import { z } from "zod";
import type { PracticeArea } from "@/db/schema";

/*
 * Fixed drafts and model prompts for B6, B8 and B10. Every one waits in the
 * approval queue. Fixed text where the content is the firm's own statement
 * (closing letter) or a structure (skeletons); the model only fills facts
 * from masked records. VERIFY all wording with the firm's attorney.
 */

export const B6_PROMPT_VERSION = "b6-2026-10-11";
export const B8_PROMPT_VERSION = "b8-2026-10-11";

export const b6Output = z.object({ body: z.string().min(20).max(1_200) });
export const B6_SYSTEM = [
  "You draft a short, plain-language status update from a law firm to its client, for an attorney to review before it is sent.",
  "Say what stage the matter is at, what the firm is doing next, and anything the client needs to provide. Two short paragraphs at most.",
  "Never give legal advice, assess the merits, predict an outcome or timing, or quote fees. Do not include identifiers.",
].join("\n");

export const DRAFT_KINDS = {
  irs_response: { label: "IRS response letter skeleton", area: "tax" },
  form_2848_info: { label: "Information for Form 2848", area: "tax" },
  ep_design_summary: { label: "Estate planning design summary", area: "estate" },
  entity_data_sheet: { label: "Entity formation data sheet", area: "business" },
} as const satisfies Record<string, { label: string; area: PracticeArea }>;
export type DraftKind = keyof typeof DRAFT_KINDS;

export const b8Output = z.object({ body: z.string().min(50).max(12_000) });
export const B8_SYSTEM = [
  "You prepare a first draft for an attorney at a law firm, from the matter records given (identifiers are masked; keep them masked).",
  "Use only facts in the records. Where a fact is missing, write [TO CONFIRM: what is needed] instead of guessing.",
  "This is a draft for the attorney, labeled DRAFT. Do not state legal conclusions as settled; mark points for the attorney's judgment as [ATTORNEY TO DECIDE].",
].join("\n");

export const DRAFT_LABEL =
  "DRAFT. Prepared with software assistance for attorney review. Not legal advice and not sent to the client.";

/** Structure-only skeletons, used when no model is configured and as the model's outline. */
export function skeleton(kind: DraftKind, facts: Record<string, string>): string {
  const f = (k: string, what: string) => facts[k] ?? `[TO CONFIRM: ${what}]`;
  switch (kind) {
    case "irs_response":
      return [
        DRAFT_LABEL,
        "",
        "[Firm letterhead]",
        "",
        `Re: ${f("noticeType", "notice number")}, tax year(s) ${f("taxYears", "tax years")}`,
        `Taxpayer: ${f("clientName", "taxpayer name")}  Taxpayer ID: [last 4 only]`,
        "",
        "To whom it may concern:",
        "",
        `This firm represents the taxpayer under the enclosed Form 2848. We respond to the notice dated ${f("noticeDate", "notice date")}.`,
        "",
        "1. Summary of the notice: [ATTORNEY TO DECIDE: what the notice proposes]",
        "2. The taxpayer's position: [ATTORNEY TO DECIDE]",
        "3. Supporting documents enclosed: [list]",
        "4. Requested action: [ATTORNEY TO DECIDE]",
        "",
        "Please direct all correspondence to the undersigned.",
        "",
        "Sincerely,",
        "[Attorney name], [Firm]",
      ].join("\n");
    case "form_2848_info":
      return [
        DRAFT_LABEL,
        "",
        "Information for Form 2848 (Power of Attorney and Declaration of Representative). Complete the form itself in the IRS template.",
        "",
        `Taxpayer name: ${f("clientName", "taxpayer name")}`,
        "Taxpayer identification number: [enter from the client's records; not stored here]",
        `Representative: ${f("attorneyName", "representative")}`,
        `Tax matters: ${f("taxMatter", "type of tax, e.g. Income")}; form ${f("taxForm", "form number, e.g. 1040")}; years ${f("taxYears", "years or periods")}`,
        "Specific acts authorized or limited: [ATTORNEY TO DECIDE]",
      ].join("\n");
    case "ep_design_summary":
      return [
        DRAFT_LABEL,
        "",
        `Estate planning design summary for ${f("clientName", "client name")}`,
        "",
        `Family: ${f("family", "family details from the questionnaire")}`,
        `Assets: ${f("assets", "asset summary from the questionnaire")}`,
        `Fiduciaries: ${f("fiduciaries", "executor, trustee and agents")}`,
        `Goals: ${f("goals", "client goals")}`,
        "",
        "Recommended documents: [ATTORNEY TO DECIDE]",
        "Open questions for the design meeting: [ATTORNEY TO DECIDE]",
      ].join("\n");
    case "entity_data_sheet":
      return [
        DRAFT_LABEL,
        "",
        `Entity formation data sheet: ${f("clientName", "client name")}`,
        "",
        `Proposed name: ${f("entityName", "proposed entity name")}`,
        `Entity type and state: ${f("entity", "entity type and state")}`,
        `Owners and percentages: ${f("owners", "owners and ownership split")}`,
        "Registered agent: [TO CONFIRM]",
        "Management: [ATTORNEY TO DECIDE: member- or manager-managed]",
        "Principal office address: [TO CONFIRM]",
        "EIN application: [TO CONFIRM responsible party]",
      ].join("\n");
  }
}

/** B6 fallback when no model is configured. */
export function plainStatusUpdate(v: {
  firstName: string | null;
  firmName: string;
  stage: string;
  outstanding: string[];
}): string {
  return [
    `Hi ${v.firstName?.trim() || "there"},`,
    "",
    `A quick update on your matter with ${v.firmName}: it is now at the ${v.stage.toLowerCase()} stage.`,
    v.outstanding.length
      ? `To keep it moving, we still need: ${v.outstanding.join("; ")}. You can upload these in the client portal.`
      : "We do not need anything from you right now.",
    "",
    "If you have questions, reply to this message.",
    "",
    v.firmName,
  ].join("\n");
}

/** B10 closing letter: the firm's statement that the representation has ended. Fixed draft. */
export function closingLetter(v: {
  firmName: string;
  firstName: string | null;
  matterTitle: string;
  returnList: string[];
  retentionUntil: string;
}): { subject: string; body: string } {
  return {
    subject: `Closing your matter with ${v.firmName}`,
    body: [
      `Dear ${v.firstName?.trim() || "Sir or Madam"},`,
      "",
      `The work on your matter (${v.matterTitle}) is complete, and we are closing our file. Unless you engage the firm again in writing, the firm's representation of you in this matter has ended.`,
      "",
      v.returnList.length
        ? `We will return the following documents you provided:\n${v.returnList.map((d) => `- ${d}`).join("\n")}`
        : "We do not hold original documents of yours.",
      "",
      `The firm will keep its file until ${v.retentionUntil}, after which it may be destroyed. If you would like a copy before then, please let us know.`,
      "",
      "Thank you for the opportunity to work with you.",
      "",
      "Sincerely,",
      v.firmName,
    ].join("\n"),
  };
}
