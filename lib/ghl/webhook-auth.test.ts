import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GHL_WEBHOOK_PUBLIC_KEY } from "./endpoints";
import { authenticateWebhook, verifyGhlSignature, webhookDedupeKey } from "./webhook-auth";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
const body = JSON.stringify({ type: "ContactCreate", id: "c1", webhookId: "wh_1" });
const signature = sign("sha256", Buffer.from(body), privateKey).toString("base64");
const SECRET = "s".repeat(40);

const headers = (h: Record<string, string>) => new Headers(h);

describe("webhook authentication", () => {
  it("verifies an RSA SHA-256 signature of the raw body", () => {
    expect(verifyGhlSignature(body, signature, pem)).toBe(true);
    expect(verifyGhlSignature(body + " ", signature, pem)).toBe(false);
    expect(verifyGhlSignature(body, "garbage", pem)).toBe(false);
    expect(verifyGhlSignature(body, signature, "not a key")).toBe(false);
  });

  it("ships GHL's published key as a parseable PEM", () => {
    expect(GHL_WEBHOOK_PUBLIC_KEY).toMatch(/^-----BEGIN PUBLIC KEY-----/);
    // A signature from another key never verifies against GHL's key.
    expect(verifyGhlSignature(body, signature, GHL_WEBHOOK_PUBLIC_KEY)).toBe(false);
  });

  it("accepts the shared secret header and rejects a wrong or unconfigured secret", () => {
    const cfg = { sharedSecret: SECRET, publicKey: pem };
    expect(authenticateWebhook(headers({ "x-lexdesk-webhook-secret": SECRET }), body, cfg)).toEqual(
      {
        ok: true,
        method: "shared_secret",
      },
    );
    expect(authenticateWebhook(headers({ "x-lexdesk-webhook-secret": "nope" }), body, cfg).ok).toBe(
      false,
    );
    expect(
      authenticateWebhook(headers({ "x-lexdesk-webhook-secret": SECRET }), body, { publicKey: pem })
        .ok,
    ).toBe(false);
  });

  it("accepts a valid x-wh-signature and rejects requests with no credentials", () => {
    const cfg = { sharedSecret: SECRET, publicKey: pem };
    expect(authenticateWebhook(headers({ "x-wh-signature": signature }), body, cfg)).toEqual({
      ok: true,
      method: "signature",
    });
    expect(authenticateWebhook(headers({}), body, cfg)).toEqual({
      ok: false,
      reason: "no credentials",
    });
  });

  it("dedupes on webhookId, else on the exact body", () => {
    expect(webhookDedupeKey({ webhookId: "wh_1" }, body)).toBe("ghl:webhook:wh_1");
    const a = webhookDedupeKey({}, '{"a":1}');
    expect(a).toBe(webhookDedupeKey({}, '{"a":1}'));
    expect(a).not.toBe(webhookDedupeKey({}, '{"a":2}'));
  });
});
