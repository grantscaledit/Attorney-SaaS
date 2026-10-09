import { auditLog, type AuditActorType } from "@/db/schema";
import type { DbOrTx } from "@/db/client";
import { redact } from "@/lib/log/redact";

export type AuditActor =
  | { type: "user"; id: string; label: string }
  | { type: "vendor"; id: string; label: string }
  | { type: "system"; label: string }
  | { type: "anonymous"; label?: string };

export type AuditRequest = {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
};

export type AuditEntry = {
  actor: AuditActor;
  /** Dotted verb, past tense of the command: "users.invited", "firm.settings.updated". */
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown> | null;
  request?: AuditRequest | null;
};

/** Plain JSON (dates to ISO strings), sensitive keys redacted, undefined dropped. */
function toJson(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  return redact(JSON.parse(JSON.stringify(value)) as unknown);
}

function actorColumns(actor: AuditActor): {
  actorType: AuditActorType;
  actorId: string | null;
  actorLabel: string | null;
} {
  switch (actor.type) {
    case "user":
    case "vendor":
      return { actorType: actor.type, actorId: actor.id, actorLabel: actor.label };
    case "system":
      return { actorType: "system", actorId: null, actorLabel: actor.label };
    case "anonymous":
      return { actorType: "anonymous", actorId: null, actorLabel: actor.label ?? null };
  }
}

/**
 * Appends one audit row. Call it with the same transaction as the mutation so
 * the change and its audit record commit or roll back together. The database
 * assigns seq, timestamp and hash chain (migration 0001).
 */
export async function recordAudit(db: DbOrTx, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    ...actorColumns(entry.actor),
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    before: toJson(entry.before),
    after: toJson(entry.after),
    metadata: toJson(entry.metadata),
    ip: entry.request?.ip ?? null,
    userAgent: entry.request?.userAgent?.slice(0, 512) ?? null,
    requestId: entry.request?.requestId ?? null,
  });
}
