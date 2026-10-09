/**
 * Client IP as seen by the app. Render terminates TLS and appends the client
 * address to X-Forwarded-For; the left-most entry is the original client.
 */
export function clientIpFromHeaders(h: Headers): string | null {
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip");
}
