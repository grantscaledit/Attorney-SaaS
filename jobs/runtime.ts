import { PgBoss } from "pg-boss";
import { setJobQueue, QUEUES, type JobQueue } from "@/lib/jobs/queue";
import { DRAFT_KINDS, type DraftKind } from "@/modules/matters/drafts";
import { log } from "@/lib/log";
import { runA3 } from "./automations/A3";
import {
  DEADLINES_DAILY_CRON,
  DEADLINES_ESCALATE_CRON,
  DEADLINES_WEEKLY_CRON,
  escalateDeadlinesJob,
  runDeadlineAuditJob,
  runDeadlinesDailyJob,
} from "./deadlines/run";
import { processDocument } from "./documents/process";
import { MATTERS_DAILY_CRON, runDraft, runMattersDaily, runStatusUpdate } from "./matters/drafts";
import { MATTER_WEEKLY_CRON, runSummary, runWeeklySummaries } from "./matters/summary";
import { A8_CRON, INTAKE_DAILY_CRON, runA8, runIntakeDaily } from "./automations/followups";
import { GHL_RECONCILE_CRON, reconcileGhl } from "./ghl/reconcile";
import { processWebhookJob } from "./ghl/process-webhook";
import { sendMessageJob } from "./messaging/send";
import {
  AUDIT_CHAIN_VERIFY,
  AUDIT_CHAIN_VERIFY_CRON,
  auditChainVerify,
} from "./system/audit-chain-verify";
import { SWEEP_CRON, sweep } from "./system/sweep";

type Data = Record<string, unknown>;

const isDraftKind = (k: string): k is DraftKind => k in DRAFT_KINDS;

function stringField(data: unknown, key: string): string {
  const v = (data as Data | null)?.[key];
  if (typeof v !== "string") throw new Error(`job data is missing ${key}`);
  return v;
}

export type StartOptions = {
  connectionString: string;
  timezone: string;
  /** Register cron schedules (off in tests). */
  schedules?: boolean;
  pollingIntervalSeconds?: number;
};

/**
 * Starts pg-boss, creates every queue, registers handlers and schedules, and
 * installs the started instance as the process's job queue. Used by the
 * worker process and by integration tests that exercise the real queue.
 */
export async function startJobs(options: StartOptions): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: options.connectionString,
    schema: "pgboss",
    application_name: "lexdesk-worker",
  });
  boss.on("error", (err: unknown) => log.error("pg-boss error", { err }));
  await boss.start();

  const polling = { pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2 };
  const queues = [
    AUDIT_CHAIN_VERIFY,
    QUEUES.ghlWebhook,
    QUEUES.ghlReconcile,
    QUEUES.messageSend,
    QUEUES.sweep,
    QUEUES.A3,
    QUEUES.A8,
    QUEUES.intakeDaily,
    QUEUES.documentProcess,
    QUEUES.matterSummary,
    QUEUES.matterStatusUpdate,
    QUEUES.matterDraft,
    QUEUES.mattersDaily,
    QUEUES.mattersWeekly,
    QUEUES.deadlinesDaily,
    QUEUES.deadlinesEscalate,
    QUEUES.deadlinesWeekly,
  ];
  // Handlers never rely on pg-boss retries: webhooks and sends carry their own retry state.
  for (const q of queues) await boss.createQueue(q, { retryLimit: 0 });

  await boss.work(QUEUES.ghlWebhook, polling, async ([job]) => {
    if (job) await processWebhookJob(stringField(job.data, "eventId"));
  });
  await boss.work(QUEUES.messageSend, polling, async ([job]) => {
    if (job) await sendMessageJob(stringField(job.data, "messageId"));
  });
  await boss.work(QUEUES.A3, polling, async ([job]) => {
    if (job) await runA3(stringField(job.data, "leadId"), stringField(job.data, "messageId"));
  });
  await boss.work(QUEUES.A8, async () => {
    await runA8();
  });
  await boss.work(QUEUES.intakeDaily, async () => {
    await runIntakeDaily();
  });
  await boss.work(QUEUES.documentProcess, polling, async ([job]) => {
    if (job) await processDocument(stringField(job.data, "documentId"));
  });
  await boss.work(QUEUES.matterSummary, polling, async ([job]) => {
    if (job) {
      const trigger = stringField(job.data, "trigger");
      await runSummary(
        stringField(job.data, "matterId"),
        trigger === "weekly" || trigger === "document" ? trigger : "on_demand",
      );
    }
  });
  await boss.work(QUEUES.matterStatusUpdate, polling, async ([job]) => {
    if (job) {
      const reason = stringField(job.data, "reason");
      await runStatusUpdate(
        stringField(job.data, "matterId"),
        reason === "no_contact" ? "no_contact" : "stage_change",
      );
    }
  });
  await boss.work(QUEUES.matterDraft, polling, async ([job]) => {
    if (!job) return;
    const kind = stringField(job.data, "kind");
    if (!isDraftKind(kind)) throw new Error(`unknown draft kind ${kind}`);
    await runDraft(stringField(job.data, "matterId"), kind, stringField(job.data, "requestedBy"));
  });
  await boss.work(QUEUES.mattersDaily, async () => {
    await runMattersDaily();
  });
  await boss.work(QUEUES.mattersWeekly, async () => {
    await runWeeklySummaries();
  });
  await boss.work(QUEUES.deadlinesDaily, async () => {
    await runDeadlinesDailyJob();
  });
  await boss.work(QUEUES.deadlinesEscalate, async () => {
    await escalateDeadlinesJob();
  });
  await boss.work(QUEUES.deadlinesWeekly, async () => {
    await runDeadlineAuditJob();
  });
  await boss.work(QUEUES.ghlReconcile, async () => {
    await reconcileGhl();
  });
  await boss.work(QUEUES.sweep, async () => {
    await sweep();
  });
  await boss.work(AUDIT_CHAIN_VERIFY, async () => {
    await auditChainVerify();
  });

  if (options.schedules !== false) {
    const tz = { tz: options.timezone };
    await boss.schedule(AUDIT_CHAIN_VERIFY, AUDIT_CHAIN_VERIFY_CRON, null, tz);
    await boss.schedule(QUEUES.ghlReconcile, GHL_RECONCILE_CRON, null, tz);
    await boss.schedule(QUEUES.sweep, SWEEP_CRON, null, tz);
    await boss.schedule(QUEUES.A8, A8_CRON, null, tz);
    await boss.schedule(QUEUES.intakeDaily, INTAKE_DAILY_CRON, null, tz);
    await boss.schedule(QUEUES.mattersDaily, MATTERS_DAILY_CRON, null, tz);
    await boss.schedule(QUEUES.mattersWeekly, MATTER_WEEKLY_CRON, null, tz);
    await boss.schedule(QUEUES.deadlinesDaily, DEADLINES_DAILY_CRON, null, tz);
    await boss.schedule(QUEUES.deadlinesEscalate, DEADLINES_ESCALATE_CRON, null, tz);
    await boss.schedule(QUEUES.deadlinesWeekly, DEADLINES_WEEKLY_CRON, null, tz);
  }

  const queue: JobQueue = {
    async send(name, data, opts = {}) {
      await boss.send(name, data, { startAfter: opts.startAfter, singletonKey: opts.singletonKey });
    },
  };
  setJobQueue(queue);
  log.info("jobs started", { queues, timezone: options.timezone });
  return boss;
}
