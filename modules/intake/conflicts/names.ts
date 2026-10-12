/**
 * Name matching for the A6 conflict pre-screen. Pure functions; the database
 * only retrieves candidates (pg_trgm), this decides what is a hit.
 *
 * Conservative by design: a false positive costs a reviewer a few seconds, a
 * missed conflict is an ethics problem. Nothing here ever clears a conflict;
 * a person reviews every check (spec Section 7, A6).
 */

const NICKNAMES: Record<string, string> = {
  bob: "robert",
  bobby: "robert",
  rob: "robert",
  robbie: "robert",
  bert: "robert",
  bill: "william",
  billy: "william",
  will: "william",
  willie: "william",
  liam: "william",
  liz: "elizabeth",
  lizzie: "elizabeth",
  beth: "elizabeth",
  betsy: "elizabeth",
  betty: "elizabeth",
  eliza: "elizabeth",
  libby: "elizabeth",
  jim: "james",
  jimmy: "james",
  jamie: "james",
  mike: "michael",
  mikey: "michael",
  mick: "michael",
  kate: "katherine",
  katie: "katherine",
  kathy: "katherine",
  cathy: "katherine",
  catherine: "katherine",
  kathryn: "katherine",
  kat: "katherine",
  tom: "thomas",
  tommy: "thomas",
  dick: "richard",
  rick: "richard",
  ricky: "richard",
  rich: "richard",
  dave: "david",
  davey: "david",
  joe: "joseph",
  joey: "joseph",
  chris: "christopher",
  kit: "christopher",
  matt: "matthew",
  dan: "daniel",
  danny: "daniel",
  steve: "steven",
  stephen: "steven",
  tony: "anthony",
  ed: "edward",
  eddie: "edward",
  ted: "edward",
  ned: "edward",
  sam: "samuel",
  sammy: "samuel",
  alex: "alexander",
  andy: "andrew",
  drew: "andrew",
  nick: "nicholas",
  nicky: "nicholas",
  sue: "susan",
  susie: "susan",
  suzy: "susan",
  jen: "jennifer",
  jenny: "jennifer",
  peggy: "margaret",
  maggie: "margaret",
  meg: "margaret",
  marge: "margaret",
  nate: "nathan",
  nathaniel: "nathan",
  ben: "benjamin",
  benny: "benjamin",
  greg: "gregory",
  jon: "john",
  johnny: "john",
  jack: "john",
  larry: "lawrence",
  charlie: "charles",
  chuck: "charles",
  hank: "henry",
  harry: "henry",
  jerry: "gerald",
  ron: "ronald",
  ronnie: "ronald",
  don: "donald",
  donnie: "donald",
  ken: "kenneth",
  kenny: "kenneth",
  deb: "deborah",
  debbie: "deborah",
  debra: "deborah",
  becky: "rebecca",
  vicky: "victoria",
  vickie: "victoria",
  cindy: "cynthia",
  mandy: "amanda",
  abby: "abigail",
  sandy: "sandra",
  tina: "christina",
  christine: "christina",
  kristina: "christina",
  pat: "patricia",
  patty: "patricia",
  trish: "patricia",
  terri: "teresa",
  terry: "teresa",
  theresa: "teresa",
};

