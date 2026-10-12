/*
 * B9 estate planning questionnaire (spec Section 7: family, assets,
 * fiduciaries, goals), answered by the client in the portal. Ages, never
 * dates of birth (rule 6). Product default wording; VERIFY with the firm's
 * attorney before use.
 */

export type QuestionDef = { id: string; label: string; help?: string; long?: boolean };
export type SectionDef = { key: string; title: string; questions: QuestionDef[] };

export const ESTATE_QUESTIONNAIRE: SectionDef[] = [
  {
    key: "family",
    title: "Family",
    questions: [
      { id: "marital_status", label: "Marital status" },
      { id: "spouse_name", label: "Spouse's full name, if married" },
      {
        id: "children",
        label: "Children: names and ages",
        help: "Ages only. Please do not enter dates of birth.",
        long: true,
      },
      { id: "prior_marriage_children", label: "Any children from a prior relationship?" },
      { id: "guardian_preference", label: "Who would you want as guardian of minor children?" },
    ],
  },
  {
    key: "assets",
    title: "Assets",
    questions: [
      {
        id: "real_estate",
        label: "Real estate you own, and the state each property is in",
        long: true,
      },
      {
        id: "asset_band",
        label: "Approximate total value of everything you own (a range is fine)",
      },
      { id: "business_interests", label: "Businesses you own all or part of" },
      {
        id: "retirement_accounts",
        label: "Retirement accounts (401(k), IRA) and who the beneficiaries are",
        help: "Account types only. Please do not enter account numbers.",
        long: true,
      },
      { id: "life_insurance", label: "Life insurance policies and approximate amounts" },
    ],
  },
  {
    key: "fiduciaries",
    title: "People you trust",
    questions: [
      { id: "executor", label: "First and second choice to manage your estate (executor)" },
      { id: "trustee", label: "Who should manage any trust for your beneficiaries?" },
      {
        id: "financial_agent",
        label: "Who should handle your finances if you cannot (financial power of attorney)?",
      },
      {
        id: "medical_agent",
        label: "Who should make medical decisions if you cannot (medical power of attorney)?",
      },
    ],
  },
  {
    key: "goals",
    title: "Goals",
    questions: [
      { id: "distribution", label: "How would you like your property to pass?", long: true },
      { id: "charitable", label: "Any gifts to charities or friends?" },
      {
        id: "concerns",
        label: "Anything you are concerned about, or want the attorney to know",
        long: true,
      },
    ],
  },
];

export const QUESTION_IDS = new Set(
  ESTATE_QUESTIONNAIRE.flatMap((s) => s.questions.map((q) => q.id)),
);
