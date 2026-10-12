import { calendarFeedFor } from "@/modules/deadlines/queries";

/*
 * C6 calendar feed. Calendar apps cannot sign in, so the private token in the
 * path is the credential: calendarFeedFor() checks its hash, the person's
 * status and role, and the C6 switch. Anything else is a plain 404.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token.replace(/\.ics$/, "");
  const ics = await calendarFeedFor(token);
  if (!ics) return new Response("Not found", { status: 404 });
  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
    },
  });
}
