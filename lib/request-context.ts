import "server-only";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { clientIpFromHeaders } from "@/lib/auth/client-ip";

export type RequestMeta = {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
};

export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  return {
    ip: clientIpFromHeaders(h),
    userAgent: h.get("user-agent"),
    requestId: h.get("x-request-id") ?? randomUUID(),
  };
}
