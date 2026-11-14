-- ---------------------------------------------------------------------------
-- 0109 — the links (the spine, stage 1)
--
-- A booking already belongs to its event (0090). From this file a proposal,
-- a deal (opportunities) and an enquiry can each point at their event the
-- same way, so the event is the one place a client's occasion is found. The
-- join itself is never a guess: nothing is matched by name, email, title or
-- date.
--
-- In order, in one transaction (the migrator runs the file as one; a lock
-- that cannot be had within five seconds fails it and nothing changes):
--
--   1. opportunities gains the key (id, venue_id), as proposals and enquiries
--      already have, for later keys that pin a row to a deal's venue.
--   2. An event's client account must be its own venue's. The file stops,
--      naming the rule, if any event names another venue's account; then the
--      single-column key is replaced by events_client_account_venue_fk to
--      client_accounts (id, venue_id), which still empties only the account
--      when the account is removed.
--   3. enquiries, opportunities and proposals gain event_id, pinned to the
--      event's venue by (event_id, venue_id) and ON DELETE RESTRICT (events
--      are soft-deleted; no code deletes an event row), each with a partial
--      index. An event has at most one open deal (not lost or archived, not
--      deleted).
--   4. A link may be moved but never emptied: a trigger refuses setting
--      event_id back to null, except inside the undo, which says so with the
--      setting venviewer.undo_event_links = 'on' for its own transaction.
--   5. Two tables: event_link_joins, the record of every join made for a
--      record (so it can be undone), and event_link_reviews, the list of
--      joins a person should check, one open question per record and reason.
--   6. October's list (event_binding_reviews, 0090) is copied into the new
--      one, so there is one list. Its text is not copied: it holds event
--      names and booking titles. Each copy carries a fixed sentence for its
--      reason and the id of the row it came from, through which the old text
--      can still be read.
--
-- Re-running the file changes nothing: every step skips what is already in
-- place, and a review row is copied once.
-- ---------------------------------------------------------------------------

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint

-- 1. A deal's own (id, venue_id) key ------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname = 'opportunities_id_venue_unique' AND conrelid = '"opportunities"'::regclass) THEN
    ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_id_venue_unique" UNIQUE ("id", "venue_id");
  END IF;
END $$;
--> statement-breakpoint

-- 2. An event's client account is its own venue's ------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "events" e
    JOIN "client_accounts" a ON a."id" = e."client_account_id"
    WHERE a."venue_id" <> e."venue_id"
  ) THEN
    RAISE EXCEPTION 'event_spine_links: an event names a client account of another venue';
  END IF;
END $$;
--> statement-breakpoint
-- The single-column key's name was given by PostgreSQL or Drizzle, so it is
-- looked up rather than named; the venue-pinned key, once present, is kept.
DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT c."conname"
    FROM pg_constraint c
    WHERE c."conrelid" = '"events"'::regclass
      AND c."contype" = 'f'
      AND c."confrelid" = '"client_accounts"'::regclass
      AND c."conname" <> 'events_client_account_venue_fk'
  LOOP
    EXECUTE format('ALTER TABLE "events" DROP CONSTRAINT %I', fk."conname");
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname = 'events_client_account_venue_fk' AND conrelid = '"events"'::regclass) THEN
    ALTER TABLE "events" ADD CONSTRAINT "events_client_account_venue_fk"
      FOREIGN KEY ("client_account_id", "venue_id") REFERENCES "client_accounts"("id", "venue_id")
      ON DELETE SET NULL ("client_account_id");
  END IF;
END $$;
--> statement-breakpoint

