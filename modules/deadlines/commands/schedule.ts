import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { deadlines, matters, type PaymentPlanRow } from "@/db/schema";
import type { AuditSpec } from "@/lib/commands/define";
import { addDays, daysInMonth, type IsoDate } from "../date-math";

/*
 * C5 payment schedules. Each payment date of an installment agreement is a
 * "schedule" deadline; the next few are kept ahead, and marking one done
 * records the payment as made.
 */

export const PAYMENTS_AHEAD = 3;

/** The plan's k-th payment date (k = 0 is the first payment). */
export function paymentDate(plan: Pick<PaymentPlanRow, "firstDueOn" | "dayOfMonth">, k: number) {
  if (k === 0) return plan.firstDueOn;
  const [y, m] = plan.firstDueOn.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + k;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const d = Math.min(plan.dayOfMonth, daysInMonth(ty, tm));
  return `${ty}-${String(tm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Payment dates from `from` onward: the next `count`. */
export function upcomingPayments(
  plan: Pick<PaymentPlanRow, "firstDueOn" | "dayOfMonth">,
  from: IsoDate,
  count: number,
): IsoDate[] {
  const out: IsoDate[] = [];
  for (let k = 0; out.length < count && k < 1_200; k++) {
    const d = paymentDate(plan, k);
    if (d >= from) out.push(d);
  }
  return out;
}

/** Keep the next few payment dates as deadlines. Idempotent. */
export async function topUpPayments(
  tx: Tx,
  plan: PaymentPlanRow,
  today: IsoDate,
  actorId: string | null,
): Promise<AuditSpec[]> {
  if (plan.status !== "active") return [];
  const [m] = await tx.select().from(matters).where(eq(matters.id, plan.matterId));
  if (!m || m.status !== "open") return [];
  // Include payments missed in the last month so a late one still shows.
  const dates = upcomingPayments(plan, addDays(today, -31), PAYMENTS_AHEAD + 1);
  const audit: AuditSpec[] = [];
  for (const due of dates) {
    const rows = await tx
      .insert(deadlines)
      .values({
        matterId: m.id,
        label: `${plan.label} payment${plan.amount ? ` (${plan.amount})` : ""}`,
        dueOn: due,
        origin: "schedule",
        severity: "normal",
        ownerId: m.responsibleAttorneyId,
        dedupeKey: `C5:pay:${plan.id}:${due}`,
        computation: [`Installment agreement: monthly on day ${plan.dayOfMonth}`],
        createdBy: actorId,
      })
      .onConflictDoNothing()
      .returning({ id: deadlines.id });
    if (rows[0]) {
      audit.push({
        action: "deadlines.payment_scheduled",
        entityType: "deadline",
        entityId: rows[0].id,
        after: { dueOn: due },
        metadata: { matterId: m.id, planId: plan.id, automationId: "C5" },
      });
    }
  }
  return audit;
}

/** Ending a plan cancels its future payment dates. */
export async function cancelFuturePayments(
  tx: Tx,
  plan: PaymentPlanRow,
  today: IsoDate,
): Promise<AuditSpec[]> {
  const open = await tx
    .select()
    .from(deadlines)
    .where(
      and(
        eq(deadlines.matterId, plan.matterId),
        eq(deadlines.origin, "schedule"),
        inArray(deadlines.status, ["open"]),
      ),
    );
  const audit: AuditSpec[] = [];
  for (const d of open.filter((x) => x.dedupeKey?.startsWith(`C5:pay:${plan.id}:`))) {
    if (d.dueOn < today) continue;
    await tx
      .update(deadlines)
      .set({
        status: "cancelled",
        note: "payment plan ended",
        updatedAt: new Date(),
        version: d.version + 1,
      })
      .where(eq(deadlines.id, d.id));
    audit.push({
      action: "deadlines.cancelled",
      entityType: "deadline",
      entityId: d.id,
      before: { status: "open", dueOn: d.dueOn },
      after: { status: "cancelled" },
      metadata: { reason: "payment plan ended" },
    });
  }
  return audit;
}
