/**
 * Redaction for anything that leaves the process or lands in the audit log
 * (rule 6). Keys are matched case-insensitively on their normalized form.
 *
 * This is a backstop. Code should not put sensitive values into logs or audit
 * payloads in the first place; masking of free text for the LLM is a separate
 * module (lib/masking, Phase 2).
 */
/** Short identifiers matched as whole words ("client_ssn", "ownerEin"), never as substrings ("einstein"). */
const SENSITIVE_WORDS = new Set(["ssn", "ein", "tin", "dob", "cvv", "cvc", "iban", "pin"]);

/** Longer names matched as the end of the normalized key ("newPassword", "sessionToken"). */
const SENSITIVE_SUFFIXES = [
  "password",
  "passwd",
  "secret",
  "token",
  "backupcodes",
  "apikey",
  "authorization",
  "cookie",
  "socialsecurity",
  "socialsecuritynumber",
  "taxid",
  "dateofbirth",
  "birthdate",
  "accountnumber",
  "routingnumber",
  "cardnumber",
];

export const REDACTED = "[REDACTED]";

function words(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

export function isSensitiveKey(key: string): boolean {
  if (words(key).some((w) => SENSITIVE_WORDS.has(w))) return true;
  const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
  return SENSITIVE_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) ? REDACTED : redact(v, depth + 1);
  }
  return out as T;
}
