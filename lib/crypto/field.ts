import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Field-level encryption for sensitive columns (rule 6, spec Section 4).
 *
 * AES-256-GCM with a random 96-bit IV per value. Output format:
 *   v1.<iv b64url>.<tag b64url>.<ciphertext b64url>
 * The version prefix allows key rotation: add a v2 key, re-encrypt in a job,
 * then retire v1.
 *
 * `aad` binds a ciphertext to its location (for example "contacts.ssn:<id>")
 * so a value cannot be copied into another row or column and still decrypt.
 */
const VERSION = "v1";
const ALGO = "aes-256-gcm";

export class FieldCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, "base64");
    if (key.length !== 32) throw new Error("Field encryption key must be 32 bytes");
    this.key = key;
  }

  encrypt(plaintext: string, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, this.key, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString("base64url"),
      tag.toString("base64url"),
      ct.toString("base64url"),
    ].join(".");
  }

  decrypt(payload: string, aad: string): string {
    const parts = payload.split(".");
    if (parts.length !== 4 || parts[0] !== VERSION)
      throw new Error("Unsupported ciphertext format");
    const [, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
    const decipher = createDecipheriv(ALGO, this.key, Buffer.from(ivB64, "base64url"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}

/** Last-four mask for display (rule 6). Non-alphanumerics are dropped before counting. */
export function lastFour(value: string): string {
  const chars = value.replace(/[^0-9A-Za-z]/g, "");
  if (chars.length <= 4) return "•".repeat(chars.length);
  return `•••• ${chars.slice(-4)}`;
}
