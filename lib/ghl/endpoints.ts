/**
 * GoHighLevel API facts LexDesk depends on, in one place.
 *
 * Checked on 2026-10-10 against GHL's official API V2 documentation source,
 * github.com/GoHighLevel/highlevel-api-docs at commit 0af86a4 (2026-06-19):
 * apps/contacts.json, apps/opportunities.json, apps/conversations.json,
 * apps/calendars.json, docs/oauth/WebhookAuthentication.md,
 * docs/oauth/Authorization.md and docs/webhook events/*.md.
 * The marketplace docs site itself was not reachable from the build
 * environment. Items still marked VERIFY are listed in docs/ghl/api-notes.md.
 */

export const GHL_API_BASE_URL = "https://services.leadconnectorhq.com";

/**
 * Each resource family requires its own `Version` header value
 * (an enum of one value per family in the OpenAPI specs).
 */
export const GHL_API_VERSIONS = {
  contacts: "2021-07-28",
  opportunities: "2021-07-28",
  conversations: "2021-04-15",
  calendars: "2021-04-15",
} as const;

export type GhlResource = keyof typeof GHL_API_VERSIONS;

export const GHL_PATHS = {
  /** GET. Scope contacts.readonly. */
  contact: (contactId: string) => `/contacts/${encodeURIComponent(contactId)}`,
  /**
   * GET, paginated with startAfter/startAfterId, limit up to 100. Marked
   * deprecated in the spec; its replacement (POST /contacts/search) has no
   * documented request body in the source. VERIFY before relying on it.
   */
  contactsList: "/contacts/",
  /** GET, paginated with startAfter/startAfterId or page, limit up to 100. Scope opportunities.readonly. */
  opportunitiesSearch: "/opportunities/search",
  /** GET ?locationId. Scope calendars.readonly. */
  calendars: "/calendars/",
  /** GET ?locationId&calendarId&startTime&endTime (epoch millis). Scope calendars/events.readonly. */
  calendarEvents: "/calendars/events",
  /** POST. Scope conversations/message.write. */
  sendMessage: "/conversations/messages",
} as const;

/** Burst limit from docs/oauth/Authorization.md: 100 requests per 10 seconds per location. */
export const GHL_BURST_LIMIT = { requests: 100, windowMs: 10_000 } as const;

/** Rate-limit response headers documented in docs/oauth/Authorization.md. */
export const GHL_RATE_LIMIT_HEADERS = {
  remaining: "x-ratelimit-remaining",
  intervalMs: "x-ratelimit-interval-milliseconds",
  dailyRemaining: "x-ratelimit-daily-remaining",
} as const;

/** Header carrying the RSA signature on marketplace webhook deliveries. */
export const GHL_SIGNATURE_HEADER = "x-wh-signature";

/**
 * Public key for verifying `x-wh-signature` (RSA, SHA-256, base64 signature),
 * copied from docs/oauth/WebhookAuthentication.md. GHL announces rotations by
 * email; set GHL_WEBHOOK_PUBLIC_KEY to override without a deploy.
 */
export const GHL_WEBHOOK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAokvo/r9tVgcfZ5DysOSC
Frm602qYV0MaAiNnX9O8KxMbiyRKWeL9JpCpVpt4XHIcBOK4u3cLSqJGOLaPuXw6
dO0t6Q/ZVdAV5Phz+ZtzPL16iCGeK9po6D6JHBpbi989mmzMryUnQJezlYJ3DVfB
csedpinheNnyYeFXolrJvcsjDtfAeRx5ByHQmTnSdFUzuAnC9/GepgLT9SM4nCpv
uxmZMxrJt5Rw+VUaQ9B8JSvbMPpez4peKaJPZHBbU3OdeCVx5klVXXZQGNHOs8gF
3kvoV5rTnXV0IknLBXlcKKAQLZcY/Q9rG6Ifi9c+5vqlvHPCUJFT5XUGG5RKgOKU
J062fRtN+rLYZUV+BjafxQauvC8wSWeYja63VSUruvmNj8xkx2zE/Juc+yjLjTXp
IocmaiFeAO6fUtNjDeFVkhf5LNb59vECyrHD2SQIrhgXpO4Q3dVNA5rw576PwTzN
h/AMfHKIjE4xQA1SZuYJmNnmVZLIZBlQAF9Ntd03rfadZ+yDiOXCCs9FkHibELhC
HULgCsnuDJHcrGNd5/Ddm5hxGQ0ASitgHeMZ0kcIOwKDOzOU53lDza6/Y09T7sYJ
PQe7z0cvj7aE4B+Ax1ZoZGPzpJlZtGXCsu9aTEGEnKzmsFqwcSsnw3JB31IGKAyk
T1hhTiaCeIY/OwwwNUY2yvcCAwEAAQ==
-----END PUBLIC KEY-----`;

/**
 * Header that LexDesk's snapshot workflows send with the firm's
 * GHL_WEBHOOK_SECRET (workflow "Custom Webhook" actions cannot sign bodies).
 * Our own name, not a GHL convention.
 */
export const LEXDESK_SECRET_HEADER = "x-lexdesk-webhook-secret";
