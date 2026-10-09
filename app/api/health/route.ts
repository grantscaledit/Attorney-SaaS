import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { env } from "@/lib/env";
import { loadFirmSettings } from "@/lib/firm.config";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * Render health check. Healthy means: environment valid, database reachable,
 * migrations applied, and the database belongs to this firm. Returns no firm
 * data beyond pass/fail.
 */
export async function GET(): Promise<NextResponse> {
  const checks: Record<string, "ok" | "fail"> = { env: "fail", database: "fail", firm: "fail" };
  try {
    env();
    checks.env = "ok";
    await getDb().execute(sql`SELECT 1`);
    checks.database = "ok";
    await loadFirmSettings();
    checks.firm = "ok";
  } catch (err) {
    log.error("health check failed", { err, checks });
  }
  const healthy = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json(
    {
      status: healthy ? "ok" : "unhealthy",
      checks,
      version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? "dev",
    },
    { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
