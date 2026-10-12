import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  checklistItems,
  documentExtractions,
  documents,
  documentTexts,
  matters,
  tasks,
} from "@/db/schema";
import type { AuditSpec, Principal } from "@/lib/commands/define";
import { defineCommand } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";
import { requireSystem } from "@/lib/commands/system";
import { maskText } from "@/lib/masking";
import { syncNoticeDeadline } from "@/modules/deadlines/commands/notice";
import { automationEnabled, recordAutomationRun } from "@/modules/messaging/commands/outbox";
import { DOC_TYPE_LABELS, DOC_TYPES } from "@/practice";
import { firmToday, lockMatter, scopeOf } from "@/modules/matters/scope";
import { conventionalName } from "../classify";
import { plainNoticeSummary, type NoticeFields } from "../notice-parser";

/*
 * Documents (B3, B4). Upload stores the file first (route handler), then this
 * command records it; processing (OCR, classification, notice triage) runs in
 * a job and comes back through documents.apply_processing.
 */

const actorId = (p: Principal): string | null => (p.type === "user" ? p.user.id : null);

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const recordUpload = defineCommand({
  name: "documents.upload",
  permission: "documents.write",
  input: z.object({
    matterId: z.uuid(),
    checklistItemId: z.uuid().optional(),
    originalName: z.string().min(1).max(300),
    storageKey: z.string().regex(/^matters\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    mimeType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/tiff"]),
    sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  }),
  async run(ctx, input) {
    const m = await lockMatter(ctx.tx, input.matterId);
    ctx.authorize("documents.write", { resource: await scopeOf(ctx.tx, m) });
    const client = ctx.principal.type === "user" && ctx.principal.user.role === "client";
    if (m.status === "closed" && client)
      throw new CommandError("invalid_state", "This matter is closed.");

    // The same file twice on one matter is one document.
    const [dupe] = await ctx.tx
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.matterId, m.id),
          eq(documents.sha256, input.sha256),
          isNull(documents.deletedAt),
        ),
      );
    if (dupe) {
      return {
        result: { documentId: dupe.id, duplicate: true, process: false },
        audit: [
          {
            action: "documents.duplicate_upload",
            entityType: "document",
            entityId: dupe.id,
            metadata: { matterId: m.id },
          },
        ],
      };
    }
    let item: { id: string; status: string } | undefined;
    if (input.checklistItemId) {
      [item] = await ctx.tx
        .select({ id: checklistItems.id, status: checklistItems.status })
        .from(checklistItems)
        .where(
          and(eq(checklistItems.id, input.checklistItemId), eq(checklistItems.matterId, m.id)),
        );
      if (!item) throw new CommandError("not_found", "Checklist item not found on this matter.");
    }
    const documentId = input.storageKey.split("/")[2]!;
    const ext =
      input.mimeType === "application/pdf"
        ? "pdf"
        : input.mimeType === "image/png"
          ? "png"
          : input.mimeType === "image/tiff"
            ? "tif"
            : "jpg";
    const now = new Date();
    await ctx.tx.insert(documents).values({
      id: documentId,
      matterId: m.id,
      checklistItemId: item?.id ?? null,
      originalName: maskText(input.originalName).text,
      displayName: conventionalName({
        receivedOn: firmToday(now),
        docType: "other",
        detail: "received",
        matterNumber: m.number,
        ext,
      }),
      storageKey: input.storageKey,
      sha256: input.sha256,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      uploadedBy: actorId(ctx.principal),
      uploadedVia: client ? "portal" : "staff",
      sharedWithClient: client,
    });
    const audit: AuditSpec[] = [
      {
        action: "documents.uploaded",
        entityType: "document",
        entityId: documentId,
        after: {
          matterId: m.id,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          via: client ? "portal" : "staff",
          checklistItemId: item?.id ?? null,
        },
      },
    ];
    if (item && item.status === "requested") {
      await ctx.tx
        .update(checklistItems)
        .set({ status: "received", receivedAt: now, documentId, updatedAt: now })
        .where(eq(checklistItems.id, item.id));
      audit.push({
        action: "matters.checklist_received",
        entityType: "matter",
        entityId: m.id,
        after: { checklistItemId: item.id },
      });
    }
    if (client)
      await ctx.tx.update(matters).set({ lastClientContactAt: now }).where(eq(matters.id, m.id));
    return {
      result: { documentId, duplicate: false, process: true },
      audit: audit as [AuditSpec, ...AuditSpec[]],
    };
  },
});

