import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { documents, users } from "@/db/schema";
import type { SessionUser } from "@/lib/commands/define";
import { MemoryStore, setBlobStoreForTesting } from "@/lib/storage";
import { rerunConflictCheck, reviewConflictCheck } from "@/modules/intake/commands/conflicts";
import { openMatter } from "@/modules/matters/commands/matters";
import { seedLead } from "./ai-kit";
import { SYSTEM, asUser, run } from "./helpers";
import { textPdf } from "./pdf";

/* Phase 3 test data: synthetic clients only. */

export const store = new MemoryStore();
export function installStore(): MemoryStore {
  setBlobStoreForTesting(store);
  return store;
}

export async function openTestMatter(
  owner: SessionUser,
  opts: {
    practiceArea?: "tax" | "business" | "estate";
    matterType?: string;
    first?: string;
    email?: string | null;
  } = {},
) {
  const l = await seedLead({
    status: "consult_held",
    inbound: null,
    first: opts.first,
    email: opts.email,
  });
  const r = (await run(openMatter, asUser(owner), {
    leadId: l.leadId,
    practiceArea: opts.practiceArea ?? "tax",
    matterType: opts.matterType ?? "notice_response",
  })) as {
    matterId: string;
    number: string;
    portal: { setupUrl?: string; userId?: string; skipped?: string } | null;
  };
  return { ...r, leadId: l.leadId, contactId: l.contactId };
}

/** Stores a file and returns the input the documents.upload command takes. */
export async function storedPdf(matterId: string, pages: string[][]) {
  const bytes = textPdf(pages);
  const id = randomUUID();
  const storageKey = `matters/${matterId}/${id}`;
  await store.put(storageKey, bytes, "application/pdf");
  return {
    matterId,
    originalName: "notice.pdf",
    storageKey,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mimeType: "application/pdf" as const,
    sizeBytes: bytes.byteLength,
  };
}

export async function documentFor(matterId: string) {
  const [d] = await getDb().select().from(documents).where(eq(documents.matterId, matterId));
  return d!;
}

/** The portal user B1 created for a matter's client, as a session user. */
export async function clientUser(contactId: string): Promise<SessionUser> {
  const [u] = await getDb()
    .select()
    .from(users)
    .where(and(eq(users.contactId, contactId), eq(users.role, "client")));
  if (!u) throw new Error("no client user");
  return { id: u.id, email: u.email, name: u.name, role: "client", status: "active" };
}

/** A lead whose conflict pre-screen a lawyer has cleared (A9 requires it). */
export async function clearedLead(owner: SessionUser, first = "Casey") {
  const l = await seedLead({ status: "consult_held", inbound: null, first });
  const c = (await run(rerunConflictCheck, asUser(owner), { leadId: l.leadId })) as {
    checkId: string;
  };
  await run(reviewConflictCheck, asUser(owner), {
    checkId: c.checkId,
    decision: "cleared",
    note: "No overlap found",
  });
  return l;
}

export { SYSTEM };
