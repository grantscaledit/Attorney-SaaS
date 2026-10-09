import { eq } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db/client";
import { firmSettings, type FirmSettingsRow } from "@/db/schema";
import { env, type Tier } from "@/lib/env";

/**
 * Firm configuration (rule 8). Deployment identity comes from the environment;
 * everything the firm can edit comes from the `firm_settings` row.
 */
export type FirmConfig = {
  slug: string;
  tier: Tier;
  timezone: string;
  demoMode: boolean;
  settings: FirmSettingsRow;
};

export class FirmNotProvisionedError extends Error {
  constructor() {
    super("This deployment has no firm_settings row. Run scripts/provision-firm.ts.");
    this.name = "FirmNotProvisionedError";
  }
}

export class FirmMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`FIRM_SLUG is "${expected}" but the database belongs to "${actual}". Refusing to serve.`);
    this.name = "FirmMismatchError";
  }
}

export async function loadFirmSettings(db: DbOrTx = getDb()): Promise<FirmSettingsRow> {
  const [row] = await db.select().from(firmSettings).where(eq(firmSettings.id, 1));
  if (!row) throw new FirmNotProvisionedError();
  // Isolation guard: an app configured for one firm must never serve another firm's database.
  if (row.slug !== env().FIRM_SLUG) throw new FirmMismatchError(env().FIRM_SLUG, row.slug);
  return row;
}

export async function loadFirmConfig(db: DbOrTx = getDb()): Promise<FirmConfig> {
  const e = env();
  return {
    slug: e.FIRM_SLUG,
    tier: e.FIRM_TIER,
    timezone: e.FIRM_TIMEZONE,
    demoMode: e.DEMO_MODE,
    settings: await loadFirmSettings(db),
  };
}

/** Short-lived cache for hot paths outside React's request scope (auth hooks). */
let cachedAllowlist: { value: readonly string[]; at: number } | undefined;
const ALLOWLIST_TTL_MS = 30_000;

export async function getIpAllowlist(): Promise<readonly string[]> {
  if (cachedAllowlist && Date.now() - cachedAllowlist.at < ALLOWLIST_TTL_MS)
    return cachedAllowlist.value;
  const settings = await loadFirmSettings();
  cachedAllowlist = { value: settings.ipAllowlist, at: Date.now() };
  return cachedAllowlist.value;
}

export function invalidateFirmCaches(): void {
  cachedAllowlist = undefined;
}