const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "rev", "hon", "prof"]);
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v", "esq", "md", "phd", "cpa"]);
const ORG_SUFFIXES = new Set([
  "llc",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "pllc",
  "pc",
  "lp",
  "llp",
  "ltd",
  "limited",
  "the",
  "dba",
  "plc",
  "lc",
  "pa",
]);
const ORG_HINT =
  /\b(llc|l\.l\.c|inc|corp|corporation|company|co\.|pllc|llp|lp|ltd|holdings|group|partners|bank|properties|enterprises|services|ventures|trust company|associates|construction|consulting|capital|realty|foundation|church|ministries|logistics)\b/i;

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.'’`]/g, "")
    .replace(/[^a-z0-9& ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

export function isOrganization(name: string): boolean {
  return ORG_HINT.test(name);
}

/** "Smith, Robert J. Jr." -> "robert smith" (nickname canonical, initials and suffixes dropped). */
export function normalizePerson(name: string): string {
  let raw = name.trim();
  const comma = raw.match(/^([^,]+),\s*([^,]+)$/);
  if (comma && !/\b(jr|sr|ii|iii|iv|esq)\b/i.test(comma[2]!)) raw = `${comma[2]} ${comma[1]}`;
  const parts = words(raw).filter((w) => !TITLES.has(w) && !SUFFIXES.has(w));
  const kept = parts.filter((w, i) => w.length > 1 || i === 0 || i === parts.length - 1);
  if (kept.length === 0) return "";
  const first = NICKNAMES[kept[0]!] ?? kept[0]!;
  return [first, ...kept.slice(1)].join(" ");
}

/** "The Smith Holdings, L.L.C." -> "smith holdings". */
export function normalizeOrganization(name: string): string {
  return words(name.replace(/l\.l\.c\.?/gi, "llc"))
    .filter((w) => !ORG_SUFFIXES.has(w))
    .join(" ");
}

export function normalizeName(name: string): string {
  return isOrganization(name) ? normalizeOrganization(name) : normalizePerson(name);
}

/** pg_trgm-compatible trigram set: each word padded "  w ". */
function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.split(/\s+/).filter(Boolean)) {
    const padded = `  ${w} `;
    for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

export function trigramSimilarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / (A.size + B.size - shared);
}

/** Edit distance, for short name tokens. */
export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** Misspelling tolerance by token length: 1 edit for short names, 2 for long ones. */
const closeEnough = (a: string, b: string) =>
  editDistance(a, b) <=
  (Math.min(a.length, b.length) >= 7 ? 2 : Math.min(a.length, b.length) >= 4 ? 1 : 0);

export type MatchReason =
  | "exact"
  | "nickname"
  | "reordered"
  | "same_surname_initial"
  | "similar_spelling"
  | "name_contains";

export type NameMatch = { similarity: number; reason: MatchReason };

/** Threshold for reporting a hit. Low on purpose (see file comment). */
export const HIT_THRESHOLD = 0.5;

export function matchNames(query: string, candidate: string): NameMatch | null {
  const org = isOrganization(query) || isOrganization(candidate);
  const q = org ? normalizeOrganization(query) : normalizePerson(query);
  const c = org ? normalizeOrganization(candidate) : normalizePerson(candidate);
  if (!q || !c) return null;
  if (q === c) {
    const rawEqual = query.trim().toLowerCase() === candidate.trim().toLowerCase();
    return { similarity: 1, reason: rawEqual || org ? "exact" : "nickname" };
  }
  const qt = q.split(" ");
  const ct = c.split(" ");
  if (qt.length > 1 && [...qt].sort().join(" ") === [...ct].sort().join(" ")) {
    return { similarity: 0.9, reason: "reordered" };
  }
  if (!org && qt.length > 1 && ct.length > 1) {
    const qLast = qt.at(-1)!;
    const cLast = ct.at(-1)!;
    if (qLast === cLast && qLast.length > 2 && qt[0]![0] === ct[0]![0]) {
      return { similarity: 0.75, reason: "same_surname_initial" };
    }
    // Both names misspelled a little: "Jonathan Smyth" ~ "Jonathon Smith".
    if (closeEnough(qt[0]!, ct[0]!) && closeEnough(qLast, cLast)) {
      return { similarity: 0.65, reason: "similar_spelling" };
    }
  }
  if (org) {
    const [short, long] = qt.length <= ct.length ? [qt, ct] : [ct, qt];
    const contained = short.every((w) => long.includes(w));
    if (contained && (short.length >= 2 || (short[0]?.length ?? 0) >= 5)) {
      return { similarity: 0.8, reason: "name_contains" };
    }
  }
  const sim = trigramSimilarity(q, c);
  if (sim >= (org ? 0.6 : 0.55))
    return { similarity: Math.round(sim * 100) / 100, reason: "similar_spelling" };
  return null;
}

const NOT_NAMES =
  /^(me|myself|i|none|n\/?a|na|no|nobody|unknown|not sure|just me|my (wife|husband|spouse|partner|son|daughter|kids?|children|family|brother|sister|mother|father|mom|dad))$/i;

/** Names in a free-text answer: "Acme LLC and Robert Smith; Jane Doe" -> 3 names. */
export function splitNames(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/[,;\n/]|\s+&\s+|\s+and\s+|\s+with\s+/i)
    .map((s) =>
      s
        .replace(/\([^)]*\)/g, "")
        .replace(
          /^(my |our )?(partner|co-?owner|ex-?wife|ex-?husband|landlord|tenant|buyer|seller|vendor|customer|client|executor|brother|sister)\s+(is\s+)?/i,
          "",
        )
        .trim(),
    )
    .filter((s) => s.length >= 3 && /[a-z]/i.test(s) && !NOT_NAMES.test(s) && !/^\d+$/.test(s));
}
