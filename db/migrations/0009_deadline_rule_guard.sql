-- C1, spec Section 8: "The engine refuses to compute from a rule where
-- verified_by and verified_at are null." The application checks this and a
-- hash of the verified parameters (modules/deadlines/engine.ts); this
-- trigger is the second lock, so no code path can write a rule-computed
-- deadline from an unverified rule, or from parameters other than the ones
-- the attorney verified.

ALTER TABLE "deadlines"
  ADD CONSTRAINT "deadlines_rule_origin_has_rule"
  CHECK ("origin" <> 'rule' OR ("rule_id" IS NOT NULL AND "rule_hash" IS NOT NULL));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION deadlines_require_verified_rule() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  IF NEW.origin <> 'rule' THEN
    RETURN NEW;
  END IF;
  SELECT active, verified_by, verified_at, verified_hash INTO r
    FROM deadline_rules WHERE id = NEW.rule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deadline rule % does not exist', NEW.rule_id USING ERRCODE = 'check_violation';
  END IF;
  IF NOT r.active OR r.verified_by IS NULL OR r.verified_at IS NULL OR r.verified_hash IS NULL THEN
    RAISE EXCEPTION 'deadline rule % is not verified; it cannot compute deadlines', NEW.rule_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF r.verified_hash <> NEW.rule_hash THEN
    RAISE EXCEPTION 'deadline was computed from parameters that differ from the verified rule %', NEW.rule_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "deadlines_verified_rule_insert"
  BEFORE INSERT ON "deadlines"
  FOR EACH ROW EXECUTE FUNCTION deadlines_require_verified_rule();
--> statement-breakpoint
-- On update only when the date or its source changes: closing a deadline whose
-- rule was later edited must still work.
CREATE TRIGGER "deadlines_verified_rule_update"
  BEFORE UPDATE OF "due_on", "rule_id", "rule_hash", "origin" ON "deadlines"
  FOR EACH ROW EXECUTE FUNCTION deadlines_require_verified_rule();
