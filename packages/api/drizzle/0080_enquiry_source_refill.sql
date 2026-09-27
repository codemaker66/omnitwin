-- ---------------------------------------------------------------------------
-- 0080 — 0079's fill again, for enquiries written between the two releases
-- (T-635, roadmap N6)
--
-- 0079 added enquiries.source and enquiries.room_chosen and filled them, but
-- the API that was running then wrote neither: each enquiry it took after 0079
-- applied has no source, room_chosen at its default (true, even for a guest who
-- named no room) and the walkthrough's note in front of the guest's words.
-- This release writes both columns and no note, so here 0079's two fill
-- statements run again, unchanged. They touch only rows with no source, and
-- every rule gives the same answer when run again, so a row 0079 already
-- filled, or left without a source because it could not be placed, ends as it
-- was.
--
-- This release reaches production before its migration (Railway rebuilds the
-- API as soon as master moves; Deploy migrates after CI), so for those minutes
-- an enquiry the previous API wrote reads as it did before 0079. Nothing is
-- lost: this migration then settles it.
--
-- No other table changes. The whole file runs in one transaction; a lock
-- that cannot be had within five seconds fails it, and nothing changes.
-- ---------------------------------------------------------------------------

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
UPDATE "enquiries" SET
  "room_chosen" = ("configuration_id" IS NOT NULL),
  "source" = CASE
    WHEN "configuration_id" IS NOT NULL THEN 'planner'
    WHEN "event_type" IN ('venue-access', 'venue-enquiry') THEN 'website'
    WHEN "created_at" < '2026-09-26 22:23:00+00' OR "fixture_source" IS NOT NULL THEN NULL
    WHEN "message" = 'Sent from the venue''s virtual walkthrough (the twin).'
      OR left("message", 55) = 'Sent from the venue''s virtual walkthrough (the twin).' || E'\n\n'
      THEN 'walkthrough'
    ELSE 'website'
  END
WHERE "source" IS NULL;
--> statement-breakpoint
-- The note and the blank line after it are the route's words, not the
-- guest's; a note with nothing after it was a message the guest left empty.
UPDATE "enquiries" SET "message" = CASE
    WHEN "message" = 'Sent from the venue''s virtual walkthrough (the twin).' THEN NULL
    ELSE substr("message", 56)
  END
WHERE "configuration_id" IS NULL
  AND ("message" = 'Sent from the venue''s virtual walkthrough (the twin).'
    OR left("message", 55) = 'Sent from the venue''s virtual walkthrough (the twin).' || E'\n\n');
