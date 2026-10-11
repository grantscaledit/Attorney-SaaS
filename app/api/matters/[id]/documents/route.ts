import { NextResponse, type NextRequest } from "next/server";
import { requireAnySession } from "@/lib/auth/session";
import { CommandError } from "@/lib/commands/errors";
import { env } from "@/lib/env";
import { getRequestMeta } from "@/lib/request-context";
import { MAX_UPLOAD_BYTES } from "@/modules/documents/commands/documents";
import { uploadDocument } from "@/modules/documents/upload";

export const dynamic = "force-dynamic";

/** Upload one file to a matter (staff app and portal). Multipart: "file", optional "checklistItemId". */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireAnySession();
  // Cross-site request forgery: route handlers lack the origin check server actions get.
  const origin = req.headers.get("origin");
  if (!origin || new URL(origin).host !== new URL(env().APP_URL).host) {
    return NextResponse.json({ error: "Upload from the LexDesk site only." }, { status: 403 });
  }
  const { id } = await params;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
    return NextResponse.json(
      { error: "Files can be up to 25 MB. Split larger files." },
      { status: 413 },
    );
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File))
    return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  const checklistItemId = form?.get("checklistItemId");
  try {
    const r = await uploadDocument({
      user,
      request: await getRequestMeta(),
      matterId: id,
      checklistItemId:
        typeof checklistItemId === "string" && checklistItemId ? checklistItemId : undefined,
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return NextResponse.json(r);
  } catch (err) {
    if (err instanceof CommandError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.code === "not_found" ? 404 : 400 },
      );
    }
    throw err;
  }
}
