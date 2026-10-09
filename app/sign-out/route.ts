import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/lib/auth/auth";

export const dynamic = "force-dynamic";

const REASONS = new Set(["idle", "expired", "disabled", "network"]);

/**
 * Ends the session and returns to sign-in. GET so that server-side guards
 * (idle timeout, absolute lifetime, IP allowlist) can redirect here; the worst
 * a cross-site request can do is sign someone out.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const reason = request.nextUrl.searchParams.get("reason");
  const target = new URL("/sign-in", request.nextUrl.origin);
  if (reason && REASONS.has(reason)) target.searchParams.set("reason", reason);

  const result = await getAuth()
    .api.signOut({ headers: request.headers, asResponse: true })
    .catch(() => null);
  const response = NextResponse.redirect(target, { status: 303 });
  // Forward Better Auth's cookie-clearing headers.
  for (const cookie of result?.headers.getSetCookie() ?? [])
    response.headers.append("set-cookie", cookie);
  return response;
}
