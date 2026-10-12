import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { deadlineHolidays, deadlineRules } from "@/db/schema";
import type { AuditSpec, CommandContext } from "@/lib/commands/define";
import { defineCommand } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";
import { allRuleSeeds, paramsOfSeed, SEVERITIES } from "@/practice";
import { isIsoDate, usFederalHolidays } from "../date-math";
import { ruleHash } from "../engine";
import { hashOfRow, paramsOf } from "../rules";
import { recomputeEvents } from "./apply";

/*
 * The verification workflow (spec Sections 5 and 8). Only the owner attorney
 * (permission deadline_rules.verify) edits, verifies or switches off a rule,
 * and only as a person: no job or script can verify a rule. Any edit clears
 * the verification. Verifying or un-verifying re-runs C1 for every event the
 * rule could apply to.
 */

function personOnly(ctx: CommandContext): string {
  if (ctx.principal.type !== "user")
    throw new CommandError("forbidden", "Only a person can change or verify deadline rules.");
  return ctx.principal.user.id;
}

async function lockRule(ctx: CommandContext, id: string) {
  const [r] = await ctx.tx
    .select()
    .from(deadlineRules)
    .where(eq(deadlineRules.id, id))
    .for("update");
  if (!r) throw new CommandError("not_found", "Rule not found.");
  return r;
}

const seedHash = (s: ReturnType<typeof allRuleSeeds>[number]) =>
  createHash("sha256")
    .update(ruleHash(paramsOfSeed(s)))
    .digest("hex");

/** Adds product seed rules the firm does not have yet, unverified. Never touches existing rows. */
export async function insertMissingSeeds(tx: Tx): Promise<string[]> {
  const existing = new Set(
    (await tx.select({ key: deadlineRules.key }).from(deadlineRules)).map((r) => r.key),
  );
  const added: string[] = [];
  for (const s of allRuleSeeds()) {
    if (existing.has(s.key)) continue;
    await tx
      .insert(deadlineRules)
      .values({
        key: s.key,
        practiceArea: s.practiceArea,
        ...paramsOfSeed(s),
        seedNote: s.seedNote,
        seedHash: seedHash(s),
      })
      .onConflictDoNothing();
    added.push(s.key);
  }
  return added;
}

export const syncDeadlineRules = defineCommand({
  name: "deadlines.sync_rules",
  permission: "deadline_rules.verify",
  input: z.object({}),
  async run(ctx) {
    const added = await insertMissingSeeds(ctx.tx);
    return {
      result: { added },
      audit: [
        { action: "deadlines.rules_synced", entityType: "deadline_rule", metadata: { added } },
      ],
    };
  },
});

const offsetSchema = z.discriminatedUnion("unit", [
  z.object({
    unit: z.enum(["days", "months", "years"]),
    amount: z.number().int().min(1).max(36_500),
  }),
  z
    .object({
      unit: z.literal("annual"),
      month: z.number().int().min(1).max(12),
      day: z.number().int().min(1).max(31),
    })
    .refine((o) => o.day <= new Date(Date.UTC(2028, o.month, 0)).getUTCDate(), {
      message: "That day does not exist in that month.",
    }),
]);

