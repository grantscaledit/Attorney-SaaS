import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_VARIABLES,
  formatAppointmentTime,
  placeholdersIn,
  renderTemplate,
  unknownPlaceholders,
} from "./templates";

describe("message templates", () => {
  it("fills placeholders and uses fallbacks", () => {
    expect(renderTemplate("Hi {{firstName|there}}, {{firmName}}", { firmName: "Firm" })).toEqual({
      ok: true,
      text: "Hi there, Firm",
    });
    expect(renderTemplate("Hi {{ firstName | there }}", { firstName: "Ana" })).toEqual({
      ok: true,
      text: "Hi Ana",
    });
  });

  it("refuses to render when a required value is missing", () => {
    expect(renderTemplate("Book at {{bookingUrl}}", { bookingUrl: "  " })).toEqual({
      ok: false,
      missing: ["bookingUrl"],
    });
  });

  it("every default template uses only known placeholders and texts mention STOP where they start a thread", () => {
    for (const t of DEFAULT_TEMPLATES) {
      expect(unknownPlaceholders(t.body), t.key).toEqual([]);
      for (const p of placeholdersIn(t.body)) expect(p in TEMPLATE_VARIABLES).toBe(true);
    }
    for (const key of ["A1.sms", "A2.sms", "A7.confirmation.sms", "A7.no_show_followup.sms"]) {
      expect(DEFAULT_TEMPLATES.find((t) => t.key === key)!.body).toContain(
        "Reply STOP to opt out.",
      );
    }
  });

  it("the email acknowledgement says contact does not create a relationship (rule 5)", () => {
    const email = DEFAULT_TEMPLATES.find((t) => t.key === "A2.email")!;
    expect(email.body).toContain("does not create an attorney-client relationship");
  });

  it("formats consult times in the recipient's zone", () => {
    const at = new Date("2026-10-14T19:30:00Z");
    expect(formatAppointmentTime(at, "America/Chicago")).toBe("Wed, Oct 14 at 2:30 PM CDT");
  });
});
