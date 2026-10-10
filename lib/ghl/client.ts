import type { z } from "zod";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import {
  GHL_API_BASE_URL,
  GHL_API_VERSIONS,
  GHL_BURST_LIMIT,
  GHL_PATHS,
  type GhlResource,
} from "./endpoints";
import {
  getContactResponse,
  listCalendarsResponse,
  listContactsResponse,
  listEventsResponse,
  searchOpportunitiesResponse,
  sendMessageResponse,
  type GhlAppointment,
  type GhlContact,
  type GhlOpportunity,
  type SendMessageResult,
} from "./schemas";

/**
 * The only path to the GoHighLevel API (spec Section 2: "All GHL calls go
 * through lib/ghl/client.ts with retry, backoff, and idempotency keys").
 *
 * Retries: reads retry on 429, 5xx and network errors with exponential
 * backoff (honouring Retry-After). Writes retry only on 429, which means the
 * request was not processed. Any other write failure is reported as
 * ambiguous and never retried, because GHL documents no idempotency key and a
 * blind retry could text a person twice. Idempotency is enforced on our side
 * by the outbox (messages.idempotency_key).
 */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type GhlClientOptions = {
  token: string;
  locationId: string;
  fetch?: FetchLike;
  baseUrl?: string;
  maxRetries?: number;
  timeoutMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
};

export class GhlApiError extends Error {
  readonly status: number | null;
  /** True when a write may or may not have been applied by GHL. */
  readonly ambiguous: boolean;
  constructor(message: string, status: number | null, ambiguous = false) {
    super(message);
    this.name = "GhlApiError";
    this.status = status;
    this.ambiguous = ambiguous;
  }
}

export class GhlNotConfiguredError extends Error {
  constructor() {
    super("GoHighLevel is not connected: GHL_PRIVATE_TOKEN and GHL_LOCATION_ID are not set.");
    this.name = "GhlNotConfiguredError";
  }
}

type RequestSpec<S extends z.ZodType> = {
  resource: GhlResource;
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  schema: S;
};

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export function backoffMs(attempt: number, retryAfterHeader?: string | null): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
    const at = Date.parse(retryAfterHeader);
    if (!Number.isNaN(at)) return Math.min(Math.max(at - Date.now(), 0), 30_000);
  }
  const base = 500 * 2 ** attempt;
  return Math.min(base + Math.floor(Math.random() * 250), 8_000);
}

/** Sliding-window limiter that keeps one process under GHL's burst limit. */
class BurstLimiter {
  private stamps: number[] = [];
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly sleep: (ms: number) => Promise<void>,
  ) {}
  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
      if (this.stamps.length < this.max) {
        this.stamps.push(now);
        return;
      }
      await this.sleep(this.windowMs - (now - this.stamps[0]!) + 5);
    }
  }
}

export class GhlClient {
  readonly locationId: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly limiter: BurstLimiter;

  constructor(options: GhlClientOptions) {
    this.token = options.token;
    this.locationId = options.locationId;
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.baseUrl = options.baseUrl ?? GHL_API_BASE_URL;
    this.maxRetries = options.maxRetries ?? 4;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    // Stay a little under the documented limit to leave room for GHL's own workflows.
    this.limiter = new BurstLimiter(
      GHL_BURST_LIMIT.requests - 10,
      GHL_BURST_LIMIT.windowMs,
      this.sleep,
    );
  }

