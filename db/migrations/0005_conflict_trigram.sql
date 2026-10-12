-- A6 conflict pre-screen (spec Section 2: "pg_trgm for conflict matching").
-- Trigram indexes on the normalized names the pre-screen compares.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_full_name_trgm_idx"
  ON "contacts" USING gin (lower(coalesce("full_name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_company_trgm_idx"
  ON "contacts" USING gin (lower(coalesce("company_name", '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conflict_parties_name_trgm_idx"
  ON "conflict_parties" USING gin (lower("name") gin_trgm_ops);
