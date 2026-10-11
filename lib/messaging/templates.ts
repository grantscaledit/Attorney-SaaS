import type { MessageChannel } from "@/db/schema";

/**
 * Automatic message templates (spec Section 6, "Auto-send allowed:
 * pre-approved templates with variable slots only").
 *
 * The text below is a starting point. Nothing sends until the owner attorney
 * reviews and approves each template in Settings > Message templates; editing
 * a template clears its approval. Placeholders are `{{name}}` or
 * `{{name|fallback}}`; a placeholder without a fallback must have a value or
 * the message is not sent.
 */

export const TEMPLATE_VARIABLES = {
  firstName: "Recipient's first name, when GHL has it",
  firmName: "Firm display name (Settings > Firm)",
  firmPhone: "Firm phone number (Settings > Firm)",
  bookingUrl: "Booking page link (Settings > Integrations)",
  intakeFormUrl: "Pre-consult intake form link (Settings > Integrations)",
  appointmentTime: "Consult date and time in the recipient's time zone",
  urgentReason: "Why an enquiry was flagged urgent (staff alerts only)",
  leadUrl: "Link to the lead in LexDesk (staff alerts only)",
  signingUrl: "The engagement letter's e-signature link (A9)",
  outstandingItems: "Documents still needed from the client, one per line (B2)",
  portalUrl: "The client portal sign-in page",
} as const;

export type TemplateVariable = keyof typeof TEMPLATE_VARIABLES;
export type TemplateValues = Partial<Record<TemplateVariable, string | null>>;

export type TemplateDefinition = {
  key: string;
  automationId: "A1" | "A2" | "A3" | "A5" | "A7" | "A9" | "A10" | "B2";
  channel: Extract<MessageChannel, "sms" | "email">;
  label: string;
  /** When it sends, in plain words, for the approval screen. */
  when: string;
  subject?: string;
  body: string;
};

const STOP = "Reply STOP to opt out.";

