import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const TIERS = ["solo", "firm"] as const;
export type Tier = (typeof TIERS)[number];

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    FIRM_SLUG: z
      .string()
      .regex(
        /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/,
        "lowercase letters, digits and hyphens, 3-40 chars",
      ),
    FIRM_TIER: z.enum(TIERS),
    FIRM_TIMEZONE: z.string().refine(isValidTimeZone, "must be a valid IANA time zone"),
    DEMO_MODE: booleanFromString,
    APP_URL: z.url(),
    DATABASE_URL: z.string().min(1),
    DATABASE_URL_READONLY: optionalString,
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
    FIELD_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64 encoded"),
    GHL_PRIVATE_TOKEN: optionalString,
    GHL_LOCATION_ID: optionalString,
    GHL_WEBHOOK_SECRET: optionalString,
    ANTHROPIC_API_KEY: optionalString,
    ALLOW_RAW_DOCUMENT_TO_LLM: booleanFromString,
    SENTRY_DSN: optionalString,
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .superRefine((env, ctx) => {
    // Rule 12: demo mode can never connect to live GHL or send real messages.
    if (env.DEMO_MODE && (env.GHL_PRIVATE_TOKEN || env.GHL_LOCATION_ID)) {
      ctx.addIssue({
        code: "custom",
        path: ["DEMO_MODE"],
        message: "DEMO_MODE=true cannot be combined with GHL credentials",
      });
    }
    const local = ["localhost", "127.0.0.1"].includes(new URL(env.APP_URL).hostname);
    if (env.NODE_ENV === "production" && !env.APP_URL.startsWith("https://") && !local) {
      ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "must be https in production" });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Validated environment. Parsed lazily on first use so that `next build` can run
 * without production secrets; the first request (or script) fails loudly if the
 * environment is wrong.
 */
export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: drop the cached env so a test can change process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
