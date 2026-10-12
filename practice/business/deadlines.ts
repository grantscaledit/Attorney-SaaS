import type { DeadlineModule } from "../deadline-rules";

/** Business deadline seeds (spec Section 8). C3 creates each year's report from the entity's formation. */
export const BUSINESS_DEADLINES: DeadlineModule = {
  events: [
    {
      key: "entity_formed",
      label: "Entity formed",
      matterTypes: ["entity_formation", "general_counsel"],
    },
  ],
  rules: [
    {
      key: "business.tx_franchise_report",
      label: "Texas franchise tax report",
      description:
        "Annual Texas franchise tax and information report. Created each year for the entity (C3).",
      trigger: "entity_formed",
      offset: { unit: "annual", month: 5, day: 15 },
      rollForward: "next_business_day",
      severity: "high",
      matterTypes: ["entity_formation", "general_counsel"],
      recurring: "annual",
      seedNote:
        "Spec Section 8 seed value (annual, May 15). Not verified. Check when the first report is due for a newly formed entity.",
    },
  ],
};
