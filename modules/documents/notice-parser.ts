/*
 * B3 notice triage, deterministic half: reads the fields printed on an IRS or
 * Texas Comptroller notice from its (already masked) text. Each field is
 * either found verbatim or left null; nothing is inferred. The model half
 * (prompts.ts) fills gaps and writes the summary, and any value it gives
 * must also appear in the text (reconcile()).
 *
 * Dates are date-only ISO strings (rule 10) and advisory (rule 7).
 */

export type NoticeFields = {
  agency: "IRS" | "Texas Comptroller" | "Other" | null;
  noticeType: string | null;
  taxYears: string[];
  /** Amount the notice says is due, in dollars, as printed ("12,345.67"). */
  amountDue: string | null;
  noticeDate: string | null;
  respondBy: string | null;
};

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const DATE_SRC =
  "(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}/\\d{1,2}/\\d{4}|\\d{4}-\\d{2}-\\d{2})";

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "October 1, 2026", "Oct. 1, 2026", "10/01/2026", "2026-10-01" to "2026-10-01". */
export function parseDate(text: string): string | null {
  const t = text.trim().toLowerCase();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return iso(Number(m[3]), Number(m[1]), Number(m[2]));
  m = t.match(/^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const month = MONTHS[m[1]!];
    return month ? iso(Number(m[3]), month, Number(m[2])) : null;
  }
  return null;
}

function firstDateAfter(text: string, cue: RegExp, window = 80): string | null {
  const re = new RegExp(`${cue.source}[^\\n]{0,${window}}?(${DATE_SRC})`, "i");
  const m = text.match(re);
  return m?.[1] ? parseDate(m[1]) : null;
}

function agencyOf(text: string): NoticeFields["agency"] {
  if (/internal revenue service|department of the treasury|\birs\b|irs\.gov/i.test(text))
    return "IRS";
  if (/comptroller of public accounts|texas comptroller|comptroller\.texas\.gov/i.test(text))
    return "Texas Comptroller";
  return /\bnotice\b|\bstate of\b|department of revenue/i.test(text) ? "Other" : null;
}

function noticeTypeOf(text: string): string | null {
  const cp = text.match(/\b(?:notice\s+)?(CP\s?\d{2,4}[A-Z]?)\b/);
  if (cp?.[1]) return cp[1].replace(/\s+/g, "").toUpperCase();
  const lt = text.match(/\b(LT\s?\d{2,4}[A-Z]?)\b/);
  if (lt?.[1]) return lt[1].replace(/\s+/g, "").toUpperCase();
  const letter = text.match(/\bLetter\s+(\d{3,4}[A-Z]?)\b/);
  if (letter?.[1]) return `Letter ${letter[1].toUpperCase()}`;
  return null;
}

function taxYearsOf(text: string): string[] {
  const years = new Set<string>();
  const patterns = [
    /tax\s+(?:years?|periods?)(?:\s+ending)?[:\s]+((?:(?:19|20)\d{2}(?:,\s*|\s+and\s+|\s*-\s*|\s+through\s+)?)+)/gi,
    /for\s+(?:the\s+)?(?:tax\s+)?year\s+((?:19|20)\d{2})/gi,
    /tax\s+period[:\s]+(?:[a-z]+\.?\s+\d{1,2},?\s+|\d{1,2}\/\d{1,2}\/)((?:19|20)\d{2})/gi,
    /\b((?:19|20)\d{2})\s+(?:form\s+)?1040\b/gi,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const span = m[1] ?? "";
      const range = span.match(/((?:19|20)\d{2})\s*(?:-|through)\s*((?:19|20)\d{2})/i);
      if (range) {
        for (let y = Number(range[1]); y <= Number(range[2]) && y - Number(range[1]) < 15; y++)
          years.add(String(y));
      }
      for (const y of span.match(/(?:19|20)\d{2}/g) ?? []) years.add(y);
    }
  }
  return [...years].sort();
}

function amountOf(text: string): string | null {
  const cues = [
    /amount\s+(?:you\s+)?(?:now\s+)?(?:due|owed?)/i,
    /total\s+(?:amount\s+)?(?:you\s+)?(?:owe|due)/i,
    /(?:balance|amount)\s+due/i,
    /you\s+owe/i,
    /proposed\s+(?:amount|balance)\s+due/i,
    /pay\s+(?:the\s+)?(?:full\s+)?amount/i,
  ];
  for (const cue of cues) {
    const m = text.match(
      new RegExp(`${cue.source}[^\\n$]{0,60}\\$\\s?([\\d,]+(?:\\.\\d{2})?)`, "i"),
    );
    if (m?.[1]) return m[1];
  }
  return null;
}