/** Edits a rule's parameters. The rule becomes unverified until verified again. */
export const updateDeadlineRule = defineCommand({
  name: "deadlines.update_rule",
  permission: "deadline_rules.verify",
  input: z.object({
    ruleId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    label: z.string().trim().min(3).max(120),
    description: z.string().trim().min(3).max(600),
    offset: offsetSchema,
    rollForward: z.enum(["next_business_day", "none"]),
    severity: z.enum(SEVERITIES),
    noticeTypes: z.array(z.string().trim().min(2).max(40)).max(30),
    preferPrinted: z.boolean(),
  }),
  async run(ctx, input) {
    const actor = personOnly(ctx);
    const r = await lockRule(ctx, input.ruleId);
    if (r.version !== input.expectedVersion)
      throw new CommandError("conflict", "The rule changed since you opened it. Reload and retry.");
    const before = paramsOf(r);
    const after = {
      ...before,
      label: input.label,
      description: input.description,
      offset: input.offset,
      rollForward: input.rollForward,
      severity: input.severity,
      noticeTypes: input.noticeTypes,
      preferPrinted: input.preferPrinted,
    };
    if (ruleHash(after) === ruleHash(before))
      throw new CommandError("validation", "Nothing changed.");
    const now = new Date();
    await ctx.tx
      .update(deadlineRules)
      .set({
        label: after.label,
        description: after.description,
        offset: after.offset,
        rollForward: after.rollForward,
        severity: after.severity,
        noticeTypes: after.noticeTypes,
        preferPrinted: after.preferPrinted,
        version: r.version + 1,
        verifiedBy: null,
        verifiedAt: null,
        verifiedHash: null,
        updatedAt: now,
      })
      .where(eq(deadlineRules.id, r.id));
    const re = await recomputeEvents(ctx.tx, { triggers: [r.trigger] }, actor);
    return {
      result: { version: r.version + 1 },
      audit: [
        {
          action: "deadlines.rule_updated",
          entityType: "deadline_rule",
          entityId: r.id,
          before: { ...before, verifiedBy: r.verifiedBy, version: r.version },
          after: { ...after, verifiedBy: null, version: r.version + 1 },
        },
        ...re.audit,
      ],
    };
  },
});

/**
 * The owner attorney signs a rule off against its source. The hash they saw
 * must still be the rule's hash, so they verify exactly what is stored.
 */
export const verifyDeadlineRule = defineCommand({
  name: "deadlines.verify_rule",
  permission: "deadline_rules.verify",
  input: z.object({
    ruleId: z.uuid(),
    expectedHash: z.string().regex(/^[0-9a-f]{64}$/),
    citation: z
      .string()
      .trim()
      .min(5, "Cite the statute, rule or publication you checked")
      .max(500),
    attest: z.literal(true, "Confirm you checked the rule against its source"),
  }),
  async run(ctx, input) {
    const actor = personOnly(ctx);
    const r = await lockRule(ctx, input.ruleId);
    const hash = hashOfRow(r);
    if (hash !== input.expectedHash)
      throw new CommandError(
        "conflict",
        "The rule changed since you opened it. Review it again before verifying.",
      );
    if (!r.active) throw new CommandError("invalid_state", "Switch the rule on before verifying.");
    const now = new Date();
    await ctx.tx
      .update(deadlineRules)
      .set({
        verifiedBy: actor,
        verifiedAt: now,
        verifiedHash: hash,
        citation: input.citation,
        updatedAt: now,
      })
      .where(eq(deadlineRules.id, r.id));
    const re = await recomputeEvents(ctx.tx, { triggers: [r.trigger] }, actor);
    return {
      result: { computed: re.computed, recomputed: re.recomputed },
      audit: [
        {
          action: "deadlines.rule_verified",
          entityType: "deadline_rule",
          entityId: r.id,
          before: { verifiedBy: r.verifiedBy, verifiedAt: r.verifiedAt },
          after: {
            ...paramsOf(r),
            citation: input.citation,
            verifiedHash: hash,
            version: r.version,
          },
        },
        ...re.audit,
      ],
    };
  },
});

export const revokeRuleVerification = defineCommand({
  name: "deadlines.revoke_rule_verification",
  permission: "deadline_rules.verify",
  input: z.object({ ruleId: z.uuid(), reason: z.string().trim().min(3).max(500) }),
  async run(ctx, input) {
    const actor = personOnly(ctx);
    const r = await lockRule(ctx, input.ruleId);
    if (!r.verifiedAt) throw new CommandError("invalid_state", "The rule is not verified.");
    await ctx.tx
      .update(deadlineRules)
      .set({ verifiedBy: null, verifiedAt: null, verifiedHash: null, updatedAt: new Date() })
      .where(eq(deadlineRules.id, r.id));
    const re = await recomputeEvents(ctx.tx, { triggers: [r.trigger] }, actor);
    return {
      result: { revoked: true },
      audit: [
        {
          action: "deadlines.rule_verification_revoked",
          entityType: "deadline_rule",
          entityId: r.id,
          before: { verifiedBy: r.verifiedBy, verifiedAt: r.verifiedAt },
          after: { verifiedBy: null, reason: input.reason },
        },
        ...re.audit,
      ],
    };
  },
});

