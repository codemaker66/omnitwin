-- Opening and lock-up on the Day Board (T-693, 11 November 2026).
-- 0110 at journal idx 107, after 0109 (supplier arrivals); the release queue
-- confirms the number at the merge slot. A renumber changes this file's name,
-- this line, and the journal entry's tag, idx and `when`. Its `when` must be
-- strictly later than the entry before it: drizzle applies a migration only
-- when its `when` is later than the last one applied, so an equal value is
-- skipped.
--
-- The venue's own checks for opening the building and locking it up, in its
-- own words, and each day's ticks. Venviewer writes none: a list it invented
-- would be a claim about a building it has not seen. A check is never
-- deleted: one taken off the list is retired, and new words make a new
-- check, so a day keeps what was ticked on it in the words it was ticked
-- against. A tick is one per check per board day (the venue's day, to its
-- boundary hour); the unique index over live ticks decides two taps at
-- once. A tick taken back stays on record, with who took it back and when.
-- A tick records what someone says they did, never a compliance claim. The
-- name on a tick stays as the venue's record of who did the check, after
-- their account is deleted too (Blake, 12 November 2026).
--
-- New tables only: nothing existing is read or rewritten. Creating their
-- foreign keys takes SHARE ROW EXCLUSIVE locks on venues and on users,
-- which block writes to those tables. Each lock is waited for at most ten
-- seconds, then the deploy fails rather than wait longer, so writes queue
-- for up to ten seconds behind each wait; once taken, both locks are held
-- until the migration batch commits, which is moments later.

SET LOCAL lock_timeout = '10s';
--> statement-breakpoint
CREATE TABLE venue_building_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  kind varchar(10) NOT NULL,
  label varchar(200) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  retired_at timestamptz,
  retired_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT venue_building_checks_kind CHECK (kind IN ('opening', 'lockup')),
  CONSTRAINT venue_building_checks_label CHECK (label = btrim(label) AND char_length(label) BETWEEN 1 AND 200),
  CONSTRAINT venue_building_checks_retired_after_created CHECK (retired_at IS NULL OR retired_at >= created_at),
  -- What a tick's (check_id, venue_id) names: a check of the tick's own venue.
  CONSTRAINT venue_building_checks_id_venue UNIQUE (id, venue_id)
);
--> statement-breakpoint
CREATE INDEX venue_building_checks_venue_kind_idx ON venue_building_checks(venue_id, kind, sort_order);
--> statement-breakpoint
CREATE TABLE venue_building_check_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  check_id uuid NOT NULL,
  board_day date NOT NULL,
  done_at timestamptz NOT NULL DEFAULT now(),
  done_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  done_by_name varchar(160) NOT NULL,
  undone_at timestamptz,
  undone_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  undone_by_name varchar(160),
  -- No action on delete: a ticked check is never deleted out from under its
  -- ticks. A venue's own deletion still removes both, as each cascades from
  -- venues and this is checked once the statement's cascades are done.
  CONSTRAINT venue_building_check_marks_check FOREIGN KEY (check_id, venue_id) REFERENCES venue_building_checks(id, venue_id),
  CONSTRAINT venue_building_check_marks_done_by_name CHECK (btrim(done_by_name) <> ''),
  CONSTRAINT venue_building_check_marks_undone CHECK (
    (undone_at IS NULL) = (undone_by_name IS NULL) AND (undone_by_name IS NULL OR btrim(undone_by_name) <> '')
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX venue_building_check_marks_check_day_unique ON venue_building_check_marks(check_id, board_day) WHERE undone_at IS NULL;
--> statement-breakpoint
CREATE INDEX venue_building_check_marks_venue_day_idx ON venue_building_check_marks(venue_id, board_day);
