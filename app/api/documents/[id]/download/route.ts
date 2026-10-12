import { NextResponse, type NextRequest } from "next/server";
import { requireAnySession } from "@/lib/auth/session";
import { CommandError } from "@/lib/commands/errors";
import { execute } from "@/lib/commands/execute";
import { log } from "@/lib/log";
import { getRequestMeta } from "@/lib/request-context";
import { getBlobStore } from "@/lib/storage";
import { logDownload } from "@/modules/documents/commands/documents";

export const dynamic = "force-dynamic";

/**
 * Document download for staff and portal clients. Permission is checked and
 * the download audited by documents.download; then the browser gets a
 * 5-minute signed URL (S3) or the bytes (local store).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireAnySession();
  const { id } = await params;
  let file: { storageKey: string; fileName: string; mimeType: string };
  try {
    file = await execute(
      logDownload,
      { type: "user", user },
      { documentId: id },
      { request: await getRequestMeta() },
    );
  } catch (err) {
    if (err instanceof CommandError) return new NextResponse("Not found", { status: 404 });
    throw err;
  }
  const store = getBlobStore();
  if (!store) return new NextResponse("Document storage is not configured", { status: 503 });
  const signed = await store.signedDownloadUrl(file.storageKey, file.fileName, file.mimeType);
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (signed) return NextResponse.redirect(signed, { status: 303, headers });
  try {
    const bytes = await store.get(file.storageKey);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        ...headers,
        "Content-Type": file.mimeType,
        "Content-Disposition": `attachment; filename="${file.fileName.replace(/["\\\r\n]/g, "_")}"`,
      },
    });
  } catch (err) {
    log.error("document bytes missing", { documentId: id, err });
    return new NextResponse("Not found", { status: 404 });
  }
}
