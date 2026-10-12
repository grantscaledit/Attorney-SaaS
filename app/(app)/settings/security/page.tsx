import type { Metadata } from "next";
import { headers } from "next/headers";
import { PageHeader } from "@/components/ui/panel";
import { getAuth } from "@/lib/auth/auth";
import { AUTH_POLICY } from "@/lib/auth/config";
import { requireSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { formatDateTime, formatRelative } from "@/lib/ui/format";
import { SecurityPanels, type SessionView } from "./security-panels";

export const metadata: Metadata = { title: "Sign-in and security" };

function describeAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Android/.test(ua)
          ? "Android"
          : /Linux/.test(ua)
            ? "Linux"
            : "Unknown OS";
  return `${browser} on ${os}`;
}

export default async function SecurityPage() {
  const session = await requireSession();
  const tz = env().FIRM_TIMEZONE;
  const list = await getAuth().api.listSessions({ headers: await headers() });

  const sessions: SessionView[] = list
    .map((s) => ({
      id: s.id,
      device: describeAgent(s.userAgent),
      ip: s.ipAddress ?? null,
      signedIn: formatDateTime(s.createdAt, tz),
      lastActive: formatRelative(
        new Date(new Date(s.expiresAt).getTime() - AUTH_POLICY.idleTimeoutSeconds * 1000),
      ),
      current: s.id === session.sessionId,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current));

  return (
    <>
      <PageHeader
        title="Sign-in and security"
        description={`${session.user.email}. Your account uses a password and an authenticator app. Sessions end after 30 minutes without activity.`}
      />
      <SecurityPanels sessions={sessions} minPasswordLength={AUTH_POLICY.minPasswordLength} />
    </>
  );
}
