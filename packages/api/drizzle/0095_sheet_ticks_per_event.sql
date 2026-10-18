-- A setup sheet's ticks belong to the event the room was set for
-- (18 October 2026). The number is provisional; the final one is assigned
-- at merge.
--
-- hallkeeper_progress keyed a tick on (config_id, row_key). A layout can be
-- reused for more than one event, so a reused layout opened with the last
-- event's ticks, and the Day Board could say "84 of 84" for a room nobody had
-- set tonight. A tick now carries the event it was made for.
--
-- Rows already stored keep event_id NULL. Nobody can tell which night they
-- were made for, so they are never counted towards an event; they remain only
-- in the layout's own, eventless scope (lib/hallkeeper-progress.ts).
--
-- The new unique key treats NULL as one value (NULLS NOT DISTINCT, PostgreSQL
-- 15+; CI and production run 16 or later), so the eventless scope keeps one
-- tick per row exactly as before, and ON CONFLICT (config_id, event_id,
-- row_key) still makes a replayed tick a no-op.
--
-- Rollout: an API instance still running the old code during the switch
-- names the old key in ON CONFLICT and gets an error; its client keeps the
-- tick in the offline queue and replays it to the new code.

ALTER TABLE hallkeeper_progress ADD COLUMN event_id uuid REFERENCES events(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE hallkeeper_progress DROP CONSTRAINT hallkeeper_progress_config_row_unique;
--> statement-breakpoint
ALTER TABLE hallkeeper_progress ADD CONSTRAINT hallkeeper_progress_config_event_row_unique UNIQUE NULLS NOT DISTINCT (config_id, event_id, row_key);
--> statement-breakpoint
CREATE INDEX hallkeeper_progress_event_idx ON hallkeeper_progress(event_id);
