import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { matters } from "@/db/schema";
import type { AuditRequest } from "@/lib/audit/record";
import { can } from "@/lib/auth/can";
import type { SessionUser } from "@/lib/commands/define";
import { CommandError } from "@/lib/commands/errors";
import { execute } from "@/lib/commands/execute";
import { enqueueSafely, QUEUES } from "@/lib/jobs/queue";
import { sniffFileKind } from "@/lib/ocr";
import { getBlobStore } from "@/lib/storage";
import { scopeOf } from "@/modules/matters/scope";
import { MAX_UPLOAD_BYTES, recordUpload } from "./commands/documents";

/**
 * Stores an uploaded file in the firm's bucket and records it (staff app and
 * portal). Permission is checked before anything is written, the type is read
 * from the bytes, and processing is queued after commit.
 */
export async function uploadDocument(input: {
  user: SessionUser;
  request: AuditRequest;
  matterId: string;
  checklistItemId?: string;
  fileName: string;
  bytes: Uint8Array;
}): Promise<{ documentId: string; duplicate: boolean }> {
  const db = getDb();
  const [m] = await db
    .select()
    .from(matters)
    .where(and(eq(matters.id, input.matterId), isNull(matters.deletedAt)));
  if (!m || !can(input.user, "documents.write", { resource: await scopeOf(db, m) })) {
    throw new CommandError("not_found", "Matter not found.");
  }
  if (input.bytes.byteLength === 0) throw new CommandError("validation", "The file is empty.");
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new CommandError("validation", "Files can be up to 25 MB. Split larger files.");
  }
  const kind = sniffFileKind(input.bytes);
  if (!kind) throw new CommandError("validation", "Upload a PDF, JPEG, PNG or TIFF file.");
  const store = getBlobStore();
  if (!store)
    throw new CommandError(
      "invalid_state",
      "Document storage is not configured. Ask the firm's administrator.",
    );

  const documentId = randomUUID();
  const storageKey = `matters/${m.id}/${documentId}`;
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  await store.put(storageKey, input.bytes, kind.mime);
  const r = await execute(
    recordUpload,
    { type: "user", user: input.user },
    {
      matterId: m.id,
      checklistItemId: input.checklistItemId,
      originalName: input.fileName.slice(0, 300) || "upload",
      storageKey,
      sha256,
      mimeType: kind.mime,
      sizeBytes: input.bytes.byteLength,
    },
    { request: input.request },
  );
  if (r.process)
    await enqueueSafely(
      QUEUES.documentProcess,
      { documentId: r.documentId },
      { singletonKey: r.documentId },
    );
  return { documentId: r.documentId, duplicate: r.duplicate };
}
