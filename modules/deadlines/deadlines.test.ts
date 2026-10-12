import { describe, expect, it } from "vitest";
import { allRuleSeeds, paramsOfSeed, type RuleParams } from "@/practice";
import {
  addDays,
  addMonths,
  addYears,
  daysBetween,
  isLeapYear,
  nextAnnual,
  nextBusinessDay,
  usFederalHolidays,
  weekday,
} from "./date-math";
import {
  computeDue,
  isCritical,
  ruleHash,
  rulesForEvent,
  thresholdFor,
  verificationOf,
  type RuleState,
} from "./engine";

const NONE = new Set<string>();

function rule(over: Partial<RuleParams> = {}, verified = true): RuleState {
  const p: RuleParams = {
    label: "Test rule",
    description: "A test rule.",
    trigger: "notice_date",
    offset: { unit: "days", amount: 30 },
    rollForward: "next_business_day",
    severity: "high",
    matterTypes: ["notice_response"],
    noticeTypes: [],
    condition: null,
    preferPrinted: false,
    recurring: null,
    allowsTolling: false,
    ...over,
  };
  return {
    ...p,
    id: "r1",
    key: "test.rule",
    active: true,
    verifiedBy: verified ? "u1" : null,
    verifiedAt: verified ? new Date("2026-01-01T00:00:00Z") : null,
    verifiedHash: verified ? ruleHash(p) : null,
  };
}

describe("date math", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2026-10-01", 90)).toBe("2026-12-30");
  });

  it("is not moved by daylight saving changes", () => {
    // US clocks change on 8 March and 1 November 2026.
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(daysBetween("2026-03-01", "2026-04-01")).toBe(31);
  });

  it("clamps month arithmetic to the last day of a shorter month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-03-31", 1)).toBe("2026-04-30");
    expect(addMonths("2026-08-31", 1)).toBe("2026-09-30");
    expect(addMonths("2026-05-31", 9)).toBe("2027-02-28");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonths("2026-12-31", 2)).toBe("2027-02-28");
  });

  it("handles leap days in year arithmetic", () => {
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(addYears("2028-02-29", 1)).toBe("2029-02-28");
    expect(addYears("2028-02-29", 4)).toBe("2032-02-29");
    expect(addYears("2024-02-29", 10)).toBe("2034-02-28");
    expect(addYears("2026-02-28", 2)).toBe("2028-02-28");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2100-02-28", 1)).toBe("2100-03-01");
  });

  it("finds the next annual date strictly after the trigger", () => {
    expect(nextAnnual("2026-03-01", 5, 15)).toBe("2026-05-15");
    expect(nextAnnual("2026-05-15", 5, 15)).toBe("2027-05-15");
    expect(nextAnnual("2026-11-20", 5, 15)).toBe("2027-05-15");
    expect(nextAnnual("2027-03-01", 2, 29)).toBe("2028-02-29");
    expect(nextAnnual("2028-03-01", 2, 29)).toBe("2029-02-28");
  });

  it("rolls weekends and holidays forward to the next business day", () => {
    expect(weekday("2026-10-17")).toBe(6);
    expect(nextBusinessDay("2026-10-17", NONE)).toBe("2026-10-19");
    expect(nextBusinessDay("2026-10-18", NONE)).toBe("2026-10-19");
    expect(nextBusinessDay("2026-10-19", NONE)).toBe("2026-10-19");
    // Friday 25 December 2026, then a weekend: Monday 28.
    const xmas = new Set(["2026-12-25"]);
    expect(nextBusinessDay("2026-12-25", xmas)).toBe("2026-12-28");
    // Holiday on a Monday after a weekend.
    expect(nextBusinessDay("2026-09-05", new Set(["2026-09-07"]))).toBe("2026-09-08");
  });

  it("lists federal holidays with observed dates", () => {
    const h2026 = Object.fromEntries(usFederalHolidays(2026).map((h) => [h.label, h.date]));
    expect(h2026["Independence Day"]).toBe("2026-07-03"); // Saturday, observed Friday
    expect(h2026["Thanksgiving Day"]).toBe("2026-11-26");
    expect(h2026["Memorial Day"]).toBe("2026-05-25");
    expect(h2026["Birthday of Martin Luther King, Jr."]).toBe("2026-01-19");
    const h2027 = Object.fromEntries(usFederalHolidays(2027).map((h) => [h.label, h.date]));
    expect(h2027["Christmas Day"]).toBe("2027-12-24"); // Saturday
    expect(h2027["Juneteenth National Independence Day"]).toBe("2027-06-18");
    const h2028 = Object.fromEntries(usFederalHolidays(2028).map((h) => [h.label, h.date]));
    // 1 January 2028 is a Saturday: observed Friday 31 December 2027.
    expect(h2028["New Year's Day"]).toBe("2027-12-31");
  });

  it("rejects impossible dates", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow();
    expect(() => addDays("2027-02-29", 1)).toThrow();
  });
});

