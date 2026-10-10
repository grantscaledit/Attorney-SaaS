-- Intake metric views (spec Section 9: "Metric definitions live in
-- /modules/metrics/definitions.ts as SQL views. The dashboard, briefs, monthly
-- report, and G4 all read the same views so numbers never disagree.")
--
-- One row per lead with every fact the Intake panel needs. Aggregations over
-- these rows live in modules/metrics/definitions.ts.

CREATE VIEW "metrics_lead_facts" AS
SELECT
  l.id AS lead_id,
  l.contact_id,
  l.status,
  l.channel,
  l.practice_area,
  l.missed_call,
  l.first_inbound_at,
  l.first_response_at,
  l.first_human_response_at,
  EXTRACT(EPOCH FROM (l.first_response_at - l.first_inbound_at))::integer AS first_response_seconds,
  l.consult_booked_at,
  l.consult_held_at,
  l.retained_at,
  l.closed_at,
  coalesce(ft.source_label, 'unknown') AS first_touch_source,
  coalesce(lt.source_label, 'unknown') AS last_touch_source,
  -- A missed-call lead is recovered when, within 7 days of the missed call, the
  -- caller books a consult, replies, or a call with them connects.
  (
    l.missed_call AND (
      (l.consult_booked_at IS NOT NULL AND l.consult_booked_at <= l.first_inbound_at + interval '7 days')
      OR EXISTS (
        SELECT 1 FROM calls c
        WHERE c.lead_id = l.id
          AND c.outcome = 'answered'
          AND c.occurred_at > l.first_inbound_at
          AND c.occurred_at <= l.first_inbound_at + interval '7 days'
      )
      OR EXISTS (
        SELECT 1 FROM messages m
        WHERE m.lead_id = l.id
          AND m.direction = 'inbound'
          AND m.occurred_at > l.first_inbound_at
          AND m.occurred_at <= l.first_inbound_at + interval '7 days'
      )
    )
  ) AS recovered
FROM leads l
LEFT JOIN LATERAL (
  SELECT t.source_label FROM lead_touches t
  WHERE t.lead_id = l.id
  ORDER BY t.occurred_at ASC, t.created_at ASC
  LIMIT 1
) ft ON true
LEFT JOIN LATERAL (
  SELECT t.source_label FROM lead_touches t
  WHERE t.lead_id = l.id
  ORDER BY t.occurred_at DESC, t.created_at DESC
  LIMIT 1
) lt ON true
WHERE l.deleted_at IS NULL;
--> statement-breakpoint

-- Consult appointments linked to a lead, for booked and show rates.
CREATE VIEW "metrics_consults" AS
SELECT
  a.id AS appointment_id,
  a.lead_id,
  a.status,
  a.starts_at,
  (a.status = 'showed') AS showed,
  (a.status = 'noshow') AS no_show
FROM appointments a
WHERE a.deleted_at IS NULL
  AND a.lead_id IS NOT NULL;
