import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

/**
 * Job queue names. Automation queues are named for their spec ID (A1, A7...);
 * the worker registers one handler file per queue under /jobs.
 */
export const QUEUES = {
  ghlWebhook: "ghl.webhook",
  ghlReconcile: "ghl.reconcile",
  messageSend: "messaging.send",
  sweep: "system.sweep",
  A1: "automation.A1",
  A2: "automation.A2",
  A3: "automation.A3",
  A7: "automation.A7",
  A8: "automation.A8",
  /** A10 nurture enrolment and A11 cold-lead letters. */
  intakeDaily: "automation.intake_daily",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export type EnqueueOptions = {
  /** Run no earlier than this. */
  startAfter?: Date;
  /** pg-boss drops a second queued job with the same key. */
  singletonKey?: string;
};

export interface JobQueue {
  send(name: QueueName, data: Record<string, unknown>, options?: EnqueueOptions): Promise<void>;
}

/** pg-boss sender for processes that only enqueue (the web app). The worker owns the schema. */
class PgBossSender implements JobQueue {
  private boss: Promise<PgBoss> | undefined;

  private start(): Promise<PgBoss> {
    this.boss ??= (async () => {
      const boss = new PgBoss({
        connectionString: env().DATABASE_URL,
        schema: "pgboss",
        application_name: "lexdesk-web",
        supervise: false,
        schedule: false,
        migrate: false,
        createSchema: false,
        max: 2,
      });
      boss.on("error", (err: unknown) => log.error("pg-boss sender error", { err }));
      await boss.start();
      return boss;
    })().catch((err: unknown) => {
      this.boss = undefined;
      throw err;
    });
    return this.boss;
  }

  async send(name: QueueName, data: Record<string, unknown>, options: EnqueueOptions = {}) {
    const boss = await this.start();
    await boss.send(name, data, {
      startAfter: options.startAfter,
      singletonKey: options.singletonKey,
    });
  }
}

const globalForQueue = globalThis as unknown as { __lexdeskQueue?: JobQueue };

export function getJobQueue(): JobQueue {
  globalForQueue.__lexdeskQueue ??= new PgBossSender();
  return globalForQueue.__lexdeskQueue;
}

/** The worker installs its started pg-boss instance; tests install a recorder. */
export function setJobQueue(queue: JobQueue | undefined): void {
  globalForQueue.__lexdeskQueue = queue;
}

/**
 * Enqueue without failing the caller. A lost enqueue is recovered by the
 * one-minute sweep (pending webhooks and due messages are re-enqueued), so
 * callers that already committed their row can carry on.
 */
export async function enqueueSafely(
  name: QueueName,
  data: Record<string, unknown>,
  options?: EnqueueOptions,
): Promise<boolean> {
  try {
    await getJobQueue().send(name, data, options);
    return true;
  } catch (err) {
    log.warn("enqueue failed; the sweep will pick it up", { queue: name, err });
    return false;
  }
}
