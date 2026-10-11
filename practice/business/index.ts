import { BUSINESS_MATTER_TYPES } from "./matters";
import { dollars, type PracticeModule } from "../types";

/** Business: formation, contracts, disputes, sale or purchase, ongoing counsel (spec Section 8). */
export const business: PracticeModule = {
  area: "business",
  label: "Business",
  scope:
    "Forming an LLC or corporation, operating and partnership agreements, contracts, business disputes, buying or selling a business, ongoing general counsel.",
  questions: [
    {
      id: "need",
      label: "Need",
      intent:
        "What they need: formation, a contract, a dispute, a sale or purchase, or ongoing counsel",
      required: true,
    },
    {
      id: "entity",
      label: "Entity type and state",
      intent: "The business's entity type and state, or the type they are considering",
      required: true,
    },
    {
      id: "owners",
      label: "Owners",
      intent: "How many owners there are and their names",
      required: true,
    },
    {
      id: "revenue_band",
      label: "Revenue band",
      intent: "Approximate annual revenue (a range is fine)",
      required: false,
      kind: "money",
    },
    {
      id: "timeline",
      label: "Timeline",
      intent: "When they need this done",
      required: true,
      kind: "date",
    },
    {
      id: "other_parties",
      label: "Other parties",
      intent:
        "Names of the other people or companies involved (the other side of a contract, dispute or deal)",
      required: true,
      askWhen: (a) => /contract|dispute|sale|sell|purchase|buy|partner/i.test(a.need ?? ""),
    },
  ],
  score(a) {
    const notes: string[] = [];
    let urgency = 10;
    if (
      /\b(asap|urgent|this week|next week|immediately|sued|lawsuit|served|tro|injunction)\b/i.test(
        `${a.timeline} ${a.need}`,
      )
    ) {
      urgency = 32;
      notes.push("Short timeline or active dispute");
    } else if (/\b(this month|30 days|weeks)\b/i.test(a.timeline ?? "")) urgency = 20;
    const revenue = dollars(a.revenue_band);
    let value = /sale|sell|purchase|buy|acquisition|ongoing|general counsel/i.test(a.need ?? "")
      ? 28
      : 15;
    if (revenue !== null && revenue >= 1_000_000) {
      value = 35;
      notes.push("Revenue over $1M");
    }
    const outOfState =
      a.entity &&
      !/\b(texas|tx)\b/i.test(a.entity) &&
      /\b(delaware|nevada|wyoming|california|florida|new york|[A-Z]{2})\b/.test(a.entity);
    if (outOfState) notes.push("Entity outside Texas");
    return { urgency, value, fit: outOfState ? 15 : 25, notes };
  },
  matterTypes: BUSINESS_MATTER_TYPES,
  promptFragment: [
    "Business matters: collect who is involved and what they need, not the merits.",
    "Always get the names of every other party to a contract, dispute or deal: they are needed for the conflict check.",
    "Never say which entity type is better, whether a contract is enforceable, or who would win a dispute.",
  ].join("\n"),
};
