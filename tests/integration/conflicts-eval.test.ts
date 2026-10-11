import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { conflictChecks, conflictHits, contacts, leads } from "@/db/schema";
import type { SessionUser } from "@/lib/commands/define";
import {
  addConflictParties,
  rerunConflictCheck,
  reviewConflictCheck,
} from "@/modules/intake/commands/conflicts";
import {
  CONFLICT_CASES,
  ROSTER_CONTACTS,
  ROSTER_PARTIES,
} from "@/modules/intake/evals/conflicts.cases";
import { seedLead } from "./ai-kit";
import { configureGhlEnv } from "./ghl-kit";
import { asUser, provisionTestFirm, run, withFreshDatabase } from "./helpers";

/*
 * Phase 2 acceptance: "Conflict hits surface for known test collisions."
 * Runs A6 against a real database (pg_trgm candidate retrieval plus the
 * TypeScript matcher) for every golden case.
 */

configureGhlEnv();
const { db } = withFreshDatabase();
let owner: SessionUser;

beforeAll(async () => {
  ({ owner } = await provisionTestFirm());
  for (const c of ROSTER_CONTACTS) {
    const [first, ...rest] = (c.fullName ?? "").split(" ");
    const l = await seedLead({
      first,
      last: rest.join(" "),
      company: c.companyName,
      inbound: null,
      status: c.client ? "retained" : "new",
    });
    await db().update(contacts).set({ fullName: c.fullName }).where(eq(contacts.id, l.contactId));
  }
  await run(addConflictParties, asUser(owner), { parties: ROSTER_PARTIES });
});

describe("A6 conflict pre-screen eval", () => {
  it("has at least 20 cases", () => {
    expect(CONFLICT_CASES.length).toBeGreaterThanOrEqual(20);
  });

  for (const c of CONFLICT_CASES) {
    it(c.name, async () => {
      const l = await seedLead({
        first: c.prospect.first,
        last: c.prospect.last,
        company: c.prospect.company ?? null,
        inbound: null,
        practiceArea: "business",
        answers: c.answers ?? {},
      });
      await db()
        .update(contacts)
        .set({ fullName: `${c.prospect.first} ${c.prospect.last}` })
        .where(eq(contacts.id, l.contactId));
      const r = (await run(rerunConflictCheck, asUser(owner), { leadId: l.leadId })) as {
        checkId: string;
      };
      const hits = await db()
        .select()
        .from(conflictHits)
        .where(eq(conflictHits.checkId, r.checkId));
      const matched = [...new Set(hits.map((h) => h.matchedName))];
      if (c.expectHits.length === 0) expect(matched).toEqual([]);
      else expect(matched).toEqual(expect.arrayContaining(c.expectHits));
      // Never auto-clears.
      const [check] = await db()
        .select()
        .from(conflictChecks)
        .where(eq(conflictChecks.id, r.checkId));
      expect(check!.status).toBe("awaiting_review");
    });
  }

  it("does not match a prospect against their own contact", async () => {
    const l = await seedLead({ first: "Solo", last: "Prospectington", inbound: null });
    const r = (await run(rerunConflictCheck, asUser(owner), { leadId: l.leadId })) as {
      checkId: string;
    };
    const hits = await db().select().from(conflictHits).where(eq(conflictHits.checkId, r.checkId));
    expect(hits).toHaveLength(0);
  });

  it("only a lawyer can clear a check, and only with a note", async () => {
    const l = await seedLead({ first: "Margaret", last: "Okonkwo", inbound: null });
    const r = (await run(rerunConflictCheck, asUser(owner), { leadId: l.leadId })) as {
      checkId: string;
    };
    const paralegal: SessionUser = { ...owner, role: "paralegal" };
    await expect(
      run(reviewConflictCheck, asUser(paralegal), {
        checkId: r.checkId,
        decision: "cleared",
        note: "Different person",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      run(reviewConflictCheck, asUser(owner), {
        checkId: r.checkId,
        decision: "cleared",
        note: "",
      }),
    ).rejects.toMatchObject({ code: "validation" });
    await run(reviewConflictCheck, asUser(owner), {
      checkId: r.checkId,
      decision: "conflict",
      note: "Same person as our client",
    });
    const [check] = await db()
      .select()
      .from(conflictChecks)
      .where(eq(conflictChecks.id, r.checkId));
    expect(check).toMatchObject({ status: "conflict", reviewedBy: owner.id });
    const [lead] = await db().select().from(leads).where(eq(leads.id, l.leadId));
    expect(lead).toBeDefined();
  });
});
