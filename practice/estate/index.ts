import { ESTATE_DEADLINES } from "./deadlines";
import { ESTATE_MATTER_TYPES } from "./matters";
import { daysUntil, dollars, yes, type PracticeModule } from "../types";

const isProbate = (a: Record<string, string>) =>
  /probate|passed|died|death|estate of|executor|administrat/i.test(a.matter ?? "");

/** Estate planning and probate (spec Section 8). */
export const estate: PracticeModule = {
  area: "estate",
  label: "Estate and probate",
  scope:
    "Wills, trusts, powers of attorney, estate plan updates, probate after a death, estate administration, guardianship.",
  questions: [
    {
      id: "matter",
      label: "Planning or probate",
      intent:
        "Whether they want estate planning for themselves, or help with probate after a death",
      required: true,
    },
    {
      id: "marital_status",
      label: "Marital status",
      intent: "Their marital status",
      required: true,
      askWhen: (a) => !isProbate(a),
    },
    {
      id: "children",
      label: "Children and minors",
      intent: "Whether they have children, and whether any are minors",
      required: true,
      askWhen: (a) => !isProbate(a),
    },
    {
      id: "asset_band",
      label: "Asset band",
      intent: "Approximate total value of assets (a range is fine)",
      required: false,
      kind: "money",
    },
    {
      id: "out_of_state_property",
      label: "Real estate in other states",
      intent: "Whether they own real estate outside Texas",
      required: true,
      askWhen: (a) => !isProbate(a),
    },
    {
      id: "business_ownership",
      label: "Business ownership",
      intent: "Whether they own all or part of a business",
      required: true,
      askWhen: (a) => !isProbate(a),
    },
    {
      id: "existing_documents",
      label: "Existing documents",
      intent: "Whether they already have a will, trust or power of attorney, and how old it is",
      required: true,
      askWhen: (a) => !isProbate(a),
    },
    {
      id: "date_of_death",
      label: "Date of death",
      intent: "The date the person died",
      required: true,
      kind: "date",
      askWhen: isProbate,
    },
    {
      id: "county",
      label: "County",
      intent: "The county where the person lived",
      required: true,
      askWhen: isProbate,
    },
    {
      id: "will_exists",
      label: "Will exists",
      intent: "Whether there is a will and who has the original",
      required: true,
      askWhen: isProbate,
    },
    {
      id: "named_executor",
      label: "Named executor",
      intent: "Who is named as executor, and the name of the person who died",
      required: true,
      askWhen: isProbate,
    },
  ],
  score(a, now) {
    const notes: string[] = [];
    let urgency = 8;
    if (isProbate(a)) {
      urgency = 22;
      const since = daysUntil(a.date_of_death, now);
      if (since !== null && since >= -30) {
        urgency = 30;
        notes.push("Death in the last 30 days");
      }
    }
    const assets = dollars(a.asset_band);
    const value = assets === null ? 15 : assets >= 2_000_000 ? 35 : assets >= 500_000 ? 26 : 15;
    if (assets !== null) notes.push(`Assets about $${Math.round(assets).toLocaleString("en-US")}`);
    if (yes(a.business_ownership)) notes.push("Owns a business (cross-sell: business)");
    if (yes(a.out_of_state_property)) notes.push("Real estate outside Texas");
    const fit =
      a.county &&
      !/\b(collin|dallas|denton|tarrant|grayson|rockwall|hunt|texas|tx)\b/i.test(a.county)
        ? 18
        : 25;
    return { urgency, value, fit, notes };
  },
  matterTypes: ESTATE_MATTER_TYPES,
  deadlines: ESTATE_DEADLINES,
  promptFragment: [
    "Estate matters: be brief and kind; a recent death is hard to talk about.",
    "For probate, collect the name of the person who died and of the named executor: they are needed for the conflict check.",
    "Never say who inherits, whether a will is valid, or whether probate is needed.",
    "Do not ask for dates of birth or Social Security numbers.",
  ].join("\n"),
};
