"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { runCommand, type ActionState } from "@/lib/commands/action";
import type { Command } from "@/lib/commands/define";
import { createCalendarFeed, revokeCalendarFeed } from "@/modules/deadlines/commands/calendar";
import {
  acknowledgeAlerts,
  addDeadline,
  addTolling,
  assignDeadline,
  endPaymentPlan,
  moveDeadline,
  recordEvent,
  removeEvent,
  removeTolling,
  setDeadlineStatus,
  setPaymentPlan,
  updateEvent,
} from "@/modules/deadlines/commands/deadlines";
import {
  addFederalHolidays,
  addHoliday,
  removeHoliday,
  revokeRuleVerification,
  setRuleActive,
  syncDeadlineRules,
  updateDeadlineRule,
  verifyDeadlineRule,
} from "@/modules/deadlines/commands/rules";

/*
 * Server actions for deadlines. Each one runs one command (permissions,
 * audit and validation live there) and refreshes the screens that show it.
 */

type State = ActionState<unknown>;

function refresh(matterId?: string) {
  if (matterId) revalidatePath(`/matters/${matterId}`);
  revalidatePath("/deadlines");
  revalidatePath("/settings/deadline-rules", "layout");
  revalidatePath("/", "layout");
}

async function go<S extends z.ZodType, R>(
  command: Command<S, R>,
  input: unknown,
  message: string,
  matterId?: string,
): Promise<State> {
  const r = await runCommand(command, input, { successMessage: message });
  if (r.status === "success") refresh(matterId);
  return r;
}

// ------------------------------------------------------------- matter --

export async function recordEventAction(
  matterId: string,
  input: {
    kind: string;
    occurredOn: string;
    noticeType: string | null;
    flags: Record<string, boolean>;
  },
): Promise<State> {
  const r = await runCommand(recordEvent, { matterId, ...input, note: null });
  if (r.status !== "success") return r;
  refresh(matterId);
  const d = r.data as { computed: number; unverified: number };
  return {
    ...r,
    message:
      d.unverified > 0
        ? `Event recorded. ${d.unverified} rule${d.unverified === 1 ? " is" : "s are"} not verified, so no date was computed from ${d.unverified === 1 ? "it" : "them"}; the owner attorney has a task to verify.`
        : `Event recorded. ${d.computed} deadline${d.computed === 1 ? "" : "s"} computed.`,
  };
}

export async function updateEventAction(
  matterId: string,
  eventId: string,
  input: { occurredOn: string; noticeType: string | null; flags: Record<string, boolean> },
): Promise<State> {
  return go(
    updateEvent,
    { eventId, ...input, note: null },
    "Event corrected; deadlines recomputed.",
    matterId,
  );
}

export async function removeEventAction(matterId: string, eventId: string, reason: string) {
  return go(
    removeEvent,
    { eventId, reason },
    "Event removed; its deadlines are cancelled.",
    matterId,
  );
}

export async function addDeadlineAction(
  matterId: string,
  input: { label: string; dueOn: string; severity: string; ownerId: string | null },
): Promise<State> {
  return go(addDeadline, { matterId, ...input, note: null }, "Deadline added.", matterId);
}

export async function moveDeadlineAction(
  matterId: string,
  deadlineId: string,
  dueOn: string,
  reason: string,
) {
  return go(moveDeadline, { deadlineId, dueOn, reason }, "Date changed.", matterId);
}

export async function setDeadlineStatusAction(
  matterId: string,
  deadlineId: string,
  status: "open" | "done" | "cancelled",
  note: string | null,
) {
  return go(
    setDeadlineStatus,
    { deadlineId, status, note },
    status === "done" ? "Marked done." : status === "open" ? "Reopened." : "Cancelled.",
    matterId,
  );
}

export async function assignDeadlineAction(
  matterId: string,
  deadlineId: string,
  ownerId: string | null,
) {
  return go(assignDeadline, { deadlineId, ownerId }, "Owner saved.", matterId);
}

export async function acknowledgeAction(matterId: string, deadlineId: string) {
  return go(acknowledgeAlerts, { deadlineId }, "Alert acknowledged.", matterId);
}

export async function addTollingAction(
  matterId: string,
  input: {
    deadlineId: string;
    days: number;
    reason: string;
    fromOn: string | null;
    toOn: string | null;
  },
) {
  return go(addTolling, input, "Tolling added; the date is recomputed.", matterId);
}

export async function removeTollingAction(matterId: string, tollingId: string) {
  return go(removeTolling, { tollingId }, "Tolling removed.", matterId);
}

export async function setPaymentPlanAction(
  matterId: string,
  input: { label: string; firstDueOn: string; dayOfMonth: number; amount: string | null },
) {
  return go(setPaymentPlan, { matterId, ...input }, "Payment plan saved.", matterId);
}

export async function endPaymentPlanAction(matterId: string, reason: string) {
  return go(endPaymentPlan, { matterId, reason }, "Payment plan ended.", matterId);
}

// -------------------------------------------------------------- rules --

export async function syncRulesAction() {
  return go(syncDeadlineRules, {}, "Product rules loaded. New rules are not verified.");
}

export async function updateRuleAction(input: unknown) {
  return go(updateDeadlineRule, input, "Rule saved. It is not verified until you verify it again.");
}

export async function verifyRuleAction(input: unknown) {
  return go(verifyDeadlineRule, input, "Rule verified. Deadlines are computed from it.");
}

export async function revokeRuleAction(ruleId: string, reason: string) {
  return go(revokeRuleVerification, { ruleId, reason }, "Verification removed.");
}

export async function setRuleActiveAction(ruleId: string, active: boolean) {
  return go(setRuleActive, { ruleId, active }, active ? "Rule switched on." : "Rule switched off.");
}

export async function addHolidayAction(date: string, label: string) {
  return go(addHoliday, { date, label }, "Holiday added; affected dates recomputed.");
}

export async function addFederalHolidaysAction(year: number) {
  return go(addFederalHolidays, { year }, `Federal holidays for ${year} added.`);
}

export async function removeHolidayAction(date: string) {
  return go(removeHoliday, { date }, "Holiday removed; affected dates recomputed.");
}

// ----------------------------------------------------------- calendar --

export async function createFeedAction(): Promise<State> {
  const r = await runCommand(createCalendarFeed, {});
  if (r.status === "success") revalidatePath("/settings/calendar");
  return r;
}

export async function revokeFeedAction(): Promise<State> {
  const r = await runCommand(
    revokeCalendarFeed,
    {},
    { successMessage: "Calendar link turned off." },
  );
  if (r.status === "success") revalidatePath("/settings/calendar");
  return r;
}
