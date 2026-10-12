import { and, eq, isNull, lt, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { matters } from "@/db/schema";
import { aiCall } from "@/lib/ai/call";
import { execute } from "@/lib/commands/execute";
import { enqueueSafely, QUEUES } from "@/lib/jobs/queue";
import { applySummary } from "@/modules/matters/commands/summary";
import {
  B7_PROMPT_VERSION,
  B7_SYSTEM,
  b7Output,
  summaryContext,
  validTimeline,
} from "@/modules/matters/summary";
import { automationEnabled } from "@/modules/messaging/commands/outbox";
import { jobContext } from "../context";

export type SummaryTrigger = "on_demand" | "weekly" | "document";

export async function enqueueSummary(matterId: string, trigger: SummaryTrigger): Promise<void> {
  await enqueueSafely(
    QUEUES.matterSummary,
    { matterId, trigger },
    { singletonKey: `${matterId}:${trigger}` },
  );
}

/** B7 for one matter: model summary with cited timeline, or a summary straight from records. */
export async function runSummary(matterId: string, trigger: SummaryTrigger): Promise<void> {
  const db = getDb();
  if (!(await automationEnabled(db, "B7"))) return;
  const c = await summaryContext(db, matterId);
  if (!c) return;
  const ai = await aiCall({
    purpose: "matters.summary",
    automationId: "B7",
    promptVersion: B7_PROMPT_VERSION,
    tier: "standard",
    effort: "medium",
    maxTokens: 4_000,
    system: B7_SYSTEM,
    messages: [{ role: "user", content: c.prompt }],
    schema: b7Output,
    entity: { type: "matter", id: matterId },
  });
  const { principal, request } = jobContext(QUEUES.matterSummary, matterId);
  await execute(
    applySummary,
    principal,
    ai.ok
      ? {
          matterId,
          summary: ai.output.summary,
          timeline: validTimeline(ai.output.timeline, c.known),
          aiRunId: ai.runId,
          trigger,
        }
      : { matterId, summary: c.fallbackSummary, timeline: c.fallback, aiRunId: null, trigger },
    { request },
  );
}

/** Weekly B7 for open matters not summarized in the last 6 days. */
export const MATTER_WEEKLY_CRON = "20 6 * * 1";
export async function runWeeklySummaries(): Promise<number> {
  const db = getDb();
  const stale = new Date(Date.now() - 6 * 86_400_000);
  const rows = await db
    .select({ id: matters.id })
    .from(matters)
    .where(
      and(
        eq(matters.status, "open"),
        isNull(matters.deletedAt),
        or(isNull(matters.summaryUpdatedAt), lt(matters.summaryUpdatedAt, stale)),
      ),
    );
  for (const r of rows) await runSummary(r.id, "weekly");
  return rows.length;
}