describe("rules engine (C1)", () => {
  it("refuses to compute from an unverified rule", () => {
    const r = computeDue(rule({}, false), { triggerOn: "2026-10-01", holidays: NONE });
    expect(r).toEqual({ ok: false, reason: "unverified" });
  });

  it("refuses when the rule changed after it was verified", () => {
    const r = rule();
    const edited = { ...r, offset: { unit: "days" as const, amount: 60 } };
    expect(verificationOf(edited)).toBe("changed_since_verified");
    expect(computeDue(edited, { triggerOn: "2026-10-01", holidays: NONE }).ok).toBe(false);
  });

  it("refuses a switched-off rule", () => {
    expect(
      computeDue({ ...rule(), active: false }, { triggerOn: "2026-10-01", holidays: NONE }),
    ).toEqual({ ok: false, reason: "inactive" });
  });

  it("refuses when only part of the verification is present", () => {
    expect(verificationOf({ ...rule(), verifiedAt: null })).toBe("unverified");
    expect(verificationOf({ ...rule(), verifiedHash: null })).toBe("unverified");
  });

  it("hashes parameters independently of key and list order", () => {
    const a = rule({ matterTypes: ["a", "b"], noticeTypes: ["Letter 1058", "LT11"] });
    const b = rule({ matterTypes: ["b", "a"], noticeTypes: ["lt 11", "LETTER1058"] });
    expect(ruleHash(a)).toBe(ruleHash(b));
    expect(ruleHash(a)).not.toBe(ruleHash(rule({ severity: "critical" })));
  });

  it("computes day offsets and rolls a weekend forward", () => {
    // 2026-07-01 + 30 = 2026-07-31 (Friday): no roll.
    const a = computeDue(rule(), { triggerOn: "2026-07-01", holidays: NONE });
    expect(a.ok && a.dueOn).toBe("2026-07-31");
    // 2026-09-17 + 30 = 2026-10-17 (Saturday): Monday 19th.
    const b = computeDue(rule(), { triggerOn: "2026-09-17", holidays: NONE });
    expect(b.ok && b.dueOn).toBe("2026-10-19");
    expect(b.ok && b.baseOn).toBe("2026-10-17");
    expect(b.ok && b.rolled).toBe(true);
  });

  it("rolls over a holiday the firm entered", () => {
    // 2026-08-28 + 10 = 2026-09-07, Labor Day.
    const r = rule({ offset: { unit: "days", amount: 10 } });
    const c = computeDue(r, { triggerOn: "2026-08-28", holidays: new Set(["2026-09-07"]) });
    expect(c.ok && c.dueOn).toBe("2026-09-08");
  });

  it("does not roll when the rule says so", () => {
    const r = rule({ rollForward: "none" });
    const c = computeDue(r, { triggerOn: "2026-09-17", holidays: NONE });
    expect(c.ok && c.dueOn).toBe("2026-10-17");
  });

  it("computes month offsets at month ends and in leap years", () => {
    const nine = rule({ offset: { unit: "months", amount: 9 }, rollForward: "none" });
    expect(computeDue(nine, { triggerOn: "2027-05-31", holidays: NONE })).toMatchObject({
      dueOn: "2028-02-29",
    });
    expect(computeDue(nine, { triggerOn: "2026-05-31", holidays: NONE })).toMatchObject({
      dueOn: "2027-02-28",
    });
    const one = rule({ offset: { unit: "months", amount: 1 }, rollForward: "none" });
    expect(computeDue(one, { triggerOn: "2026-01-30", holidays: NONE })).toMatchObject({
      dueOn: "2026-02-28",
    });
  });

  it("computes year offsets from a leap day", () => {
    const ten = rule({ offset: { unit: "years", amount: 10 }, rollForward: "none" });
    expect(computeDue(ten, { triggerOn: "2024-02-29", holidays: NONE })).toMatchObject({
      dueOn: "2034-02-28",
    });
  });

  it("adds tolling days only when the rule allows tolling", () => {
    const csed = rule({ offset: { unit: "years", amount: 10 }, rollForward: "none" });
    const tolled = { ...csed, allowsTolling: true };
    tolled.verifiedHash = ruleHash(tolled);
    expect(
      computeDue(tolled, { triggerOn: "2020-06-15", holidays: NONE, tollingDays: 45 }),
    ).toMatchObject({ dueOn: "2030-07-30", baseOn: "2030-06-15" });
    expect(
      computeDue(csed, { triggerOn: "2020-06-15", holidays: NONE, tollingDays: 45 }),
    ).toMatchObject({ dueOn: "2030-06-15" });
  });

  it("computes annual occurrences and rolls each one", () => {
    const annual = rule({ offset: { unit: "annual", month: 5, day: 15 }, recurring: "annual" });
    // 15 May 2027 is a Saturday: Monday 17th.
    expect(computeDue(annual, { triggerOn: "2026-08-01", holidays: NONE })).toMatchObject({
      baseOn: "2027-05-15",
      dueOn: "2027-05-17",
    });
    expect(
      computeDue(annual, { triggerOn: "2026-08-01", holidays: NONE, occurrence: 1 }),
    ).toMatchObject({ baseOn: "2028-05-15", dueOn: "2028-05-15" });
  });

  it("explains each step", () => {
    const c = computeDue(rule(), { triggerOn: "2026-09-17", holidays: NONE });
    expect(c.ok && c.steps).toEqual([
      "Trigger date Thu, Sep 17, 2026",
      "30 days after the trigger: Sat, Oct 17, 2026",
      "Falls on a weekend or holiday; moved to Mon, Oct 19, 2026",
    ]);
  });

  it("matches rules by trigger, matter type, notice number and flag", () => {
    const domestic = rule({
      noticeTypes: ["CP3219A"],
      condition: { flag: "abroad", equals: false },
    });
    const abroad = { ...domestic, id: "r2", condition: { flag: "abroad", equals: true } };
    const rules = [domestic, abroad];
    const m = { matterType: "notice_response" };
    expect(
      rulesForEvent(rules, m, { kind: "notice_date", noticeType: "cp 3219a", flags: {} }),
    ).toEqual([domestic]);
    expect(
      rulesForEvent(rules, m, {
        kind: "notice_date",
        noticeType: "CP3219A",
        flags: { abroad: true },
      }),
    ).toEqual([abroad]);
    expect(
      rulesForEvent(rules, m, { kind: "notice_date", noticeType: "CP2000", flags: {} }),
    ).toEqual([]);
    expect(rulesForEvent(rules, m, { kind: "notice_date", noticeType: null, flags: {} })).toEqual(
      [],
    );
    expect(
      rulesForEvent(
        rules,
        { matterType: "probate" },
        {
          kind: "notice_date",
          noticeType: "CP3219A",
          flags: {},
        },
      ),
    ).toEqual([]);
  });
});

