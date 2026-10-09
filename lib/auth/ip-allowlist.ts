import { BlockList, isIP } from "node:net";

/**
 * Optional per-firm IP allowlist (spec Section 4: "IP allowlist option").
 * Entries are single addresses or CIDR ranges, IPv4 or IPv6. An empty list
 * allows every address.
 */
export function parseAllowlistEntry(entry: string): { address: string; prefix: number; family: "ipv4" | "ipv6" } | null {
  const [address, prefixRaw] = entry.trim().split("/");
  if (!address) return null;
  const version = isIP(address);
  if (version === 0) return null;
  const family = version === 4 ? "ipv4" : "ipv6";
  const max = version === 4 ? 32 : 128;
  const prefix = prefixRaw === undefined ? max : Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) return null;
  return { address, prefix, family };
}

export function isValidAllowlistEntry(entry: string): boolean {
  return parseAllowlistEntry(entry) !== null;
}

/** Unwraps IPv4-mapped IPv6 ("::ffff:203.0.113.5") so IPv4 rules apply. */
function normalizeIp(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return mapped?.[1] ?? ip;
}

export function isIpAllowed(ip: string | null, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return true;
  if (!ip) return false;
  const candidate = normalizeIp(ip);
  const version = isIP(candidate);
  if (version === 0) return false;
  const list = new BlockList();
  for (const entry of allowlist) {
    const parsed = parseAllowlistEntry(entry);
    if (parsed) list.addSubnet(parsed.address, parsed.prefix, parsed.family);
  }
  return list.check(candidate, version === 4 ? "ipv4" : "ipv6");
}
