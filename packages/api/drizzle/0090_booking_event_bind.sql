-- ---------------------------------------------------------------------------
-- 0090 — the bind (event-spine Phase A)
--
-- Every provisional hold and confirmed booking belongs to an event. Until now
-- a hold made from an enquiry was written with no event, and the only link
-- was the Diary drawer's "Start a floor plan", two writes that could leave an
-- orphan. From this release every writer creates or joins the event in the
-- booking's own transaction (services/event-binding.ts); this file makes the
-- rows already written agree and then has the database hold the rule.
--
-- In order, in one transaction (the migrator runs the file as one; a lock
-- that cannot be had within five seconds fails it and nothing changes):
--
--   1. Writers of bookings and events wait until the rule is in place.
--   2. 'lost' joins the event status vocabulary: an event whose options all
--      went, released, lapsed or lost, with none confirmed.
--   3. A review list, event_binding_reviews, records what a person should
--      look at: a booking whose enquiry already had bookings in more than one
--      event; a new event that may be the same occasion as another booking's;
--      and every existing event whose status this file changed, with the
--      status it had. Nothing is deleted or overwritten without a record.
--   4. The backfill, deterministic and never by guesswork. A hold or ink with
--      no event joins the event its enquiry's bookings already have (a live
--      booking's first, then the newest), as the API does. The rest bind in
--      groups, all of one enquiry's together, otherwise one booking each, and
--      each group gets one new event made from its first live booking (else
--      its earliest): title, type, times, creator, the enquiry's name as the
--      client, the seed's fixture marker, the house's default phases,
--      headcounts unknown. A group of deleted bookings gets a deleted event.
--   5. Every event the Diary speaks for takes its derived status
--      (deriveEventStatus in @omnitwin/types; the same table in SQL below).
--   6. bookings.event_id stops being set to null when an event is deleted:
--      both foreign keys become ON DELETE RESTRICT (events are soft-deleted
--      through deleted_at; no code deletes an event row).
--   7. bookings_bound_to_event: a hold or ink must have an event. Interest
--      only (prospect) and the venue's own blocks are exempt.
--
-- Production holds few real bookings today, plus the seeded demo week; this
-- is the cheapest moment to bind them. Re-running the file changes nothing:
-- every step skips what is already in place.
-- ---------------------------------------------------------------------------

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
LOCK TABLE "bookings", "events" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint

-- 2. The vocabulary ----------------------------------------------------------
ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_status_check";
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_status_check"
  CHECK ("status" IN ('draft', 'proposed', 'confirmed', 'in_planning', 'ready_for_ops', 'executed', 'closed', 'cancelled', 'lost'));
--> statement-breakpoint