-- 3. The links ---------------------------------------------------------------
ALTER TABLE "enquiries" ADD COLUMN IF NOT EXISTS "event_id" uuid;
--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "event_id" uuid;
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "event_id" uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname = 'enquiries_event_venue_fk' AND conrelid = '"enquiries"'::regclass) THEN
    ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_event_venue_fk"
      FOREIGN KEY ("event_id", "venue_id") REFERENCES "events"("id", "venue_id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname = 'opportunities_event_venue_fk' AND conrelid = '"opportunities"'::regclass) THEN
    ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_event_venue_fk"
      FOREIGN KEY ("event_id", "venue_id") REFERENCES "events"("id", "venue_id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname = 'proposals_event_venue_fk' AND conrelid = '"proposals"'::regclass) THEN
    ALTER TABLE "proposals" ADD CONSTRAINT "proposals_event_venue_fk"
      FOREIGN KEY ("event_id", "venue_id") REFERENCES "events"("id", "venue_id") ON DELETE RESTRICT;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enquiries_event_idx" ON "enquiries" ("event_id") WHERE "event_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunities_event_idx" ON "opportunities" ("event_id") WHERE "event_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_event_idx" ON "proposals" ("event_id") WHERE "event_id" IS NOT NULL;
--> statement-breakpoint
-- One open deal per event; a lost or archived one may stand beside it.
CREATE UNIQUE INDEX IF NOT EXISTS "opportunities_one_open_per_event" ON "opportunities" ("event_id")
  WHERE "event_id" IS NOT NULL AND "deleted_at" IS NULL AND "stage" NOT IN ('lost', 'archived');
--> statement-breakpoint

-- 4. A link is moved, never emptied --------------------------------------------
CREATE OR REPLACE FUNCTION "event_link_is_kept"() RETURNS trigger
  LANGUAGE plpgsql
  AS $kept$
BEGIN
  IF OLD."event_id" IS NOT NULL AND NEW."event_id" IS NULL
    AND current_setting('venviewer.undo_event_links', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'An event link cannot be removed, only moved (%)', TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$kept$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "enquiries_event_link_kept" ON "enquiries";
--> statement-breakpoint
CREATE TRIGGER "enquiries_event_link_kept"
  BEFORE UPDATE OF "event_id" ON "enquiries"
  FOR EACH ROW EXECUTE FUNCTION "event_link_is_kept"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "opportunities_event_link_kept" ON "opportunities";
--> statement-breakpoint
CREATE TRIGGER "opportunities_event_link_kept"
  BEFORE UPDATE OF "event_id" ON "opportunities"
  FOR EACH ROW EXECUTE FUNCTION "event_link_is_kept"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "proposals_event_link_kept" ON "proposals";
--> statement-breakpoint
CREATE TRIGGER "proposals_event_link_kept"
  BEFORE UPDATE OF "event_id" ON "proposals"
  FOR EACH ROW EXECUTE FUNCTION "event_link_is_kept"();
--> statement-breakpoint

-- 5. The record of joins, and the list of joins to check -----------------------
-- event_id has no key: the record must outlive an event the undo removes.
CREATE TABLE IF NOT EXISTS "event_link_joins" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "subject_kind" varchar(20) NOT NULL,
  "subject_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "path" varchar(20) NOT NULL,
  "event_made" boolean NOT NULL DEFAULT false,
  "joined_at" timestamp with time zone NOT NULL DEFAULT now(),
  "undone_at" timestamp with time zone,
  CONSTRAINT "event_link_joins_subject_kind_check"
    CHECK ("subject_kind" IN ('enquiry', 'opportunity', 'proposal', 'deposit_request')),
  CONSTRAINT "event_link_joins_path_check"
    CHECK ("path" IN ('enquiry_bookings', 'plan_link', 'enquiry', 'deal', 'deposit_request', 'new_event'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_link_joins_open_unique"
  ON "event_link_joins" ("subject_kind", "subject_id") WHERE "undone_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_link_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "subject_kind" varchar(20) NOT NULL,
  "subject_id" uuid NOT NULL,
  "reason" varchar(40) NOT NULL,
  "candidate_event_ids" uuid[] NOT NULL DEFAULT '{}',
  "detail" text NOT NULL,
  "binding_review_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at" timestamp with time zone,
  "resolved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "resolution" varchar(20),
  "resolved_event_id" uuid,
  CONSTRAINT "event_link_reviews_subject_kind_check"
    CHECK ("subject_kind" IN ('enquiry', 'opportunity', 'proposal', 'booking', 'event')),
  CONSTRAINT "event_link_reviews_reason_check"
    CHECK ("reason" IN ('reaches_many_events', 'paths_disagree', 'second_open_deal',
      'enquiry_events_differ', 'possibly_same_event', 'event_status_derived')),
  CONSTRAINT "event_link_reviews_resolution_check"
    CHECK ("resolution" IS NULL OR "resolution" IN ('joined', 'own_event', 'merged', 'kept_apart', 'noted')),
  CONSTRAINT "event_link_reviews_resolution_whole"
    CHECK (("resolved_at" IS NULL) = ("resolution" IS NULL))
);
--> statement-breakpoint
-- One open question per record and reason; copies of October's rows stand apart.
CREATE UNIQUE INDEX IF NOT EXISTS "event_link_reviews_open_unique"
  ON "event_link_reviews" ("subject_kind", "subject_id", "reason")
  WHERE "resolved_at" IS NULL AND "binding_review_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_link_reviews_binding_review_unique"
  ON "event_link_reviews" ("binding_review_id") WHERE "binding_review_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_link_reviews_venue_open_idx"
  ON "event_link_reviews" ("venue_id", "created_at") WHERE "resolved_at" IS NULL;
--> statement-breakpoint

-- 6. October's list, without its text ----------------------------------------
INSERT INTO "event_link_reviews"
  ("venue_id", "subject_kind", "subject_id", "reason", "candidate_event_ids", "detail", "binding_review_id", "created_at")
SELECT
  r."venue_id",
  CASE WHEN r."booking_id" IS NOT NULL THEN 'booking' ELSE 'event' END,
  coalesce(r."booking_id", r."event_id"),
  r."reason",
  ARRAY[r."event_id"],
  CASE r."reason"
    WHEN 'enquiry_events_differ' THEN
      'Carried over from October''s list: this booking''s enquiry had bookings in more than one event.'
    WHEN 'possibly_same_event' THEN
      'Carried over from October''s list: this booking was given a new event while a booking of the same title, near the same time, is in another event.'
    ELSE
      'Carried over from October''s list: this event''s status was changed to follow its bookings in the Diary.'
  END,
  r."id",
  r."created_at"
FROM "event_binding_reviews" r
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- The five-second lock limit was for this file alone; anything after it in
-- the same migration run waits as the migrator itself allows.
SET LOCAL lock_timeout TO DEFAULT;