const noticeFields = z.object({
  agency: z.enum(["IRS", "Texas Comptroller", "Other"]).nullable(),
  noticeType: z.string().max(40).nullable(),
  taxYears: z.array(z.string().regex(/^(19|20)\d{2}$/)).max(20),
  amountDue: z
    .string()
    .regex(/^[\d,]+(\.\d{2})?$/)
    .nullable(),
  noticeDate: z.iso.date().nullable(),
  respondBy: z.iso.date().nullable(),
});

const DAY = 86_400_000;

/** Result of the processing job. Text arrives masked; the command masks again before storing. */
export const applyProcessing = defineCommand({
  name: "documents.apply_processing",
  permission: "documents.write",
  input: z.object({
    documentId: z.uuid(),
    error: z.string().max(300).optional(),
    read: z
      .object({
        engine: z.enum(["textract", "text_layer"]),
        pageCount: z.number().int().min(0).max(5_000),
        unreadablePages: z.array(z.number().int().positive()).max(5_000),
        confidence: z.number().min(0).max(1).nullable(),
        maskedText: z.string().max(2_000_000),
        missingPages: z.string().max(300).nullable(),
      })
      .optional(),
    classification: z
      .object({
        docType: z.enum(DOC_TYPES),
        confidence: z.number().min(0).max(1),
        via: z.enum(["rules", "model", "none"]),
      })
      .optional(),
    notice: z
      .object({
        fields: noticeFields,
        provenance: z.record(
          z.string(),
          z.enum(["parser", "model", "both", "conflict"]).nullable(),
        ),
        summary: z.string().max(2_000).nullable(),
        aiRunId: z.uuid().nullable(),
      })
      .optional(),
  }),
  async run(ctx, input) {
    requireSystem(ctx);
    const tx = ctx.tx;
    const [doc] = await tx
      .select()
      .from(documents)
      .where(eq(documents.id, input.documentId))
      .for("update");
    if (!doc) throw new CommandError("not_found", "Document not found.");
    if (doc.status === "processed") {
      return {
        result: { applied: false, b7: false },
        audit: [
          {
            action: "documents.processing_skipped",
            entityType: "document",
            entityId: doc.id,
            metadata: { reason: "already processed" },
          },
        ],
      };
    }
    const m = await lockMatter(tx, doc.matterId);
    const now = new Date();
    if (input.error || !input.read) {
      await tx
        .update(documents)
        .set({ status: "failed", flags: { error: input.error ?? "no text" }, updatedAt: now })
        .where(eq(documents.id, doc.id));
      await tx
        .insert(tasks)
        .values({
          matterId: m.id,
          title: `Review an upload that could not be read: ${doc.originalName}`,
          assigneeId: m.responsibleAttorneyId,
          automationId: "B4",
          dedupeKey: `B4:failed:${doc.id}`,
        })
        .onConflictDoNothing();
      return {
        result: { applied: true, b7: false },
        audit: [
          {
            action: "documents.processing_failed",
            entityType: "document",
            entityId: doc.id,
            metadata: { error: input.error ?? "no text" },
          },
        ],
      };
    }

    const masked = maskText(input.read.maskedText);
    await tx
      .insert(documentTexts)
      .values({
        documentId: doc.id,
        maskedText: masked.text,
        maskedCounts: masked.found,
        confidence: input.read.confidence,
      })
      .onConflictDoUpdate({
        target: documentTexts.documentId,
        set: {
          maskedText: masked.text,
          maskedCounts: masked.found,
          confidence: input.read.confidence,
          updatedAt: now,
        },
      });

    const cls = input.classification ?? {
      docType: "other" as const,
      confidence: 0,
      via: "none" as const,
    };
    const f = input.notice?.fields;
    const detail = f ? [f.noticeType, f.taxYears.join(" ")].filter(Boolean).join(" ") : null;
    const ext =
      doc.storageKey && doc.mimeType === "application/pdf"
        ? "pdf"
        : doc.mimeType === "image/png"
          ? "png"
          : doc.mimeType === "image/tiff"
            ? "tif"
            : "jpg";
    const receivedOn = firmToday(doc.createdAt);
    const flags = {
      ...(input.read.unreadablePages.length ? { unreadablePages: input.read.unreadablePages } : {}),
      ...(input.read.missingPages ? { incomplete: input.read.missingPages } : {}),
    };
    await tx
      .update(documents)
      .set({
        status: "processed",
        docType: cls.docType,
        docTypeConfidence: cls.confidence,
        displayName: conventionalName({
          receivedOn,
          docType: cls.docType,
          detail,
          matterNumber: m.number,
          ext,
        }),
        pageCount: input.read.pageCount,
        ocrEngine: input.read.engine,
        flags: Object.keys(flags).length ? flags : null,
        updatedAt: now,
      })
      .where(eq(documents.id, doc.id));
    const audit: AuditSpec[] = [
      {
        action: "documents.processed",
        entityType: "document",
        entityId: doc.id,
        after: { docType: cls.docType, via: cls.via, pages: input.read.pageCount, flags },
        metadata: { masked: masked.found },
      },
    ];

    // B4: attach to the first open checklist item of the same type.
    if (!doc.checklistItemId && cls.docType !== "other") {
      const [item] = await tx
        .select({ id: checklistItems.id })
        .from(checklistItems)
        .where(
          and(
            eq(checklistItems.matterId, m.id),
            eq(checklistItems.docType, cls.docType),
            eq(checklistItems.status, "requested"),
          ),
        )
        .orderBy(checklistItems.createdAt)
        .limit(1);
      if (item) {
        await tx
          .update(documents)
          .set({ checklistItemId: item.id })
          .where(eq(documents.id, doc.id));
        await tx
          .update(checklistItems)
          .set({ status: "received", receivedAt: now, documentId: doc.id, updatedAt: now })
          .where(eq(checklistItems.id, item.id));
        audit.push({
          action: "matters.checklist_received",
          entityType: "matter",
          entityId: m.id,
          after: { checklistItemId: item.id, via: "B4" },
        });
      }
    }
    if (Object.keys(flags).length) {
      await tx
        .insert(tasks)
        .values({
          matterId: m.id,
          title: `Check upload quality: ${DOC_TYPE_LABELS[cls.docType]} (${input.read.missingPages ?? `unreadable page(s) ${input.read.unreadablePages.join(", ")}`})`,
          assigneeId: m.responsibleAttorneyId,
          automationId: "B4",
          dedupeKey: `B4:quality:${doc.id}`,
        })
        .onConflictDoNothing();
    }
    await recordAutomationRun(tx, {
      automationId: "B4",
      trigger: "document_uploaded",
      status: "succeeded",
      entityType: "document",
      entityId: doc.id,
      detail: { docType: cls.docType, via: cls.via },
    });

    // B3: notice triage. The extraction waits for a person to confirm.
    if (input.notice && f) {
      const summary = maskText(input.notice.summary ?? plainNoticeSummary(f)).text;
      const [ex] = await tx
        .insert(documentExtractions)
        .values({
          documentId: doc.id,
          kind: "tax_notice",
          fields: f,
          provenance: input.notice.provenance,
          summary,
          aiRunId: input.notice.aiRunId,
        })
        .onConflictDoUpdate({
          target: [documentExtractions.documentId, documentExtractions.kind],
          set: {
            fields: f,
            provenance: input.notice.provenance,
            summary,
            aiRunId: input.notice.aiRunId,
            status: "proposed",
            updatedAt: now,
          },
        })
        .returning({ id: documentExtractions.id });
      const label = `${f.agency ?? "Agency"} ${f.noticeType ?? "notice"}${f.taxYears.length ? ` (${f.taxYears.join(", ")})` : ""}`;
      const soon = f.respondBy
        ? Date.parse(`${f.respondBy}T00:00:00Z`) - Date.parse(`${firmToday(now)}T00:00:00Z`) <=
          10 * DAY
        : false;
      await tx
        .insert(tasks)
        .values({
          matterId: m.id,
          title: `Review ${label} and confirm the extracted fields`,
          detail: summary,
          assigneeId: m.responsibleAttorneyId,
          priority: soon ? "urgent" : "normal",
          automationId: "B3",
          dedupeKey: `B3:review:${doc.id}`,
        })
        .onConflictDoNothing();
      if (f.respondBy) {
        // The work item. The date itself is tracked as a deadline (below, C1) with alerts (C2).
        await tx
          .insert(tasks)
          .values({
            matterId: m.id,
            title: `Respond to ${label} (date printed on the notice)`,
            dueOn: f.respondBy,
            dueFromDocument: true,
            assigneeId: m.responsibleAttorneyId,
            priority: soon ? "urgent" : "normal",
            automationId: "B3",
            dedupeKey: `B3:respond:${doc.id}`,
          })
          .onConflictDoNothing();
      }
      audit.push(
        ...(await syncNoticeDeadline(tx, m, doc.id, f, { confirmed: false, actorId: null })),
      );
      await tx
        .update(matters)
        .set({
          summary: maskText(`${summary}${m.summary ? `\n\n${m.summary}` : ""}`).text.slice(
            0,
            8_000,
          ),
          summaryUpdatedAt: now,
          updatedAt: now,
        })
        .where(eq(matters.id, m.id));
      await recordAutomationRun(tx, {
        automationId: "B3",
        trigger: "notice_classified",
        status: "succeeded",
        entityType: "document",
        entityId: doc.id,
        detail: { extractionId: ex!.id, respondBy: f.respondBy, urgent: soon },
      });
      audit.push({
        action: "documents.notice_triaged",
        entityType: "document",
        entityId: doc.id,
        after: {
          noticeType: f.noticeType,
          taxYears: f.taxYears,
          respondBy: f.respondBy,
          conflicts: Object.entries(input.notice.provenance)
            .filter(([, v]) => v === "conflict")
            .map(([k]) => k),
        },
      });
    }
    return {
      result: {
        applied: true,
        b7: input.notice !== undefined && (await automationEnabled(tx, "B7")),
      },
      audit: audit as [AuditSpec, ...AuditSpec[]],
    };
  },
});

