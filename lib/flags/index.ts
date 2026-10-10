import "server-only";
import { cache } from "react";
import { getDb } from "@/db/client";
import { env } from "@/lib/env";
import { FEATURE_FLAGS, type FeatureFlag } from "./catalog";
import { evaluateFeature, type FeatureState } from "./evaluate";
import { loadFlagOverrides } from "./load";

export * from "./catalog";
export * from "./evaluate";
export { featureEnabledIn, loadFlagOverrides } from "./load";

/** Per-request memoized overrides for server components. */
const requestOverrides = cache(() => loadFlagOverrides(getDb()));

/** The one way application code asks whether a capability is on. */
export async function hasFeature(flag: FeatureFlag): Promise<boolean> {
  return evaluateFeature(env().FIRM_TIER, flag, await requestOverrides()).enabled;
}

export async function allFeatureStates(): Promise<FeatureState[]> {
  const overrides = await requestOverrides();
  return FEATURE_FLAGS.map((flag) => evaluateFeature(env().FIRM_TIER, flag, overrides));
}
