-- Audit log integrity (spec Section 4: "Immutable audit_log").
--
-- 1. Every row is chained to the previous one with SHA-256, computed inside the
--    database so no code path (app, script, psql) can insert an unchained row.
-- 2. UPDATE, DELETE and TRUNCATE are rejected.
-- 3. audit_log_verify_chain() recomputes the chain and reports the first break.
--
-- Chain writes are serialized with a transaction-scoped advisory lock. Inserts
-- must run under READ COMMITTED (the Postgres default) so each trigger sees the
-- latest committed head.

ALTER TABLE "audit_log"
  ADD CONSTRAINT "audit_log_actor_type_check"
  CHECK ("actor_type" IN ('user', 'system', 'vendor', 'anonymous'));
--> statement-breakpoint

CREATE FUNCTION audit_log_compute_hash(r audit_log) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(concat_ws(E'\x1f',
    r.seq::text,
    r.id::text,
    to_char(r.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    r.actor_type,
    coalesce(r.actor_id::text, ''),
    coalesce(r.actor_label, ''),
    r.action,
    coalesce(r.entity_type, ''),
    coalesce(r.entity_id, ''),
    coalesce(r.before::text, ''),
    coalesce(r.after::text, ''),
    coalesce(r.metadata::text, ''),
    coalesce(r.ip, ''),
    coalesce(r.user_agent, ''),
    coalesce(r.request_id, ''),
    coalesce(r.prev_hash, '')
  ), 'UTF8')), 'hex');
$$;
--> statement-breakpoint

CREATE FUNCTION audit_log_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_seq bigint;
  last_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('lexdesk.audit_log.chain'));
  SELECT seq, hash INTO last_seq, last_hash FROM audit_log ORDER BY seq DESC LIMIT 1;
  NEW.seq := coalesce(last_seq, 0) + 1;
  NEW.occurred_at := clock_timestamp();
  NEW.prev_hash := last_hash;
  NEW.hash := audit_log_compute_hash(NEW);
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER audit_log_chain
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_chain();
--> statement-breakpoint

CREATE FUNCTION audit_log_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_mutation();
--> statement-breakpoint

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_mutation();
--> statement-breakpoint

-- Returns one row: how many rows were checked, the seq of the first invalid row
-- (NULL when the chain is intact), and why it failed.
CREATE FUNCTION audit_log_verify_chain()
RETURNS TABLE (checked bigint, first_invalid_seq bigint, reason text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r audit_log;
  expected_seq bigint := 1;
  expected_prev text := NULL;
  n bigint := 0;
BEGIN
  FOR r IN SELECT * FROM audit_log ORDER BY seq LOOP
    n := n + 1;
    IF r.seq <> expected_seq THEN
      RETURN QUERY SELECT n, r.seq, format('sequence gap: expected %s', expected_seq);
      RETURN;
    END IF;
    IF r.prev_hash IS DISTINCT FROM expected_prev THEN
      RETURN QUERY SELECT n, r.seq, 'prev_hash does not match previous row'::text;
      RETURN;
    END IF;
    IF r.hash <> audit_log_compute_hash(r) THEN
      RETURN QUERY SELECT n, r.seq, 'row content does not match its hash'::text;
      RETURN;
    END IF;
    expected_seq := r.seq + 1;
    expected_prev := r.hash;
  END LOOP;
  RETURN QUERY SELECT n, NULL::bigint, NULL::text;
END;
$$;
