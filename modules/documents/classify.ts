import { DOC_TYPE_LABELS, type DocType } from "@/practice";
import { looksLikeTaxNotice, parseNotice } from "./notice-parser";

/*
 * B4 document classification and naming, deterministic half. Strong phrases
 * printed on standard documents decide the type with high confidence; when
 * none match, the job may ask the model (masked text only), and otherwise
 * the type stays "other" for a person to set.
 */

const RULES: [DocType, RegExp][] = [
  [
    "tax_transcript",
    /\b(wage and income transcript|account transcript|record of account|tax return transcript)\b/i,
  ],
  [
    "tax_return",
    /\b(u\.?s\.? individual income tax return|form 1040\b(?!.*notice)|u\.?s\.? return of partnership income|u\.?s\.? corporation income tax return|form 1120|form 1065)\b/i,
  ],
  ["death_certificate", /\b(certificate of death|death certificate)\b/i],
  ["will", /\blast will and testament\b/i],
  ["trust", /\b(revocable (living )?trust|trust agreement|declaration of trust)\b/i],
  [
    "power_of_attorney",
    /\b(durable power of attorney|statutory durable power|medical power of attorney|form 2848)\b/i,
  ],
  [
    "deed",
    /\b(warranty deed|special warranty deed|quitclaim deed|deed of trust|general warranty deed)\b/i,
  ],
  ["articles", /\b(certificate of formation|articles of (incorporation|organization))\b/i],
  [
    "operating_agreement",
    /\b(operating agreement|partnership agreement|shareholders'? agreement|company agreement)\b/i,
  ],
  ["bank_statement", /\b(statement period|beginning balance|ending balance)\b/i],
  ["pay_stub", /\b(pay period|gross pay|net pay|year[- ]to[- ]date)\b/i],
  [
    "financial_statement",
    /\b(collection information statement|form 433-?[af]|balance sheet|profit and loss)\b/i,
  ],
  ["id_document", /\b(driver'?s license|passport|identification card)\b/i],
  [
    "engagement_letter",
    /\b(engagement letter|scope of (the )?engagement|attorney-client agreement)\b/i,
  ],
  [
    "contract",
    /\b(this agreement is (made|entered)|agreement between|terms and conditions|purchase agreement|lease agreement)\b/i,
  ],
];

export type Classification = {
  docType: DocType;
  confidence: number;
  via: "rules" | "model" | "none";
};

export function classifyText(maskedText: string): Classification {
  const text = maskedText.slice(0, 20_000);
  if (looksLikeTaxNotice(text)) {
    const f = parseNotice(text);
    return {
      docType: f.agency === "IRS" ? "irs_notice" : "state_tax_notice",
      confidence: 0.95,
      via: "rules",
    };
  }
  for (const [type, re] of RULES) {
    if (re.test(text)) return { docType: type, confidence: 0.85, via: "rules" };
  }
  return { docType: "other", confidence: 0, via: "none" };
}

/**
 * Firm naming convention: "<received date> <type>[ <detail>] - <matter number>.<ext>",
 * for example "2026-10-11 IRS notice CP2000 2024 - 2026-0007.pdf". The date is
 * the day received in the firm's time zone.
 */
export function conventionalName(input: {
  receivedOn: string;
  docType: DocType;
  detail?: string | null;
  matterNumber: string;
  ext: string;
}): string {
  const detail = input.detail
    ?.replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const base = `${input.receivedOn} ${DOC_TYPE_LABELS[input.docType]}${detail ? ` ${detail}` : ""} - ${input.matterNumber}`;
  return `${base.slice(0, 180)}.${input.ext}`;
}

/**
 * "Page 2 of 4" markers that point past the pages received, or a gap in the
 * sequence, mean pages are missing. Returns a note for the reviewer, or null.
 */
export function missingPagesNote(pages: readonly string[]): string | null {
  let declared = 0;
  const seen = new Set<number>();
  for (const p of pages) {
    for (const m of p.matchAll(/\bpage\s+(\d{1,3})\s+of\s+(\d{1,3})\b/gi)) {
      seen.add(Number(m[1]));
      declared = Math.max(declared, Number(m[2]));
    }
  }
  if (declared === 0) return null;
  const missing: number[] = [];
  for (let i = 1; i <= declared; i++) if (!seen.has(i)) missing.push(i);
  if (missing.length === 0 && pages.length >= declared) return null;
  return missing.length
    ? `The document says it has ${declared} pages; page${missing.length > 1 ? "s" : ""} ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} missing.`
    : `The document says it has ${declared} pages; ${pages.length} were received.`;
}
