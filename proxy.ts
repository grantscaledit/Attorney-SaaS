import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_PREFIX } from "@/lib/auth/config";

/**
 * Edge of every request:
 *  1. Content-Security-Policy with a per-request nonce (Next applies it to its own scripts).
 *  2. A request id for log and audit correlation.
 *  3. A cheap redirect to sign-in when no session cookie is present. This is an
 *     optimization only; real authorization happens in requireSession().
 */
const PUBLIC_PREFIXES = [
  "/sign-in",
  "/invite/",
  "/sign-out",
  "/api/auth/",
  "/api/health",
  "/setup/mfa",
];

export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  if (!requestHeaders.get("x-request-id")) requestHeaders.set("x-request-id", crypto.randomUUID());

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some(
    (p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p),
  );
  const hasSessionCookie = request.cookies
    .getAll()
    .some(
      (c) =>
        c.name.startsWith(`${SESSION_COOKIE_PREFIX}.session_token`) ||
        c.name.startsWith(`__Secure-${SESSION_COOKIE_PREFIX}.session_token`),
    );

  let response: NextResponse;
  if (!isPublic && !hasSessionCookie) {
    response = NextResponse.redirect(new URL("/sign-in", request.url));
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }
  response.headers.set("content-security-policy", csp);
  response.headers.set("x-request-id", requestHeaders.get("x-request-id")!);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets.
    { source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:woff2?|png|svg|ico)$).*)" },
  ],
};
