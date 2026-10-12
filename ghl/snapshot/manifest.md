# GHL snapshot: what each firm's sub-account must contain

Spec Section 2: one snapshot with pipelines, custom fields, calendars and the thin workflows that
fire webhooks. All logic lives in LexDesk. A GHL snapshot is built and shared inside GHL's agency
UI, so this file is the specification it is built from and checked against. Build it once in a
template sub-account, export the snapshot, and load it into each new firm's sub-account
(runbook: `docs/runbooks/ghl-setup.md`).

## Pipeline: "LexDesk Intake"

| Stage            | Meaning                                        |
| ---------------- | ---------------------------------------------- |
| New enquiry      | Created by the form workflow or by staff       |
| Consult booked   | Moved by the booking workflow                  |
| Consult held     | Staff move it after the consult                |
| Decision pending | Engagement letter out (Phase 3 automates this) |

Mark the opportunity **Won** when the client signs, **Lost** or **Abandoned** otherwise. LexDesk
reads won/lost as retained/lost until matters exist (Phase 3).

## Calendar: "Initial consultation"

30 minutes, booking page link goes in LexDesk Settings > Firm > Consult booking page. Turn off
GHL's own confirmation and reminder messages: A7 sends them, from firm-approved templates.

## Contact form: "Website contact form"

| Field                                                                                                  | Type     | Notes                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First name, Last name, Email, Phone                                                                    | standard |                                                                                                                                                         |
| What do you need help with?                                                                            | dropdown | Tax / IRS or Texas Comptroller; Business; Estate planning; Probate; Something else. Mapped by `ghl/field-map.ts`                                        |
| SMS consent                                                                                            | checkbox | "I agree to receive text messages from [firm] about my enquiry. Message and data rates may apply. Reply STOP to opt out." **Attorney review required.** |
| Hidden: utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid, page URL, referrer | hidden   | Filled from the URL by GHL's form settings (F1)                                                                                                         |

Do not add fields for SSN, EIN, dates of birth or account numbers (rule 6).

## Workflows

See `workflows.md` for the webhook bodies. Every workflow posts to the firm's
`https://<app>/api/webhooks/ghl` with header `x-lexdesk-webhook-secret: <GHL_WEBHOOK_SECRET>`.

| Workflow                     | Trigger                                               | Action                                                                       |
| ---------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| LexDesk: missed call         | Call status: missed / no answer / voicemail (inbound) | Custom Webhook, `LexDeskMissedCall`                                          |
| LexDesk: form submitted      | Form submitted: Website contact form                  | Create opportunity in New enquiry; Custom Webhook, `LexDeskFormSubmitted`    |
| LexDesk: contact changed     | Contact created; contact changed; contact DND changed | Custom Webhook, `ContactCreate` / `ContactUpdate` / `ContactDndUpdate` shape |
| LexDesk: opportunity changed | Opportunity created; stage changed; status changed    | Custom Webhook, `OpportunityCreate` / `OpportunityStatusUpdate` shape        |
| LexDesk: appointment changed | Appointment booked / status changed / cancelled       | Custom Webhook, `AppointmentCreate` / `AppointmentUpdate` shape              |
| LexDesk: messages            | Customer replied; staff sent message                  | Custom Webhook, `InboundMessage` / `OutboundMessage` shape                   |

If the firm installs a private Marketplace app instead, its signed events replace the last four
workflows; keep the first two.

Workflows must not send texts or emails themselves: LexDesk's A1, A2 and A7 do, after the firm
approves the text, and only LexDesk applies quiet hours, consent and do-not-disturb.
