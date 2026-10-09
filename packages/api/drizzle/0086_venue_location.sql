-- ---------------------------------------------------------------------------
-- 0086 — where each venue stands, for the sky over it (T-647)
--
-- The relit hall (T-639) is lit by the real weather over the venue: live now,
-- each event's date in the planner. The API asks the Met Office for the
-- forecast at the venue's latitude and longitude, so a venue now records
-- them: WGS84 decimal degrees, both or neither. A venue with neither has no
-- sky; the API answers it with a clear error rather than a guess.
--
-- Trades Hall is given the site agreed with T-639
-- (claude/real-hall:tools/relight/config/grand-hall.json, room.site): the
-- same place the hall's own sun is computed for. The fill touches only that
-- venue, and only while it has no location, so running this again, or after
-- a location has been set by other means, changes nothing.
--
-- Schema first: the release that reads these columns follows only once this
-- has run, because the API selects every venue column on its venue routes.
-- Adding nullable columns without a default rewrites nothing; the constraint
-- scans the venues table (a few rows). A busy moment holds writes to venues
-- for up to five seconds a lock, then fails the deploy rather than holding
-- them longer. The constraint is looked for on this table alone (as 0085
-- does), so a copy of the table elsewhere in the database never stops it
-- being added here.
-- ---------------------------------------------------------------------------
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "latitude" double precision;
--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "longitude" double precision;
--> statement-breakpoint
-- Both or neither, and on the globe. BETWEEN is false for NaN and the
-- infinities, so neither can be stored.
DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'venues_location_check' AND conrelid = to_regclass('venues')) THEN
    ALTER TABLE "venues" ADD CONSTRAINT "venues_location_check" CHECK (
      ("latitude" IS NULL AND "longitude" IS NULL)
      OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL
        AND "latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
    );
  END IF;
END
$constraints$;
--> statement-breakpoint
UPDATE "venues" SET "latitude" = 55.8593, "longitude" = -4.2491
WHERE "slug" = 'trades-hall-glasgow' AND "latitude" IS NULL AND "longitude" IS NULL;
