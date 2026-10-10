import { env } from "@/lib/env";
import { execute } from "@/lib/commands/execute";
import { CommandError } from "@/lib/commands/errors";
import { getGhlClient, GhlApiError } from "@/lib/ghl/client";
import { enqueueSafely, QUEUES } from "@/lib/jobs/queue";
import { log } from "@/lib/log";
import { textToHtml } from "@/lib/messaging/html";
import { claimMessage, recordSendResult } from "@/modules/messaging/commands/outbox";
import type { QueuedMessage } from "@/modules/intake/commands/automations";
import { jobContext } from "../context";

type Outcome = {
  outcome: "sent" | "simulated" | "failed" | "unknown";
  ghlMessageId?: string | null;
  retryable?: boolean;
  error?: string;
};

/**
 * Sends one outbox message: claim (re-checks every rule) -> GHL -> record.
 * At most once: only a definite "not processed" answer from GHL is retried.
 */
export async function sendMessageJob(
  messageId: string,
): Promise<Outcome["outcome"] | "skipped" | "waiting"> {
  const { principal, request } = jobContext(QUEUES.messageSend, messageId);
  let claim;
  try {
    claim = await execute(claimMessage, principal, { messageId }, { request });
  } catch (err) {
    if (err instanceof CommandError && err.code === "not_found") return "skipped";
    throw err;
  }
  if (claim.action === "skip") return "skipped";
  if (claim.action === "wait") {
    await enqueueSafely(
      QUEUES.messageSend,
      { messageId },
      { startAfter: claim.until, singletonKey: messageId },
    );
    return "waiting";
  }

  let result: Outcome;
  if (env().DEMO_MODE) {
    // Rule 12: recorded exactly as a send would be, but nothing leaves the system.
    result = { outcome: "simulated" };
  } else {
    const client = getGhlClient();
    if (!client) {
      result = { outcome: "failed", error: "GoHighLevel is not connected" };
    } else {
      try {
        const r =
          claim.channel === "sms"
            ? await client.sendMessage({
                channel: "sms",
                contactId: claim.ghlContactId,
                message: claim.body,
              })
            : await client.sendMessage({
                channel: "email",
                contactId: claim.ghlContactId,
                subject: claim.subject ?? "",
                message: claim.body,
                html: textToHtml(claim.body),
              });
        result = { outcome: "sent", ghlMessageId: r.messageId };
      } catch (err) {
        if (err instanceof GhlApiError) {
          result = err.ambiguous
            ? { outcome: "unknown", error: err.message }
            : { outcome: "failed", retryable: err.status === 429, error: err.message };
        } else {
          // Failed before or after the request left: cannot tell, so do not resend.
          result = { outcome: "unknown", error: err instanceof Error ? err.message : String(err) };
        }
      }
    }
  }

  const recorded = await execute(
    recordSendResult,
    principal,
    { messageId, ...result },
    { request },
  );
  if (recorded.retryAt) {
    await enqueueSafely(
      QUEUES.messageSend,
      { messageId },
      { startAfter: recorded.retryAt, singletonKey: `${messageId}:${recorded.retryAt.getTime()}` },
    );
  }
  if (result.outcome === "unknown" || result.outcome === "failed") {
    log.warn("message not sent", { messageId, outcome: result.outcome, error: result.error });
  }
  return result.outcome;
}

/** Sends what is due now inline (the 60-second path) and schedules the rest. */
export async function dispatchQueued(queued: readonly QueuedMessage[]): Promise<void> {
  for (const m of queued) {
    if (m.status !== "queued") continue;
    const due = !m.scheduledFor || m.scheduledFor.getTime() <= Date.now() + 1_000;
    if (due) {
      try {
        await sendMessageJob(m.messageId);
      } catch (err) {
        // The sweep retries queued messages that are due.
        log.error("inline send failed", { messageId: m.messageId, err });
      }
    } else {
      await enqueueSafely(
        QUEUES.messageSend,
        { messageId: m.messageId },
        {
          startAfter: m.scheduledFor!,
          singletonKey: m.messageId,
        },
      );
    }
  }
}
