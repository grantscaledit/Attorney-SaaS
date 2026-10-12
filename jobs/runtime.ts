import { PgBoss } from "pg-boss";
import { setJobQueue, QUEUES, type JobQueue } from "@/lib/jobs/queue";
import { log } from "@/lib/log";
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
  ];
  // Handlers never rely on pg-boss retries: webhooks and sends carry their own retry state.
  for (const q of queues) await boss.createQueue(q, { retryLimit: 0 });

  await boss.work(QUEUES.ghlWebhook, polling, async ([job]) => {
    if (job) await processWebhookJob(stringField(job.data, "eventId"));
  });
  await boss.work(QUEUES.messageSend, polling, async ([job]) => {
    if (job) await sendMessageJob(stringField(job.data, "messageId"));
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
