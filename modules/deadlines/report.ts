import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";

/*
 * C7 deadline audit (spec Section 7): matters with no deadlines, deadlines
 * with no owner, and deadlines whose date changed in the last 7 days. The
 * weekly job and the Deadlines panel read this one function.
 */

export type DeadlineAudit = {
  mattersWithoutDeadline: { matterId: string; number: string; title: string }[];
  withoutOwner: {
    deadlineId: string;
    matterId: string;
    number: string;
    label: string;
    dueOn: string;
  }[];
  changedThisWeek: {
    deadlineId: string;
    matterId: string;
    number: string;
    label: string;
    dueOn: string;
    changedAt: Date;
  }[];
};

export async function deadlineAuditReport(db: DbOrTx, now = new Date()): Promise<DeadlineAudit> {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const none = await db.execute<{ id: string; number: string; title: string }>(
    sql`select m.id, m.number, m.title from matters m
        where m.status = 'open' and m.deleted_at is null
          and not exists (select 1 from deadlines d where d.matter_id = m.id and d.status = 'open')
        order by m.number`,
  );
  const noOwner = await db.execute<{
    id: string;
    matter_id: string;
    number: string;
    label: string;
    due_on: string;
  }>(
    sql`select d.id, d.matter_id, m.number, d.label, d.due_on::text as due_on from deadlines d
        join matters m on m.id = d.matter_id
        where d.status = 'open' and d.owner_id is null and m.status = 'open' and m.deleted_at is null
        order by d.due_on`,
  );
  const changed = await db.execute<{
    id: string;
    matter_id: string;
    number: string;
    label: string;
    due_on: string;
    due_changed_at: Date;
  }>(
    sql`select d.id, d.matter_id, m.number, d.label, d.due_on::text as due_on, d.due_changed_at from deadlines d
        join matters m on m.id = d.matter_id
        where d.due_changed_at >= ${since.toISOString()} and m.deleted_at is null
        order by d.due_changed_at desc`,
  );
  return {
    mattersWithoutDeadline: none.rows.map((r) => ({
      matterId: r.id,
      number: r.number,
      title: r.title,
    })),
    withoutOwner: noOwner.rows.map((r) => ({
      deadlineId: r.id,
      matterId: r.matter_id,
      number: r.number,
      label: r.label,
      dueOn: r.due_on,
    })),
    changedThisWeek: changed.rows.map((r) => ({
      deadlineId: r.id,
      matterId: r.matter_id,
      number: r.number,
      label: r.label,
      dueOn: r.due_on,
      changedAt: new Date(r.due_changed_at),
    })),
  };
}
