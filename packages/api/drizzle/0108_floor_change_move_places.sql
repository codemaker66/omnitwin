-- A Diary move keeps its places as data (12 November 2026; PR #361's review).
-- 0108 at journal idx 105, after master's 0107. Two open PRs (#364, #365) also
-- number theirs 0108 and 0109; the release queue renumbers them after this
-- one, each with a later journal `when` (renumber the tag AND the `when`).
--
-- #361 tells the floor of each Diary move of a booking in its event's change
-- feed, folding a move made before anyone acknowledged the last into one change
-- from the place the floor last knew. It worked out that place by reading its
-- own words back ("Grand Hall, Sat 14 Nov, 18:00 – 23:00"). en-GB writes
-- September "Sept", so a September function moved twice read "Room and times
-- changed" when only its hours had, and a room renamed between two moves did
-- the same.
--
-- A booking move now keeps four things beside its words, so the next move is
-- compared with them by room id and by instant and the words are only ever
-- written, never read:
--   move_known_*  where the floor last knew the booking: its place before the
--                 first move nobody has acknowledged;
--   move_to_*     where this move put it (the Day Board uses it to tell when a
--                 move took a function off the day it shows);
--   move_chain_id the run of unacknowledged moves it belongs to, so a move back
--                 finds every bell of that run (whether anyone read one) and
--                 when the run began;
--   move_told     whether the floor was told of the move. A move into the past
--                 is not news to the floor and rings no bell, but it is kept,
--                 told to no one, so the next move is still compared with the
--                 place the floor last knew rather than with the slip.
-- Every other change leaves all eight NULL. The CHECK keeps them together, on
-- a change sourced from the event, each place ending after it starts.
--
-- The room ids carry no foreign key: they record where the floor knew the
-- booking, which stays true if the room is later removed (a key would either
-- block the removal or empty the record).
--
-- No stored row is a booking move: #361 brings the first with this file, so
-- every row has all eight NULL and passes the CHECK. Additive for the release
-- before it, which writes none of the columns.
--
-- Locks. The deploy applies every pending migration in ONE transaction
-- (drizzle-orm 0.45's migrator, node-postgres and Neon alike), so the
-- ACCESS EXCLUSIVE lock the ALTER takes on event_plan_changes is held until
-- that whole batch commits, including any later migration in the same
-- release, and the CREATE INDEX runs inside it. Until then nothing reads or
-- writes the change feed (event pages, the Day Board, a booking move, Got it).
-- Each step itself is quick: the new columns have no default, so no row is
-- rewritten; the CHECK and the index each scan the table once under the lock.
-- SET LOCAL also lasts to the end of that transaction, so every later
-- statement in the batch waits at most five seconds for a lock it cannot have
-- and then fails the deploy, leaving the database as it was, rather than
-- queue the change feed behind it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "event_plan_changes"
  ADD COLUMN "move_known_space_id" uuid,
  ADD COLUMN "move_known_starts_at" timestamp with time zone,
  ADD COLUMN "move_known_ends_at" timestamp with time zone,
  ADD COLUMN "move_to_space_id" uuid,
  ADD COLUMN "move_to_starts_at" timestamp with time zone,
  ADD COLUMN "move_to_ends_at" timestamp with time zone,
  ADD COLUMN "move_chain_id" uuid,
  ADD COLUMN "move_told" boolean,
  ADD CONSTRAINT "event_plan_changes_booking_move_places" CHECK (
    num_nonnulls("move_known_space_id", "move_known_starts_at", "move_known_ends_at",
      "move_to_space_id", "move_to_starts_at", "move_to_ends_at", "move_chain_id", "move_told") = 0
    OR (
      num_nulls("move_known_space_id", "move_known_starts_at", "move_known_ends_at",
        "move_to_space_id", "move_to_starts_at", "move_to_ends_at", "move_chain_id", "move_told") = 0
      AND "move_known_ends_at" > "move_known_starts_at"
      AND "move_to_ends_at" > "move_to_starts_at"
      AND "source_kind" = 'event'
    )
  );
--> statement-breakpoint
-- A booking's moves, found by the booking (source_id) when the next move folds
-- them or an acknowledgement asks what replaced one.
CREATE INDEX "event_plan_changes_booking_move_idx" ON "event_plan_changes" ("source_id", "created_at")
  WHERE "move_chain_id" IS NOT NULL;
