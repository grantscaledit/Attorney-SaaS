import { and, eq, isNull, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "@/db/client";
import { firmSettings, matterNumberSeq, matters, users, type MatterRow } from "@/db/schema";
import type { MatterScope } from "@/lib/auth/can";
import { CommandError } from "@/lib/commands/errors";
import { env } from "@/lib/env";
import { matterType, stagesOf, type MatterTypeDef } from "@/practice";

/** Portal users linked to the matter's contact. */
export async function clientUserIds(db: DbOrTx, contactId: string): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.contactId, contactId), eq(users.role, "client"), isNull(users.deletedAt)));
  return rows.map((r) => r.id);
}

/** Resource scope for can(): who owns, works and is the client on this matter. */
export async function scopeOf(db: DbOrTx, m: MatterRow): Promise<MatterScope> {
  return {
    kind: "matter",
    responsibleAttorneyId: m.responsibleAttorneyId,
    assignedUserIds: m.assignedUserIds,
    clientUserIds: await clientUserIds(db, m.contactId),
  };
}

/** Locks a live matter for a command, or fails with not_found. */
export async function lockMatter(tx: Tx, matterId: string): Promise<MatterRow> {
  const [m] = await tx
    .select()
    .from(matters)
    .where(and(eq(matters.id, matterId), isNull(matters.deletedAt)))
    .for("update");
  if (!m) throw new CommandError("not_found", "Matter not found.");
  return m;
}

export function typeOf(m: Pick<MatterRow, "practiceArea" | "matterType">): MatterTypeDef {
  const t = matterType(m.practiceArea, m.matterType);
  if (!t) throw new Error(`unknown matter type ${m.practiceArea}/${m.matterType}`);
  return t;
}

export function stageLabel(m: Pick<MatterRow, "practiceArea" | "matterType" | "stage">): string {
  const t = matterType(m.practiceArea, m.matterType);
  return t ? (stagesOf(t).find((s) => s.key === m.stage)?.label ?? m.stage) : m.stage;
}

/** Today's date in the firm's time zone, as YYYY-MM-DD (rule 10). */
export function firmToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env().FIRM_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Next matter number, YYYY-NNNN, from a sequence that never repeats. */
export async function nextMatterNumber(tx: Tx): Promise<string> {
  const { rows } = await tx.execute<{ n: string }>(
    sql`select nextval(${matterNumberSeq.seqName ?? "matter_number_seq"})::text as n`,
  );
  const r = rows[0];
  return `${firmToday().slice(0, 4)}-${String(r?.n ?? "0").padStart(4, "0")}`;
}

export async function firmName(db: DbOrTx): Promise<string> {
  const [f] = await db
    .select({ n: firmSettings.displayName })
    .from(firmSettings)
    .where(eq(firmSettings.id, 1));
  return f?.n ?? "The firm";
}
