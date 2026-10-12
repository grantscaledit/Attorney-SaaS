import { describe, expect, it } from "vitest";
import { scoreLead } from "./scoring";

const now = new Date("2026-10-12T15:00:00Z");
const all = ["tax", "business", "estate"] as const;

describe("A5 lead scoring", () => {
  it("a tax notice due in 6 days with a levy and a large balance is urgent", () => {
    const s = scoreLead({
      practiceArea: "tax",
      answers: {
        agency: "IRS",
        respond_by: "2026-10-18",
        levy_or_lien: "yes, bank levy",
        amount: "$64,000",
      },
      escalations: [],
      firmAreas: all,
      now,
    });
    expect(s.urgent).toBe(true);
    expect(s.score).toBeGreaterThanOrEqual(90);
    expect(s.notes.join(" ")).toMatch(/Respond-by date in 6 days/);
  });

  it("a routine will update is not urgent", () => {
    const s = scoreLead({
      practiceArea: "estate",
      answers: {
        matter: "update our wills",
        asset_band: "about 300k",
        existing_documents: "wills from 2009",
      },
      escalations: [],
      firmAreas: all,
      now,
    });
    expect(s.urgent).toBe(false);
    expect(s.score).toBeLessThan(75);
  });

  it("an escalation forces urgency whatever the answers", () => {
    const s = scoreLead({
      practiceArea: "estate",
      answers: {},
      escalations: ["recent_death"],
      firmAreas: all,
      now,
    });
    expect(s.urgent).toBe(true);
    expect(s.parts.urgency).toBe(40);
  });

  it("asking for a person is not by itself urgent", () => {
    const s = scoreLead({
      practiceArea: "business",
      answers: {},
      escalations: ["asked_for_human"],
      firmAreas: all,
      now,
    });
    expect(s.urgent).toBe(false);
  });

  it("an area the firm does not offer has no fit and is never urgent from score alone", () => {
    const s = scoreLead({
      practiceArea: "tax",
      answers: { respond_by: "2026-10-14", levy_or_lien: "yes" },
      escalations: [],
      firmAreas: ["estate"],
      now,
    });
    expect(s.parts.fit).toBe(0);
    expect(s.urgent).toBe(false);
  });

  it("scores stay within 0-100", () => {
    const s = scoreLead({
      practiceArea: "business",
      answers: {
        need: "sale of the business",
        revenue_band: "$4M",
        timeline: "ASAP, we were served",
      },
      escalations: ["criminal_investigation"],
      firmAreas: all,
      now,
    });
    expect(s.score).toBeLessThanOrEqual(100);
  });
});
