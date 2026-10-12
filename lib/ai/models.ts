import { env } from "@/lib/env";

/**
 * Model tiers (spec Section 2: fast for classification and chat turns,
 * standard for extraction and drafting, deep for briefs and reports).
 *
 * Defaults checked 2026-10-11 against Anthropic's current model list
 * (Claude API skill reference, cached 2026-10-06). The spec's 4.x IDs are
 * superseded; MODEL_FAST / MODEL_STANDARD / MODEL_DEEP override per firm.
 */
export type ModelTier = "fast" | "standard" | "deep";

export const DEFAULT_MODELS: Record<ModelTier, string> = {
  fast: "claude-haiku-5-5",
  standard: "claude-sonnet-5-5",
  deep: "claude-opus-5-5",
};

/** USD per million tokens, Anthropic first-party rates (same source). */
const PRICING: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
};

/** Models that accept the server-side refusal fallback `fallbacks: "default"`. */
const FALLBACK_CAPABLE = new Set([
  "claude-sonnet-5-5",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-fable-5-1",
]);

export function modelFor(tier: ModelTier): string {
  const e = env();
  const override =
    tier === "fast" ? e.MODEL_FAST : tier === "standard" ? e.MODEL_STANDARD : e.MODEL_DEEP;
  return override ?? DEFAULT_MODELS[tier];
}

export function supportsRefusalFallback(model: string): boolean {
  return FALLBACK_CAPABLE.has(model);
}

/** Estimated cost in USD, or null for a model without a price on file. */
export function estimateCost(
  model: string,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number },
): number | null {
  const p = PRICING[model];
  if (!p) return null;
  return (
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.cacheRead) /
    1_000_000
  );
}
