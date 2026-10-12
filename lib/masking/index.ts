/**
 * Identifier masking (rule 6): full SSN, EIN, bank and card numbers and dates
 * of birth are never logged, stored in plaintext or sent to an LLM. Numbers
 * are reduced to their last 4 digits; dates of birth are removed entirely.
 *
 * Deterministic and conservative: it prefers masking a harmless 9-digit
 * number over letting a real identifier through. It deliberately leaves
 * phone numbers (10 digits), tax years, IRS notice codes (CP2000) and dollar
 * amounts alone, because intake needs them.
 */

export type MaskKind = "ssn" | "ein" | "tin" | "card" | "account" | "routing" | "dob";

export type MaskResult = {
  text: string;
  /** How many of each identifier were masked. Never the values. */
  found: Partial<Record<MaskKind, number>>;
};

const last4 = (digits: string) => digits.replace(/\D/g, "").slice(-4);

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

type Rule = {
  kind: MaskKind;
  re: RegExp;
  replace: (m: string, ...groups: string[]) => string | null;
};

const ACCOUNT_LABEL = String.raw`(?:account|acct|a\/c|checking|savings|iban)(?:\s*(?:number|no\.?|#))?`;
const ROUTING_LABEL = String.raw`(?:routing|aba|transit)(?:\s*(?:number|no\.?|#))?`;
const DOB_LABEL = String.raw`(?:date\s+of\s+birth|d\.?o\.?b\.?|birth\s*date|birthday|born(?:\s+on)?)`;
const DATE = String.raw`(?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}-\d{1,2}-\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+\d{4})`;

const RULES: Rule[] = [
  // Dates of birth: a date within a few words after a birth label. Removed, not shortened.
  {
    kind: "dob",
    re: new RegExp(String.raw`(${DOB_LABEL}\s*(?:is|was|:|-)?\s*(?:on\s+)?)(${DATE})`, "gi"),
    replace: (_m, label) => `${label}[date of birth removed]`,
  },
  // Labeled routing numbers (9 digits) before generic 9-digit rules.
  {
    kind: "routing",
    re: new RegExp(String.raw`(${ROUTING_LABEL}\s*(?:is|:|-)?\s*)(\d{9})\b`, "gi"),
    replace: (_m, label, n) => `${label}[routing number ending ${last4(n!)}]`,
  },
  // Labeled bank accounts: 4-17 digits, spaces or dashes allowed.
  {
    kind: "account",
    re: new RegExp(String.raw`(${ACCOUNT_LABEL}\s*(?:is|:|-)?\s*)(\d[\d\s-]{2,20}\d)\b`, "gi"),
    replace: (_m, label, n) => {
      const digits = n!.replace(/\D/g, "");
      return digits.length >= 4 && digits.length <= 17
        ? `${label}[account number ending ${last4(digits)}]`
        : null;
    },
  },
  // Payment cards: 13-19 digits (optionally grouped) that pass the Luhn check.
  {
    kind: "card",
    re: /\b(?:\d[ -]?){12,18}\d\b/g,
    replace: (m) => {
      const digits = m.replace(/\D/g, "");
      if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) return null;
      return `[card number ending ${last4(digits)}]`;
    },
  },
  // SSN as written: 123-45-6789 or 123 45 6789.
  {
    kind: "ssn",
    re: /\b\d{3}([- ])\d{2}\1\d{4}\b/g,
    replace: (m) => `[SSN ending ${last4(m)}]`,
  },
  // EIN as written: 12-3456789.
  {
    kind: "ein",
    re: /\b\d{2}-\d{7}\b/g,
    replace: (m) => `[EIN ending ${last4(m)}]`,
  },
  // Any other bare 9-digit number could be an SSN, EIN or ITIN.
  {
    kind: "tin",
    re: /(?<![\d$.,])\d{9}(?!\d|[.,]\d)/g,
    replace: (m) => `[tax ID ending ${last4(m)}]`,
  },
];

export function maskText(input: string): MaskResult {
  let text = input;
  const found: MaskResult["found"] = {};
  for (const rule of RULES) {
    text = text.replace(rule.re, (...args: unknown[]) => {
      const match = args[0] as string;
      const groups = args.slice(1, -2).map((g) => (typeof g === "string" ? g : ""));
      const out = rule.replace(match, ...groups);
      if (out === null) return match;
      found[rule.kind] = (found[rule.kind] ?? 0) + 1;
      return out;
    });
  }
  return { text, found };
}

/** Masks every string inside a JSON-like value (for structured intake records). */
export function maskDeep<T>(value: T, depth = 0): T {
  if (depth > 10) return value;
  if (typeof value === "string") return maskText(value).text as T;
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, depth + 1)) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      out[k] = maskDeep(v, depth + 1);
    return out as T;
  }
  return value;
}

/** True when the text still contains something the masker would change. */
export function containsIdentifiers(text: string): boolean {
  return Object.keys(maskText(text).found).length > 0;
}