export const setRuleActive = defineCommand({
  name: "deadlines.set_rule_active",
  permission: "deadline_rules.verify",
  input: z.object({ ruleId: z.uuid(), active: z.boolean() }),
  async run(ctx, input) {
    const actor = personOnly(ctx);
    const r = await lockRule(ctx, input.ruleId);
    if (r.active === input.active) throw new CommandError("validation", "Nothing changed.");
    await ctx.tx
      .update(deadlineRules)
      .set({ active: input.active, updatedAt: new Date() })
      .where(eq(deadlineRules.id, r.id));
    const re = await recomputeEvents(ctx.tx, { triggers: [r.trigger] }, actor);
    return {
      result: { active: input.active },
      audit: [
        {
          action: input.active ? "deadlines.rule_switched_on" : "deadlines.rule_switched_off",
          entityType: "deadline_rule",
          entityId: r.id,
          before: { active: r.active },
          after: { active: input.active },
        },
        ...re.audit,
      ],
    };
  },
});

// ------------------------------------------------------------ holidays --

const recomputeAll = (ctx: CommandContext, actor: string) => recomputeEvents(ctx.tx, {}, actor);

export const addHoliday = defineCommand({
  name: "deadlines.add_holiday",
  permission: "deadline_rules.verify",
  input: z.object({
    date: z.iso.date().refine(isIsoDate),
    label: z.string().trim().min(2).max(80),
  }),
  async run(ctx, input) {
    const actor = personOnly(ctx);
    const inserted = await ctx.tx
      .insert(deadlineHolidays)
      .values({ date: input.date, label: input.label, createdBy: actor })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0)
      throw new CommandError("conflict", "That date is already on the holiday list.");
    const re = await recomputeAll(ctx, actor);
    return {
      result: { added: 1, recomputed: re.recomputed },
      audit: [
        {
          action: "deadlines.holiday_added",
          entityType: "holiday",
          entityId: input.date,
          after: input,
        },
        ...re.audit,
      ],
    };
  },
});

export const addFederalHolidays = defineCommand({
  name: "deadlines.add_federal_holidays",
  permission: "deadline_rules.verify",
  input: z.object({ year: z.number().int().min(2000).max(2100) }),
  async run(ctx, input) {
    const actor = personOnly(ctx);
    const added: string[] = [];
    for (const h of usFederalHolidays(input.year)) {
      const rows = await ctx.tx
        .insert(deadlineHolidays)
        .values({ date: h.date, label: h.label, createdBy: actor })
        .onConflictDoNothing()
        .returning();
      if (rows.length > 0) added.push(h.date);
    }
    const re = await recomputeAll(ctx, actor);
    return {
      result: { added: added.length, recomputed: re.recomputed },
      audit: [
        {
          action: "deadlines.federal_holidays_added",
          entityType: "holiday",
          metadata: { year: input.year, added },
        },
        ...re.audit,
      ],
    };
  },
});

export const removeHoliday = defineCommand({
  name: "deadlines.remove_holiday",
  permission: "deadline_rules.verify",
  input: z.object({ date: z.iso.date() }),
  async run(ctx, input) {
    const actor = personOnly(ctx);
    const rows = await ctx.tx
      .delete(deadlineHolidays)
      .where(eq(deadlineHolidays.date, input.date))
      .returning();
    if (rows.length === 0) throw new CommandError("not_found", "That date is not on the list.");
    const re = await recomputeAll(ctx, actor);
    const audit: [AuditSpec, ...AuditSpec[]] = [
      {
        action: "deadlines.holiday_removed",
        entityType: "holiday",
        entityId: input.date,
        before: { date: rows[0]!.date, label: rows[0]!.label },
      },
      ...re.audit,
    ];
    return { result: { removed: 1 }, audit };
  },
});
