import type { Verification } from "@/modules/deadlines/engine";

/** Status is never color alone: these tones always sit beside a label. */
export const SEVERITY_TONE = { critical: "critical", high: "warning", normal: "neutral" } as const;

export const VERIFICATION_TONE: Record<Verification, "good" | "warning" | "critical" | "neutral"> =
  {
    verified: "good",
    unverified: "warning",
    changed_since_verified: "critical",
    inactive: "neutral",
  };
