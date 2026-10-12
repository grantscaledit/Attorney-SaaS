import type { MatterTypeDef } from "../matter-types";

export const ESTATE_MATTER_TYPES: MatterTypeDef[] = [
  {
    key: "estate_plan",
    label: "Estate plan",
    stages: [
      { key: "questionnaire", label: "Questionnaire", thresholdDays: 14, waitingOnClient: true },
      { key: "design", label: "Design meeting", thresholdDays: 14 },
      { key: "drafting", label: "Drafting", thresholdDays: 14 },
      { key: "review", label: "Client review", thresholdDays: 14, waitingOnClient: true },
      { key: "signing", label: "Signing", thresholdDays: 14 },
      { key: "funding", label: "Trust funding", thresholdDays: 30 },
    ],
    checklist: [
      {
        key: "existing",
        label: "Existing will, trust or powers of attorney",
        docType: "will",
        required: false,
      },
      { key: "deeds", label: "Deeds for real estate", docType: "deed", required: false },
    ],
    retentionYears: 10,
    questionnaire: "estate_planning",
  },
  {
    key: "probate",
    label: "Probate",
    stages: [
      { key: "documents", label: "Gathering documents", thresholdDays: 14, waitingOnClient: true },
      { key: "application", label: "Application filed", thresholdDays: 30 },
      { key: "hearing", label: "Hearing", thresholdDays: 45 },
      { key: "administration", label: "Administration", thresholdDays: 60 },
    ],
    checklist: [
      {
        key: "death_certificate",
        label: "Certified death certificate",
        docType: "death_certificate",
        required: true,
      },
      { key: "will", label: "The original will", docType: "will", required: true },
      {
        key: "assets",
        label: "List or statements of assets",
        docType: "bank_statement",
        required: false,
      },
    ],
    retentionYears: 10,
  },
];
