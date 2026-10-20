-- A setup sheet's ticks belong to the event the room was set for
-- (18 October 2026). 0099, after the People Book's 0098; the chief of staff
-- confirms the number at the merge slot (renumber the tag AND the journal
-- `when` so the migrator orders it after everything merged first).
--
-- hallkeeper_progress keyed a tick on (config_id, row_key). A layout can be
-- reused for more than one event, so a reused layout opened with the last
-- event's ticks, and the Day Board could say "84 of 84" for a room nobody had
-- set tonight. A tick now carries the event it was made for.
--
-- Rows already stored keep event_id NULL. Nobody can tell which night they
-- were made for: a layout linked to one event today may have served another
-- whose link or variant has since gone, so even a single-event layout's old
-- ticks are not attributed. They are never counted towards an event; they
-- remain only in the layout's own, eventless scope (lib/hallkeeper-progress.ts).
-- A room part-ticked when this lands therefore reads as unticked: deploy
-- outside setup hours.
--
-- The new unique key treats NULL as one value (NULLS NOT DISTINCT, PostgreSQL
-- 15+; CI and production run 16 or later), so the eventless scope keeps one
-- tick per row exactly as before, and ON CONFLICT (config_id, event_id,
-- row_key) still makes a replayed tick a no-op.
--
-- Rollout: an API instance still running the old code after this lands names
-- the old key in ON CONFLICT and gets an error; its client keeps the tick in
-- the offline queue and replays it on the next online event or reload.
--
-- ADD COLUMN ... REFERENCES takes ACCESS EXCLUSIVE on hallkeeper_progress and
-- SHARE ROW EXCLUSIVE on events; a bounded wait makes a busy moment fail the
-- deploy (the old container keeps serving) instead of queueing writes behind it.

SET LOCAL lock_timeout = '10s';
--> statement-breakpoint
ALTER TABLE hallkeeper_progress ADD COLUMN event_id uuid REFERENCES events(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE hallkeeper_progress DROP CONSTRAINT hallkeeper_progress_config_row_unique;
--> statement-breakpoint
ALTER TABLE hallkeeper_progress ADD CONSTRAINT hallkeeper_progress_config_event_row_unique UNIQUE NULLS NOT DISTINCT (config_id, event_id, row_key);
--> statement-breakpoint
CREATE INDEX hallkeeper_progress_event_idx ON hallkeeper_progress(event_id);
