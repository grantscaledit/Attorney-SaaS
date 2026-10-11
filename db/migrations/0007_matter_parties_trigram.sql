-- A6 also checks matter parties (spec Section 7: "against contacts, matters,
-- and adverse parties").
CREATE INDEX IF NOT EXISTS "matter_parties_name_trgm_idx"
  ON "matter_parties" USING gin (lower("name") gin_trgm_ops);