export const DEFAULT_TEMPLATES = [
  {
    key: "A1.sms",
    automationId: "A1",
    channel: "sms",
    label: "Missed-call text-back",
    when: "Within a minute of a call nobody answered (or that went to voicemail). At most one per caller per 24 hours.",
    body: `Hi {{firstName|there}}, this is {{firmName}}. Sorry we missed your call. You can book a time to talk at {{bookingUrl}} or reply to this text. ${STOP}`,
  },
  {
    key: "A2.sms",
    automationId: "A2",
    channel: "sms",
    label: "New enquiry acknowledgement (text)",
    when: "Within a minute of a web form, chat or email enquiry, only if the person ticked the SMS consent box.",
    body: `Hi {{firstName|there}}, thank you for contacting {{firmName}}. We received your enquiry and will be in touch shortly. You can choose a time at {{bookingUrl}} or reply to this text. ${STOP}`,
  },
  {
    key: "A2.email",
    automationId: "A2",
    channel: "email",
    label: "New enquiry acknowledgement (email)",
    when: "Within a minute of a web form, chat or email enquiry that included an email address.",
    subject: "We received your enquiry",
    body: [
      "Hi {{firstName|there}},",
      "",
      "Thank you for contacting {{firmName}}. We received your enquiry and a member of our team will follow up shortly.",
      "",
      "If you would like to choose a time to talk now, you can book here: {{bookingUrl}}",
      "",
      "Contacting the firm does not create an attorney-client relationship. Please do not send Social Security numbers, account numbers or other sensitive information by email.",
      "",
      "{{firmName}}",
      "{{firmPhone|}}",
    ].join("\n"),
  },
  {
    key: "A7.confirmation.sms",
    automationId: "A7",
    channel: "sms",
    label: "Consult confirmation",
    when: "When a consult is booked or moved to a new time.",
    body: `{{firmName}}: your consultation is confirmed for {{appointmentTime}}. ${STOP} Please complete our intake form before we meet: {{intakeFormUrl}}`,
  },
  {
    key: "A7.reminder_24h.sms",
    automationId: "A7",
    channel: "sms",
    label: "Consult reminder, 24 hours",
    when: "24 hours before the consult, if booked more than 24 hours ahead.",
    body: "Reminder from {{firmName}}: your consultation is {{appointmentTime}}. If you need to reschedule, call {{firmPhone}} or use {{bookingUrl}}.",
  },
  {
    key: "A7.reminder_2h.sms",
    automationId: "A7",
    channel: "sms",
    label: "Consult reminder, 2 hours",
    when: "2 hours before the consult.",
    body: "Reminder from {{firmName}}: your consultation is {{appointmentTime}}. We look forward to speaking with you.",
  },
  {
    key: "A7.no_show.sms",
    automationId: "A7",
    channel: "sms",
    label: "No-show rebooking",
    when: "When a consult is marked no-show in GHL.",
    body: "Hi {{firstName|there}}, we missed you at your consultation with {{firmName}}. You can pick a new time here: {{bookingUrl}}",
  },
  {
    key: "A7.no_show_followup.sms",
    automationId: "A7",
    channel: "sms",
    label: "No-show follow-up",
    when: "Two days after a no-show, unless a new consult has been booked.",
    body: `Hi {{firstName|there}}, {{firmName}} here. If you would still like to talk, you can book a consultation at {{bookingUrl}}. ${STOP}`,
  },
  {
    key: "A3.handoff.sms",
    automationId: "A3",
    channel: "sms",
    label: "Intake assistant hand-off",
    when: "When a person asks for legal advice or for a person, or mentions an urgent situation (levy, garnishment, a deadline within 10 days, a recent death, a criminal investigation). The assistant stops and staff take over.",
    body: "Thank you for telling us. I have passed this to our team and someone will contact you shortly. I cannot give legal advice by text. {{firmName}}",
  },
  {
    key: "A5.urgent.sms",
    automationId: "A5",
    channel: "sms",
    label: "Urgent enquiry alert to the attorney",
    when: "To the assigned attorney's own phone (their GHL contact) when an enquiry scores urgent or escalates. Contains no client details.",
    body: "LexDesk: urgent enquiry ({{urgentReason}}). Open it here: {{leadUrl}}",
  },
  {
    key: "A10.day30.email",
    automationId: "A10",
    channel: "email",
    label: "Nurture, 30 days after consult",
    when: "30 days after a consult when the person has not retained the firm. Stops if they reply.",
    subject: "Following up from {{firmName}}",
    body: [
      "Hi {{firstName|there}},",
      "",
      "Thank you again for meeting with {{firmName}}. If you would like to continue, or have questions about next steps, reply to this email or book a time here: {{bookingUrl}}",
      "",
      "{{firmName}}",
      "{{firmPhone|}}",
    ].join("\n"),
  },
  {
    key: "A10.day60.email",
    automationId: "A10",
    channel: "email",
    label: "Nurture, 60 days after consult",
    when: "60 days after a consult, unless the person replied or retained the firm.",
    subject: "Checking in from {{firmName}}",
    body: [
      "Hi {{firstName|there}},",
      "",
      "We wanted to check in. If your situation has changed or you are ready to move forward, we are glad to help. You can book a time here: {{bookingUrl}}",
      "",
      "{{firmName}}",
    ].join("\n"),
  },
  {
    key: "A10.day90.email",
    automationId: "A10",
    channel: "email",
    label: "Nurture, 90 days after consult",
    when: "90 days after a consult; the last message in the sequence.",
    subject: "{{firmName}}",
    body: [
      "Hi {{firstName|there}},",
      "",
      "This is our last follow-up about your consultation. If we can help in the future, you can reach us at {{firmPhone|our office}} or book at {{bookingUrl}}.",
      "",
      "{{firmName}}",
    ].join("\n"),
  },
  {
    key: "A9.reminder.email",
    automationId: "A9",
    channel: "email",
    label: "Engagement letter reminder",
    when: "2, 4 and 7 days after the engagement letter was sent, until it is signed.",
    subject: "Your engagement letter from {{firmName}}",
    body: [
      "Hi {{firstName|there}},",
      "",
      "This is a reminder that your engagement letter from {{firmName}} is waiting for your signature. You can review and sign it here: {{signingUrl}}",
      "",
      "If you have questions about the letter, reply to this email or call {{firmPhone|our office}}.",
      "",
      "{{firmName}}",
    ].join("\n"),
  },
  {
    key: "B2.reminder.email",
    automationId: "B2",
    channel: "email",
    label: "Document reminder (email)",
    when: "3, 7 and 14 days after documents were requested, while any are still outstanding.",
    subject: "Documents needed for your matter with {{firmName}}",
    body: [
      "Hi {{firstName|there}},",
      "",
      "To keep your matter moving, we still need:",
      "{{outstandingItems}}",
      "",
      "You can upload them securely in the client portal: {{portalUrl}}",
      "",
      "{{firmName}}",
    ].join("\n"),
  },
  {
    key: "B2.reminder.sms",
    automationId: "B2",
    channel: "sms",
    label: "Document reminder (text)",
    when: "With the email reminder, when the client has a mobile number and has agreed to texts.",
    body: `{{firmName}}: we still need some documents for your matter. Please upload them in the client portal: {{portalUrl}} ${STOP}`,
  },
] as const satisfies readonly TemplateDefinition[];

export type TemplateKey = (typeof DEFAULT_TEMPLATES)[number]["key"];

export const TEMPLATE_KEYS = DEFAULT_TEMPLATES.map((t) => t.key) as TemplateKey[];

export function templateDefinition(key: TemplateKey): TemplateDefinition {
  return DEFAULT_TEMPLATES.find((t) => t.key === key)!;
}

export function isTemplateKey(value: string): value is TemplateKey {
  return (TEMPLATE_KEYS as string[]).includes(value);
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z]+)\s*(?:\|([^}]*))?\}\}/g;

export type RenderResult = { ok: true; text: string } | { ok: false; missing: string[] };

export function renderTemplate(text: string, values: TemplateValues): RenderResult {
  const missing = new Set<string>();
  const out = text.replace(PLACEHOLDER, (_m, name: string, fallback: string | undefined) => {
    const v = (values as Record<string, string | null | undefined>)[name]?.trim();
    if (v) return v;
    if (fallback !== undefined) return fallback;
    missing.add(name);
    return "";
  });
  if (missing.size > 0) return { ok: false, missing: [...missing] };
  // Fallbacks can leave a dangling blank line or double space.
  return {
    ok: true,
    text: out
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  };
}

/** Placeholder names used in a template body, for validating firm edits. */
export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]!);
}

export function unknownPlaceholders(text: string): string[] {
  return placeholdersIn(text).filter((n) => !(n in TEMPLATE_VARIABLES));
}

/** "Tue, Oct 14 at 2:30 PM CDT" in the recipient's zone. */
export function formatAppointmentTime(at: Date, timeZone: string): string {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(at);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(at);
  return `${date} at ${time}`;
}
