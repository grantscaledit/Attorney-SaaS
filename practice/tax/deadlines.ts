import type { DeadlineModule } from "../deadline-rules";

const SPEC = "Spec Section 8 seed value. Not verified.";
const TAX_TYPES = ["notice_response", "collections", "unfiled_returns"];

/**
 * Tax deadline seeds (spec Section 8). Every value, the notice numbers each
 * rule applies to, and whether weekends and holidays roll the date forward
 * must be checked by the firm's attorney before the rule is verified.
 */
export const TAX_DEADLINES: DeadlineModule = {
  events: [
    {
      key: "notice_date",
      label: "Notice or letter date",
      matterTypes: TAX_TYPES,
      asksNoticeType: true,
      flags: [{ key: "addressedOutsideUs", label: "Notice addressed to a person outside the US" }],
    },
    { key: "assessment_date", label: "Assessment date", matterTypes: ["collections"] },
    { key: "oic_accepted", label: "Offer in compromise accepted", matterTypes: ["collections"] },
    {
      key: "audit_result_notified",
      label: "Texas Comptroller audit result notification",
      matterTypes: ["notice_response"],
    },
  ],
  rules: [
    {
      key: "tax.irs_deficiency_petition",
      label: "Tax Court petition (notice of deficiency)",
      description: "Last day to petition the US Tax Court after an IRS notice of deficiency.",
      trigger: "notice_date",
      offset: { unit: "days", amount: 90 },
      rollForward: "next_business_day",
      severity: "critical",
      matterTypes: TAX_TYPES,
      noticeTypes: ["CP3219A", "Letter 3219", "Letter 3219C"],
      condition: { flag: "addressedOutsideUs", equals: false },
      preferPrinted: true,
      seedNote: `${SPEC} Notice numbers are a starting list.`,
    },
    {
      key: "tax.irs_deficiency_petition_abroad",
      label: "Tax Court petition (notice of deficiency, addressed outside the US)",
      description:
        "Last day to petition the US Tax Court when the notice of deficiency is addressed to a person outside the United States.",
      trigger: "notice_date",
      offset: { unit: "days", amount: 150 },
      rollForward: "next_business_day",
      severity: "critical",
      matterTypes: TAX_TYPES,
      noticeTypes: ["CP3219A", "Letter 3219", "Letter 3219C"],
      condition: { flag: "addressedOutsideUs", equals: true },
      preferPrinted: true,
      seedNote: `${SPEC} Notice numbers are a starting list.`,
    },
    {
      key: "tax.irs_cdp_hearing",
      label: "Collection due process hearing request",
      description:
        "Last day to request a collection due process hearing after a notice of intent to levy.",
      trigger: "notice_date",
      offset: { unit: "days", amount: 30 },
      rollForward: "next_business_day",
      severity: "critical",
      matterTypes: TAX_TYPES,
      noticeTypes: ["LT11", "Letter 1058", "CP90"],
      preferPrinted: true,
      seedNote: `${SPEC} Notice numbers are a starting list.`,
    },
    {
      key: "tax.irs_30_day_protest",
      label: "Protest to IRS Appeals (30-day letter)",
      description: "Last day to file a protest with IRS Appeals after a 30-day letter.",
      trigger: "notice_date",
      offset: { unit: "days", amount: 30 },
      rollForward: "next_business_day",
      severity: "high",
      matterTypes: TAX_TYPES,
      noticeTypes: ["Letter 950", "Letter 525"],
      preferPrinted: true,
      seedNote: `${SPEC} Notice numbers are a starting list.`,
    },
    {
      key: "tax.irs_cp2000_response",
      label: "CP2000 response",
      description:
        "Response to a CP2000 proposed adjustment. Use the date printed on the notice; this rule is a cross-check.",
      trigger: "notice_date",
      offset: { unit: "days", amount: 30 },
      rollForward: "next_business_day",
      severity: "high",
      matterTypes: TAX_TYPES,
      noticeTypes: ["CP2000"],
      preferPrinted: true,
      seedNote: `${SPEC} The spec says "commonly 30 days"; the printed date governs.`,
    },
    {
      key: "tax.csed",
      label: "Collection statute expiration date",
      description:
        "Date the IRS collection period ends, from the assessment date, extended by tolling events entered by staff.",
      trigger: "assessment_date",
      offset: { unit: "years", amount: 10 },
      rollForward: "none",
      severity: "normal",
      matterTypes: ["collections"],
      allowsTolling: true,
      seedNote: SPEC,
    },
    {
      key: "tax.oic_compliance",
      label: "Offer in compromise compliance period ends",
      description:
        "End of the compliance period that follows an accepted offer in compromise. Filing and payment obligations apply until then.",
      trigger: "oic_accepted",
      offset: { unit: "years", amount: 5 },
      rollForward: "none",
      severity: "normal",
      matterTypes: ["collections"],
      seedNote: SPEC,
    },
    {
      key: "tax.tx_redetermination",
      label: "Texas Comptroller redetermination request",
      description:
        "Last day to request a redetermination hearing after the Comptroller's audit result notification.",
      trigger: "audit_result_notified",
      offset: { unit: "days", amount: 60 },
      rollForward: "next_business_day",
      severity: "critical",
      matterTypes: ["notice_response"],
      seedNote: SPEC,
    },
  ],
};