-- 3. The review list ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS "event_binding_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "event_id" uuid NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "booking_id" uuid REFERENCES "bookings"("id") ON DELETE CASCADE,
  "reason" varchar(40) NOT NULL,
  "detail" text NOT NULL,
  "previous_status" varchar(30),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "event_binding_reviews_reason_check"
    CHECK ("reason" IN ('enquiry_events_differ', 'possibly_same_event', 'event_status_derived'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_binding_reviews_venue_idx" ON "event_binding_reviews" ("venue_id", "created_at");
--> statement-breakpoint

-- 4. The backfill ------------------------------------------------------------
-- Every hold and ink without an event, with the group it binds in.
DROP TABLE IF EXISTS pg_temp."bind_0090";
--> statement-breakpoint
CREATE TEMP TABLE "bind_0090" AS
SELECT
  b."id" AS "booking_id",
  b."venue_id",
  b."enquiry_id",
  b."title",
  b."event_type",
  b."starts_at",
  b."ends_at",
  b."created_by",
  b."created_at",
  b."fixture_source",
  b."status",
  b."deleted_at",
  CASE
    WHEN b."enquiry_id" IS NULL THEN 'booking:' || b."id"::text
    ELSE 'enquiry:' || b."venue_id"::text || ':' || b."enquiry_id"::text
  END AS "group_key",
  NULL::uuid AS "event_id",
  false AS "joined"
FROM "bookings" b
WHERE b."kind" IN ('hold', 'ink') AND b."event_id" IS NULL;
--> statement-breakpoint

-- Join the event the enquiry's bookings already have, as the API does.
UPDATE "bind_0090" u SET "event_id" = x."event_id", "joined" = true
FROM (
  SELECT DISTINCT ON (b."venue_id", b."enquiry_id") b."venue_id", b."enquiry_id", b."event_id"
  FROM "bookings" b
  JOIN "events" e ON e."id" = b."event_id" AND e."venue_id" = b."venue_id" AND e."deleted_at" IS NULL
  WHERE b."enquiry_id" IS NOT NULL AND b."deleted_at" IS NULL
  ORDER BY b."venue_id", b."enquiry_id", (b."status" = 'active') DESC, b."created_at" DESC, b."id" DESC
) x
WHERE u."enquiry_id" = x."enquiry_id" AND u."venue_id" = x."venue_id";
--> statement-breakpoint

-- One new event per remaining group, seeded by one of its bookings: a live
-- one before an ended one, an undeleted one before a deleted one, then the
-- earliest written. A group whose every booking was deleted gets its event
-- deleted with them (at the latest deletion), so no draft is left behind for
-- bookings nobody can see. The ids are drawn once into their own table so
-- every booking of a group reads the same one.
DROP TABLE IF EXISTS pg_temp."bind_0090_events";
--> statement-breakpoint
CREATE TEMP TABLE "bind_0090_events" AS
SELECT g."group_key", gen_random_uuid() AS "event_id", g."seed_booking_id", g."deleted_at"
FROM (
  SELECT
    u."group_key",
    (array_agg(u."booking_id" ORDER BY (u."deleted_at" IS NULL) DESC, (u."status" = 'active') DESC,
      u."created_at", u."booking_id"))[1] AS "seed_booking_id",
    CASE WHEN bool_and(u."deleted_at" IS NOT NULL) THEN max(u."deleted_at") END AS "deleted_at"
  FROM "bind_0090" u
  WHERE u."event_id" IS NULL
  GROUP BY u."group_key"
) g;
--> statement-breakpoint
INSERT INTO "events" (
  "id", "venue_id", "created_by", "name", "event_type", "status", "starts_at", "ends_at",
  "guest_count", "client_name", "fixture_source", "created_at", "updated_at", "deleted_at"
)
SELECT
  n."event_id", s."venue_id", s."created_by", s."title", s."event_type", 'draft', s."starts_at", s."ends_at",
  0, left(q."name", 200), s."fixture_source", s."created_at", now(), n."deleted_at"
FROM "bind_0090_events" n
JOIN "bind_0090" s ON s."booking_id" = n."seed_booking_id"
LEFT JOIN "enquiries" q ON q."id" = s."enquiry_id";
--> statement-breakpoint
-- The house's default phases, as POST /events and the API's bind give a new
-- event (defaultEventPhaseInputs in @omnitwin/types): no room, no time, and
-- every evidence field "not checked".
INSERT INTO "event_phases" (
  "event_id", "template_key", "name", "sort_order", "starts_at", "duration_minutes", "guest_count",
  "ops_tasks_count", "review_gates_count", "density_status", "density_label",
  "staff_conflicts_status", "staff_conflicts_label", "notes"
)
SELECT
  n."event_id", p."template_key", p."name", p."sort_order", NULL, p."duration_minutes", NULL,
  0, 0, 'not_checked', 'Density not checked', 'not_checked', 'Staff conflicts not checked', NULL
FROM "bind_0090_events" n
CROSS JOIN (VALUES
  ('arrival', 'Arrival', 0, 30),
  ('ceremony', 'Ceremony', 1, 45),
  ('room-flip', 'Room Flip', 2, 45),
  ('dinner', 'Dinner', 3, 90),
  ('speeches', 'Speeches', 4, 30),
  ('bar-queue', 'Bar Queue', 5, 45),
  ('dancing', 'Dancing', 6, 90),
  ('breakdown', 'Breakdown', 7, 45)
) AS p("template_key", "name", "sort_order", "duration_minutes");
--> statement-breakpoint
UPDATE "bind_0090" u SET "event_id" = n."event_id"
FROM "bind_0090_events" n
WHERE u."group_key" = n."group_key" AND u."event_id" IS NULL;
--> statement-breakpoint
UPDATE "bookings" b SET "event_id" = u."event_id"
FROM "bind_0090" u
WHERE b."id" = u."booking_id" AND b."event_id" IS NULL;
--> statement-breakpoint

-- The review list, part one: a booking that joined its enquiry's event while
-- that enquiry's other bookings sit in more than one event.
INSERT INTO "event_binding_reviews" ("venue_id", "event_id", "booking_id", "reason", "detail")
SELECT
  u."venue_id", u."event_id", u."booking_id", 'enquiry_events_differ',
  'Joined its enquiry''s event "' || e."name" || '". The enquiry''s other bookings belong to '
    || d."events"::text || ' different events; check which one this booking is for.'
FROM "bind_0090" u
JOIN "events" e ON e."id" = u."event_id"
JOIN (
  SELECT b."venue_id", b."enquiry_id", count(DISTINCT b."event_id") AS "events"
  FROM "bookings" b
  WHERE b."enquiry_id" IS NOT NULL AND b."event_id" IS NOT NULL AND b."deleted_at" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "bind_0090" mine WHERE mine."booking_id" = b."id")
  GROUP BY b."venue_id", b."enquiry_id"
  HAVING count(DISTINCT b."event_id") > 1
) d ON d."venue_id" = u."venue_id" AND d."enquiry_id" = u."enquiry_id"
WHERE u."joined";
--> statement-breakpoint

-- Part two: a live booking that got a new event while another live booking
-- of the same title, at the same venue and within twelve hours of it, is in
-- a different event. Possibly one occasion in two rooms; never merged here.
-- The seed's demo week is left out: its events are as the seed wrote them.
INSERT INTO "event_binding_reviews" ("venue_id", "event_id", "booking_id", "reason", "detail")
SELECT DISTINCT ON (u."booking_id")
  u."venue_id", u."event_id", u."booking_id", 'possibly_same_event',
  'Given a new event. "' || o."title" || '" (booking ' || o."id"::text
    || ') is near the same time in another event; if they are one occasion, move this booking to that event.'
FROM "bind_0090" u
JOIN "bookings" o ON o."venue_id" = u."venue_id"
  AND o."id" <> u."booking_id"
  AND o."kind" IN ('hold', 'ink') AND o."status" = 'active' AND o."deleted_at" IS NULL
  AND o."event_id" IS DISTINCT FROM u."event_id"
  AND lower(btrim(o."title")) = lower(btrim(u."title"))
  AND o."starts_at" < u."ends_at" + interval '12 hours'
  AND o."ends_at" > u."starts_at" - interval '12 hours'
WHERE NOT u."joined"
  AND u."status" = 'active' AND u."deleted_at" IS NULL
  AND u."fixture_source" IS NULL
ORDER BY u."booking_id", o."starts_at", o."id";
--> statement-breakpoint

-- 5. Every event the Diary speaks for takes its derived status ---------------
--    a live confirmed booking  -> confirmed, or the later step people recorded
--    only options or interest  -> draft, or proposed when recorded
--    a confirmed booking ended -> cancelled
--    every option ended        -> lost
--    Soft-deleted bookings and the venue's own blocks are not evidence. An
--    existing event whose status changes is recorded on the review list with
--    the status it had.
WITH "facts" AS (
  SELECT
    e."id", e."venue_id", e."status" AS "before",
    bool_or(b."kind" = 'ink' AND b."status" = 'active') AS "live_ink",
    bool_or(b."kind" IN ('hold', 'prospect') AND b."status" = 'active') AS "live_option",
    bool_or(b."kind" = 'ink' AND b."status" <> 'active') AS "ended_ink",
    bool_or(b."kind" = 'hold' AND b."status" <> 'active') AS "ended_hold"
  FROM "events" e
  JOIN "bookings" b ON b."event_id" = e."id" AND b."deleted_at" IS NULL
  GROUP BY e."id", e."venue_id", e."status"
), "derived" AS (
  SELECT "id", "venue_id", "before",
    CASE
      WHEN "live_ink" THEN CASE
        WHEN "before" IN ('confirmed', 'in_planning', 'ready_for_ops', 'executed', 'closed') THEN "before"
        ELSE 'confirmed' END
      WHEN "live_option" THEN CASE WHEN "before" IN ('draft', 'proposed') THEN "before" ELSE 'draft' END
      WHEN "ended_ink" THEN 'cancelled'
      WHEN "ended_hold" THEN 'lost'
      ELSE "before"
    END AS "after"
  FROM "facts"
), "changed" AS (
  UPDATE "events" e SET "status" = d."after", "updated_at" = now()
  FROM "derived" d
  WHERE e."id" = d."id" AND d."after" <> d."before"
  RETURNING e."id", e."venue_id", d."before", d."after"
)
INSERT INTO "event_binding_reviews" ("venue_id", "event_id", "reason", "detail", "previous_status")
SELECT c."venue_id", c."id", 'event_status_derived',
  'Its status now follows its bookings in the Diary: ' || c."before" || ' became ' || c."after" || '.',
  c."before"
FROM "changed" c
WHERE NOT EXISTS (SELECT 1 FROM "bind_0090_events" n WHERE n."event_id" = c."id");
--> statement-breakpoint
DROP TABLE pg_temp."bind_0090_events";
--> statement-breakpoint
DROP TABLE pg_temp."bind_0090";
--> statement-breakpoint

-- 6. An event with bookings cannot be deleted out from under them ------------
DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT c."conname"
    FROM pg_constraint c
    WHERE c."conrelid" = '"bookings"'::regclass
      AND c."contype" = 'f'
      AND c."confrelid" = '"events"'::regclass
  LOOP
    EXECUTE format('ALTER TABLE "bookings" DROP CONSTRAINT %I', fk."conname");
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_event_venue_fk"
  FOREIGN KEY ("event_id", "venue_id") REFERENCES "events"("id", "venue_id") ON DELETE RESTRICT;
--> statement-breakpoint

-- 7. The rule ----------------------------------------------------------------
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_bound_to_event";
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_bound_to_event"
  CHECK ("kind" NOT IN ('hold', 'ink') OR "event_id" IS NOT NULL);
--> statement-breakpoint

-- The five-second lock limit was for this file alone; anything after it in
-- the same migration run waits as the migrator itself allows.
SET LOCAL lock_timeout TO DEFAULT;
