import "server-only";
import { and, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { auditLog, type AuditRow } from "@/db/schema";
import { assertCan, type Actor } from "@/lib/auth/can";

/** Filters arrive from the URL; every one is validated and optional. */
export const auditFilterSchema = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  action: z
    .string()
    .trim()
    .regex(/^[a-z_.]+$/)
    .max(80)
    .optional()
    .catch(undefined),
  actor: z.enum(["user", "system", "vendor", "anonymous"]).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  before: z.coerce.number().int().positive().optional().catch(undefined),
});

export type AuditFilters = z.infer<typeof auditFilterSchema>;

export const AUDIT_PAGE_SIZE = 50;

/**
 * Date filters are calendar days in the firm's time zone (rule 10), converted
 * to UTC bounds in SQL.
 */
function buildWhere(filters: AuditFilters, timeZone: string): SQL | undefined {
  const conditions: SQL[] = [];
  if (filters.action) conditions.push(eq(auditLog.action, filters.action));
  if (filters.actor) conditions.push(eq(auditLog.actorType, filters.actor));
  if (filters.from) {
    conditions.push(
      gte(auditLog.occurredAt, sql`(${filters.from}::date)::timestamp AT TIME ZONE ${timeZone}`),
    );
  }
  if (filters.to) {
    conditions.push(
      lt(auditLog.occurredAt, sql`((${filters.to}::date + 1)::timestamp) AT TIME ZONE ${timeZone}`),
    );
  }
  if (filters.q) {
    const term = `%${filters.q.replace(/[%_\\]/g, "\\$&")}%`;
    const match = or(
      ilike(auditLog.actorLabel, term),
      ilike(auditLog.entityId, term),
      ilike(auditLog.action, term),
    );
    if (match) conditions.push(match);
  }
  return conditions.length ? and(...conditions) : undefined;
}

export async function listAuditEvents(
  actor: Actor,
  filters: AuditFilters,
  timeZone: string,
): Promise<{ rows: AuditRow[]; nextBefore: number | null }> {
  assertCan(actor, "audit.read");
  const where = buildWhere(filters, timeZone);
  const page = filters.before ? and(where, lt(auditLog.seq, filters.before)) : where;
  const rows = await getDb()
    .select()
    .from(auditLog)
    .where(page)
    .orderBy(desc(auditLog.seq))
    .limit(AUDIT_PAGE_SIZE + 1);
  const hasMore = rows.length > AUDIT_PAGE_SIZE;
  const visible = hasMore ? rows.slice(0, AUDIT_PAGE_SIZE) : rows;
  return { rows: visible, nextBefore: hasMore ? (visible.at(-1)?.seq ?? null) : null };
}

/** Streams every matching row for export, oldest first, in batches. */
export async function* exportAuditEvents(
  actor: Actor,
  filters: AuditFilters,
  timeZone: string,
): AsyncGenerator<AuditRow[]> {
  assertCan(actor, "audit.export");
  const where = buildWhere({ ...filters, before: undefined }, timeZone);
  let after = 0;
  for (;;) {
    const batch = await getDb()
      .select()
      .from(auditLog)
      .where(and(where, sql`${auditLog.seq} > ${after}`))
      .orderBy(auditLog.seq)
      .limit(1000);
    if (batch.length === 0) return;
    yield batch;
    after = batch.at(-1)!.seq;
  }
}

export async function distinctAuditActions(actor: Actor): Promise<string[]> {
  assertCan(actor, "audit.read");
  const rows = await getDb()
    .selectDistinct({ action: auditLog.action })
    .from(auditLog)
    .orderBy(auditLog.action);
  return rows.map((r) => r.action);
}

export async function auditHead(): Promise<{ seq: number; hash: string; occurredAt: Date } | null> {
  const [row] = await getDb()
    .select({ seq: auditLog.seq, hash: auditLog.hash, occurredAt: auditLog.occurredAt })
    .from(auditLog)
    .orderBy(desc(auditLog.seq))
    .limit(1);
  return row ?? null;
}

export async function recentAuditEvents(actor: Actor, limit = 8): Promise<AuditRow[]> {
  assertCan(actor, "audit.read");
  return getDb().select().from(auditLog).orderBy(desc(auditLog.seq)).limit(limit);
}

export async function auditCountLastHours(hours: number): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(sql`${auditLog.occurredAt} >= now() - make_interval(hours => ${hours})`);
  return row?.n ?? 0;
}

export async function failedSignInsLastHours(hours: number): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(
      and(
        sql`${auditLog.occurredAt} >= now() - make_interval(hours => ${hours})`,
        or(eq(auditLog.action, "auth.sign_in_failed"), eq(auditLog.action, "auth.mfa_failed")),
      ),
    );
  return row?.n ?? 0;
}
