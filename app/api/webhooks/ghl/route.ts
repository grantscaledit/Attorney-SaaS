import { handleGhlWebhook } from "@/modules/ghl/ingest";

export const dynamic = "force-dynamic";

/**
 * GoHighLevel webhooks. Not session-authenticated: handleGhlWebhook verifies
 * the shared secret or GHL's signature before anything is stored.
 */
export async function POST(request: Request): Promise<Response> {
  return handleGhlWebhook(request);
}
