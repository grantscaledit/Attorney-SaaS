import { describe, expect, it } from "vitest";
import { GhlApiError, GhlClient, backoffMs } from "./client";

function clientWith(responses: (number | "network")[]) {
  const seen: { url: string; init: RequestInit }[] = [];
  const client = new GhlClient({
    token: "tok",
    locationId: "loc1",
    sleep: async () => {},
    fetch: async (url, init) => {
      seen.push({ url, init });
      const next = responses.shift() ?? 200;
      if (next === "network") throw new TypeError("fetch failed");
      if (next === 200) {
        return Response.json(
          url.includes("/conversations/messages")
            ? { messageId: "m1", conversationId: "c1" }
            : { contact: { id: "c1", firstName: "Ana" } },
        );
      }
      return Response.json({ message: "x" }, { status: next, headers: { "retry-after": "1" } });
    },
  });
  return { client, seen };
}

describe("GHL client", () => {
  it("sends the bearer token and the per-resource Version header", async () => {
    const { client, seen } = clientWith([200, 200]);
    await client.getContact("c1");
    await client.sendMessage({ channel: "sms", contactId: "c1", message: "hi" });
    const h0 = seen[0]!.init.headers as Record<string, string>;
    const h1 = seen[1]!.init.headers as Record<string, string>;
    expect(h0).toMatchObject({ Authorization: "Bearer tok", Version: "2021-07-28" });
    expect(h1).toMatchObject({ Version: "2021-04-15", "Content-Type": "application/json" });
    expect(seen[0]!.url).toBe("https://services.leadconnectorhq.com/contacts/c1");
    expect(JSON.parse(String(seen[1]!.init.body))).toEqual({
      type: "SMS",
      contactId: "c1",
      message: "hi",
    });
  });

  it("retries reads on 429, 5xx and network errors", async () => {
    const { client, seen } = clientWith([429, 503, "network", 200]);
    await expect(client.getContact("c1")).resolves.toMatchObject({ id: "c1" });
    expect(seen).toHaveLength(4);
  });

  it("gives up on reads after the retry limit", async () => {
    const { client } = clientWith([500, 500, 500, 500, 500]);
    await expect(client.getContact("c1")).rejects.toBeInstanceOf(GhlApiError);
  });

  it("retries a send only on 429, which GHL did not process", async () => {
    const { client, seen } = clientWith([429, 200]);
    await expect(
      client.sendMessage({ channel: "sms", contactId: "c1", message: "hi" }),
    ).resolves.toMatchObject({
      messageId: "m1",
    });
    expect(seen).toHaveLength(2);
  });

  it("never retries a send that may have been applied, and says so", async () => {
    for (const r of [502, "network"] as const) {
      const { client, seen } = clientWith([r, 200]);
      const err = await client
        .sendMessage({ channel: "sms", contactId: "c1", message: "hi" })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(GhlApiError);
      expect((err as GhlApiError).ambiguous).toBe(true);
      expect(seen).toHaveLength(1);
    }
  });

  it("a 4xx on a send is a definite failure, not ambiguous", async () => {
    const { client } = clientWith([400]);
    const err = (await client
      .sendMessage({ channel: "sms", contactId: "c1", message: "hi" })
      .catch((e: unknown) => e)) as GhlApiError;
    expect(err.ambiguous).toBe(false);
    expect(err.status).toBe(400);
  });

  it("rejects a response that does not match the schema", async () => {
    const client = new GhlClient({
      token: "t",
      locationId: "l",
      sleep: async () => {},
      fetch: async () => Response.json({ unexpected: true }),
    });
    await expect(client.getContact("c1")).rejects.toThrow(/unexpected response/);
  });

  it("backs off exponentially and honours Retry-After", () => {
    expect(backoffMs(0, "2")).toBe(2000);
    expect(backoffMs(10)).toBeLessThanOrEqual(8000);
    expect(backoffMs(1)).toBeGreaterThanOrEqual(1000);
  });
});
