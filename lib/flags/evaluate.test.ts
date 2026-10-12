import { describe, expect, it } from "vitest";
import { FEATURES, FEATURE_FLAGS, type FeatureFlag } from "./catalog";
import { evaluateFeature, isFeatureEnabled, userLimit } from "./evaluate";

/*
 * Tier table from spec Section 1, written out by hand so a catalog edit that
 * changes what a tier gets is caught here.
 */
const SOLO_EXCLUDED: readonly FeatureFlag[] = [
  "platform.sso",
  "platform.unlimited_users",
  "platform.voice_receptionist",
  "platform.multi_attorney_routing",
  "platform.staff_workload",
  "automation.A4",
  "automation.D4",
  "automation.D5",
  "automation.D6",
  "automation.F2",
  "automation.F4",
  "automation.G4",
  "automation.G5",
  "automation.G6",
];

describe("tier gating", () => {
  it("Firm tier includes every feature", () => {
    for (const flag of FEATURE_FLAGS) expect(isFeatureEnabled("firm", flag), flag).toBe(true);
  });

  it("Solo tier includes everything except the spec's Firm-only list", () => {
    for (const flag of FEATURE_FLAGS) {
      expect(isFeatureEnabled("solo", flag), flag).toBe(!SOLO_EXCLUDED.includes(flag));
    }
  });

  it("Solo: intake all except A4; revenue D1-D3; marketing F1, F3; executive G1-G3, G7", () => {
    const soloAutomations = FEATURE_FLAGS.filter(
      (f) => f.startsWith("automation.") && isFeatureEnabled("solo", f),
    )
      .map((f) => f.replace("automation.", ""))
      .filter((id) => /^[ADFG]/.test(id))
      .sort();
    expect(soloAutomations).toEqual(
      [
        "A1",
        "A10",
        "A11",
        "A12",
        "A2",
        "A3",
        "A5",
        "A6",
        "A7",
        "A8",
        "A9",
        "D1",
        "D2",
        "D3",
        "F1",
        "F3",
        "G1",
        "G2",
        "G3",
        "G7",
      ].sort(),
    );
  });

  it("every automation ID A1-G7 from the spec is in the catalog", () => {
    const ids = FEATURE_FLAGS.filter((f) => f.startsWith("automation.")).length;
    // A1-A12, B1-B10, C1-C7, D1-D6, E1-E9, F1-F4, G1-G7
    expect(ids).toBe(12 + 10 + 7 + 6 + 9 + 4 + 7);
  });

  it("every feature names at least one tier", () => {
    for (const flag of FEATURE_FLAGS) expect(FEATURES[flag].tiers.length, flag).toBeGreaterThan(0);
  });
});

describe("firm overrides", () => {
  it("can switch off a feature the tier includes", () => {
    const s = evaluateFeature("solo", "automation.A1", { "automation.A1": false });
    expect(s).toEqual({
      flag: "automation.A1",
      inTier: true,
      enabled: false,
      disabledByFirm: true,
    });
  });

  it("cannot switch on a feature outside the tier", () => {
    const s = evaluateFeature("solo", "automation.A4", { "automation.A4": true });
    expect(s.enabled).toBe(false);
    expect(s.inTier).toBe(false);
    expect(s.disabledByFirm).toBe(false);
  });

  it("an explicit true override on an in-tier feature is a no-op", () => {
    expect(isFeatureEnabled("firm", "automation.G4", { "automation.G4": true })).toBe(true);
  });
});

describe("user limits", () => {
  it("Solo is capped at 5 users; Firm is unlimited", () => {
    expect(userLimit("solo")).toBe(5);
    expect(userLimit("firm")).toBeNull();
  });
});