export function parseNotice(maskedText: string): NoticeFields {
  const text = maskedText.replace(/\r/g, "");
  const noticeDate =
    firstDateAfter(
      text,
      /(?:notice\s+date|date\s+of\s+(?:this\s+)?(?:notice|letter)|letter\s+date)/i,
    ) ??
    // A date on its own line near the top is the notice date on most IRS layouts.
    (() => {
      const head = text.split("\n").slice(0, 15).join("\n");
      const m = head.match(new RegExp(`^\\s*(${DATE_SRC})\\s*$`, "im"));
      return m?.[1] ? parseDate(m[1]) : null;
    })();
  const respondBy = firstDateAfter(
    text,
    /(?:respond\s+by|response\s+(?:due\s+)?date|reply\s+by|due\s+date|pay\s+by|payment\s+due|(?:if\s+you\s+(?:don'?t|do\s+not)\s+(?:respond|pay))(?:\s+by)?|deadline(?:\s+to\s+(?:respond|petition))?|by\s+no\s+later\s+than|petition\s+the\s+tax\s+court\s+by|request\s+a\s+hearing\s+by|last\s+day\s+to\s+(?:petition|respond|request))/i,
  );
  return {
    agency: agencyOf(text),
    noticeType: noticeTypeOf(text),
    taxYears: taxYearsOf(text),
    amountDue: amountOf(text),
    noticeDate,
    respondBy,
  };
}

/** True when the text looks like an agency notice (B4 routes it to B3). */
export function looksLikeTaxNotice(maskedText: string): boolean {
  const f = parseNotice(maskedText);
  return (
    (f.agency === "IRS" || f.agency === "Texas Comptroller") &&
    (f.noticeType !== null || f.respondBy !== null || f.amountDue !== null)
  );
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** True when a value the model gave actually appears in the document text. */
export function appearsIn(text: string, value: string): boolean {
  const t = norm(text);
  const v = norm(value);
  if (!v) return false;
  if (t.includes(v)) return true;
  // Dates may be printed differently from the ISO form the model returns.
  const d = parseDate(value);
  if (d) {
    for (const m of text.matchAll(new RegExp(DATE_SRC, "gi")))
      if (parseDate(m[0]) === d) return true;
  }
  return false;
}

export type Provenance = "parser" | "model" | "both" | "conflict";

/**
 * Combines the parser's fields with the model's. A model value counts only if
 * it appears in the text; when both have a value and they differ, the parser
 * wins and the field is marked "conflict" for the reviewer.
 */
export function reconcile(
  text: string,
  parsed: NoticeFields,
  model: Partial<NoticeFields> | null,
): { fields: NoticeFields; provenance: Record<keyof NoticeFields, Provenance | null> } {
  const prov = {} as Record<keyof NoticeFields, Provenance | null>;
  const fields = { ...parsed };
  const scalar = ["noticeType", "amountDue", "noticeDate", "respondBy"] as const;
  for (const k of scalar) {
    const p = parsed[k];
    const raw = model?.[k] ?? null;
    const m =
      raw && appearsIn(text, raw)
        ? k === "noticeDate" || k === "respondBy"
          ? (parseDate(raw) ?? raw)
          : raw
        : null;
    if (p && m) prov[k] = norm(p) === norm(m) ? "both" : "conflict";
    else if (p) prov[k] = "parser";
    else if (m) {
      fields[k] = m;
      prov[k] = "model";
    } else prov[k] = null;
  }
  if (parsed.agency)
    prov.agency =
      model?.agency && model.agency !== parsed.agency
        ? "conflict"
        : model?.agency
          ? "both"
          : "parser";
  else if (
    model?.agency &&
    appearsIn(text, model.agency === "Texas Comptroller" ? "Comptroller" : model.agency)
  ) {
    fields.agency = model.agency;
    prov.agency = "model";
  } else prov.agency = null;
  const modelYears = (model?.taxYears ?? []).filter(
    (y) => /^(19|20)\d{2}$/.test(y) && text.includes(y),
  );
  const years = [...new Set([...parsed.taxYears, ...modelYears])].sort();
  fields.taxYears = years;
  prov.taxYears =
    years.length === 0
      ? null
      : modelYears.length && parsed.taxYears.length
        ? "both"
        : parsed.taxYears.length
          ? "parser"
          : "model";
  return { fields, provenance: prov };
}

/** One-line summary without a model: what the notice says, as printed. */
export function plainNoticeSummary(f: NoticeFields): string {
  const parts = [
    `${f.agency ?? "Agency"} ${f.noticeType ?? "notice"}`,
    f.noticeDate ? `dated ${f.noticeDate}` : null,
    f.taxYears.length
      ? `for tax year${f.taxYears.length > 1 ? "s" : ""} ${f.taxYears.join(", ")}`
      : null,
    f.amountDue ? `showing $${f.amountDue} due` : null,
    f.respondBy ? `with a respond-by date of ${f.respondBy}` : null,
  ].filter(Boolean);
  return `${parts.join(", ")}.`;
}
