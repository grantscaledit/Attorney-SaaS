/*
 * E-signature for engagement letters (A9). Provider-neutral: the spec names no
 * vendor, so V1 ships a "manual" provider. The attorney prepares the letter in
 * the firm's own e-sign tool and pastes the signing link; staff mark the
 * letter signed when the tool confirms it. A real provider implements the same
 * interface (create the envelope, then report "signed" from its webhook) once
 * its API has been checked against live docs (VERIFY).
 */

export type PreparedSigning = { signingUrl: string; envelopeId: string | null };

export interface ESignProvider {
  readonly kind: string;
  prepare(input: {
    engagementId: string;
    letterText: string;
    signer: { name: string; email: string | null };
    providedUrl?: string | null;
  }): Promise<PreparedSigning>;
}

export class ESignError extends Error {}

export class ManualESign implements ESignProvider {
  readonly kind = "manual";
  async prepare(input: { providedUrl?: string | null }): Promise<PreparedSigning> {
    const url = input.providedUrl?.trim();
    if (!url) throw new ESignError("Paste the signing link from your e-signature tool.");
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ESignError("The signing link is not a valid web address.");
    }
    if (parsed.protocol !== "https:")
      throw new ESignError("The signing link must start with https://");
    return { signingUrl: parsed.toString(), envelopeId: null };
  }
}

let override: ESignProvider | undefined;

export function getESignProvider(): ESignProvider {
  return override ?? new ManualESign();
}

export function setESignProviderForTesting(p: ESignProvider | undefined): void {
  override = p;
}