describe("seed rules", () => {
  const seeds = allRuleSeeds();

  it("has unique keys", () => {
    expect(new Set(seeds.map((s) => s.key)).size).toBe(seeds.length);
  });

  it("covers every rule in spec Section 8", () => {
    expect(seeds.length).toBe(14);
  });

  it("never computes from a seed until it is verified", () => {
    for (const s of seeds) {
      const state: RuleState = {
        ...paramsOfSeed(s),
        id: s.key,
        key: s.key,
        active: true,
        verifiedBy: null,
        verifiedAt: null,
        verifiedHash: null,
      };
      expect(computeDue(state, { triggerOn: "2026-10-01", holidays: NONE }).ok).toBe(false);
    }
  });

  it("only uses trigger events its practice area records, for matter types that exist", async () => {
    const { PRACTICE_MODULES } = await import("@/practice");
    for (const s of seeds) {
      const mod = PRACTICE_MODULES[s.practiceArea];
      const ev = mod.deadlines.events.find((e) => e.key === s.trigger);
      expect(ev, s.key).toBeDefined();
      for (const t of s.matterTypes) {
        expect(
          mod.matterTypes.some((m) => m.key === t),
          `${s.key} ${t}`,
        ).toBe(true);
        expect(ev!.matterTypes, `${s.key} ${t}`).toContain(t);
      }
      if (s.condition) expect(ev!.flags?.map((f) => f.key)).toContain(s.condition.flag);
      if (s.noticeTypes?.length) expect(ev!.asksNoticeType).toBe(true);
    }
  });
});

describe("alerts (C2)", () => {
  it("picks the alert point a deadline has reached", () => {
    expect(thresholdFor(45)).toBeNull();
    expect(thresholdFor(31)).toBeNull();
    expect(thresholdFor(30)).toBe(30);
    expect(thresholdFor(20)).toBe(30);
    expect(thresholdFor(14)).toBe(14);
    expect(thresholdFor(8)).toBe(14);
    expect(thresholdFor(7)).toBe(7);
    expect(thresholdFor(4)).toBe(7);
    expect(thresholdFor(3)).toBe(3);
    expect(thresholdFor(2)).toBe(3);
    expect(thresholdFor(1)).toBe(1);
    expect(thresholdFor(0)).toBe(0);
    expect(thresholdFor(-5)).toBe(0);
  });

  it("treats the last three days, and a week out on critical deadlines, as critical", () => {
    expect(isCritical(3, "normal")).toBe(true);
    expect(isCritical(7, "normal")).toBe(false);
    expect(isCritical(7, "critical")).toBe(true);
    expect(isCritical(14, "critical")).toBe(false);
  });
});