/** A person confirms or corrects the B3 fields. A corrected respond-by date moves its task. */
export const confirmExtraction = defineCommand({
  name: "documents.confirm_extraction",
  permission: "documents.write",
  input: z.object({ extractionId: z.uuid(), fields: noticeFields }),
  async run(ctx, input) {
    const [ex] = await ctx.tx
      .select()
      .from(documentExtractions)
      .where(eq(documentExtractions.id, input.extractionId))
      .for("update");
    if (!ex) throw new CommandError("not_found", "Extraction not found.");
    const [doc] = await ctx.tx.select().from(documents).where(eq(documents.id, ex.documentId));
    const m = await lockMatter(ctx.tx, doc!.matterId);
    ctx.authorize("documents.write", { resource: await scopeOf(ctx.tx, m) });
    if (ctx.principal.type === "user" && ctx.principal.user.role === "client")
      throw new CommandError("forbidden", "Not permitted.");
    const before = ex.fields as NoticeFields;
    // Field by field: jsonb does not keep key order, so whole-object JSON comparison is unreliable.
    const changed =
      before.agency !== input.fields.agency ||
      before.noticeType !== input.fields.noticeType ||
      before.amountDue !== input.fields.amountDue ||
      before.noticeDate !== input.fields.noticeDate ||
      before.respondBy !== input.fields.respondBy ||
      [...before.taxYears].sort().join() !== [...input.fields.taxYears].sort().join();
    const now = new Date();
    await ctx.tx
      .update(documentExtractions)
      .set({
        fields: input.fields,
        status: changed ? "corrected" : "confirmed",
        reviewedBy: actorId(ctx.principal),
        reviewedAt: now,
        updatedAt: now,
      })
      .where(eq(documentExtractions.id, ex.id));
    if (before.respondBy !== input.fields.respondBy) {
      await ctx.tx
        .update(tasks)
        .set({ dueOn: input.fields.respondBy, updatedAt: now })
        .where(and(eq(tasks.dedupeKey, `B3:respond:${doc!.id}`), eq(tasks.status, "open")));
    }
    const deadlineAudit = await syncNoticeDeadline(ctx.tx, m, doc!.id, input.fields, {
      confirmed: true,
      actorId: actorId(ctx.principal),
    });
    await ctx.tx
      .update(tasks)
      .set({
        status: "done",
        completedAt: now,
        completedBy: actorId(ctx.principal),
        updatedAt: now,
      })
      .where(and(eq(tasks.dedupeKey, `B3:review:${doc!.id}`), eq(tasks.status, "open")));
    return {
      result: { status: changed ? "corrected" : "confirmed" },
      audit: [
        {
          action: changed ? "documents.extraction_corrected" : "documents.extraction_confirmed",
          entityType: "document",
          entityId: doc!.id,
          before: changed ? before : undefined,
          after: changed ? input.fields : { status: "confirmed" },
        },
        ...deadlineAudit,
      ],
    };
  },
});

