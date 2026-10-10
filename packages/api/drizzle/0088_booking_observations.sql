-- Goal 19 S5 (T-651) — observations: what a hallkeeper saw, as facts.
--
-- A booking's phases are the schedule (D1). An observation is what actually
-- happened in the room: set, doors open, live, flipping, done, cleaned. Each
-- is one row with the hallkeeper's own time (observed_at, the corrected clock
-- at the tap) and the server's (recorded_at). Rows are never updated: a
-- second device's fact sits beside the first and the board reads the latest
-- by observed_at, so a tap replayed from an offline phone lands where it
-- belongs. The idempotency key is minted at the tap, so a replay is the same
-- fact, not a second one.
--
-- Nothing here writes a time on a booking. Nothing here reads production data.

CREATE TABLE booking_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  space_id uuid REFERENCES spaces(id) ON DELETE SET NULL,
  kind varchar(12) NOT NULL,
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_name varchar(160) NOT NULL,
  actor_role varchar(30) NOT NULL,
  idempotency_key uuid NOT NULL,
  CONSTRAINT booking_observations_kind CHECK (kind IN ('set', 'doors-open', 'live', 'flipping', 'done', 'cleaned'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX booking_observations_venue_idempotency_unique ON booking_observations(venue_id, idempotency_key);
--> statement-breakpoint
CREATE INDEX booking_observations_booking_observed_idx ON booking_observations(booking_id, observed_at);
--> statement-breakpoint
CREATE INDEX booking_observations_venue_observed_idx ON booking_observations(venue_id, observed_at);
