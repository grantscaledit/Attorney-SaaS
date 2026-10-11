/*
 * A9 engagement letter text. The firm's own template (Settings > Engagement
 * letter) is used when set; otherwise this product default, which an attorney
 * must review before the firm uses it (VERIFY). Merge fields are filled from
 * records; a missing field leaves a visible gap for the reviewer, never a
 * guess.
 */

export const ENGAGEMENT_FIELDS = {
  clientName: "Client's full name",
  firmName: "Firm display name",
  attorneyName: "Responsible attorney",
  matterDescription: "Matter type, e.g. Notice response",
  feeTerms: "Fee terms entered when the lead was retained",
  date: "Today's date",
  signingUrl: "E-signature link",
} as const;
export type EngagementField = keyof typeof ENGAGEMENT_FIELDS;

export const DEFAULT_ENGAGEMENT_TEMPLATE = [
  "{{date}}",
  "",
  "Dear {{clientName}},",
  "",
  "Thank you for choosing {{firmName}}. This letter sets out the terms on which the firm will represent you.",
  "",
  "Scope of the engagement. The firm will represent you in the following matter: {{matterDescription}}. The engagement covers only this matter. Any other matter needs a separate written agreement.",
  "",
  "Responsible attorney. {{attorneyName}} will be responsible for your matter.",
  "",
  "Fees. {{feeTerms}}",
  "",
  "Your responsibilities. You agree to give the firm complete and accurate information and documents promptly, and to tell us of any change in your circumstances.",
  "",
  "Use of technology. The firm uses software, including an AI assistant, to organize documents and prepare drafts. An attorney reviews all legal work. Your information is kept confidential.",
  "",
  "When the representation starts. The firm represents you only after you sign this letter. If you do not sign within 30 days, the firm will assume you do not wish to proceed.",
  "",
  "Please review and sign this letter electronically here: {{signingUrl}}",
  "",
  "Sincerely,",
  "{{attorneyName}}",
  "{{firmName}}",
].join("\n");

export function renderEngagement(
  template: string,
  values: Partial<Record<EngagementField, string | null>>,
): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_m, name: string) => {
    const v = (values as Record<string, string | null | undefined>)[name]?.trim();
    if (v) return v;
    missing.add(name);
    return `[${name} missing]`;
  });
  return { text, missing: [...missing] };
}

export function unknownEngagementFields(template: string): string[] {
  return [...template.matchAll(/\{\{\s*([a-zA-Z]+)\s*\}\}/g)]
    .map((m) => m[1]!)
    .filter((n) => !(n in ENGAGEMENT_FIELDS));
}
