-- Supplier arrivals on the Day Board (T-692, 11 November 2026).
-- 0108, after #394's 0107 (venue managers record Ops reviews); the release
-- queue confirms the number at the merge slot.
-- A renumber changes this file's name, this line, and the journal entry's
-- tag, idx and `when`. Its `when` must be strictly later than the entry
-- before it: drizzle applies a migration only when its `when` is later than
-- the last one applied, so an equal value is skipped.
--
-- Who comes to the building for a booking, when, and at which door: what a
-- hallkeeper needs to receive a supplier at the right entrance and to know,
-- at lock-up, who is still in. The venue's office enters an arrival against
-- a booking; the floor marks it arrived and gone. Those two are facts, first
-- tap wins, and never move the revision, which guards the office's own
-- edits. A supplier pass (0038) stays what the supplier is sent; this is the
-- floor's record of the door.
--
-- booking_supplier_arrivals holds one row per supplier expected:
--   - it belongs to its booking's own venue (the composite key onto
--     bookings(id, venue_id)), so no writer can file one venue's supplier
--     under another venue's booking;
--   - its text is never blank, so the day's read never meets an empty name;
--   - an office add may carry the client's Idempotency-Key: a Save sent again
--     after a lost answer finds the first row instead of making a second.
-- booking_supplier_arrival_events is the door's history, written in the same
-- transaction as each change it records: who marked a supplier in or out,
-- who took a mark back, and who removed an arrival (that record outlives the
-- arrival, so it has no key onto it). Taps name the person; a removal keeps
-- only the account.
--
-- What is kept (Blake, 12 November 2026): the nightly clean-up clears an
-- arrival's contact and note a year after its booking ends
-- (SUPPLIER_ARRIVAL_RETENTION in @omnitwin/types). The supplier's name, the
-- times and the names of the staff who marked the door stay as the venue's
-- record of who was in the building, after an account is closed too.
--
-- New tables only: nothing existing is read or rewritten. Creating their
-- foreign keys takes SHARE ROW EXCLUSIVE locks on venues, bookings and users.
-- Each waits at most five seconds and then fails the deploy, rather than
-- queue every Diary save behind it while another session holds bookings.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE booking_supplier_arrivals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL,
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
  idempotency_key uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1,
  CONSTRAINT booking_supplier_arrivals_booking_venue_fk FOREIGN KEY (booking_id, venue_id)
    REFERENCES bookings(id, venue_id) ON DELETE CASCADE,
  CONSTRAINT booking_supplier_arrivals_leaves_after CHECK (leaves_by IS NULL OR leaves_by > arrives_at),
  CONSTRAINT booking_supplier_arrivals_left_after_arrived CHECK (left_at IS NULL OR arrived_at IS NOT NULL),
  CONSTRAINT booking_supplier_arrivals_name_not_blank CHECK (btrim(supplier_name) <> ''),
  CONSTRAINT booking_supplier_arrivals_text_not_blank CHECK (
    (category IS NULL OR btrim(category) <> '')
    AND (entrance IS NULL OR btrim(entrance) <> '')
    AND (contact IS NULL OR btrim(contact) <> '')
    AND (note IS NULL OR btrim(note) <> '')
  )
);
--> statement-breakpoint
CREATE INDEX booking_supplier_arrivals_venue_arrives_idx ON booking_supplier_arrivals(venue_id, arrives_at);
--> statement-breakpoint
CREATE INDEX booking_supplier_arrivals_booking_idx ON booking_supplier_arrivals(booking_id);
--> statement-breakpoint
CREATE UNIQUE INDEX booking_supplier_arrivals_idempotency_idx ON booking_supplier_arrivals(venue_id, idempotency_key);
--> statement-breakpoint
CREATE TABLE booking_supplier_arrival_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL,
  booking_id uuid NOT NULL,
  arrival_id uuid NOT NULL,
  supplier_name varchar(160) NOT NULL,
  action varchar(20) NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_name varchar(160),
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_supplier_arrival_events_booking_venue_fk FOREIGN KEY (booking_id, venue_id)
    REFERENCES bookings(id, venue_id) ON DELETE CASCADE,
  CONSTRAINT booking_supplier_arrival_events_action
    CHECK (action IN ('arrived', 'left', 'arrived-undone', 'left-undone', 'removed')),
  CONSTRAINT booking_supplier_arrival_events_named_at_the_door CHECK ((action = 'removed') = (actor_name IS NULL))
);
--> statement-breakpoint
CREATE INDEX booking_supplier_arrival_events_arrival_idx ON booking_supplier_arrival_events(arrival_id, at);
--> statement-breakpoint
CREATE INDEX booking_supplier_arrival_events_booking_idx ON booking_supplier_arrival_events(booking_id);
--> statement-breakpoint
-- The five-second limit was for this file alone; anything after it in the
-- same migration run waits as the migrator itself allows.
SET LOCAL lock_timeout TO DEFAULT;
