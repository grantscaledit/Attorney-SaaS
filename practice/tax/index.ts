import { TAX_DEADLINES } from "./deadlines";
import { TAX_MATTER_TYPES } from "./matters";
import { daysUntil, dollars, yes, type PracticeModule } from "../types";

/** Tax controversy: IRS and Texas Comptroller notices, collections, unfiled returns (spec Section 8). */
export const tax: PracticeModule = {
  area: "tax",
  label: "Tax",
  scope:
    "IRS or Texas Comptroller notices, audits, tax debt, collections, levies, liens, unfiled returns, penalties, payment plans, offers in compromise.",
  questions: [
    {
      id: "agency",
      label: "Agency",
      intent: "Which agency sent the notice or is involved: IRS, Texas Comptroller, or another",
      required: true,
    },
    {
      id: "notice_type",
      label: "Notice type",
      intent: "The notice or letter number or name printed on it (for example CP2000, CP504, LT11)",
      required: true,
    },
    {
      id: "notice_date",
      label: "Notice date",
      intent: "The date printed on the notice",
      required: true,
      kind: "date",
    },
    {
      id: "respond_by",
      label: "Respond-by date",
      intent: "Any respond-by or deadline date printed on the notice",
      required: true,
      kind: "date",
    },
    { id: "tax_years", label: "Tax years", intent: "Which tax years are involved", required: true },
    {
      id: "amount",
      label: "Approximate amount",
      intent: "The approximate amount the notice says is owed, if any",
      required: false,
      kind: "money",
    },
    {
      id: "taxpayer_type",
      label: "Individual or business",
      intent: "Whether this is for an individual or a business",
      required: true,
    },
    {
      id: "unfiled_returns",
      label: "Unfiled returns",
      intent: "Whether any tax returns are unfiled, and for which years",
      required: true,
    },
    {
      id: "levy_or_lien",
      label: "Levy or lien",
      intent: "Whether a levy, garnishment or lien is already in place",
      required: true,
    },
    {
      id: "prior_representation",
      label: "Prior representation",
      intent: "Whether another attorney, CPA or enrolled agent has handled this before",
      required: false,
    },
  ],
  score(a, now) {
    const notes: string[] = [];
    let urgency = 10;
    const days = daysUntil(a.respond_by, now);
    if (days !== null && days <= 10) {
      urgency = 40;
      notes.push(`Respond-by date in ${days} days`);
    } else if (days !== null && days <= 30) {
      urgency = 28;
      notes.push(`Respond-by date in ${days} days`);
    }
    if (yes(a.levy_or_lien)) {
      urgency = Math.max(urgency, 35);
      notes.push("Levy, garnishment or lien in place");
    }
    if (/\b(cp504|lt11|letter 1058|cp90|lt1058|final notice)\b/i.test(a.notice_type ?? "")) {
      urgency = Math.max(urgency, 32);
      notes.push("Final notice before levy");
    }
    const owed = dollars(a.amount);
    const value =
      owed === null ? 15 : owed >= 100_000 ? 35 : owed >= 25_000 ? 28 : owed >= 5_000 ? 20 : 10;
    if (owed !== null) notes.push(`About $${Math.round(owed).toLocaleString("en-US")} at issue`);
    if (yes(a.unfiled_returns)) notes.push("Unfiled returns");
    const fit =
      /comptroller|irs|internal revenue|texas/i.test(a.agency ?? "") || !a.agency ? 25 : 15;
    return { urgency, value, fit, notes };
  },
  matterTypes: TAX_MATTER_TYPES,
  deadlines: TAX_DEADLINES,
  promptFragment: [
    "Tax matters: ask for facts printed on the notice, not opinions about it.",
    "Never say whether the amount is right, whether penalties can be removed, or what the person should pay or file.",
    "If they read out a respond-by date, repeat it back to confirm you have it right.",
    "Do not ask for Social Security numbers, EINs or account numbers. If they send one, do not repeat it.",
  ].join("\n"),
};
