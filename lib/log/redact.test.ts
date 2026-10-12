import { describe, expect, it } from "vitest";
import { REDACTED, isSensitiveKey, redact } from "./redact";

describe("isSensitiveKey", () => {
  it.each([
    "password",
    "newPassword",
    "AUTH_SECRET",
    "sessionToken",
    "backupCodes",
    "ssn",
    "client_ssn",
    "ein",
    "dateOfBirth",
    "dob",
    "bank_account_number",
    "cardNumber",
    "Authorization",
  ])("redacts %s", (key) => expect(isSensitiveKey(key)).toBe(true));

  it.each([
    "name",
    "email",
    "role",
    "displayName",
    "timezone",
    "practiceAreas",
    "einstein",
    "tokenizedAt",
  ])("keeps %s", (key) => expect(isSensitiveKey(key)).toBe(false));
});

describe("redact", () => {
  it("redacts nested keys and leaves the rest", () => {
    const input = {
      user: { name: "A", password: "p" },
      list: [{ ssn: "123-45-6789", ok: 1 }],
      when: new Date(0),
    };
    expect(redact(input)).toEqual({
      user: { name: "A", password: REDACTED },
      list: [{ ssn: REDACTED, ok: 1 }],
      when: new Date(0),
    });
  });

  it("does not mutate its input", () => {
    const input = { password: "p" };
    redact(input);
    expect(input.password).toBe("p");
  });

  it("passes primitives through", () => {
    expect(redact("x")).toBe("x");
    expect(redact(null)).toBeNull();
  });
});
