import { createHash } from "node:crypto";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import {
  CONFLICT_ROLES,
  conflictChecks,
  conflictHits,
  conflictParties,
  contacts,
  intakeRecords,
  leads,
} from "@/db/schema";
import type { AuditSpec } from "@/lib/commands/define";
import { defineCommand } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";
import {
  HIT_THRESHOLD,
  matchNames,
  normalizeName,
  splitNames,
  type MatchReason,
} from "../conflicts/names";

/*
 * A6 conflict pre-screen (spec Section 7): fuzzy match of the prospect,
 * related parties and businesses against contacts and the firm's conflict
 * list. The output is a flag list for a person. It never auto-clears: every
 * check, with or without hits, waits for a lawyer's review.
 */

/** Answer fields that name other people or businesses, by practice area. */
const PARTY_FIELDS = ["other_parties", "owners", "named_executor"] as const;

export function namesForLead(
  contact: { fullName: string | null; companyName: string | null },
  answers: Record<string, string>,
): string[] {
  const names = [
    contact.fullName ?? "",
    contact.companyName ?? "",
    ...PARTY_FIELDS.flatMap((f) => splitNames(answers[f])),
  ]
    .map((n) => n.trim())
    .filter((n) => n.length >= 3);
  const seen = new Set<string>();
  return names.filter((n) => {
    const key = normalizeName(n);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type Candidate = { type: "contact" | "conflict_party"; id: string; name: string; role: string };

async function candidatesFor(tx: Tx, name: string, selfContactId: string): Promise<Candidate[]> {
  const q = normalizeName(name);
  const last = q.split(" ").at(-1) ?? q;
  const like = last.length >= 4 ? `%${last}%` : null;
  const near = (col: ReturnType<typeof sql>) =>
    like
      ? sql`(similarity(lower(coalesce(${col}, '')), ${q}) > 0.2 or lower(coalesce(${col}, '')) like ${like})`
      : sql`similarity(lower(coalesce(${col}, '')), ${q}) > 0.2`;

  const contactRows = await tx
    .select({
      id: contacts.id,
      fullName: contacts.fullName,
      companyName: contacts.companyName,
      client: sql<boolean>`exists (select 1 from leads l where l.contact_id = ${contacts.id} and l.status = 'retained')`,
    })
    .from(contacts)
    .where(
      and(
        isNull(contacts.deletedAt),
        ne(contacts.id, selfContactId),
        sql`(${near(sql`${contacts.fullName}`)} or ${near(sql`${contacts.companyName}`)})`,
      ),
    )
    .limit(50);

  const partyRows = await tx
    .select({ id: conflictParties.id, name: conflictParties.name, role: conflictParties.role })
    .from(conflictParties)
    .where(and(isNull(conflictParties.deletedAt), near(sql`${conflictParties.name}`)))
    .limit(50);

  const out: Candidate[] = [];
  for (const c of contactRows) {
    const role = c.client ? "client" : "prior enquiry";
    if (c.fullName) out.push({ type: "contact", id: c.id, name: c.fullName, role });
    if (c.companyName) out.push({ type: "contact", id: c.id, name: c.companyName, role });
  }
  for (const p of partyRows)
    out.push({ type: "conflict_party", id: p.id, name: p.name, role: p.role });
  return out;
}

export type ConflictCheckOutcome = {
  checkId: string;
  hits: number;
  created: boolean;
  audit: AuditSpec[];
};

/** Runs A6 for a lead. Same names, same key: re-running changes nothing. */
export async function runConflictCheck(tx: Tx, leadId: string): Promise<ConflictCheckOutcome> {
  const [row] = await tx
    .select({ lead: leads, contact: contacts, answers: intakeRecords.answers })
    .from(leads)
    .innerJoin(contacts, eq(contacts.id, leads.contactId))
    .leftJoin(intakeRecords, eq(intakeRecords.leadId, leads.id))
    .where(eq(leads.id, leadId));
  if (!row) throw new Error(`lead ${leadId} not found`);
  const names = namesForLead(row.contact, (row.answers ?? {}) as Record<string, string>);
  const dedupeKey = createHash("sha256")
    .update(JSON.stringify([leadId, names.map(normalizeName).sort()]))
    .digest("hex");

  const [existing] = await tx
    .select()
    .from(conflictChecks)
    .where(eq(conflictChecks.dedupeKey, dedupeKey));
  if (existing) return { checkId: existing.id, hits: existing.hitCount, created: false, audit: [] };

  const hits = new Map<
    string,
    { queryName: string; c: Candidate; similarity: number; reason: MatchReason }
  >();
  for (const name of names) {
    for (const c of await candidatesFor(tx, name, row.contact.id)) {
      const m = matchNames(name, c.name);
      if (!m || m.similarity < HIT_THRESHOLD) continue;
      const key = `${c.type}:${c.id}:${normalizeName(name)}`;
      const prev = hits.get(key);
      if (!prev || prev.similarity < m.similarity) hits.set(key, { queryName: name, c, ...m });
    }
  }

  const [check] = await tx
    .insert(conflictChecks)
    .values({ leadId, names, hitCount: hits.size, dedupeKey })
    .returning();
  if (!check) throw new Error("conflict check insert returned no row");
  if (hits.size > 0) {
    await tx.insert(conflictHits).values(
      [...hits.values()].map((h) => ({
        checkId: check.id,
        queryName: h.queryName,
        matchedType: h.c.type,
        matchedId: h.c.id,
        matchedName: h.c.name,
        role: h.c.role,
        similarity: h.similarity,
        reason: h.reason,
      })),
    );
  }
  return {
    checkId: check.id,
    hits: hits.size,
    created: true,
    audit: [
      {
        action: "conflicts.checked",
        entityType: "conflict_check",
        entityId: check.id,
        // Counts only: the names are client information.
        after: { leadId, namesChecked: names.length, hits: hits.size, status: check.status },
      },
    ],
  };
}

/** Anyone who works leads can re-run the pre-screen, e.g. after new parties come up. */
export const rerunConflictCheck = defineCommand({
  name: "conflicts.run",
  permission: "leads.write",
  input: z.object({ leadId: z.uuid() }),
  async run(ctx, input) {
    const r = await runConflictCheck(ctx.tx, input.leadId);
    return {
      result: { checkId: r.checkId, hits: r.hits },
      audit: r.audit.length
        ? (r.audit as [AuditSpec, ...AuditSpec[]])
        : [
            {
              action: "conflicts.check_unchanged",
              entityType: "conflict_check",
              entityId: r.checkId,
            },
          ],
    };
  },
});

/** A lawyer's decision on a pre-screen. The only way a check leaves "awaiting review". */
export const reviewConflictCheck = defineCommand({
  name: "conflicts.review",
  permission: "conflicts.review",
  input: z.object({
    checkId: z.uuid(),
    decision: z.enum(["cleared", "conflict"]),
    note: z.string().trim().min(3, "Record the basis for the decision").max(2000),
  }),
  async run(ctx, input) {
    const [check] = await ctx.tx
      .select()
      .from(conflictChecks)
      .where(eq(conflictChecks.id, input.checkId))
      .for("update");
    if (!check) throw new CommandError("not_found", "Conflict check not found.");
    if (check.status !== "awaiting_review") {
      throw new CommandError("invalid_state", "This check was already reviewed.");
    }
    const userId = ctx.principal.type === "user" ? ctx.principal.user.id : null;
    await ctx.tx
      .update(conflictChecks)
      .set({
        status: input.decision,
        reviewedBy: userId,
        reviewedAt: new Date(),
        reviewNote: input.note,
        updatedAt: new Date(),
      })
      .where(eq(conflictChecks.id, check.id));
    return {
      result: { checkId: check.id, status: input.decision },
      audit: [
        {
          action: input.decision === "cleared" ? "conflicts.cleared" : "conflicts.confirmed",
          entityType: "conflict_check",
          entityId: check.id,
          before: { status: check.status },
          after: { status: input.decision, hits: check.hitCount, note: input.note },
          metadata: { leadId: check.leadId },
        },
      ],
    };
  },
});

const partyInput = z.object({
  name: z.string().trim().min(2).max(200),
  kind: z.enum(["person", "organization"]),
  role: z.enum(CONFLICT_ROLES),
  matterReference: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v || null),
  notes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => v || null),
});

/** Owner maintains the conflict list: clients, adverse and related parties (until matters exist). */
export const addConflictParties = defineCommand({
  name: "conflicts.parties_add",
  permission: "firm.settings.update",
  input: z.object({ parties: z.array(partyInput).min(1).max(500) }),
  async run(ctx, input) {
    const userId = ctx.principal.type === "user" ? ctx.principal.user.id : null;
    const rows = await ctx.tx
      .insert(conflictParties)
      .values(input.parties.map((p) => ({ ...p, createdBy: userId })))
      .returning({ id: conflictParties.id });
    return {
      result: { added: rows.length },
      audit: [
        {
          action: "conflicts.parties_added",
          entityType: "conflict_party",
          entityId: rows[0]!.id,
          after: { count: rows.length, roles: [...new Set(input.parties.map((p) => p.role))] },
        },
      ],
    };
  },
});

export const removeConflictParty = defineCommand({
  name: "conflicts.party_remove",
  permission: "firm.settings.update",
  input: z.object({ partyId: z.uuid() }),
  async run(ctx, input) {
    const [row] = await ctx.tx
      .update(conflictParties)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(conflictParties.id, input.partyId), isNull(conflictParties.deletedAt)))
      .returning();
    if (!row) throw new CommandError("not_found", "Party not found.");
    return {
      result: { removed: true },
      audit: [
        {
          action: "conflicts.party_removed",
          entityType: "conflict_party",
          entityId: row.id,
          before: { name: row.name, role: row.role, matterReference: row.matterReference },
        },
      ],
    };
  },
});
