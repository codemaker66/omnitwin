-- Opening and lock-up on the Day Board (T-693, 11 November 2026).
-- 0107, after 0106 (supplier arrivals); the release queue confirms the
-- number at the merge slot (renumber the tag AND the journal `when`).
--
-- The venue's own checks for opening the building and locking it up, in its
-- own words, and each day's ticks. Venviewer writes none: a list it invented
-- would be a claim about a building it has not seen. A check taken off the
-- list is retired, not deleted, so a day keeps what was ticked on it. A tick
-- is one per check per board day (the venue's day, to its boundary hour);
-- the unique index decides two taps at once. A tick records what someone
-- says they did, never a compliance claim.
--
-- New tables only: nothing existing is read, rewritten or locked.

CREATE TABLE venue_building_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  kind varchar(10) NOT NULL,
  label varchar(200) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_building_checks_kind CHECK (kind IN ('opening', 'lockup'))
);
--> statement-breakpoint
CREATE INDEX venue_building_checks_venue_kind_idx ON venue_building_checks(venue_id, kind, sort_order);
--> statement-breakpoint
CREATE TABLE venue_building_check_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  check_id uuid NOT NULL REFERENCES venue_building_checks(id) ON DELETE CASCADE,
  board_day date NOT NULL,
  done_at timestamptz NOT NULL DEFAULT now(),
  done_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  done_by_name varchar(160) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX venue_building_check_marks_check_day_unique ON venue_building_check_marks(check_id, board_day);
--> statement-breakpoint
CREATE INDEX venue_building_check_marks_venue_day_idx ON venue_building_check_marks(venue_id, board_day);
