import { describe, expect, it } from "vitest";
import { classifyCall, normalizeGhlEvent, sanitizeWebhookPayload } from "./events";

describe("call classification", () => {
  it.each([
    ["completed", "completed", "answered"],
    ["voicemail", "voicemail", "voicemail"],
    ["voicemail", null, "voicemail"],
    ["no-answer", "no-answer", "missed"],
    ["busy", null, "missed"],
    [null, null, "missed"],
  ] as const)("status %s / callStatus %s -> %s", (status, callStatus, expected) => {
    expect(classifyCall(status, callStatus)).toBe(expected);
  });
});

describe("event normalization (documented GHL event shapes)", () => {
  it("InboundMessage with messageType CALL is a call, using direction rather than type", () => {
    // GHL's own example labels an inbound call "OutboundMessage" with direction "inbound".
    const e = normalizeGhlEvent({
      type: "OutboundMessage",
      locationId: "l1",
      contactId: "c1",
      direction: "inbound",
      messageType: "CALL",
      messageId: "m1",
      status: "voicemail",
      dateAdded: "2024-05-08T12:00:56.193Z",
    });
    expect(e).toMatchObject({
      kind: "call",
      call: { sourceId: "m1", direction: "inbound", outcome: "voicemail" },
    });
  });

  it("an SMS is a message on the sms channel; a call without an id is ignored", () => {
    expect(
      normalizeGhlEvent({
        type: "InboundMessage",
        contactId: "c1",
        messageType: "SMS",
        direction: "inbound",
      }),
    ).toMatchObject({ kind: "message", channel: "sms", direction: "inbound" });
    expect(
      normalizeGhlEvent({
        type: "InboundMessage",
        contactId: "c1",
        messageType: "CALL",
        direction: "inbound",
      }),
    ).toMatchObject({ kind: "ignored" });
  });

  it("contact, opportunity and appointment events map to upserts and deletes", () => {
    expect(normalizeGhlEvent({ type: "ContactCreate", id: "c1", email: "A@B.test" })).toMatchObject(
      {
        kind: "contact.upsert",
        contact: { id: "c1" },
      },
    );
    expect(normalizeGhlEvent({ type: "ContactDelete", id: "c1" })).toEqual({
      kind: "contact.delete",
      contactId: "c1",
    });
    expect(
      normalizeGhlEvent({
        type: "OpportunityStatusUpdate",
        id: "o1",
        contactId: "c1",
        status: "won",
      }),
    ).toMatchObject({ kind: "opportunity.upsert", opportunity: { status: "won" } });
    expect(
      normalizeGhlEvent({
        type: "AppointmentUpdate",
        appointment: {
          id: "a1",
          contactId: "c1",
          appointmentStatus: "noshow",
          startTime: "2026-10-20T15:00:00Z",
        },
      }),
    ).toMatchObject({ kind: "appointment.upsert", appointment: { appointmentStatus: "noshow" } });
    expect(normalizeGhlEvent({ type: "AppointmentDelete", appointment: { id: "a1" } })).toEqual({
      kind: "appointment.delete",
      appointmentId: "a1",
    });
  });

  it("never parses a date of birth or SSN out of a contact", () => {
    const e = normalizeGhlEvent({
      type: "ContactCreate",
      id: "c1",
      dateOfBirth: "1980-01-01",
      ssn: "123456789",
    });
    expect(JSON.stringify(e)).not.toMatch(/1980|123456789/);
  });

  it("LexDesk workflow events: missed call without a call id gets a per-minute id", () => {
    const e = normalizeGhlEvent({
      type: "LexDeskMissedCall",
      contactId: "c1",
      occurredAt: "2026-10-10T15:04:31Z",
      firstName: "Ana",
    });
    expect(e).toMatchObject({
      kind: "call",
      call: { sourceId: "workflow:c1:2026-10-10T15:04", outcome: "missed" },
      contactHint: { firstName: "Ana" },
    });
  });

  it("LexDesk form events read the consent checkbox in the forms GHL sends it", () => {
    for (const [value, expected] of [
      ["Yes", true],
      ["checked", true],
      [true, true],
      ["", false],
      [undefined, false],
    ] as const) {
      const e = normalizeGhlEvent({
        type: "LexDeskFormSubmitted",
        contactId: "c1",
        smsOptIn: value,
      });
      expect(e.kind === "form" && e.form.smsOptIn).toBe(expected);
    }
  });

  it("unknown types are ignored with a reason", () => {
    expect(normalizeGhlEvent({ type: "InvoicePaid" })).toEqual({
      kind: "ignored",
      reason: "unhandled event type InvoicePaid",
    });
  });
});

describe("payload sanitizing (rule 6)", () => {
  it("drops message text, notes and custom field values; redacts identifiers", () => {
    const out = sanitizeWebhookPayload({
      type: "ContactCreate",
      id: "c1",
      dateOfBirth: "1980-01-01",
      ssn: "123-45-6789",
      body: "call me about my levy",
      customFields: [{ id: "x", value: "secret" }],
      appointment: { id: "a1", notes: "private" },
      phone: "+12145550100",
    });
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/1980|123-45|levy|secret|private/);
    expect(out).toMatchObject({ id: "c1", phone: "+12145550100", dateOfBirth: "[REDACTED]" });
  });
});
