import type { PracticeArea } from "@/db/schema";

/**
 * Maps values from the snapshot's GHL forms onto LexDesk fields. The intake
 * form's "What do you need help with?" dropdown (ghl/snapshot/manifest.md)
 * sends free text; this turns it into a practice area. Anything unrecognized
 * stays unassigned for a person to route (A5 scoring arrives in Phase 2).
 */
const PRACTICE_AREA_KEYWORDS: Record<PracticeArea, readonly string[]> = {
  tax: ["tax", "irs", "comptroller", "audit", "lien", "levy", "notice"],
  business: ["business", "llc", "entity", "corporation", "contract", "partnership", "formation"],
  estate: [
    "estate",
    "probate",
    "will",
    "trust",
    "inheritance",
    "guardianship",
    "power of attorney",
  ],
};

export function mapPracticeArea(value: string | null | undefined): PracticeArea | null {
  if (!value) return null;
  const v = value.toLowerCase();
  const hits = (Object.keys(PRACTICE_AREA_KEYWORDS) as PracticeArea[]).filter((area) =>
    PRACTICE_AREA_KEYWORDS[area].some((k) => new RegExp(`\\b${k}`).test(v)),
  );
  // Ambiguous answers ("estate tax") go to a person rather than a guess.
  return hits.length === 1 ? hits[0]! : null;
}