export const setDocumentType = defineCommand({
  name: "documents.set_type",
  permission: "documents.write",
  input: z.object({ documentId: z.uuid(), docType: z.enum(DOC_TYPES) }),
  async run(ctx, input) {
    const [doc] = await ctx.tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, input.documentId), isNull(documents.deletedAt)))
      .for("update");
    if (!doc) throw new CommandError("not_found", "Document not found.");
    const m = await lockMatter(ctx.tx, doc.matterId);
    ctx.authorize("documents.write", { resource: await scopeOf(ctx.tx, m) });
    if (ctx.principal.type === "user" && ctx.principal.user.role === "client")
      throw new CommandError("forbidden", "Not permitted.");
    const ext = doc.displayName.split(".").pop() ?? "pdf";
    const displayName = conventionalName({
      receivedOn: firmToday(doc.createdAt),
      docType: input.docType,
      matterNumber: m.number,
      ext,
    });
    await ctx.tx
      .update(documents)
      .set({ docType: input.docType, docTypeConfidence: 1, displayName, updatedAt: new Date() })
      .where(eq(documents.id, doc.id));
    return {
      result: { displayName },
      audit: [
        {
          action: "documents.type_set",
          entityType: "document",
          entityId: doc.id,
          before: { docType: doc.docType },
          after: { docType: input.docType },
        },
      ],
    };
  },
});

