-- ---------------------------------------------------------------------------
-- 0076 — turnaround rules staff can set (T-637, slice A)
--
-- The rules already drive the Diary's gap labels, the planner's When ribbon
-- and the Day Board, but nothing could edit them, and production holds the
-- seed's demo values with nothing marking them as such. This migration:
--   1. records who last set a rule and when a person confirmed it, so a rule
--      nobody has confirmed reads "Not confirmed";
--   2. ties a room's rule to a room of the same venue;
--   3. allows one live rule per venue, room (or all rooms) and event type
--      (or any type), so the rule that applies is never a tie.
--
-- Each constraint is asserted before it is added: stored rows that would
-- break it stop the migration with a named 23514, and nothing changes.
-- Today's code runs unchanged on the new schema: it selects named columns.
-- ---------------------------------------------------------------------------

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "turnaround_rules"
  ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "updated_by" uuid;
--> statement-breakpoint
DO $turnaround$
DECLARE
  offending text;
BEGIN
  SELECT string_agg(r."id"::text, ', ' ORDER BY r."id") INTO offending
    FROM "turnaround_rules" r
    JOIN "spaces" s ON s."id" = r."space_id"
    WHERE s."venue_id" <> r."venue_id";
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'TURNAROUND_RULE_ROOM_VENUE: these rules name a room of another venue: %', offending
      USING ERRCODE = '23514',
        HINT = 'Point each rule at a room of its own venue, or at all rooms, then run the migration again.';
  END IF;

  SELECT string_agg(r."id"::text || ' (' || r."minutes" || ')', ', ' ORDER BY r."id") INTO offending
    FROM "turnaround_rules" r
    WHERE r."minutes" < 0 OR r."minutes" > 1440;
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'TURNAROUND_RULE_MINUTES: these rules fall outside 0 to 1440 minutes: %', offending
      USING ERRCODE = '23514',
        HINT = 'Correct the minutes on each rule, then run the migration again.';
  END IF;

  SELECT string_agg(scope, '; ' ORDER BY scope) INTO offending
    FROM (
      SELECT format('venue %s, room %s, type %s', "venue_id", coalesce("space_id"::text, 'all'), coalesce("event_type", 'any')) AS scope
        FROM "turnaround_rules"
        WHERE "is_active" AND "deleted_at" IS NULL
        GROUP BY "venue_id", "space_id", "event_type"
        HAVING count(*) > 1
    ) duplicates;
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'TURNAROUND_RULE_DUPLICATE: more than one live rule for %', offending
      USING ERRCODE = '23514',
        HINT = 'Retire all but one live rule for each scope, then run the migration again.';
  END IF;
END
$turnaround$;
--> statement-breakpoint
DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'turnaround_rules_updated_by_fk') THEN
    ALTER TABLE "turnaround_rules" ADD CONSTRAINT "turnaround_rules_updated_by_fk"
      FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'turnaround_rules_space_venue_fk') THEN
    ALTER TABLE "turnaround_rules" ADD CONSTRAINT "turnaround_rules_space_venue_fk"
      FOREIGN KEY ("space_id", "venue_id") REFERENCES "spaces"("id", "venue_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'turnaround_rules_minutes_range') THEN
    ALTER TABLE "turnaround_rules" ADD CONSTRAINT "turnaround_rules_minutes_range"
      CHECK ("minutes" >= 0 AND "minutes" <= 1440);
  END IF;
END
$constraints$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "turnaround_rules_one_live_rule"
  ON "turnaround_rules" (
    "venue_id",
    COALESCE("space_id", '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE("event_type", '')
  )
  WHERE "is_active" AND "deleted_at" IS NULL;
