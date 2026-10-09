import { sql } from "drizzle-orm";
import { boolean, check, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const PRACTICE_AREAS = ["tax", "business", "estate"] as const;
export type PracticeArea = (typeof PRACTICE_AREAS)[number];

/**
 * Single-row firm profile. Deployment identity (slug, tier, time zone) comes from
 * the environment; `slug` is stored here so the app can refuse to start against
 * another firm's database.
 */
export const firmSettings = pgTable(
  "firm_settings",
  {
    id: smallint("id").primaryKey().default(1),
    slug: text("slug").notNull(),
    legalName: text("legal_name").notNull(),
    displayName: text("display_name").notNull(),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    phone: text("phone"),
    website: text("website"),
    practiceAreas: text("practice_areas", { enum: PRACTICE_AREAS })
      .array()
      .notNull()
      .default(sql`'{}'`),
    aiDisclosureText: text("ai_disclosure_text").notNull(),
    attorneysSeeFinancials: boolean("attorneys_see_financials").notNull().default(false),
    ipAllowlist: text("ip_allowlist")
      .array()
      .notNull()
      .default(sql`'{}'`),
    provisionedAt: timestamp("provisioned_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
  },
  (t) => [check("firm_settings_singleton", sql`${t.id} = 1`)],
);

/** Per-firm overrides of tier defaults. An override can only switch off a feature the tier includes. */
export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull(),
  reason: text("reason"),
  updatedBy: uuid("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FirmSettingsRow = typeof firmSettings.$inferSelect;
