import { describe, expect, it } from "vitest";
import { actionLabel, formatDate, formatDateTime, timeZoneAbbreviation } from "./format";

describe("firm time zone display (rule 10)", () => {
  // 2026-03-08 is the US spring-forward date; 08:30 UTC falls just after the switch, so Chicago shows CDT.
  const utc = new Date("2026-03-08T08:30:00Z");

  it("renders UTC instants in the firm's zone", () => {
    expect(formatDateTime(utc, "America/Chicago")).toBe("Mar 8, 2026, 3:30 AM");
    expect(formatDateTime(utc, "America/New_York")).toBe("Mar 8, 2026, 4:30 AM");
  });

  it("dates roll over in the firm's zone, not UTC", () => {
    const lateEvening = new Date("2026-06-01T03:00:00Z"); // May 31, 10pm in Chicago
    expect(formatDate(lateEvening, "America/Chicago")).toBe("May 31, 2026");
    expect(formatDate(lateEvening, "UTC")).toBe("Jun 1, 2026");
  });

  it("names the zone", () => {
    expect(timeZoneAbbreviation("America/Chicago", new Date("2026-07-01T12:00:00Z"))).toBe("CDT");
    expect(timeZoneAbbreviation("America/Chicago", new Date("2026-01-01T12:00:00Z"))).toBe("CST");
  });
});

describe("actionLabel", () => {
  it("uses hand-written labels and falls back to the verb", () => {
    expect(actionLabel("users.role_changed")).toBe("Role changed");
    expect(actionLabel("matters.stage_advanced")).toBe("Stage advanced");
  });
});
