import { createHash, timingSafeEqual, verify } from "node:crypto";
import type { WebhookAuthMethod } from "@/db/schema";
import { GHL_SIGNATURE_HEADER, LEXDESK_SECRET_HEADER } from "./endpoints";

/*
 * Inbound webhook authentication (spec Section 2: "verify signature").
 * Two delivery paths reach the same endpoint (ADR 0006):
 *
 * 1. Marketplace app events carry `x-wh-signature`: an RSA SHA-256 signature
 *    of the raw body, verified with GHL's published public key.
 * 2. The snapshot's workflow Custom Webhook actions cannot sign, so they send
 *    the firm's GHL_WEBHOOK_SECRET in `x-lexdesk-webhook-secret` over TLS.
 */

export type WebhookAuthConfig = {
  sharedSecret?: string;
  publicKey: string;
};

export type WebhookAuthResult =
  { ok: true; method: Exclude<WebhookAuthMethod, "demo"> } | { ok: false; reason: string };

function sameSecret(given: string, expected: string): boolean {
  // Hash both sides so the comparison is constant-time regardless of length.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function verifyGhlSignature(rawBody: string, signature: string, publicKey: string): boolean {
  try {
    return verify(
      "sha256",
      Buffer.from(rawBody, "utf8"),
      publicKey,
      Buffer.from(signature.trim(), "base64"),
    );
  } catch {
    return false;
  }
}

export function authenticateWebhook(
  headers: Headers,
  rawBody: string,
  config: WebhookAuthConfig,
): WebhookAuthResult {
  const secret = headers.get(LEXDESK_SECRET_HEADER);
  if (secret !== null) {
    if (!config.sharedSecret) return { ok: false, reason: "shared secret not configured" };
    return sameSecret(secret, config.sharedSecret)
      ? { ok: true, method: "shared_secret" }
      : { ok: false, reason: "shared secret mismatch" };
  }
  const signature = headers.get(GHL_SIGNATURE_HEADER);
  if (signature !== null) {
    return verifyGhlSignature(rawBody, signature, config.publicKey)
      ? { ok: true, method: "signature" }
      : { ok: false, reason: "signature invalid" };
  }
  return { ok: false, reason: "no credentials" };
}

/** GHL's webhookId when present; otherwise the body hash, so identical replays collapse. */
export function webhookDedupeKey(payload: Record<string, unknown>, rawBody: string): string {
  const id = payload.webhookId;
  if (typeof id === "string" && id.trim()) return `ghl:webhook:${id.trim()}`;
  return `ghl:sha256:${createHash("sha256").update(rawBody).digest("hex")}`;
}
