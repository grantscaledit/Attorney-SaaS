import { describe, expect, it } from "vitest";
import { sourceLabelFor, touchDedupeKey, type TouchInput } from "./attribution";

const t = (x: Partial<TouchInput>): TouchInput => ({
  occurredAt: new Date("2026-10-01T00:00:00Z"),
  origin: "form",
  channel: "form",
  ...x,
});

describe("F1 source labels", () => {
  it.each([
    [{ gclid: "abc" }, "google_ads"],
    [{ utmSource: "google", utmMedium: "cpc" }, "google_ads"],
    [{ utmSource: "google", utmMedium: "organic" }, "organic_search"],
    [{ utmSource: "facebook", utmMedium: "paid_social" }, "meta_ads"],
    [{ utmSource: "facebook" }, "social"],
    [{ utmSource: "newsletter", utmMedium: "email" }, "email"],
    [{ utmSource: "smith-cpa", utmMedium: "referral" }, "referral"],
    [{ referrer: "https://www.google.com/" }, "organic_search"],
    [{ referrer: "https://www.bing.com/search?q=x" }, "organic_search"],
    [{ referrer: "https://chamber.example.test/members" }, "referral_web"],
    [{ channel: "call", origin: "call", trackingNumber: "+12145550100" }, "phone"],
    [{}, "website"],
    [{ channel: "other", origin: "x" }, "unknown"],
  ] as const)("%j -> %s", (input, label) => {
    expect(sourceLabelFor(t(input as Partial<TouchInput>), "firm.example.test")).toBe(label);
  });

  it("the firm's own site as referrer is direct traffic", () => {
    expect(
      sourceLabelFor(
        t({ channel: "other", referrer: "https://firm.example.test/about" }),
        "firm.example.test",
      ),
    ).toBe("direct");
  });

  it("dedupe keys are stable for the same touch and differ across leads", () => {
    const a = t({ utmSource: "google" });
    expect(touchDedupeKey("lead1", a)).toBe(touchDedupeKey("lead1", { ...a }));
    expect(touchDedupeKey("lead1", a)).not.toBe(touchDedupeKey("lead2", a));
  });
});
