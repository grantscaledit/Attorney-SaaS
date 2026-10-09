import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FieldCipher, lastFour } from "./field";

const key = randomBytes(32).toString("base64");

describe("FieldCipher", () => {
  const cipher = new FieldCipher(key);

  it("round-trips", () => {
    const ct = cipher.encrypt("123-45-6789", "contacts.ssn:1");
    expect(ct.startsWith("v1.")).toBe(true);
    expect(ct).not.toContain("6789");
    expect(cipher.decrypt(ct, "contacts.ssn:1")).toBe("123-45-6789");
  });

  it("uses a fresh IV per value", () => {
    expect(cipher.encrypt("x", "a")).not.toBe(cipher.encrypt("x", "a"));
  });

  it("rejects a ciphertext moved to another row (AAD mismatch)", () => {
    const ct = cipher.encrypt("secret", "contacts.ssn:1");
    expect(() => cipher.decrypt(ct, "contacts.ssn:2")).toThrow();
  });

  it("rejects tampered ciphertext", () => {
    const ct = cipher.encrypt("secret", "a");
    const parts = ct.split(".");
    const body = Buffer.from(parts[3]!, "base64url");
    body[0] = body[0]! ^ 0xff;
    parts[3] = body.toString("base64url");
    expect(() => cipher.decrypt(parts.join("."), "a")).toThrow();
  });

  it("rejects the wrong key", () => {
    const other = new FieldCipher(randomBytes(32).toString("base64"));
    expect(() => other.decrypt(cipher.encrypt("x", "a"), "a")).toThrow();
  });

  it("refuses short keys", () => {
    expect(() => new FieldCipher(randomBytes(16).toString("base64"))).toThrow();
  });
});

describe("lastFour", () => {
  it.each([
    ["123-45-6789", "•••• 6789"],
    ["12-3456789", "•••• 6789"],
    ["4111 1111 1111 1234", "•••• 1234"],
    ["123", "•••"],
  ])("%s -> %s", (input, expected) => expect(lastFour(input)).toBe(expected));
});
