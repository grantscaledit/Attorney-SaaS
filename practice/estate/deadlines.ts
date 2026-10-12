import type { DeadlineModule } from "../deadline-rules";

const SPEC = "Spec Section 8 seed value. Not verified.";

/** Estate and probate deadline seeds (spec Section 8). The probate milestones (C4) read these. */
export const ESTATE_DEADLINES: DeadlineModule = {
  events: [
    { key: "date_of_death", label: "Date of death", matterTypes: ["probate"] },
    { key: "will_admitted", label: "Order admitting will", matterTypes: ["probate"] },
    { key: "letters_granted", label: "Letters granted", matterTypes: ["probate"] },
    { key: "qualified", label: "Personal representative qualified", matterTypes: ["probate"] },
  ],
  rules: [
    {
      key: "estate.tx_will_application",
      label: "Application to probate the will",
      description: "Last day to apply to probate a will as a will in Texas.",
      trigger: "date_of_death",
      offset: { unit: "years", amount: 4 },
      rollForward: "next_business_day",
      severity: "high",
      matterTypes: ["probate"],
      seedNote: SPEC,
    },
    {
      key: "estate.federal_estate_return",
      label: "Federal estate tax return",
      description: "Due date of the federal estate tax return (Form 706), before any extension.",
      trigger: "date_of_death",
      offset: { unit: "months", amount: 9 },
      rollForward: "next_business_day",
      severity: "high",
      matterTypes: ["probate"],
      seedNote: SPEC,
    },
    {
      key: "estate.tx_beneficiary_notice",
      label: "Notice to beneficiaries",
      description: "Notice to beneficiaries after the order admitting the will to probate.",
      trigger: "will_admitted",
      offset: { unit: "days", amount: 60 },
      rollForward: "next_business_day",
      severity: "high",
      matterTypes: ["probate"],
      seedNote: SPEC,
    },
    {
      key: "estate.tx_creditor_notice",
      label: "Published notice to creditors",
      description: "Publication of the general notice to creditors after letters are granted.",
      trigger: "letters_granted",
      offset: { unit: "months", amount: 1 },
      rollForward: "next_business_day",
      severity: "high",
      matterTypes: ["probate"],
      seedNote: SPEC,
    },
    {
      key: "estate.tx_inventory",
      label: "Inventory, appraisement and list of claims",
      description: "Filing of the inventory after the personal representative qualifies.",
      trigger: "qualified",
      offset: { unit: "days", amount: 90 },
      rollForward: "next_business_day",
      severity: "high",
      matterTypes: ["probate"],
      seedNote: SPEC,
    },
  ],
};
