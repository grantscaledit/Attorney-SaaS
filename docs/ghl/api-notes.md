# GoHighLevel API: what was verified and what still needs checking

Spec rule: do not code vendor endpoints from memory. Phase 1 used GHL's official documentation
source, `github.com/GoHighLevel/highlevel-api-docs` at commit `0af86a4` (2026-06-19), read on
2026-10-10. The marketplace docs site and the ClickUp page it links for search filters were not
reachable from the build environment.

## Verified against the documentation source

| Fact                                                                                                                                                                       | Source                                                                             | Used in                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------ |
| Base URL `https://services.leadconnectorhq.com`                                                                                                                            | `apps/*.json` servers                                                              | `lib/ghl/endpoints.ts`               |
| Sub-account Private Integration Token is accepted as the bearer token                                                                                                      | `apps/contacts.json` securitySchemes                                               | client                               |
| `Version` header per resource: contacts and opportunities `2021-07-28`; conversations and calendars `2021-04-15`                                                           | operation parameters                                                               | client                               |
| `GET /contacts/{contactId}`, `GET /opportunities/search`, `GET /calendars/`, `GET /calendars/events`, `POST /conversations/messages` paths, parameters and response shapes | `apps/contacts.json`, `opportunities.json`, `calendars.json`, `conversations.json` | client, schemas                      |
| Burst limit 100 requests per 10 seconds per location; daily limit 200,000; rate-limit headers                                                                              | `docs/oauth/Authorization.md`                                                      | client limiter                       |
| Webhook signing: `x-wh-signature`, RSA SHA-256 over the body, base64; public key; dedupe on `webhookId`                                                                    | `docs/oauth/WebhookAuthentication.md`                                              | `webhook-auth.ts`                    |
| Event names and payloads: Contact*, Opportunity*, Appointment*, InboundMessage, OutboundMessage                                                                            | `docs/webhook events/*.md`                                                         | `schemas.ts`, `events.ts`            |
| Inbound call outcome in `status` and `callStatus`: `completed`, `voicemail`                                                                                                | `docs/webhook events/InboundMessage.md`                                            | `classifyCall`                       |
| Appointment statuses `new, confirmed, cancelled, showed, noshow, invalid`; opportunity statuses `open, won, lost, abandoned`                                               | enums in the specs                                                                 | schemas                              |
| `GET /calendars/{calendarId}/free-slots`: `startDate`/`endDate` epoch ms (range at most 31 days), `timezone`, `userId`; response maps `YYYY-MM-DD` to `{ slots: ISO[] }`   | `apps/calendars.json`                                                              | `getFreeSlots` (A3), read 2026-10-11 |
| Contacts can carry `dateOfBirth` and `ssn`                                                                                                                                 | `GetContectByIdSchema`                                                             | stripped before storage (rule 6)     |

## VERIFY before first live use

1. **Missed-call statuses.** Only `completed` and `voicemail` are documented. LexDesk treats any
   other inbound call status as missed. Place test calls (unanswered, busy, declined) and confirm.
2. **`POST /conversations/messages` required fields.** The spec marks `subType` and `status`
   required, though both read like response fields. LexDesk sends `type`, `contactId`, `message`
   (and `subject`, `html` for email). Send one test SMS and one test email from staging.
3. **Contact list for reconciliation.** `GET /contacts/` is marked deprecated; its replacement
   `POST /contacts/search` has no documented body in the source. Confirm the old endpoint still
   pages with `startAfter`/`startAfterId`, or document the search body and switch.
4. **Event type on Appointment updates.** The docs' examples for AppointmentUpdate and
   AppointmentDelete carry `"type": "AppointmentCreate"`. Confirm real deliveries use the right type.
5. **Workflow Custom Webhook action.** Confirm it can send a custom header
   (`x-lexdesk-webhook-secret`) and a JSON body built from merge fields, and confirm the merge field
   names in `ghl/snapshot/workflows.md`.
6. **Dialed number on calls.** `to` on call events is not in the documented example; the
   tracking number for F1 is read from it when present.
7. **STOP handling.** Confirm GHL sets SMS do-not-disturb when a contact replies STOP and sends
   ContactDndUpdate. LexDesk relies on that and never sends to a DND contact.
8. **Web chat replies (A3).** `POST /conversations/messages` lists `Live_Chat` in its `type` enum.
   Confirm a reply sent that way reaches the website chat widget.
9. **Free slots (A3).** Confirm the slots respect the calendar's buffers, minimum notice and
   team-member availability, and that extra top-level keys (such as `traceId`) are the only
   non-date keys. LexDesk ignores keys that are not dates.
