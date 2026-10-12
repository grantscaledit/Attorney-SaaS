import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { deadlines, matterEvents, type MatterRow } from "@/db/schema";
import type { AuditSpec } from "@/lib/commands/define";
import { automationEnabled } from "@/modules/messaging/commands/outbox";
import { eventsFor } from "@/practice";
import { applyContext, applyEvent } from "./apply";

/*
 * B3 hands a triaged notice to the deadline engine (spec B3: "Create
 * deadline (C1)"). The respond-by date printed on the notice becomes a
 * "document" deadline; the notice date becomes a trigger event, so a
 * verified rule can cross-check the printed date, or compute the deadline
 * when the notice prints none. Until a person confirms the extraction, the
 * deadline is marked unconfirmed (and still alerts: a missed date is worse).
 */

export type NoticeFacts = {
  agency: string | null;
  noticeType: string | null;
  taxYears: string[];
  noticeDate: string | null;
  respondBy: string | null;
};

export function noticeLabel(f: NoticeFacts): string {
  return `${f.agency ?? "Agency"} ${f.noticeType ?? "notice"}${f.taxYears.length ? ` (${f.taxYears.join(", ")})` : ""}`;
}

export async function syncNoticeDeadline(
  tx: Tx,
  m: MatterRow,
  documentId: string,
  f: NoticeFacts,
  opts: { confirmed: boolean; actorId: string | null },
): Promise<AuditSpec[]> {
  if (!(await automationEnabled(tx, "C1"))) return [];
  const audit: AuditSpec[] = [];
  const now = new Date();
  const dedupeKey = `B3:${documentId}`;
  const [printed] = await tx.select().from(deadlines).where(eq(deadlines.dedupeKey, dedupeKey));
  const label = `Respond to ${noticeLabel(f)} (date printed on the notice)`;

  if (f.respondBy && !printed) {
    const [d] = await tx
      .insert(deadlines)
      .values({
        matterId: m.id,
        label,
        dueOn: f.respondBy,
        origin: "document",
        documentId,
        severity: "high",
        ownerId: m.responsibleAttorneyId,
        confirmed: opts.confirmed,
        dedupeKey,
        computation: ["Date printed on the notice"],
        createdBy: opts.actorId,
      })
      .returning();
    audit.push({
      action: "deadlines.read_from_document",
      entityType: "deadline",
      entityId: d!.id,
      after: { dueOn: f.respondBy, confirmed: opts.confirmed },
      metadata: { matterId: m.id, documentId, automationId: "B3" },
    });
  } else if (printed && printed.status !== "done") {
    const status = f.respondBy ? "open" : "cancelled";
    const moved = f.respondBy !== null && f.respondBy !== printed.dueOn;
    if (
      moved ||
      status !== printed.status ||
      printed.confirmed !== opts.confirmed ||
      printed.label !== label
    ) {
      await tx
        .update(deadlines)
        .set({
          dueOn: f.respondBy ?? printed.dueOn,
          status,
          label,
          confirmed: opts.confirmed,
          dueChangedAt: moved ? now : printed.dueChangedAt,
          note:
            status === "cancelled" ? "no respond-by date on the confirmed notice" : printed.note,
          version: printed.version + 1,
          updatedAt: now,
        })
        .where(eq(deadlines.id, printed.id));
      audit.push({
        action: moved ? "deadlines.moved" : "deadlines.document_date_confirmed",
        entityType: "deadline",
        entityId: printed.id,
        before: { dueOn: printed.dueOn, status: printed.status, confirmed: printed.confirmed },
        after: { dueOn: f.respondBy, status, confirmed: opts.confirmed },
        metadata: { matterId: m.id, documentId, automationId: "B3" },
      });
    }
  }

  // The notice date as a trigger event, if this matter type records one.
  if (!eventsFor(m.practiceArea, m.matterType).some((e) => e.key === "notice_date")) return audit;
  const [ev] = await tx
    .select()
    .from(matterEvents)
    .where(
      and(
        eq(matterEvents.documentId, documentId),
        eq(matterEvents.kind, "notice_date"),
        isNull(matterEvents.deletedAt),
      ),
    );
  let event = ev;
  if (f.noticeDate && !ev) {
    [event] = await tx
      .insert(matterEvents)
      .values({
        matterId: m.id,
        kind: "notice_date",
        occurredOn: f.noticeDate,
        noticeType: f.noticeType,
        documentId,
        createdBy: opts.actorId,
      })
      .returning();
    audit.push({
      action: "deadlines.event_recorded",
      entityType: "matter_event",
      entityId: event!.id,
      after: { kind: "notice_date", occurredOn: f.noticeDate, noticeType: f.noticeType },
      metadata: { matterId: m.id, documentId, automationId: "B3" },
    });
  } else if (ev && (ev.occurredOn !== f.noticeDate || ev.noticeType !== f.noticeType)) {
    [event] = await tx
      .update(matterEvents)
      .set(
        f.noticeDate
          ? { occurredOn: f.noticeDate, noticeType: f.noticeType, updatedAt: now }
          : { deletedAt: now, updatedAt: now },
      )
      .where(eq(matterEvents.id, ev.id))
      .returning();
    audit.push({
      action: f.noticeDate ? "deadlines.event_updated" : "deadlines.event_removed",
      entityType: "matter_event",
      entityId: ev.id,
      before: { occurredOn: ev.occurredOn, noticeType: ev.noticeType },
      after: { occurredOn: f.noticeDate, noticeType: f.noticeType },
      metadata: { matterId: m.id, documentId, automationId: "B3" },
    });
  }
  if (event) {
    const c = await applyContext(tx, opts.actorId, opts.confirmed);
    const out = await applyEvent(tx, m, event, c);
    audit.push(...out.audit);
  }
  return audit;
}
