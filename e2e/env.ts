/** Fixed environment for the end-to-end run: the demo firm on its own database and port. */
export const E2E_PORT = 3100;

const adminUrl =
  process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const dbUrl = new URL(adminUrl);
dbUrl.pathname = "/lexdesk_e2e";

export const E2E_ENV: Record<string, string> = {
  NODE_ENV: "production",
  FIRM_SLUG: "siekierski-law",
  FIRM_TIER: "solo",
  FIRM_TIMEZONE: "America/Chicago",
  DEMO_MODE: "true",
  APP_URL: `http://localhost:${E2E_PORT}`,
  DATABASE_URL: dbUrl.toString(),
  AUTH_SECRET: "e2e-only-auth-secret-not-used-anywhere-else-0123456789",
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  LOG_LEVEL: "warn",
};

export const ADMIN_URL = adminUrl;
export const DEMO_PASSWORD = "Demo password for LexDesk 2026";
/** Base32 of the demo seed's shared authenticator secret. */
export const DEMO_TOTP = "NRSXQZDFONVS2ZDFNVXS2YLVORUGK3TUNFRWC5DPOIWWWZLZGAYQ";
