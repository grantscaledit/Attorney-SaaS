import { describe, expect, it } from "vitest";
import { planConsultMessages } from "./commands/automations";

const now = new Date("2026-10-10T15:00:00Z");
const hours = (h: number) => new Date(now.getTime() + h * 3_600_000);

describe("A7 consult message plan", () => {
  it("a consult three days out: confirmation now, reminders at 24h and 2h before", () => {
    const startsAt = hours(72);
    const plan = planConsultMessages(
      { id: "a1", status: "confirmed", startsAt, deleted: false },
      now,
    );
    expect(plan.map((p) => [p.templateKey, p.dueAt.toISOString()])).toEqual([
      ["A7.confirmation.sms", now.toISOString()],
      ["A7.reminder_24h.sms", hours(48).toISOString()],
      ["A7.reminder_2h.sms", hours(70).toISOString()],
    ]);
  });

  it("a consult booked for this afternoon skips the 24-hour reminder", () => {
    const plan = planConsultMessages(
      { id: "a1", status: "new", startsAt: hours(5), deleted: false },
      now,
    );
    expect(plan.map((p) => p.templateKey)).toEqual(["A7.confirmation.sms", "A7.reminder_2h.sms"]);
  });

  it("keys change with the start time, so a reschedule replaces the set", () => {
    const a = planConsultMessages(
      { id: "a1", status: "confirmed", startsAt: hours(72), deleted: false },
      now,
    );
    const b = planConsultMessages(
      { id: "a1", status: "confirmed", startsAt: hours(96), deleted: false },
      now,
    );
    expect(a.map((p) => p.idempotencyKey)).not.toEqual(b.map((p) => p.idempotencyKey));
  });

  it("no-show: rebooking text now and a follow-up in two days that a new booking cancels", () => {
    const plan = planConsultMessages(
      { id: "a1", status: "noshow", startsAt: hours(-1), deleted: false },
      now,
    );
    expect(plan.map((p) => p.templateKey)).toEqual(["A7.no_show.sms", "A7.no_show_followup.sms"]);
    expect(plan[1]!.context).toEqual({ cancelIfRebookedAfter: now.toISOString() });
  });

  it("cancelled, deleted, showed or past consults get nothing new", () => {
    for (const status of ["cancelled", "invalid", "showed"]) {
      expect(
        planConsultMessages({ id: "a1", status, startsAt: hours(24), deleted: false }, now),
      ).toEqual([]);
    }
    expect(
      planConsultMessages(
        { id: "a1", status: "confirmed", startsAt: hours(24), deleted: true },
        now,
      ),
    ).toEqual([]);
    expect(
      planConsultMessages(
        { id: "a1", status: "confirmed", startsAt: hours(-2), deleted: false },
        now,
      ),
    ).toEqual([]);
  });
});