  private url(path: string, query?: RequestSpec<z.ZodType>["query"]): string {
    const u = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  async request<S extends z.ZodType>(spec: RequestSpec<S>): Promise<z.output<S>> {
    const isWrite = spec.method !== "GET";
    const url = this.url(spec.path, spec.query);
    const route = `${spec.method} ${spec.path.replace(/\/[A-Za-z0-9_-]{12,}(?=\/|$)/g, "/:id")}`;

    for (let attempt = 0; ; attempt++) {
      await this.limiter.take();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: spec.method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            Version: GHL_API_VERSIONS[spec.resource],
            Accept: "application/json",
            ...(spec.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: spec.body !== undefined ? JSON.stringify(spec.body) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        // The request may have reached GHL before the connection dropped.
        if (isWrite) {
          throw new GhlApiError(`${route} failed in transit; outcome unknown`, null, true);
        }
        if (attempt >= this.maxRetries) {
          throw new GhlApiError(`${route} failed after ${attempt + 1} attempts`, null);
        }
        log.warn("ghl request failed, retrying", { route, attempt, err });
        await this.sleep(backoffMs(attempt));
        continue;
      }
      clearTimeout(timer);

      if (res.ok) {
        const json: unknown = await res.json().catch(() => null);
        const parsed = spec.schema.safeParse(json);
        if (!parsed.success) {
          // Never log the body: it holds client data.
          log.error("ghl response did not match schema", {
            route,
            issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`),
          });
          throw new GhlApiError(`${route} returned an unexpected response`, res.status);
        }
        return parsed.data;
      }

      const retryable = isWrite ? res.status === 429 : RETRYABLE_STATUS.has(res.status);
      if (retryable && attempt < this.maxRetries) {
        log.warn("ghl request rejected, retrying", { route, status: res.status, attempt });
        await this.sleep(backoffMs(attempt, res.headers.get("retry-after")));
        continue;
      }
      // A 5xx on a write may or may not have been applied.
      const ambiguous = isWrite && res.status >= 500;
      throw new GhlApiError(`${route} returned HTTP ${res.status}`, res.status, ambiguous);
    }
  }

  async getContact(contactId: string): Promise<GhlContact> {
    const r = await this.request({
      resource: "contacts",
      method: "GET",
      path: GHL_PATHS.contact(contactId),
      schema: getContactResponse,
    });
    return r.contact;
  }

  /** One page of contacts. VERIFY: endpoint is marked deprecated in GHL's spec (see endpoints.ts). */
  async listContacts(cursor: { startAfter?: number | null; startAfterId?: string | null } = {}) {
    const r = await this.request({
      resource: "contacts",
      method: "GET",
      path: GHL_PATHS.contactsList,
      query: {
        locationId: this.locationId,
        limit: 100,
        startAfter: cursor.startAfter,
        startAfterId: cursor.startAfterId,
      },
      schema: listContactsResponse,
    });
    const last = r.contacts.at(-1);
    const next =
      r.contacts.length === 100 && last
        ? {
            startAfterId: r.meta?.startAfterId ?? last.id,
            startAfter: r.meta?.startAfter ?? last.dateAdded?.getTime() ?? null,
          }
        : null;
    return { contacts: r.contacts, next };
  }

  /** One page of opportunities, paginated with GHL's startAfter cursor. */
  async searchOpportunities(
    cursor: { startAfter?: number | null; startAfterId?: string | null } = {},
  ): Promise<{
    opportunities: GhlOpportunity[];
    next: { startAfter: number | null; startAfterId: string | null } | null;
  }> {
    const r = await this.request({
      resource: "opportunities",
      method: "GET",
      path: GHL_PATHS.opportunitiesSearch,
      query: {
        location_id: this.locationId,
        status: "all",
        limit: 100,
        startAfter: cursor.startAfter,
        startAfterId: cursor.startAfterId,
      },
      schema: searchOpportunitiesResponse,
    });
    const next =
      r.opportunities.length === 100 && r.meta?.startAfterId
        ? { startAfter: r.meta.startAfter ?? null, startAfterId: r.meta.startAfterId }
        : null;
    return { opportunities: r.opportunities, next };
  }

  async listCalendars(): Promise<{ id: string; name: string | null }[]> {
    const r = await this.request({
      resource: "calendars",
      method: "GET",
      path: GHL_PATHS.calendars,
      query: { locationId: this.locationId },
      schema: listCalendarsResponse,
    });
    return r.calendars;
  }

  async listCalendarEvents(calendarId: string, from: Date, to: Date): Promise<GhlAppointment[]> {
    const r = await this.request({
      resource: "calendars",
      method: "GET",
      path: GHL_PATHS.calendarEvents,
      query: {
        locationId: this.locationId,
        calendarId,
        startTime: from.getTime(),
        endTime: to.getTime(),
      },
      schema: listEventsResponse,
    });
    return r.events;
  }

  /**
   * Sends an SMS or email to a contact through the firm's GHL number or
   * mailbox. VERIFY: the spec lists `subType` and `status` as required on this
   * body although both read as response fields; we send neither.
   */
  async sendMessage(
    input:
      | { channel: "sms"; contactId: string; message: string }
      | { channel: "email"; contactId: string; subject: string; message: string; html: string },
  ): Promise<SendMessageResult> {
    const body =
      input.channel === "sms"
        ? { type: "SMS", contactId: input.contactId, message: input.message }
        : {
            type: "Email",
            contactId: input.contactId,
            subject: input.subject,
            message: input.message,
            html: input.html,
          };
    return this.request({
      resource: "conversations",
      method: "POST",
      path: GHL_PATHS.sendMessage,
      body,
      schema: sendMessageResponse,
    });
  }
}

/** True when this deployment has live GHL credentials (never in demo mode, rule 12). */
export function ghlConfigured(): boolean {
  const e = env();
  return !e.DEMO_MODE && Boolean(e.GHL_PRIVATE_TOKEN && e.GHL_LOCATION_ID);
}

let override: GhlClient | null | undefined;
let shared: GhlClient | undefined;

/** The firm's GHL client (one per process, so the burst limiter is shared), or null when not connected. */
export function getGhlClient(): GhlClient | null {
  if (override !== undefined) return override;
  if (!ghlConfigured()) return null;
  if (!shared) {
    const e = env();
    shared = new GhlClient({ token: e.GHL_PRIVATE_TOKEN!, locationId: e.GHL_LOCATION_ID! });
  }
  return shared;
}

/** Tests and the demo seed swap the client (a fake transport, or null for "not connected"). */
export function setGhlClientForTesting(client: GhlClient | null | undefined): void {
  override = client;
}
