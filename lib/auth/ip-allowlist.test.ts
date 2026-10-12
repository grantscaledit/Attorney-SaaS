import { describe, expect, it } from "vitest";
import { isIpAllowed, isValidAllowlistEntry } from "./ip-allowlist";

describe("isIpAllowed", () => {
  it("allows everything when the list is empty", () => {
    expect(isIpAllowed("198.51.100.7", [])).toBe(true);
    expect(isIpAllowed(null, [])).toBe(true);
  });

  it("matches single addresses and CIDR ranges", () => {
    const list = ["203.0.113.5", "198.51.100.0/24", "2001:db8::/32"];
    expect(isIpAllowed("203.0.113.5", list)).toBe(true);
    expect(isIpAllowed("203.0.113.6", list)).toBe(false);
    expect(isIpAllowed("198.51.100.200", list)).toBe(true);
    expect(isIpAllowed("198.51.101.1", list)).toBe(false);
    expect(isIpAllowed("2001:db8:1::1", list)).toBe(true);
    expect(isIpAllowed("2001:db9::1", list)).toBe(false);
  });

  it("applies IPv4 rules to IPv4-mapped IPv6 addresses", () => {
    expect(isIpAllowed("::ffff:198.51.100.9", ["198.51.100.0/24"])).toBe(true);
  });

  it("denies unknown or malformed client addresses when a list is set", () => {
    expect(isIpAllowed(null, ["198.51.100.0/24"])).toBe(false);
    expect(isIpAllowed("not-an-ip", ["198.51.100.0/24"])).toBe(false);
  });
});

describe("isValidAllowlistEntry", () => {
  it.each(["10.0.0.1", "10.0.0.0/8", "2001:db8::/32", "::1"])("accepts %s", (e) =>
    expect(isValidAllowlistEntry(e)).toBe(true),
  );
  it.each(["10.0.0.0/33", "300.1.1.1", "10.0.0.0/x", "", "example.com"])("rejects %s", (e) =>
    expect(isValidAllowlistEntry(e)).toBe(false),
  );
});
