import type { DbOrTx } from "@/db/client";
import { featureFlags } from "@/db/schema";
import { env } from "@/lib/env";
import { isFeatureFlag, type FeatureFlag } from "./catalog";
import { isFeatureEnabled, type FlagOverrides } from "./evaluate";

/** Firm overrides from the database. Safe outside React (worker, commands). */
export async function loadFlagOverrides(db: DbOrTx): Promise<FlagOverrides> {
  const rows = await db
    .select({ key: featureFlags.key, enabled: featureFlags.enabled })
    .from(featureFlags);
  const overrides: FlagOverrides = {};
  for (const row of rows) if (isFeatureFlag(row.key)) overrides[row.key] = row.enabled;
  return overrides;
}

/** hasFeature() for jobs and commands: reads overrides through the given handle. */
export async function featureEnabledIn(db: DbOrTx, flag: FeatureFlag): Promise<boolean> {
  return isFeatureEnabled(env().FIRM_TIER, flag, await loadFlagOverrides(db));
}
