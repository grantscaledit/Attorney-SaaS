import type { MatterTypeDef } from "../matter-types";

export const BUSINESS_MATTER_TYPES: MatterTypeDef[] = [
  {
    key: "entity_formation",
    label: "Entity formation",
    stages: [
      {
        key: "information",
        label: "Collecting information",
        thresholdDays: 10,
        waitingOnClient: true,
      },
      { key: "drafting", label: "Drafting documents", thresholdDays: 10 },
      { key: "review", label: "Client review", thresholdDays: 10, waitingOnClient: true },
      { key: "filing", label: "Filing and EIN", thresholdDays: 10 },
    ],
    checklist: [
      {
        key: "owners",
        label: "Owner details and ownership split",
        docType: "other",
        required: true,
      },
    ],
    retentionYears: 10,
  },
  {
    key: "contract",
    label: "Contract drafting or review",
    stages: [
      { key: "documents", label: "Gathering documents", thresholdDays: 7, waitingOnClient: true },
      { key: "review", label: "Review and drafting", thresholdDays: 7 },
      { key: "negotiation", label: "Negotiation", thresholdDays: 21 },
    ],
    checklist: [
      { key: "contract", label: "The contract or term sheet", docType: "contract", required: true },
      {
        key: "governing",
        label: "Operating or partnership agreement",
        docType: "operating_agreement",
        required: false,
      },
    ],
    retentionYears: 7,
  },
  {
    key: "general_counsel",
    label: "General business counsel",
    stages: [{ key: "active", label: "Active", thresholdDays: 30 }],
    checklist: [
      { key: "formation", label: "Certificate of formation", docType: "articles", required: false },
      {
        key: "governing",
        label: "Operating or partnership agreement",
        docType: "operating_agreement",
        required: false,
      },
    ],
    retentionYears: 7,
  },
];
