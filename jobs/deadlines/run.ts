import { execute } from "@/lib/commands/execute";
import { QUEUES } from "@/lib/jobs/queue";
import {
  escalateDeadlineAlerts,
  runDeadlineAudit,
  runDeadlinesDaily,
} from "@/modules/deadlines/commands/automations";
import { jobContext } from "../context";

/*
 * Deadline jobs (C2, C3, C5, C7). Each one is a single system command, so a
 * run is all-or-nothing and audited.
 */

/** 6:50 firm time: alerts are in place before the 7am daily brief (G1). */
export const DEADLINES_DAILY_CRON = "50 6 * * *";
/** Hourly: critical alerts nobody acknowledged escalate (C2). */
export const DEADLINES_ESCALATE_CRON = "15 * * * *";
/** Monday 7:20 firm time (C7). */
export const DEADLINES_WEEKLY_CRON = "20 7 * * 1";

export async function runDeadlinesDailyJob(today?: string) {
  const { principal, request } = jobContext(QUEUES.deadlinesDaily);
  return execute(runDeadlinesDaily, principal, { today }, { request });
}

export async function escalateDeadlinesJob(now?: Date) {
  const { principal, request } = jobContext(QUEUES.deadlinesEscalate);
  return execute(escalateDeadlineAlerts, principal, { now: now?.toISOString() }, { request });
}

export async function runDeadlineAuditJob(now?: Date) {
  const { principal, request } = jobContext(QUEUES.deadlinesWeekly);
  return execute(runDeadlineAudit, principal, { now: now?.toISOString() }, { request });
}
