/*
 * Matter types, stages and document checklists (spec Sections 7 and 8).
 * Product defaults per practice area, not firm data: a firm can rename or
 * retime them later from settings. Thresholds feed B5 (stalled matters);
 * "waitingOnClient" stages feed the Pipeline panel.
 */

export const DOC_TYPES = [
  "irs_notice",
  "state_tax_notice",
  "tax_return",
  "tax_transcript",
  "bank_statement",
  "pay_stub",
  "financial_statement",
  "id_document",
  "will",
  "trust",
  "power_of_attorney",
  "deed",
  "death_certificate",
  "articles",
  "operating_agreement",
  "contract",
  "engagement_letter",
  "correspondence",
  "other",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  irs_notice: "IRS notice",
  state_tax_notice: "State tax notice",
  tax_return: "Tax return",
  tax_transcript: "IRS transcript",
  bank_statement: "Bank statement",
  pay_stub: "Pay stub",
  financial_statement: "Financial statement",
  id_document: "Identification",
  will: "Will",
  trust: "Trust",
  power_of_attorney: "Power of attorney",
  deed: "Deed",
  death_certificate: "Death certificate",
  articles: "Certificate of formation",
  operating_agreement: "Operating or partnership agreement",
  contract: "Contract",
  engagement_letter: "Engagement letter",
  correspondence: "Correspondence",
  other: "Other",
};

export type StageDef = {
  key: string;
  label: string;
  /** Days in this stage before B5 flags the matter as stalled. Null: never. */
  thresholdDays: number | null;
  /** The firm is waiting on the client in this stage (Pipeline panel). */
  waitingOnClient?: boolean;
};

export type ChecklistDef = {
  key: string;
  label: string;
  docType: DocType;
  required: boolean;
  /** Shown to the client in the portal. */
  hint?: string;
};

export type MatterTypeDef = {
  key: string;
  label: string;
  stages: StageDef[];
  checklist: ChecklistDef[];
  /** Years to keep the file after closing (B10 sets the retention date). VERIFY with the firm. */
  retentionYears: number;
  /** B9 runs for this type. */
  questionnaire?: "estate_planning";
};

/** Every matter type starts here and ends in "closed". */
export const OPENING_STAGE: StageDef = { key: "opening", label: "Opening", thresholdDays: 7 };
export const CLOSED_STAGE: StageDef = { key: "closed", label: "Closed", thresholdDays: null };

export function stagesOf(t: MatterTypeDef): StageDef[] {
  return [OPENING_STAGE, ...t.stages, CLOSED_STAGE];
}
