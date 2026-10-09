import type { NextRequest } from "next/server";
import { can } from "@/lib/auth/can";
import { getRawSession, requireSession } from "@/lib/auth/session";
import type { Command } from "@/lib/commands/define";
import { execute } from "@/lib/commands/execute";
import { env } from "@/lib/env";
import { getRequestMeta } from "@/lib/request-context";
import { auditFilterSchema, exportAuditEvents } from "@/modules/audit/queries";
import { recordAuditExport } from "@/modules/audit/commands/record-export";
import type { z } from "zod";

export const dynamic = "force-dynamic";

const COLUMNS = [
  "seq",
  "occurred_at_utc",
  "actor_type",
  "actor_id",
  "actor_label",
  "action",
  "entity_type",
  "entity_id",
  "before",
  "after",
  "metadata",
  "ip",
  "user_agent",
  "request_id",
  "prev_hash",
  "hash",
] as const;

/** RFC 4180 field; also neutralizes spreadsheet formula injection. */
function csvField(value: unknown): string {
  let s =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Owner-only export of the audit log (spec Section 4: "exportable by the firm
 * owner"). Includes the hash columns so the firm can verify the chain offline.
 */
export async function GET(request: NextRequest): Promise<Response> {
  if (!(await getRawSession())) return new Response("Unauthorized", { status: 401 });
  const session = await requireSession();
  if (!can(session.user, "audit.export", { policy: session.policy }))
    return new Response("Forbidden", { status: 403 });

  const filters = auditFilterSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const { before: _before, ...recorded } = filters;
  await execute(
    recordAuditExport as unknown as Command<z.ZodType, unknown>,
    { type: "user", user: session.user },
    { filters: recorded, format: "csv" },
    { request: await getRequestMeta() },
  );

  const tz = env().FIRM_TIMEZONE;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(COLUMNS.join(",") + "\r\n"));
      for await (const batch of exportAuditEvents(session.user, filters, tz)) {
        const lines = batch.map((r) =>
          [
            r.seq,
            r.occurredAt.toISOString(),
            r.actorType,
            r.actorId,
            r.actorLabel,
            r.action,
            r.entityType,
            r.entityId,
            r.before,
            r.after,
            r.metadata,
            r.ip,
            r.userAgent,
            r.requestId,
            r.prevHash,
            r.hash,
          ]
            .map(csvField)
            .join(","),
        );
        controller.enqueue(encoder.encode(lines.join("\r\n") + "\r\n"));
      }
      controller.close();
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-log-${env().FIRM_SLUG}-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
