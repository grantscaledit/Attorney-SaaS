import { randomUUID } from "node:crypto";
import { clientIpFromHeaders } from "@/lib/auth/client-ip";
import type { Principal } from "@/lib/commands/define";
import { execute } from "@/lib/commands/execute";
import { env } from "@/lib/env";
import { GHL_WEBHOOK_PUBLIC_KEY } from "@/lib/ghl/endpoints";
import { sanitizeWebhookPayload } from "@/lib/ghl/events";
import { authenticateWebhook, webhookDedupeKey } from "@/lib/ghl/webhook-auth";
import { enqueueSafely, QUEUES } from "@/lib/jobs/queue";
import { log } from "@/lib/log";
import { ingestGhlWebhook } from "./commands/ingest-webhook";

export const WEBHOOK_PRINCIPAL: Principal = { type: "system", label: "ghl.webhook" };

/** GHL payloads are small JSON documents; anything larger is not one of them. */
const MAX_BODY_BYTES = 512 * 1024;

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/**
 * Inbound GHL webhook (spec Section 2): authenticate, store the sanitized
 * payload in webhook_events, enqueue processing, return 200. Nothing slow
 * happens here, so GHL never times out and retries a delivery we accepted.
 */
export async function handleGhlWebhook(request: Request): Promise<Response> {
  const e = env();
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const meta = {
    ip: clientIpFromHeaders(request.headers),
    userAgent: request.headers.get("user-agent"),
    requestId,
  };

  // Rule 12: a demo deployment never accepts traffic from a live GHL account.
  if (e.DEMO_MODE) return json(404, { error: "not found" });

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json(413, { error: "payload too large" });
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) return json(413, { error: "payload too large" });

  const auth = authenticateWebhook(request.headers, rawBody, {
    sharedSecret: e.GHL_WEBHOOK_SECRET,
    publicKey: e.GHL_WEBHOOK_PUBLIC_KEY?.replace(/\\n/g, "\n") ?? GHL_WEBHOOK_PUBLIC_KEY,
  });
  if (!auth.ok) {
    log.warn("ghl webhook rejected", { reason: auth.reason, ip: meta.ip, requestId });
    return json(401, { error: "unauthorized" });
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("not an object");
    payload = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: "body must be a JSON object" });
  }

  // A delivery for another sub-account must never touch this firm's records (spec Section 4: isolation).
  const locationId = typeof payload.locationId === "string" ? payload.locationId : null;
  if (locationId && e.GHL_LOCATION_ID && locationId !== e.GHL_LOCATION_ID) {
    log.warn("ghl webhook for another location rejected", { requestId });
    return json(403, { error: "wrong location" });
  }

  const eventType =
    typeof payload.type === "string" && payload.type.trim()
      ? payload.type.trim().slice(0, 100)
      : "unknown";
  const { eventId, duplicate } = await execute(
    ingestGhlWebhook,
    WEBHOOK_PRINCIPAL,
    {
      dedupeKey: webhookDedupeKey(payload, rawBody),
      eventType,
      authMethod: auth.method,
      locationId,
      payload: sanitizeWebhookPayload(payload),
    },
    { request: meta },
  );

  if (!duplicate) {
    await enqueueSafely(QUEUES.ghlWebhook, { eventId }, { singletonKey: eventId });
  }
  log.info("ghl webhook accepted", { eventType, duplicate, requestId });
  return json(200, { ok: true, duplicate });
}
