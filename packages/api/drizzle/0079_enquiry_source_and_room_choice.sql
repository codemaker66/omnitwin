-- ---------------------------------------------------------------------------
-- 0079 — how an enquiry reached the venue, and whether the guest chose a room
-- (T-635, roadmap N6)
--
-- An enquiry sent from the venue's own pages (the walkthrough, the website's
-- enquiry form, the pricing page and the workspace gate) names no room, but
-- enquiries.space_id is NOT NULL, so it was filed against the venue's first
-- room and nothing said the guest had not chosen it: the Enquiries desk then
-- showed the Grand Hall's name and photograph as the guest's choice. The
-- route also wrote a note in front of the guest's message to say it came from
-- the walkthrough. This migration adds two columns:
--   1. enquiries.source: how the enquiry arrived (website, walkthrough,
--      planner, phone or email), NULL where that is not known;
--   2. enquiries.room_chosen: false when the guest named no room, so the room
--      on the row is where it is filed, not what they asked for;
-- fills both where the rows prove them, and takes the note out of every
-- message, because it was never the guest's own words.
--
-- What the rows prove:
--   * a configuration means the planner, where the guest laid out a room
--     (only the two enquiry routes write this table, and nothing later
--     changes an enquiry's configuration or room);
--   * no configuration means the venue's own pages, which never name a room;
--   * the pricing page and the workspace gate are known by their event types;
--   * from 2026-09-26 22:23 UTC, when production's API was read running
--     669b64b7 (production receipt 36275236717), only the walkthrough writes
--     the note, so a row with it is the walkthrough's and a row without it
--     the website's. Before b96e5a60 the website's enquiry form (/fresh)
--     wrote the same note, so an older row cannot tell the two apart and
--     keeps no source rather than a guessed one. Seed fixture rows keep none
--     either.
-- The code that writes both columns ships after this migration has applied,
-- so no running release reads them before they are filled. That release
-- repeats the fill for rows written in between (where source IS NULL); every
-- rule here gives the same answer when run again.
--
-- No other table changes. The whole file runs in one transaction; a lock
-- that cannot be had within five seconds fails it, and nothing changes.
-- ---------------------------------------------------------------------------

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "source" varchar(20);
--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "room_chosen" boolean DEFAULT true NOT NULL;
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
--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_source_check"
  CHECK ("source" IS NULL OR "source" IN ('website', 'walkthrough', 'planner', 'phone', 'email'));
