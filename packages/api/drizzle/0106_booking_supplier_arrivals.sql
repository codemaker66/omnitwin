-- Supplier arrivals on the Day Board (T-692, 11 November 2026).
-- 0106, after 0105; the release queue confirms the number at the merge slot
-- (renumber the tag AND the journal `when`).
--
-- Who comes to the building for a booking, when, and at which door: what a
-- hallkeeper needs to receive a supplier at the right entrance and to know,
-- at lock-up, who is still in. The venue's office enters an arrival against
-- a booking; the floor marks it arrived and gone. Those two are facts, first
-- tap wins, and never move the revision, which guards the office's own
-- edits. A supplier pass (0038) stays what the supplier is sent; this is the
-- floor's record of the door.
--
-- A new table only: nothing existing is read, rewritten or locked.

CREATE TABLE booking_supplier_arrivals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  supplier_name varchar(160) NOT NULL,
  category varchar(40),
  arrives_at timestamptz NOT NULL,
  leaves_by timestamptz,
  entrance varchar(100),
  contact varchar(160),
  note varchar(500),
  arrived_at timestamptz,
  arrived_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  arrived_by_name varchar(160),
  left_at timestamptz,
  left_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  left_by_name varchar(160),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1,
  CONSTRAINT booking_supplier_arrivals_leaves_after CHECK (leaves_by IS NULL OR leaves_by > arrives_at),
  CONSTRAINT booking_supplier_arrivals_left_after_arrived CHECK (left_at IS NULL OR arrived_at IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX booking_supplier_arrivals_venue_arrives_idx ON booking_supplier_arrivals(venue_id, arrives_at);
--> statement-breakpoint
CREATE INDEX booking_supplier_arrivals_booking_idx ON booking_supplier_arrivals(booking_id);
