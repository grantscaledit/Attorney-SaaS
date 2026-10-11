import type { LeadChannel, LeadStatus } from "@/db/schema";

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  consult_booked: "Consult booked",
  consult_held: "Consult held",
  retained: "Retained",
  lost: "Lost",
};

export const LEAD_CHANNEL_LABELS: Record<LeadChannel, string> = {
  call: "Call",
  form: "Web form",
  chat: "Chat",
  email: "Email",
  sms: "Text",
  other: "Other",
};

export const PRACTICE_AREA_LABELS: Record<string, string> = {
  tax: "Tax",
  business: "Business",
  estate: "Estate and probate",
  unassigned: "Not yet assigned",
};

export const SUPPRESSION_LABELS: Record<string, string> = {
  feature_off: "Automation switched off",
  dnd: "Do not disturb",
  consent_revoked: "Consent revoked",
  no_sms_consent: "No SMS consent",
  no_phone: "No phone number",
  no_email: "No email address",
  template_not_approved: "Template not approved",
  template_changed: "Template changed after queueing",
  quiet_hours_window_passed: "Quiet hours left no time to send",
  recent_text_back: "Already texted in the last 24 hours",
  contact_deleted: "Contact deleted in GoHighLevel",
  rebooked: "Consult rebooked",
  replied: "The person replied",
  lead_closed: "Lead retained or closed",
  documents_received: "Documents already received",
  engagement_settled: "Engagement letter signed or withdrawn",
  approval_withdrawn: "Approval withdrawn",
  no_approved_text: "No approved text",
};

export function suppressionLabel(reason: string | null): string {
  if (!reason) return "";
  if (reason.startsWith("missing_value:")) {
    return `Missing ${reason.slice("missing_value:".length).replace(/,/g, ", ")}`;
  }
  if (reason.startsWith("appointment_")) return `Consult ${reason.slice("appointment_".length)}`;
  return SUPPRESSION_LABELS[reason] ?? reason.replace(/_/g, " ");
}
