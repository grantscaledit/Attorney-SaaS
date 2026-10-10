import { createHash } from "node:crypto";
import type { LeadChannel } from "@/db/schema";
import type { GhlAttribution } from "@/lib/ghl/schemas";

/*
 * F1 source attribution: turns GHL attribution records, form UTM fields and
 * call tracking numbers into lead touches with one normalized source label.
 * Pure functions; the mirror writes the rows.
 */

export const SOURCE_LABELS = {
  google_ads: "Google Ads",
  meta_ads: "Facebook and Instagram ads",
  paid_other: "Other paid",
  organic_search: "Organic search",
  social: "Social media",
  email: "Email",
  referral_web: "Referring website",
  referral: "Referral",
  website: "Website",
  phone: "Phone",
  direct: "Direct",
  unknown: "Unknown",
} as const;

export type SourceLabel = keyof typeof SOURCE_LABELS;

export function sourceDisplayName(label: string): string {
  return label in SOURCE_LABELS ? SOURCE_LABELS[label as SourceLabel] : label;
}

export type TouchInput = {
  occurredAt: Date;
  origin: string;
  channel: LeadChannel;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  referrer?: string | null;
  landingUrl?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  trackingNumber?: string | null;
  ghlSource?: string | null;
};

const SEARCH_ENGINES = /(^|\.)(google|bing|yahoo|duckduckgo|ecosia|search\.brave)\./i;
const SOCIAL = /(facebook|instagram|fb|meta|linkedin|twitter|x\.com|tiktok|nextdoor|youtube)/i;
const PAID_MEDIUM = /^(cpc|ppc|paid|paidsearch|paid_search|paid-social|paid_social|display|cpm)$/i;

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * One label per touch, most specific signal first: click ids, then UTM tags,
 * then the referrer, then what GHL recorded, then the channel itself.
 */
export function sourceLabelFor(t: TouchInput, firmHost?: string | null): SourceLabel {
  const source = t.utmSource?.toLowerCase() ?? "";
  const medium = t.utmMedium?.toLowerCase() ?? "";
  if (t.gclid) return "google_ads";
  if (t.fbclid && PAID_MEDIUM.test(medium)) return "meta_ads";
  if (source) {
    const paid = PAID_MEDIUM.test(medium);
    if (/google/.test(source)) return paid ? "google_ads" : "organic_search";
    if (SOCIAL.test(source)) return paid ? "meta_ads" : "social";
    if (medium === "email" || /newsletter|mail/.test(source)) return "email";
    if (/referral|partner|cpa/.test(medium) || /referral/.test(source)) return "referral";
    return paid ? "paid_other" : "referral_web";
  }
  if (t.fbclid) return "social";
  const ref = hostOf(t.referrer);
  if (ref && ref !== firmHost) {
    if (SEARCH_ENGINES.test(ref)) return "organic_search";
    if (SOCIAL.test(ref)) return "social";
    return "referral_web";
  }
  const ghl = t.ghlSource?.toLowerCase() ?? "";
  if (/referr/.test(ghl)) return "referral";
  if (/google ads|adwords/.test(ghl)) return "google_ads";
  if (/facebook|instagram/.test(ghl)) return "social";
  if (t.channel === "call" || t.trackingNumber) return "phone";
  if (t.channel === "form" || t.channel === "chat" || /form|website|chat|widget/.test(ghl)) {
    return "website";
  }
  if (t.channel === "email") return "email";
  return ref === firmHost && ref ? "direct" : "unknown";
}

export function touchFromGhlAttribution(
  a: GhlAttribution,
  occurredAt: Date,
  origin: "ghl_first_attribution" | "ghl_last_attribution",
  channel: LeadChannel,
): TouchInput {
  return {
    occurredAt,
    origin,
    channel,
    utmSource: a.utmSource,
    utmMedium: a.utmMedium ?? a.medium,
    utmCampaign: a.campaign,
    utmContent: a.utmContent,
    referrer: a.referrer,
    landingUrl: a.url && /^https?:\/\//.test(a.url) ? a.url : null,
    gclid: a.gclid,
    fbclid: a.fbclid,
  };
}

/** Same touch for the same lead always hashes to the same key (replays, reconciliation). */
export function touchDedupeKey(leadId: string, t: TouchInput): string {
  const material = JSON.stringify([
    leadId,
    t.origin,
    t.utmSource ?? null,
    t.utmMedium ?? null,
    t.utmCampaign ?? null,
    t.utmContent ?? null,
    t.referrer ?? null,
    t.landingUrl ?? null,
    t.gclid ?? null,
    t.fbclid ?? null,
    t.trackingNumber ?? null,
    t.origin.startsWith("ghl_") ? null : t.occurredAt.toISOString(),
  ]);
  return createHash("sha256").update(material).digest("hex");
}
