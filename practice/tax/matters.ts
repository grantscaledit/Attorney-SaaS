import type { MatterTypeDef } from "../matter-types";

const notice = {
  key: "notice",
  label: "The notice or letter",
  docType: "irs_notice",
  required: true,
  hint: "Every page of the notice, front and back.",
} as const;

export const TAX_MATTER_TYPES: MatterTypeDef[] = [
  {
    key: "notice_response",
    label: "Notice response",
    stages: [
      { key: "documents", label: "Gathering documents", thresholdDays: 10, waitingOnClient: true },
      { key: "analysis", label: "Analysis", thresholdDays: 7 },
      { key: "response", label: "Drafting response", thresholdDays: 5 },
      { key: "awaiting_agency", label: "Awaiting the agency", thresholdDays: 60 },
    ],
    checklist: [
      notice,
      {
        key: "returns",
        label: "Returns for the years on the notice",
        docType: "tax_return",
        required: true,
      },
      {
        key: "support",
        label: "Records that support your position",
        docType: "other",
        required: false,
      },
    ],
    retentionYears: 7,
  },
  {
    key: "collections",
    label: "Collections and payment plan",
    stages: [
      { key: "documents", label: "Gathering financials", thresholdDays: 14, waitingOnClient: true },
      { key: "analysis", label: "Financial analysis", thresholdDays: 10 },
      { key: "negotiation", label: "Negotiating with the agency", thresholdDays: 45 },
      { key: "compliance", label: "Monitoring compliance", thresholdDays: 90 },
    ],
    checklist: [
      notice,
      {
        key: "bank",
        label: "Bank statements, last 3 months",
        docType: "bank_statement",
        required: true,
      },
      {
        key: "income",
        label: "Pay stubs or income records, last 3 months",
        docType: "pay_stub",
        required: true,
      },
      { key: "returns", label: "Most recent filed return", docType: "tax_return", required: true },
    ],
    retentionYears: 7,
  },
  {
    key: "unfiled_returns",
    label: "Unfiled returns",
    stages: [
      { key: "documents", label: "Gathering records", thresholdDays: 21, waitingOnClient: true },
      { key: "preparation", label: "Preparing returns", thresholdDays: 21 },
      { key: "filing", label: "Filing", thresholdDays: 10 },
    ],
    checklist: [
      {
        key: "transcripts",
        label: "IRS wage and income transcripts",
        docType: "tax_transcript",
        required: false,
      },
      {
        key: "income",
        label: "Income records (W-2, 1099) for each year",
        docType: "other",
        required: true,
      },
      { key: "notices", label: "Any notices received", docType: "irs_notice", required: false },
    ],
    retentionYears: 7,
  },
];