export const shareDocument = defineCommand({
  name: "documents.share",
  permission: "documents.write",
  input: z.object({ documentId: z.uuid(), shared: z.boolean() }),
  async run(ctx, input) {
    const [doc] = await ctx.tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, input.documentId), isNull(documents.deletedAt)))
      .for("update");
    if (!doc) throw new CommandError("not_found", "Document not found.");
    const m = await lockMatter(ctx.tx, doc.matterId);
    ctx.authorize("documents.write", { resource: await scopeOf(ctx.tx, m) });
    if (ctx.principal.type === "user" && ctx.principal.user.role === "client")
      throw new CommandError("forbidden", "Not permitted.");
    if (doc.isDraft && input.shared)
      throw new CommandError("invalid_state", "Drafts are never shared with the client.");
    await ctx.tx
      .update(documents)
      .set({ sharedWithClient: input.shared, updatedAt: new Date() })
      .where(eq(documents.id, doc.id));
    return {
      result: { shared: input.shared },
      audit: [
        {
          action: input.shared ? "documents.shared" : "documents.unshared",
          entityType: "document",
          entityId: doc.id,
        },
      ],
    };
  },
});

/** Every download is on the record: who, which document, from where. */
export const logDownload = defineCommand({
  name: "documents.download",
  permission: "documents.read",
  input: z.object({ documentId: z.uuid() }),
  async run(ctx, input) {
    const [doc] = await ctx.tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, input.documentId), isNull(documents.deletedAt)));
    if (!doc) throw new CommandError("not_found", "Document not found.");
    const [m] = await ctx.tx.select().from(matters).where(eq(matters.id, doc.matterId));
    ctx.authorize("documents.read", { resource: await scopeOf(ctx.tx, m!) });
    const client = ctx.principal.type === "user" && ctx.principal.user.role === "client";
    if (client && (!doc.sharedWithClient || doc.isDraft))
      throw new CommandError("not_found", "Document not found.");
    return {
      result: { storageKey: doc.storageKey, fileName: doc.displayName, mimeType: doc.mimeType },
      audit: [
        {
          action: "documents.downloaded",
          entityType: "document",
          entityId: doc.id,
          metadata: { matterId: m!.id, via: client ? "portal" : "staff" },
        },
      ],
    };
  },
});

/** Documents left unprocessed (lost job): picked up by the sweep. */
export const STALE_DOCUMENT_SQL = sql`${documents.status} = 'stored' and ${documents.createdAt} < now() - interval '3 minutes'`;
