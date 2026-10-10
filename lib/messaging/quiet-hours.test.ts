import { describe, expect, it } from "vitest";
import { isWithinQuietHours, nextSendableTime, zonedTime } from "./quiet-hours";

const CHI = "America/Chicago";

describe("quiet hours (8am-9pm recipient time)", () => {
  it("leaves a daytime send alone", () => {
    const due = new Date("2026-10-14T17:00:00Z"); // noon CDT
    expect(isWithinQuietHours(due, CHI)).toBe(false);
    expect(nextSendableTime(due, CHI)).toEqual(due);
  });

  it("moves an early-morning send to 8am the same day", () => {
    const due = new Date("2026-10-14T10:30:00Z"); // 5:30am CDT
    expect(nextSendableTime(due, CHI).toISOString()).toBe("2026-10-14T13:00:00.000Z");
  });

  it("moves a late-evening send to 8am the next day", () => {
    const due = new Date("2026-10-15T03:15:00Z"); // 10:15pm CDT on the 14th
    expect(nextSendableTime(due, CHI).toISOString()).toBe("2026-10-15T13:00:00.000Z");
  });

  it("treats 9:00pm as quiet and 8:00am as allowed", () => {
    expect(isWithinQuietHours(new Date("2026-10-15T02:00:00Z"), CHI)).toBe(true); // 9pm CDT
    expect(isWithinQuietHours(new Date("2026-10-14T13:00:00Z"), CHI)).toBe(false); // 8am CDT
  });

  it("uses the recipient's own zone", () => {
    const due = new Date("2026-10-14T13:30:00Z"); // 8:30am Chicago, 6:30am Los Angeles
    expect(isWithinQuietHours(due, CHI)).toBe(false);
    expect(nextSendableTime(due, "America/Los_Angeles").toISOString()).toBe(
      "2026-10-14T15:00:00.000Z",
    );
  });

  it("crosses month and year ends", () => {
    expect(nextSendableTime(new Date("2027-01-01T04:00:00Z"), CHI).toISOString()).toBe(
      "2027-01-01T14:00:00.000Z",
    );
  });

  it("handles daylight saving changes", () => {
    // Spring forward (8 March 2026): 8am CDT is 13:00Z; the night before it was CST.
    expect(nextSendableTime(new Date("2026-03-08T05:00:00Z"), CHI).toISOString()).toBe(
      "2026-03-08T13:00:00.000Z",
    );
    // Fall back (1 November 2026): 8am CST is 14:00Z.
    expect(zonedTime(2026, 11, 1, 8, CHI).toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });
});
