-- Ship Friday slice 10 — requests and the flashing slot (gate line 22).
--
-- Three objects:
--   venue_settings          per-venue operating settings. The first one is the
--                           escalation window: how long an unanswered "now"
--                           request waits before the venue administrator is
--                           told. A venue with no row here never escalates —
--                           the window is data, never a constant in code.
--   requests                the ask itself. The audience is written once, at
--                           creation, and the row has no path that widens it.
--   request_status_history  every step of the ladder, with who moved it.
--
-- Reconciled against event_day_issues first: that table has no kind, quantity,
-- room, slot or urgency, so a new table is the honest answer rather than a
-- column-by-column retrofit of a different idea.

CREATE TABLE venue_settings (
  venue_id uuid PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE,
  request_escalation_seconds integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_settings_escalation_window CHECK (request_escalation_seconds BETWEEN 30 AND 86400)
);
--> statement-breakpoint
CREATE TABLE requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  room_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  kind varchar(20) NOT NULL,
  quantity integer,
  urgency varchar(10) NOT NULL,
  detail text,
  requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  requested_by_name varchar(160) NOT NULL,
  requested_by_role varchar(30) NOT NULL,
  audience_roles jsonb NOT NULL,
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  owner_name varchar(160),
  state varchar(20) NOT NULL DEFAULT 'sent',
  outcome varchar(30),
  outcome_note text,
  idempotency_key varchar(200) NOT NULL,
  escalation_due_at timestamptz,
  escalated_at timestamptz,
  acknowledged_at timestamptz,
  accepted_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT requests_kind CHECK (kind IN ('refreshments', 'temperature', 'cleaning', 'av', 'access', 'other')),
  CONSTRAINT requests_urgency CHECK (urgency IN ('routine', 'soon', 'now')),
  CONSTRAINT requests_state CHECK (state IN ('sent', 'acknowledged', 'accepted', 'resolved')),
  CONSTRAINT requests_outcome CHECK (outcome IS NULL OR outcome IN ('done', 'not_possible', 'no_longer_needed')),
  -- A finished request always says how it finished; an unfinished one never does.
  CONSTRAINT requests_outcome_follows_state CHECK ((state = 'resolved') = (outcome IS NOT NULL)),
  CONSTRAINT requests_quantity CHECK (quantity IS NULL OR (quantity BETWEEN 1 AND 999)),
  CONSTRAINT requests_detail_length CHECK (detail IS NULL OR length(detail) <= 500),
  CONSTRAINT requests_outcome_note_length CHECK (outcome_note IS NULL OR length(outcome_note) <= 500),
  -- The audience is a non-empty list of role names, fixed at creation.
  CONSTRAINT requests_audience_roles CHECK (
    jsonb_typeof(audience_roles) = 'array' AND jsonb_array_length(audience_roles) BETWEEN 1 AND 32)
);
--> statement-breakpoint
-- The concurrency guard for a replayed press: the same key in the same venue
-- can only ever be one row, decided by the index rather than by a precheck.
CREATE UNIQUE INDEX requests_venue_idempotency_unique ON requests(venue_id, idempotency_key);
--> statement-breakpoint
CREATE INDEX requests_venue_state_created_idx ON requests(venue_id, state, created_at DESC);
--> statement-breakpoint
CREATE INDEX requests_booking_idx ON requests(booking_id, created_at DESC);
--> statement-breakpoint
-- The escalation sweep reads only unanswered rows that have a window set.
CREATE INDEX requests_escalation_due_idx ON requests(escalation_due_at) WHERE escalated_at IS NULL AND escalation_due_at IS NOT NULL;
--> statement-breakpoint
CREATE TABLE request_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  from_state varchar(20),
  to_state varchar(20) NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_name varchar(160) NOT NULL,
  actor_role varchar(30) NOT NULL,
  outcome varchar(30),
  note text,
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT request_status_history_from_state CHECK (
    from_state IS NULL OR from_state IN ('sent', 'acknowledged', 'accepted', 'resolved')),
  CONSTRAINT request_status_history_to_state CHECK (
    to_state IN ('sent', 'acknowledged', 'accepted', 'resolved')),
  CONSTRAINT request_status_history_outcome CHECK (
    outcome IS NULL OR outcome IN ('done', 'not_possible', 'no_longer_needed')),
  CONSTRAINT request_status_history_note_length CHECK (note IS NULL OR length(note) <= 500)
);
--> statement-breakpoint
CREATE INDEX request_status_history_request_idx ON request_status_history(request_id, at);
--> statement-breakpoint
-- Trades Hall's escalation window: 180 seconds, which is THREE MINUTES.
-- An unanswered "now" request reaches the venue administrator after it.
--
-- Keyed on the venues.slug row 'trades-hall-glasgow' (the asset slug
-- 'trades-hall' is a different namespace and would match nothing here), and
-- ON CONFLICT DO NOTHING so replaying this migration writes nothing twice.
-- The guard aborts the whole migration rather than write a second row: this
-- becomes a production write when migrations are applied, so "exactly one row
-- or nothing" is enforced here and not left to the shape of the data.
DO $$
DECLARE
  matched integer;
  trades_hall_id uuid;
BEGIN
  SELECT count(*) INTO matched FROM venues v WHERE v.slug = 'trades-hall-glasgow';

  IF matched > 1 THEN
    RAISE EXCEPTION
      'Refusing to seed venue_settings: slug trades-hall-glasgow matched % venues, expected at most one', matched;
  END IF;

  IF matched = 1 THEN
    SELECT v.id INTO trades_hall_id FROM venues v WHERE v.slug = 'trades-hall-glasgow';
    INSERT INTO venue_settings (venue_id, request_escalation_seconds)
    VALUES (trades_hall_id, 180)
    ON CONFLICT (venue_id) DO NOTHING;
  END IF;
END $$;
