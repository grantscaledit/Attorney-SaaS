import type { Tier } from "@/lib/env";
import { FEATURES, SOLO_USER_LIMIT, type FeatureFlag } from "./catalog";

export type FlagOverrides = Partial<Record<FeatureFlag, boolean>>;

export type FeatureState = {
  flag: FeatureFlag;
  /** Included in the firm's tier. */
  inTier: boolean;
  /** Effective value after overrides. */
  enabled: boolean;
  /** True when a firm override switched it off. */
  disabledByFirm: boolean;
};

export function tierIncludes(tier: Tier, flag: FeatureFlag): boolean {
  return (FEATURES[flag].tiers as readonly Tier[]).includes(tier);
}

/**
 * Pure flag evaluation. A firm override can switch a tier feature off; it can
 * never switch on a feature the tier does not include.
 */
export function evaluateFeature(
  tier: Tier,
  flag: FeatureFlag,
  overrides: FlagOverrides = {},
): FeatureState {
  const inTier = tierIncludes(tier, flag);
  const override = overrides[flag];
  const disabledByFirm = inTier && override === false;
  return { flag, inTier, enabled: inTier && !disabledByFirm, disabledByFirm };
}

export function isFeatureEnabled(
  tier: Tier,
  flag: FeatureFlag,
  overrides: FlagOverrides = {},
): boolean {
  return evaluateFeature(tier, flag, overrides).enabled;
}

/** Maximum active staff users for the tier, or null for unlimited. */
export function userLimit(tier: Tier): number | null {
  return tierIncludes(tier, "platform.unlimited_users") ? null : SOLO_USER_LIMIT;
}
