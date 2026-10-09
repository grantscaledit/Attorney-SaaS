import "server-only";
import { cache } from "react";
import { getDb, type DbOrTx } from "@/db/client";
import { featureFlags } from "@/db/schema";
import { env } from "@/lib/env";
import { FEATURE_FLAGS, isFeatureFlag, type FeatureFlag } from "./catalog";
import { evaluateFeature, type FeatureState, type FlagOverrides } from "./evaluate";

export * from "./catalog";
export * from "./evaluate";

export async function loadFlagOverrides(db: DbOrTx = getDb()): Promise<FlagOverrides> {
  const rows = await db.select({ key: featureFlags.key, enabled: featureFlags.enabled }).from(featureFlags);
  const overrides: FlagOverrides = {};
  for (const row of rows) if (isFeatureFlag(row.key)) overrides[row.key] = row.enabled;
  return overrides;
}

/** Per-request memoized overrides for server components. */
const requestOverrides = cache(() => loadFlagOverrides());

/** The one way application code asks whether a capability is on. */
export async function hasFeature(flag: FeatureFlag): Promise<boolean> {
  return evaluateFeature(env().FIRM_TIER, flag, await requestOverrides()).enabled;
}

export async function allFeatureStates(): Promise<FeatureState[]> {
  const overrides = await requestOverrides();
  return FEATURE_FLAGS.map((flag) => evaluateFeature(env().FIRM_TIER, flag, overrides));
}
