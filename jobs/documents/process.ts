import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { documents } from "@/db/schema";
import { aiCall } from "@/lib/ai/call";
import { execute } from "@/lib/commands/execute";
import { QUEUES } from "@/lib/jobs/queue";
import { log } from "@/lib/log";
import { maskText } from "@/lib/masking";
import { getTextReader } from "@/lib/ocr";
import { getBlobStore } from "@/lib/storage";
import { classifyText, missingPagesNote } from "@/modules/documents/classify";
import { applyProcessing, STALE_DOCUMENT_SQL } from "@/modules/documents/commands/documents";
import { parseNotice, reconcile } from "@/modules/documents/notice-parser";
import {
  B3_PROMPT_VERSION,
  B3_SYSTEM,
  b3Output,
  B4_PROMPT_VERSION,
  B4_SYSTEM,
  b4Output,
} from "@/modules/documents/prompts";
import { automationEnabled } from "@/modules/messaging/commands/outbox";
import { jobContext } from "../context";
import { enqueueSummary } from "../matters/summary";

/*
 * Document processing (B4, B3), outside any transaction: read the text (OCR
 * or text layer), mask it, classify, triage notices, then apply the result
 * with one command. The model only ever sees masked text.
 */

const CLASSIFY_CHARS = 4_000;
const NOTICE_CHARS = 30_000;

export async function processDocument(documentId: string): Promise<void> {
  const { principal, request } = jobContext(QUEUES.documentProcess, documentId);
  const db = getDb();
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!doc || doc.status === "processed") return;
  const apply = (input: Omit<Parameters<typeof applyProcessing.run>[1], "documentId">) =>
    execute(applyProcessing, principal, { documentId, ...input }, { request });

  const store = getBlobStore();
  if (!store) {
    await apply({ error: "storage not configured" });
    return;
  }
  let read;
  try {
    const bytes = await store.get(doc.storageKey);
    read = await getTextReader().read({
      key: doc.storageKey,
      bytes,
      mime: doc.mimeType as "application/pdf",
    });
  } catch (err) {
    log.error("document text could not be read", { documentId, err });
    await apply({ error: "the file could not be read" });
    return;
  }
  const masked = maskText(read.pages.join("\n\n")).text;
  const readResult = {
    engine: read.engine,
    pageCount: read.pages.length,
    unreadablePages: read.unreadablePages,
    confidence: read.confidence,
    maskedText: masked,
    missingPages: missingPagesNote(read.pages),
  };
  if (masked.trim().length < 20) {
    await apply({
      read: readResult,
      classification: { docType: "other", confidence: 0, via: "none" },
    });
    return;
  }

  // B4: rules first, then the model for what the rules cannot place.
  let cls = classifyText(masked);
  if (cls.via === "none" && (await automationEnabled(db, "B4"))) {
    const ai = await aiCall({
      purpose: "documents.classify",
      automationId: "B4",
      promptVersion: B4_PROMPT_VERSION,
      tier: "fast",
      maxTokens: 300,
      system: B4_SYSTEM,
      messages: [{ role: "user", content: masked.slice(0, CLASSIFY_CHARS) }],
      schema: b4Output,
      entity: { type: "document", id: documentId },
    });
    if (ai.ok && ai.output.confidence >= 0.6)
      cls = { docType: ai.output.docType, confidence: ai.output.confidence, via: "model" };
  }

  // B3: notice triage.
  let notice: Parameters<typeof applyProcessing.run>[1]["notice"];
  if (
    (cls.docType === "irs_notice" || cls.docType === "state_tax_notice") &&
    (await automationEnabled(db, "B3"))
  ) {
    const parsed = parseNotice(masked);
    const ai = await aiCall({
      purpose: "documents.notice_triage",
      automationId: "B3",
      promptVersion: B3_PROMPT_VERSION,
      tier: "standard",
      effort: "low",
      maxTokens: 1_500,
      system: B3_SYSTEM,
      messages: [
        {
          role: "user",
          content: `The notice text (identifiers masked):\n"""\n${masked.slice(0, NOTICE_CHARS)}\n"""`,
        },
      ],
      schema: b3Output,
      entity: { type: "document", id: documentId },
    });
    const model = ai.ok ? ai.output : null;
    const r = reconcile(masked, parsed, model);
    notice = {
      fields: r.fields,
      provenance: r.provenance,
      summary: model?.summary ?? null,
      aiRunId: ai.ok ? ai.runId : null,
    };
  }

  const result = await apply({ read: readResult, classification: cls, notice });
  if (result.b7) await enqueueSummary(doc.matterId, "document");
}

/** Uploads whose processing job was lost. */
export async function staleDocuments(limit: number): Promise<string[]> {
  const rows = await getDb()
    .select({ id: documents.id })
    .from(documents)
    .where(and(sql`${STALE_DOCUMENT_SQL}`))
    .orderBy(asc(documents.createdAt))
    .limit(limit);
  return rows.map((r) => r.id);
}
