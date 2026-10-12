import { describe, expect, it } from "vitest";
import { paymentDate, upcomingPayments } from "./commands/schedule";
import { escapeText, fold, renderCalendar } from "./ics";

describe("calendar feed (C6)", () => {
  it("escapes text values", () => {
    expect(escapeText("a, b; c\\d\nnext")).toBe("a\\, b\\; c\\\\d\\nnext");
  });

  it("folds lines over 75 octets without splitting a character", () => {
    const line = `SUMMARY:${"é".repeat(60)}`;
    const folded = fold(line);
    for (const part of folded.split("\r\n"))
      expect(Buffer.byteLength(part)).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });

  it("renders all-day events that end the next day, with the version as SEQUENCE", () => {
    const ics = renderCalendar(
      "LexDesk deadlines",
      [
        {
          uid: "d1@lexdesk",
          dueOn: "2026-12-31",
          summary: "2026-0004: Protest due",
          description: "Verify against the source document.",
          url: "https://app.example.test/matters/m1#deadlines",
          sequence: 3,
          updatedAt: new Date("2026-10-01T12:00:00Z"),
        },
      ],
      new Date("2026-10-12T08:30:00Z"),
    );
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231\r\n");
    expect(ics).toContain("DTEND;VALUE=DATE:20270101\r\n");
    expect(ics).toContain("SEQUENCE:3\r\n");
    expect(ics).toContain("DTSTAMP:20261012T083000Z\r\n");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});

describe("payment schedule (C5)", () => {
  it("keeps the day of month and clamps short months", () => {
    const plan = { firstDueOn: "2027-01-31", dayOfMonth: 31 };
    expect([0, 1, 2, 3].map((k) => paymentDate(plan, k))).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
    expect(paymentDate({ firstDueOn: "2027-12-15", dayOfMonth: 15 }, 2)).toBe("2028-02-15");
    expect(paymentDate({ firstDueOn: "2028-01-29", dayOfMonth: 29 }, 1)).toBe("2028-02-29");
  });

  it("lists the next payments from a date", () => {
    expect(upcomingPayments({ firstDueOn: "2026-11-05", dayOfMonth: 5 }, "2027-01-06", 2)).toEqual([
      "2027-02-05",
      "2027-03-05",
    ]);
  });
});
