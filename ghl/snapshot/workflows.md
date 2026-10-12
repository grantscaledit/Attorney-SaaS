# Workflow webhook bodies

Each workflow uses GHL's **Custom Webhook** action: method POST, URL
`https://<app>/api/webhooks/ghl`, header `x-lexdesk-webhook-secret` set to the firm's
`GHL_WEBHOOK_SECRET`, content type JSON.

**VERIFY** every merge field below in the GHL workflow builder before go-live (they were written
from GHL's documented field names, not checked in a live builder). LexDesk validates each body
with Zod (`lib/ghl/schemas.ts`); a body that fails validation is stored and marked "Not used" in
Settings > GoHighLevel, never half-applied.

## LexDeskMissedCall

```json
{
  "type": "LexDeskMissedCall",
  "locationId": "{{location.id}}",
  "contactId": "{{contact.id}}",
  "occurredAt": "{{right_now.iso}}",
  "firstName": "{{contact.first_name}}",
  "lastName": "{{contact.last_name}}",
  "phone": "{{contact.phone}}",
  "email": "{{contact.email}}",
  "trackingNumber": "{{call.to_number}}"
}
```

Without a call id, LexDesk treats one missed call per contact per minute as one call. A1 texts a
caller at most once in 24 hours however many times they call.

## LexDeskFormSubmitted

```json
{
  "type": "LexDeskFormSubmitted",
  "locationId": "{{location.id}}",
  "contactId": "{{contact.id}}",
  "submissionId": "{{form.submission_id}}",
  "formName": "{{form.name}}",
  "occurredAt": "{{right_now.iso}}",
  "firstName": "{{contact.first_name}}",
  "lastName": "{{contact.last_name}}",
  "email": "{{contact.email}}",
  "phone": "{{contact.phone}}",
  "practiceArea": "{{contact.what_do_you_need_help_with}}",
  "smsOptIn": "{{contact.sms_consent}}",
  "utmSource": "{{contact.utm_source}}",
  "utmMedium": "{{contact.utm_medium}}",
  "utmCampaign": "{{contact.utm_campaign}}",
  "utmContent": "{{contact.utm_content}}",
  "utmTerm": "{{contact.utm_term}}",
  "referrer": "{{contact.referrer}}",
  "pageUrl": "{{contact.page_url}}",
  "gclid": "{{contact.gclid}}",
  "fbclid": "{{contact.fbclid}}"
}
```

`smsOptIn` accepts true/false or yes/no/checked text.

## Mirror events

For contact, opportunity, appointment and message workflows, send the documented GHL event
shape with `type` set to the event name (see `docs/webhook events/*.md` in GHL's API docs and
`lib/ghl/schemas.ts`), for example:

```json
{
  "type": "AppointmentUpdate",
  "locationId": "{{location.id}}",
  "appointment": {
    "id": "{{appointment.id}}",
    "calendarId": "{{appointment.calendar_id}}",
    "contactId": "{{contact.id}}",
    "appointmentStatus": "{{appointment.status}}",
    "startTime": "{{appointment.start_time_iso}}",
    "endTime": "{{appointment.end_time_iso}}",
    "dateUpdated": "{{right_now.iso}}"
  }
}
```
