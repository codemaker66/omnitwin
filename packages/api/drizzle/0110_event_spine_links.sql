-- ---------------------------------------------------------------------------
-- 0110 — the links (the spine, stage 1)
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
--   6. October's two kinds of question (event_binding_reviews, 0090:
--      enquiry_events_differ, possibly_same_event) are copied into the new
--      list, so there is one list. Its third kind of row, event_status_derived,
--      is a note of a status 0090 changed, not a question: it is not copied and
--      stays where it is. The text is not copied: it holds event names and
--      booking titles. Each copy carries a fixed sentence for its reason and
--      the id of the row it came from, through which the old text can still be
--      read.
--   7. spine_join_old_records(), the repeatable join of old records, and one
--      call of it: each proposal, deal and enquiry with no event joins the one
--      event a path reaches, goes on the list when paths disagree, or gets an
--      event of its own when it must have one and nothing reaches any. The
--      deploy and the nightly workflows call it again.
--   8. spine_undo_joins(), the join's undo, read from its own record: an
--      operator's tool, run by hand. This file never calls it.
--
-- Re-running the file changes nothing: every step skips what is already in
-- place, a review row is copied once, and the join finds nothing left to do.
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
    CHECK ("path" IN ('enquiry_bookings', 'plan_link', 'enquiry', 'deal', 'proposal', 'deposit_request', 'new_event'))
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
      'enquiry_events_differ', 'possibly_same_event')),
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

-- 6. October's questions, without their text ----------------------------------
-- Only its two kinds of question; its notes of a derived status stay in
-- event_binding_reviews.
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
    ELSE
      'Carried over from October''s list: this booking was given a new event while a booking of the same title, near the same time, is in another event.'
  END,
  r."id",
  r."created_at"
FROM "event_binding_reviews" r
WHERE r."reason" IN ('enquiry_events_differ', 'possibly_same_event')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 7. The join of old records -------------------------------------------------
-- The one repeatable step that joins proposals, deals and enquiries made
-- before the links to their events, never by a guess. It is the only writer
-- of event_link_joins. It runs below, and again after every release and every
-- night, beside live writers; run twice, the second run changes nothing.
--
-- Locks. It takes no table lock, and it never waits for a row lock: each
-- record is decided first on a plain read; nothing is locked for a record
-- that will be neither joined nor listed; for one that will be, the rows the
-- join will write are locked FOR NO KEY UPDATE SKIP LOCKED in the writers'
-- order (a proposal, then its enquiry and its deposit request; a deal's
-- enquiry, then the deal), each re-checked to still hold what was read, and
-- the record is decided again under those locks before it is acted on. An
-- event it joins is taken FOR KEY SHARE SKIP LOCKED and must still be live:
-- the lock every key to an event takes anyway, which no writer's FOR NO KEY
-- UPDATE waits for. A row it cannot have at once, or that changed, is left
-- to the next run. Every lock it takes is held until the run commits.
--
-- The one wait it can make on another transaction is a deal's update meeting
-- an open deal a writer has put on the same event and not yet committed (the
-- one-open-deal index). That wait is bounded at 100 ms, below the server's
-- deadlock_timeout: a writer that then took the event FOR UPDATE would wait
-- for the join's key share while the join waited for it. When the writer
-- commits within the bound the deal is listed; otherwise the deal is left to
-- the next run, which lists it. (Its foreign keys also take key shares on the
-- venue rows they name; only a venue row held FOR UPDATE would make those
-- wait, for as long as the session's own lock_timeout allows.)
--
-- A live event is an events row with deleted_at IS NULL at the record's own
-- venue. Listed is an open question of the join's own (resolved_at IS NULL,
-- binding_review_id IS NULL). A listed record is never touched; a deal or a
-- proposal whose enquiry is listed, and a proposal whose open deal has no
-- event, wait with it. A question's detail holds counts and kinds, never a
-- name.
--
-- Enquiries. After a run no enquiry that may become an event is left without
-- one while an undeleted booking, deal or proposal of it has a live event,
-- unless it is listed or a writer held one of its rows. Step 1 joins an
-- enquiry to the one live event its bookings, deals and proposals sit in, or
-- lists it when they sit in several. Steps 1 to 3 are repeated while a round
-- joins anything (at most four rounds), so an enquiry whose deals or
-- proposals were joined in one round is settled from all of them together in
-- the next, and the result never depends on the order records are read in.
-- An event is made for an enquiry, by step 1, 2 or 3, only when nothing of
-- its own (held dates, deals, proposals, floor plan) reaches a live event, and
-- in step 3 only after every proposal that reaches an existing event has been
-- joined.
CREATE OR REPLACE FUNCTION "spine_join_old_records"()
  RETURNS TABLE ("joined" integer, "events_made" integer, "listed" integer)
  LANGUAGE plpgsql
  AS $join$
DECLARE
  -- Which records must have an event: the one definition (event-spine.ts and
  -- enquiry.ts in @omnitwin/types), written out. Each rule built on these is
  -- written where it is marked "(Rule: ...)".
  -- OPEN_OPPORTUNITY_STAGES: a deal at these stages still needs its event.
  open_deal_stages CONSTANT text[] := ARRAY['new', 'qualified', 'proposal_drafting', 'proposal_sent', 'negotiation', 'won'];
  -- SENT_PROPOSAL_STATUSES: the customer has been given the proposal.
  sent_proposal_statuses CONSTANT text[] := ARRAY['sent', 'changes_requested', 'accepted'];
  -- CLOSED_ENQUIRY_STATES: no further work is expected.
  closed_enquiry_states CONSTANT text[] := ARRAY['rejected', 'withdrawn', 'archived'];
  -- NON_BOOKING_ENQUIRY_TYPES: an enquiry of these types asks to book nothing;
  -- no type at all asks to book. Compared trimmed, as isBookingEnquiry does.
  non_booking_enquiry_types CONSTANT text[] := ARRAY['venue-access', 'venue-enquiry'];
  -- What JavaScript's String.prototype.trim() removes (its WhiteSpace and
  -- LineTerminator characters), so btrim(x, js_whitespace) is x.trim(): tab,
  -- line feed, vertical tab, form feed, carriage return, space, then U+00A0,
  -- U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and
  -- U+FEFF. The vertical tab is written \x0B: in an E'' string, \v is a plain
  -- "v". The \u escapes need a UTF8 database.
  js_whitespace CONSTANT text := E' \t\n\x0B\f\r\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF';
  -- The longest a deal's update may wait for a writer's uncommitted open deal
  -- on the same event: below deadlock_timeout (1 s by default).
  deal_update_wait CONSTANT text := '100ms';

  this_enquiry record;
  this_deal record;
  this_proposal record;
  v_round integer := 0;
  v_joined_before integer;
  v_phase integer;
  v_locked boolean;          -- the record's rows are held: decide again, then act
  v_enquiry_locked uuid;     -- the enquiry this record's locking took, if any
  v_request_locked uuid;     -- the deposit request this record's locking took, if any
  v_a uuid[];                -- the live events an enquiry's undeleted bookings sit in
  v_c uuid[];                -- the live events its undeleted deals and proposals are joined to
  v_m uuid[];                -- the two together
  v_b uuid[];                -- the live events a floor plan is linked to
  v_candidates uuid[];
  v_target uuid;
  v_path text;
  v_reason text;
  v_detail text;
  v_make boolean;
  v_second boolean;
  v_left boolean;
  v_for_enquiry boolean;     -- the event is made for the record's enquiry, which joins it
  v_name text;               -- what an event the join makes is named by, before the naming rule
  v_client text;             -- its client's name, before the naming rule
  v_type text;               -- its occasion
  v_fixture text;            -- its fixture_source
  v_q_id uuid;               -- a deal's or a proposal's enquiry, when it is of the record's venue
  v_q_event uuid;
  v_q_name text;
  v_q_type text;
  v_q_fixture text;
  v_q_may_become boolean;
  v_q_reaches boolean;       -- something of the enquiry's own reaches a live event
  v_deal_type text;
  v_base uuid;
  v_asked uuid;
  v_request uuid;
  v_request_event uuid;
  v_lock_timeout text;
  v_waited uuid[] := '{}';   -- deals whose update gave up on a writer in this run: not tried again in it
  v_made uuid[] := '{}';
  v_constraint text;
  v_rows integer;
  v_joined integer := 0;
  v_events_made integer := 0;
  v_listed integer := 0;
BEGIN
  -- 0. An open question whose record has its event by now (a writer gave it
  --    one) is closed: joined, to that event, by nobody. A question a person
  --    is answering at this moment is left to them.
  WITH "answered" AS (
    SELECT v."id", s."event_id"
    FROM "event_link_reviews" v
    CROSS JOIN LATERAL (SELECT CASE v."subject_kind"
        WHEN 'enquiry' THEN (SELECT q."event_id" FROM "enquiries" q WHERE q."id" = v."subject_id")
        WHEN 'opportunity' THEN (SELECT o."event_id" FROM "opportunities" o WHERE o."id" = v."subject_id")
        WHEN 'proposal' THEN (SELECT p."event_id" FROM "proposals" p WHERE p."id" = v."subject_id")
      END AS "event_id") s
    WHERE v."resolved_at" IS NULL AND v."binding_review_id" IS NULL AND s."event_id" IS NOT NULL
    FOR NO KEY UPDATE OF v SKIP LOCKED
  )
  UPDATE "event_link_reviews" v
  SET "resolution" = 'joined', "resolved_event_id" = a."event_id", "resolved_at" = now(), "resolved_by" = NULL
  FROM "answered" a
  WHERE v."id" = a."id";

  -- Steps 1 to 3, repeated while a round joins anything (at most four rounds).
  LOOP
    v_round := v_round + 1;
    v_joined_before := v_joined;

  -- 1. Enquiries that may become an event, with none. ----------------------
  <<enquiry_loop>>
  FOR this_enquiry IN
    SELECT q."id", q."venue_id", q."state", q."event_type", q."configuration_id", q."first_response_at"
    FROM "enquiries" q
    WHERE q."event_id" IS NULL
      -- (Rule: an enquiry that may become an event, enquiryMayBecomeEvent)
      -- not a draft, and asks to book the venue's rooms.
      AND q."state" <> 'draft'
      AND (q."event_type" IS NULL OR btrim(q."event_type", js_whitespace) <> ALL (non_booking_enquiry_types))
    ORDER BY q."created_at", q."id"
  LOOP
    v_locked := false;
    LOOP
      -- Decided on a plain read, then again under its lock.
      CONTINUE enquiry_loop WHEN EXISTS (SELECT 1 FROM "event_link_reviews" l
        WHERE l."subject_kind" = 'enquiry' AND l."subject_id" = this_enquiry."id"
          AND l."resolved_at" IS NULL AND l."binding_review_id" IS NULL);
      -- (Rule: what of an enquiry's own reaches an event) its held dates (A),
      -- its deals and proposals (C) and its floor plan (B); steps 2 and 3 ask
      -- the same question of a record's enquiry.
      v_a := ARRAY(SELECT DISTINCT e."id" FROM "bookings" b JOIN "events" e ON e."id" = b."event_id"
        WHERE b."enquiry_id" = this_enquiry."id" AND b."deleted_at" IS NULL
          AND e."venue_id" = this_enquiry."venue_id" AND e."deleted_at" IS NULL
        ORDER BY e."id");
      v_c := ARRAY(SELECT DISTINCT e."id"
        FROM (SELECT o."event_id" FROM "opportunities" o
                WHERE o."source_enquiry_id" = this_enquiry."id" AND o."deleted_at" IS NULL
              UNION ALL
              SELECT p."event_id" FROM "proposals" p
                WHERE p."enquiry_id" = this_enquiry."id" AND p."deleted_at" IS NULL) k
        JOIN "events" e ON e."id" = k."event_id"
        WHERE e."venue_id" = this_enquiry."venue_id" AND e."deleted_at" IS NULL
        ORDER BY e."id");
      v_m := ARRAY(SELECT DISTINCT y FROM unnest(v_a || v_c) AS y ORDER BY y);
      v_b := ARRAY(SELECT DISTINCT e."id" FROM "event_configuration_links" k JOIN "events" e ON e."id" = k."event_id"
        WHERE k."configuration_id" = this_enquiry."configuration_id"
          AND e."venue_id" = this_enquiry."venue_id" AND e."deleted_at" IS NULL
        ORDER BY e."id");

      v_reason := NULL;
      v_target := NULL;
      v_make := false;
      IF cardinality(v_m) > 1 THEN
        v_reason := 'reaches_many_events';
        v_candidates := v_m;
        v_detail := format('Its held dates, deals and proposals sit in %s events.', cardinality(v_m));
      ELSIF cardinality(v_m) = 1 AND NOT (v_b <@ v_m) THEN
        v_reason := 'paths_disagree';
        v_candidates := ARRAY(SELECT DISTINCT y FROM unnest(v_m || v_b) AS y ORDER BY y);
        v_detail := 'Its held dates, deals and proposals sit in one event, and its floor plan is linked to another.';
      ELSIF cardinality(v_m) = 1 THEN
        v_target := v_m[1];
        v_path := CASE
          WHEN v_target = ANY (v_a) THEN 'enquiry_bookings'
          WHEN EXISTS (SELECT 1 FROM "opportunities" o WHERE o."source_enquiry_id" = this_enquiry."id"
            AND o."deleted_at" IS NULL AND o."event_id" = v_target) THEN 'deal'
          ELSE 'proposal'
        END;
      ELSIF cardinality(v_b) > 1 THEN
        v_reason := 'reaches_many_events';
        v_candidates := v_b;
        v_detail := format('Its floor plan is linked to %s events.', cardinality(v_b));
      ELSIF cardinality(v_b) = 1 THEN
        v_target := v_b[1];
        v_path := 'plan_link';
      ELSIF this_enquiry."state" <> ALL (closed_enquiry_states)
        -- (Rule: an open enquiry) not in CLOSED_ENQUIRY_STATES; (Rule: a worked
        -- enquiry, enquiryWorked) a first reply; a live hold, booking or
        -- viewing; an undeleted deal, proposal or quote.
        AND (this_enquiry."first_response_at" IS NOT NULL
          OR EXISTS (SELECT 1 FROM "bookings" b WHERE b."enquiry_id" = this_enquiry."id" AND b."deleted_at" IS NULL
            AND b."status" = 'active' AND b."kind" IN ('hold', 'ink', 'viewing'))
          OR EXISTS (SELECT 1 FROM "opportunities" o WHERE o."source_enquiry_id" = this_enquiry."id" AND o."deleted_at" IS NULL)
          OR EXISTS (SELECT 1 FROM "proposals" p WHERE p."enquiry_id" = this_enquiry."id" AND p."deleted_at" IS NULL)
          OR EXISTS (SELECT 1 FROM "quotes" t WHERE t."enquiry_id" = this_enquiry."id" AND t."deleted_at" IS NULL)) THEN
        v_make := true;
        v_path := 'new_event';
      ELSE
        CONTINUE enquiry_loop;
      END IF;

      EXIT WHEN v_locked;
      -- Its own row: still no event, and still as read.
      PERFORM 1 FROM "enquiries" q
      WHERE q."id" = this_enquiry."id" AND q."event_id" IS NULL AND q."state" = this_enquiry."state"
        AND q."event_type" IS NOT DISTINCT FROM this_enquiry."event_type"
        AND q."configuration_id" IS NOT DISTINCT FROM this_enquiry."configuration_id"
      FOR NO KEY UPDATE SKIP LOCKED;
      CONTINUE enquiry_loop WHEN NOT FOUND;
      v_locked := true;
    END LOOP;

    IF v_reason IS NOT NULL THEN
      INSERT INTO "event_link_reviews" ("venue_id", "subject_kind", "subject_id", "reason", "candidate_event_ids", "detail")
      VALUES (this_enquiry."venue_id", 'enquiry', this_enquiry."id", v_reason, v_candidates, v_detail)
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_listed := v_listed + v_rows;
      CONTINUE;
    END IF;
    IF v_make THEN
      SELECT q."name", q."fixture_source" INTO v_name, v_fixture FROM "enquiries" q WHERE q."id" = this_enquiry."id";
      v_client := v_name;
      v_type := this_enquiry."event_type";
      -- (Rule: an event the join makes; the same statement in steps 1, 2 and
      -- 3) a draft with no dates and no guests, made by nobody; named by its
      -- record, trimmed and cut to 200, or 'Event' when that is blank or holds
      -- an '@' (an event is never named by an email address, event-name.ts);
      -- its client's name the same way, or none; its occasion trimmed and cut
      -- to 80.
      INSERT INTO "events" ("venue_id", "name", "client_name", "event_type", "status", "guest_count", "created_by", "fixture_source")
      VALUES (this_enquiry."venue_id",
        CASE WHEN btrim(coalesce(v_name, ''), js_whitespace) = '' OR strpos(v_name, '@') > 0
          THEN 'Event' ELSE left(btrim(v_name, js_whitespace), 200) END,
        CASE WHEN btrim(coalesce(v_client, ''), js_whitespace) = '' OR strpos(v_client, '@') > 0
          THEN NULL ELSE left(btrim(v_client, js_whitespace), 200) END,
        left(nullif(btrim(v_type, js_whitespace), ''), 80), 'draft', 0, NULL, v_fixture)
      RETURNING "id" INTO v_target;
      v_made := v_made || v_target;
      v_events_made := v_events_made + 1;
    ELSE
      PERFORM 1 FROM "events" e WHERE e."id" = v_target AND e."deleted_at" IS NULL FOR KEY SHARE SKIP LOCKED;
      CONTINUE WHEN NOT FOUND;
    END IF;
    UPDATE "enquiries" SET "event_id" = v_target WHERE "id" = this_enquiry."id";
    INSERT INTO "event_link_joins" ("venue_id", "subject_kind", "subject_id", "event_id", "path", "event_made")
    VALUES (this_enquiry."venue_id", 'enquiry', this_enquiry."id", v_target, v_path, v_make);
    v_joined := v_joined + 1;
  END LOOP;

  -- 2. Deals with no event, oldest first. ------------------------------------
  <<deal_loop>>
  FOR this_deal IN
    SELECT o."id", o."venue_id", o."stage", o."source_enquiry_id", o."title", o."event_type"
    FROM "opportunities" o
    WHERE o."deleted_at" IS NULL AND o."event_id" IS NULL AND o."id" <> ALL (v_waited)
    ORDER BY o."created_at", o."id"
  LOOP
    v_locked := false;
    v_enquiry_locked := NULL;
    LOOP
      -- A listed deal waits for a person, and so does one whose enquiry is listed.
      CONTINUE deal_loop WHEN EXISTS (SELECT 1 FROM "event_link_reviews" l
        WHERE l."resolved_at" IS NULL AND l."binding_review_id" IS NULL
          AND ((l."subject_kind" = 'opportunity' AND l."subject_id" = this_deal."id")
            OR (l."subject_kind" = 'enquiry' AND l."subject_id" = this_deal."source_enquiry_id")));
      -- Its enquiry, when it is of the deal's venue, and the live event it is joined to.
      SELECT q."id", q."event_id", q."name", q."event_type", q."fixture_source",
        -- The rule of step 1: an enquiry that may become an event.
        (q."state" <> 'draft' AND (q."event_type" IS NULL OR btrim(q."event_type", js_whitespace) <> ALL (non_booking_enquiry_types))),
        -- The rule of step 1: what of an enquiry's own reaches an event.
        (EXISTS (SELECT 1 FROM "bookings" b JOIN "events" e ON e."id" = b."event_id"
            WHERE b."enquiry_id" = q."id" AND b."deleted_at" IS NULL AND e."venue_id" = q."venue_id" AND e."deleted_at" IS NULL)
          OR EXISTS (SELECT 1 FROM "opportunities" o JOIN "events" e ON e."id" = o."event_id"
            WHERE o."source_enquiry_id" = q."id" AND o."deleted_at" IS NULL AND e."venue_id" = q."venue_id" AND e."deleted_at" IS NULL)
          OR EXISTS (SELECT 1 FROM "proposals" p JOIN "events" e ON e."id" = p."event_id"
            WHERE p."enquiry_id" = q."id" AND p."deleted_at" IS NULL AND e."venue_id" = q."venue_id" AND e."deleted_at" IS NULL)
          OR EXISTS (SELECT 1 FROM "event_configuration_links" k JOIN "events" e ON e."id" = k."event_id"
            WHERE k."configuration_id" = q."configuration_id" AND e."venue_id" = q."venue_id" AND e."deleted_at" IS NULL))
      INTO v_q_id, v_q_event, v_q_name, v_q_type, v_q_fixture, v_q_may_become, v_q_reaches
      FROM "enquiries" q
      WHERE q."id" = this_deal."source_enquiry_id" AND q."venue_id" = this_deal."venue_id";
      v_target := (SELECT e."id" FROM "events" e
        WHERE e."id" = v_q_event AND e."venue_id" = this_deal."venue_id" AND e."deleted_at" IS NULL);

      v_second := false;
      v_make := false;
      v_for_enquiry := false;
      IF v_target IS NOT NULL THEN
        -- (Rule: an open deal) at a stage in OPEN_OPPORTUNITY_STAGES. An open
        -- deal is not joined where an open deal already is.
        v_second := this_deal."stage" = ANY (open_deal_stages) AND EXISTS (SELECT 1 FROM "opportunities" o
          WHERE o."event_id" = v_target AND o."id" <> this_deal."id"
            AND o."deleted_at" IS NULL AND o."stage" = ANY (open_deal_stages));
      ELSIF this_deal."stage" = ANY (open_deal_stages) THEN
        -- Nothing reaches it: an event is made, for its enquiry when that may
        -- become one and has none (the deal then joins it through its
        -- enquiry). When something of that enquiry's own reaches an event
        -- (step 1 could not settle it: a row it could not have at once), the
        -- deal waits for the enquiry.
        v_for_enquiry := v_q_id IS NOT NULL AND v_q_event IS NULL AND v_q_may_become;
        CONTINUE deal_loop WHEN v_for_enquiry AND v_q_reaches;
        v_make := true;
      ELSE
        -- A closed deal that reaches no event is left.
        CONTINUE deal_loop;
      END IF;

      EXIT WHEN v_locked;
      -- What will be written: its enquiry first when the event is made for
      -- it, then the deal, still with no event and still as read.
      IF v_for_enquiry THEN
        PERFORM 1 FROM "enquiries" q WHERE q."id" = v_q_id AND q."event_id" IS NULL FOR NO KEY UPDATE SKIP LOCKED;
        CONTINUE deal_loop WHEN NOT FOUND;
        v_enquiry_locked := v_q_id;
      END IF;
      PERFORM 1 FROM "opportunities" o
      WHERE o."id" = this_deal."id" AND o."event_id" IS NULL AND o."deleted_at" IS NULL
        AND o."stage" = this_deal."stage"
        AND o."source_enquiry_id" IS NOT DISTINCT FROM this_deal."source_enquiry_id"
      FOR NO KEY UPDATE SKIP LOCKED;
      CONTINUE deal_loop WHEN NOT FOUND;
      v_locked := true;
    END LOOP;
    -- Decided again under the locks: an enquiry it will write must be one it holds.
    CONTINUE WHEN v_for_enquiry AND v_enquiry_locked IS DISTINCT FROM v_q_id;

    IF v_target IS NOT NULL THEN
      IF NOT v_second THEN
        PERFORM 1 FROM "events" e WHERE e."id" = v_target AND e."deleted_at" IS NULL FOR KEY SHARE SKIP LOCKED;
        CONTINUE WHEN NOT FOUND;
        -- The one wait (see above): an open deal a writer has put on the same
        -- event and not committed is met here by the one-open-deal index. The
        -- update waits for that writer at most deal_update_wait, once in a run;
        -- if it commits, this deal is listed instead, and if not, the deal is
        -- left to the next run. Any other unique violation stops the run.
        v_left := false;
        v_lock_timeout := current_setting('lock_timeout');
        BEGIN
          PERFORM set_config('lock_timeout', deal_update_wait, true);
          UPDATE "opportunities" SET "event_id" = v_target WHERE "id" = this_deal."id";
          PERFORM set_config('lock_timeout', v_lock_timeout, true);
          INSERT INTO "event_link_joins" ("venue_id", "subject_kind", "subject_id", "event_id", "path", "event_made")
          VALUES (this_deal."venue_id", 'opportunity', this_deal."id", v_target, 'enquiry', false);
          v_joined := v_joined + 1;
        EXCEPTION
          WHEN unique_violation THEN
            GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
            PERFORM set_config('lock_timeout', v_lock_timeout, true);
            IF v_constraint IS DISTINCT FROM 'opportunities_one_open_per_event' THEN
              RAISE;
            END IF;
            v_second := true;
          WHEN lock_not_available THEN
            PERFORM set_config('lock_timeout', v_lock_timeout, true);
            v_left := true;
            v_waited := v_waited || this_deal."id";
        END;
        CONTINUE WHEN v_left;
      END IF;
      IF v_second THEN
        INSERT INTO "event_link_reviews" ("venue_id", "subject_kind", "subject_id", "reason", "candidate_event_ids", "detail")
        VALUES (this_deal."venue_id", 'opportunity', this_deal."id", 'second_open_deal', ARRAY[v_target],
          'The event its enquiry is joined to already has an open deal.')
        ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_listed := v_listed + v_rows;
      END IF;
      CONTINUE;
    END IF;

    -- An event made for it: named for its enquiry when the enquiry joins it,
    -- otherwise by the deal; its client is the enquiry's, when it has one.
    IF v_for_enquiry THEN
      v_name := v_q_name;
      v_type := coalesce(nullif(btrim(v_q_type, js_whitespace), ''), this_deal."event_type");
    ELSE
      v_name := this_deal."title";
      v_type := coalesce(nullif(btrim(this_deal."event_type", js_whitespace), ''), v_q_type);
    END IF;
    v_client := v_q_name;
    v_fixture := v_q_fixture;
    -- (Rule: an event the join makes; as in step 1.)
    INSERT INTO "events" ("venue_id", "name", "client_name", "event_type", "status", "guest_count", "created_by", "fixture_source")
    VALUES (this_deal."venue_id",
      CASE WHEN btrim(coalesce(v_name, ''), js_whitespace) = '' OR strpos(v_name, '@') > 0
        THEN 'Event' ELSE left(btrim(v_name, js_whitespace), 200) END,
      CASE WHEN btrim(coalesce(v_client, ''), js_whitespace) = '' OR strpos(v_client, '@') > 0
        THEN NULL ELSE left(btrim(v_client, js_whitespace), 200) END,
      left(nullif(btrim(v_type, js_whitespace), ''), 80), 'draft', 0, NULL, v_fixture)
    RETURNING "id" INTO v_target;
    v_made := v_made || v_target;
    v_events_made := v_events_made + 1;
    IF v_for_enquiry THEN
      UPDATE "enquiries" SET "event_id" = v_target WHERE "id" = v_q_id;
      INSERT INTO "event_link_joins" ("venue_id", "subject_kind", "subject_id", "event_id", "path", "event_made")
      VALUES (this_deal."venue_id", 'enquiry', v_q_id, v_target, 'new_event', true);
      v_joined := v_joined + 1;
    END IF;
    UPDATE "opportunities" SET "event_id" = v_target WHERE "id" = this_deal."id";
    INSERT INTO "event_link_joins" ("venue_id", "subject_kind", "subject_id", "event_id", "path", "event_made")
    VALUES (this_deal."venue_id", 'opportunity', this_deal."id", v_target,
      CASE WHEN v_for_enquiry THEN 'enquiry' ELSE 'new_event' END, NOT v_for_enquiry);
    v_joined := v_joined + 1;
  END LOOP;

  -- 3. Proposals with no event, oldest first: in phase 1 those that reach an
  --    existing event, then in phase 2 those for which an event is made. ----
  FOR v_phase IN 1..2 LOOP
  <<proposal_loop>>
  FOR this_proposal IN
    SELECT p."id", p."venue_id", p."status", p."opportunity_id", p."enquiry_id", p."configuration_id", p."title"
    FROM "proposals" p
    WHERE p."deleted_at" IS NULL AND p."event_id" IS NULL
    ORDER BY p."created_at", p."id"
  LOOP
    v_locked := false;
    v_enquiry_locked := NULL;
    v_request_locked := NULL;
    LOOP
      -- A listed proposal waits for a person, and so does one whose enquiry is
      -- listed; one whose open deal has no event waits with its deal.
      CONTINUE proposal_loop WHEN EXISTS (SELECT 1 FROM "event_link_reviews" l
        WHERE l."resolved_at" IS NULL AND l."binding_review_id" IS NULL
          AND ((l."subject_kind" = 'proposal' AND l."subject_id" = this_proposal."id")
            OR (l."subject_kind" = 'enquiry' AND l."subject_id" = this_proposal."enquiry_id")));
      CONTINUE proposal_loop WHEN EXISTS (SELECT 1 FROM "opportunities" o
        WHERE o."id" = this_proposal."opportunity_id" AND o."event_id" IS NULL
          AND o."deleted_at" IS NULL AND o."stage" = ANY (open_deal_stages));
      -- Its enquiry, when it is of the proposal's venue.
      SELECT q."id", q."event_id", q."name", q."event_type", q."fixture_source",
        -- The rule of step 1: an enquiry that may become an event.
        (q."state" <> 'draft' AND (q."event_type" IS NULL OR btrim(q."event_type", js_whitespace) <> ALL (non_booking_enquiry_types))),
        -- The rule of step 1: what of an enquiry's own reaches an event.
        (EXISTS (SELECT 1 FROM "bookings" b JOIN "events" e ON e."id" = b."event_id"
            WHERE b."enquiry_id" = q."id" AND b."deleted_at" IS NULL AND e."venue_id" = q."venue_id" AND e."deleted_at" IS NULL)
          OR EXISTS (SELECT 1 FROM "opportunities" o JOIN "events" e ON e."id" = o."event_id"
            WHERE o."source_enquiry_id" = q."id" AND o."deleted_at" IS NULL AND e."venue_id" = q."venue_id" AND e."deleted_at" IS NULL)
          OR EXISTS (SELECT 1 FROM "proposals" p JOIN "events" e ON e."id" = p."event_id"
            WHERE p."enquiry_id" = q."id" AND p."deleted_at" IS NULL AND e."venue_id" = q."venue_id" AND e."deleted_at" IS NULL)
          OR EXISTS (SELECT 1 FROM "event_configuration_links" k JOIN "events" e ON e."id" = k."event_id"
            WHERE k."configuration_id" = q."configuration_id" AND e."venue_id" = q."venue_id" AND e."deleted_at" IS NULL))
      INTO v_q_id, v_q_event, v_q_name, v_q_type, v_q_fixture, v_q_may_become, v_q_reaches
      FROM "enquiries" q
      WHERE q."id" = this_proposal."enquiry_id" AND q."venue_id" = this_proposal."venue_id";
      -- base: the live event of its deal, else of its enquiry.
      SELECT o."event_type", e."id" INTO v_deal_type, v_base
      FROM "opportunities" o
      LEFT JOIN "events" e ON e."id" = o."event_id" AND e."venue_id" = this_proposal."venue_id" AND e."deleted_at" IS NULL
      WHERE o."id" = this_proposal."opportunity_id";
      v_path := 'deal';
      IF v_base IS NULL THEN
        v_path := 'enquiry';
        v_base := (SELECT e."id" FROM "events" e WHERE e."id" = v_q_event AND e."deleted_at" IS NULL);
      END IF;
      -- asked: the event its deposit request in force names (one is in force at most).
      SELECT d."id", d."event_id" INTO v_request, v_request_event
      FROM "proposal_deposit_requests" d
      WHERE d."proposal_id" = this_proposal."id" AND d."cancelled_at" IS NULL;
      v_asked := (SELECT e."id" FROM "events" e WHERE e."id" = v_request_event AND e."deleted_at" IS NULL);

      v_reason := NULL;
      v_target := NULL;
      v_make := false;
      v_for_enquiry := false;
      IF v_request_event IS NOT NULL AND v_asked IS NULL THEN
        -- Its deposit request names an event that has been deleted: a person decides.
        v_reason := 'paths_disagree';
        v_candidates := ARRAY(SELECT y FROM unnest(ARRAY[v_base]) AS y WHERE y IS NOT NULL);
        v_detail := 'Its deposit request names an event that has been deleted.';
      ELSIF v_base IS NOT NULL AND v_asked IS NOT NULL AND v_base <> v_asked THEN
        v_reason := 'paths_disagree';
        v_candidates := ARRAY(SELECT y FROM unnest(ARRAY[v_base, v_asked]) AS y ORDER BY y);
        v_detail := format('Its %s is in one event, and its deposit request names another.', v_path);
      ELSIF v_base IS NOT NULL THEN
        v_target := v_base;
      ELSIF v_asked IS NOT NULL THEN
        v_target := v_asked;
        v_path := 'deposit_request';
      ELSE
        v_b := ARRAY(SELECT DISTINCT e."id" FROM "event_configuration_links" k JOIN "events" e ON e."id" = k."event_id"
          WHERE k."configuration_id" = this_proposal."configuration_id"
            AND e."venue_id" = this_proposal."venue_id" AND e."deleted_at" IS NULL
          ORDER BY e."id");
        -- (Rule: a proposal that must have an event, proposalMustHaveEvent; the
        -- loop reads undeleted proposals only) sent; or with an agreement; or
        -- with a deposit request in force; or a draft for a deal or an enquiry.
        IF this_proposal."status" = ANY (sent_proposal_statuses)
          OR EXISTS (SELECT 1 FROM "proposal_contract_versions" a WHERE a."proposal_id" = this_proposal."id")
          OR v_request IS NOT NULL
          OR (this_proposal."status" = 'draft'
            AND (this_proposal."opportunity_id" IS NOT NULL OR this_proposal."enquiry_id" IS NOT NULL)) THEN
          IF cardinality(v_b) > 1 THEN
            v_reason := 'reaches_many_events';
            v_candidates := v_b;
            v_detail := format('Its floor plan is linked to %s events.', cardinality(v_b));
          ELSIF cardinality(v_b) = 1 THEN
            v_target := v_b[1];
            v_path := 'plan_link';
          ELSE
            v_make := true;
            v_path := 'new_event';
            v_for_enquiry := v_q_id IS NOT NULL AND v_q_event IS NULL AND v_q_may_become;
          END IF;
        ELSIF this_proposal."status" <> 'draft' AND cardinality(v_b) = 1 THEN
          -- One that need not have an event (it is over) joins its plan's one
          -- live event as history. It is never listed nor given an event, and a
          -- draft made from a plan alone waits until it is sent.
          v_target := v_b[1];
          v_path := 'plan_link';
        ELSE
          CONTINUE proposal_loop;
        END IF;
      END IF;

      -- An event is made last: not in phase 1, and in phase 2 for its enquiry
      -- only when nothing of the enquiry's own reaches a live event, and no
      -- other proposal of it without an event reaches one through its deal,
      -- its deposit request or (when that would join or list it) its plan.
      -- Otherwise it is left: the next round or run settles the enquiry first.
      -- (A proposal that joins an existing event never carries its enquiry;
      -- step 1 of the next round joins the enquiry from all of them.)
      IF v_make THEN
        CONTINUE proposal_loop WHEN v_phase = 1;
        CONTINUE proposal_loop WHEN v_for_enquiry AND v_q_reaches;
        CONTINUE proposal_loop WHEN v_for_enquiry AND EXISTS (
          SELECT 1 FROM "proposals" s
          CROSS JOIN LATERAL (SELECT count(DISTINCT e."id") AS "reached"
            FROM "event_configuration_links" k JOIN "events" e ON e."id" = k."event_id"
            WHERE k."configuration_id" = s."configuration_id" AND e."venue_id" = s."venue_id" AND e."deleted_at" IS NULL) pl
          WHERE s."enquiry_id" = v_q_id AND s."id" <> this_proposal."id" AND s."deleted_at" IS NULL AND s."event_id" IS NULL
            AND (EXISTS (SELECT 1 FROM "opportunities" o JOIN "events" e ON e."id" = o."event_id"
                  WHERE o."id" = s."opportunity_id" AND e."venue_id" = s."venue_id" AND e."deleted_at" IS NULL)
              OR EXISTS (SELECT 1 FROM "proposal_deposit_requests" d JOIN "events" e ON e."id" = d."event_id"
                  WHERE d."proposal_id" = s."id" AND d."cancelled_at" IS NULL AND e."deleted_at" IS NULL)
              OR pl."reached" = 1
              -- The rule of step 3: one that must have an event is listed when its plan reaches several.
              OR (pl."reached" > 1 AND (s."status" = ANY (sent_proposal_statuses)
                OR EXISTS (SELECT 1 FROM "proposal_contract_versions" a WHERE a."proposal_id" = s."id")
                OR EXISTS (SELECT 1 FROM "proposal_deposit_requests" d WHERE d."proposal_id" = s."id" AND d."cancelled_at" IS NULL)
                OR (s."status" = 'draft' AND (s."opportunity_id" IS NOT NULL OR s."enquiry_id" IS NOT NULL))))));
      END IF;

      EXIT WHEN v_locked;
      -- What will be written, in the writers' order: the proposal (still with
      -- no event and still as read), then its enquiry when the event is made
      -- for it, then its deposit request when it takes the event.
      PERFORM 1 FROM "proposals" p
      WHERE p."id" = this_proposal."id" AND p."event_id" IS NULL AND p."deleted_at" IS NULL
        AND p."status" = this_proposal."status"
        AND p."opportunity_id" IS NOT DISTINCT FROM this_proposal."opportunity_id"
        AND p."enquiry_id" IS NOT DISTINCT FROM this_proposal."enquiry_id"
        AND p."configuration_id" IS NOT DISTINCT FROM this_proposal."configuration_id"
      FOR NO KEY UPDATE SKIP LOCKED;
      CONTINUE proposal_loop WHEN NOT FOUND;
      IF v_for_enquiry THEN
        PERFORM 1 FROM "enquiries" q WHERE q."id" = v_q_id AND q."event_id" IS NULL FOR NO KEY UPDATE SKIP LOCKED;
        CONTINUE proposal_loop WHEN NOT FOUND;
        v_enquiry_locked := v_q_id;
      END IF;
      IF v_reason IS NULL AND v_request IS NOT NULL AND v_request_event IS NULL THEN
        PERFORM 1 FROM "proposal_deposit_requests" d
        WHERE d."id" = v_request AND d."event_id" IS NULL AND d."cancelled_at" IS NULL
        FOR NO KEY UPDATE SKIP LOCKED;
        CONTINUE proposal_loop WHEN NOT FOUND;
        v_request_locked := v_request;
      END IF;
      v_locked := true;
    END LOOP;
    -- Decided again under the locks: what it will write must be what it holds.
    CONTINUE WHEN v_for_enquiry AND v_enquiry_locked IS DISTINCT FROM v_q_id;
    CONTINUE WHEN v_reason IS NULL AND v_request IS NOT NULL AND v_request_event IS NULL
      AND v_request_locked IS DISTINCT FROM v_request;

    IF v_reason IS NOT NULL THEN
      INSERT INTO "event_link_reviews" ("venue_id", "subject_kind", "subject_id", "reason", "candidate_event_ids", "detail")
      VALUES (this_proposal."venue_id", 'proposal', this_proposal."id", v_reason, v_candidates, v_detail)
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_listed := v_listed + v_rows;
      CONTINUE;
    END IF;
    IF v_make THEN
      -- Named for its enquiry when the enquiry joins it (the proposal then
      -- joins through its enquiry), otherwise by the proposal; its client is
      -- the enquiry's, when it has one; its occasion the enquiry's or the deal's.
      IF v_for_enquiry THEN
        v_name := v_q_name;
        v_path := 'enquiry';
      ELSE
        v_name := this_proposal."title";
      END IF;
      v_client := v_q_name;
      v_type := coalesce(nullif(btrim(v_q_type, js_whitespace), ''), v_deal_type);
      v_fixture := v_q_fixture;
      -- (Rule: an event the join makes; as in step 1.)
      INSERT INTO "events" ("venue_id", "name", "client_name", "event_type", "status", "guest_count", "created_by", "fixture_source")
      VALUES (this_proposal."venue_id",
        CASE WHEN btrim(coalesce(v_name, ''), js_whitespace) = '' OR strpos(v_name, '@') > 0
          THEN 'Event' ELSE left(btrim(v_name, js_whitespace), 200) END,
        CASE WHEN btrim(coalesce(v_client, ''), js_whitespace) = '' OR strpos(v_client, '@') > 0
          THEN NULL ELSE left(btrim(v_client, js_whitespace), 200) END,
        left(nullif(btrim(v_type, js_whitespace), ''), 80), 'draft', 0, NULL, v_fixture)
      RETURNING "id" INTO v_target;
      v_made := v_made || v_target;
      v_events_made := v_events_made + 1;
    ELSE
      PERFORM 1 FROM "events" e WHERE e."id" = v_target AND e."deleted_at" IS NULL FOR KEY SHARE SKIP LOCKED;
      CONTINUE WHEN NOT FOUND;
    END IF;
    UPDATE "proposals" SET "event_id" = v_target WHERE "id" = this_proposal."id";
    INSERT INTO "event_link_joins" ("venue_id", "subject_kind", "subject_id", "event_id", "path", "event_made")
    VALUES (this_proposal."venue_id", 'proposal', this_proposal."id", v_target, v_path, v_make AND NOT v_for_enquiry);
    v_joined := v_joined + 1;
    IF v_for_enquiry THEN
      UPDATE "enquiries" SET "event_id" = v_target WHERE "id" = v_q_id;
      INSERT INTO "event_link_joins" ("venue_id", "subject_kind", "subject_id", "event_id", "path", "event_made")
      VALUES (this_proposal."venue_id", 'enquiry', v_q_id, v_target, 'new_event', true);
      v_joined := v_joined + 1;
    END IF;
    -- Its deposit request in force takes the same event when it names none,
    -- recorded with the path its proposal took.
    IF v_request_locked IS NOT NULL THEN
      UPDATE "proposal_deposit_requests" SET "event_id" = v_target WHERE "id" = v_request_locked;
      INSERT INTO "event_link_joins" ("venue_id", "subject_kind", "subject_id", "event_id", "path", "event_made")
      VALUES (this_proposal."venue_id", 'deposit_request', v_request_locked, v_target, v_path, false);
      v_joined := v_joined + 1;
    END IF;
  END LOOP;
  END LOOP;

    EXIT WHEN v_joined = v_joined_before OR v_round = 4;
  END LOOP;

  -- 4. Every event made here gets the house's default phases, exactly as 0090
  --    gave the events it made (defaultEventPhaseInputs in @omnitwin/types):
  --    no room, no time, and every evidence field "not checked".
  INSERT INTO "event_phases" (
    "event_id", "template_key", "name", "sort_order", "starts_at", "duration_minutes", "guest_count",
    "ops_tasks_count", "review_gates_count", "density_status", "density_label",
    "staff_conflicts_status", "staff_conflicts_label", "notes"
  )
  SELECT
    n."event_id", p."template_key", p."name", p."sort_order", NULL, p."duration_minutes", NULL,
    0, 0, 'not_checked', 'Density not checked', 'not_checked', 'Staff conflicts not checked', NULL
  FROM unnest(v_made) AS n("event_id")
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

  "joined" := v_joined;
  "events_made" := v_events_made;
  "listed" := v_listed;
  RETURN NEXT;
END;
$join$;
--> statement-breakpoint

-- 8. The undo of the join -----------------------------------------------------
-- Puts back what the join did, read from its own record (event_link_joins),
-- and leaves what a person has changed since. An operator's tool, run by hand
-- and rarely; nothing calls it. Stop the deploy's and the nightly runs of the
-- join first: the next of them would join again what was undone.
--
-- An event the join made (the one join row with event_made) goes, with its
-- phases, only when nothing has attached to it since: every join recorded to
-- it still holds; the event is as made (updated_at still its created_at, not
-- deleted); no phase of it has been given a room or a time, or edited; and no
-- row points at it or at one of its phases other than the records joined to
-- it. Every foreign key to events and to event_phases is read from
-- pg_constraint as it runs, so a table added later is covered. An event that
-- may not go is kept WITH its joins: each of its join rows is counted in
-- left_alone and stays in force. Every other join in force, newest first, is
-- undone when its record still names the event it was given (the link is
-- emptied and the row stamped undone_at); one a person has moved is counted in
-- left_alone and left. Last, the open questions the join wrote are deleted;
-- the copies of October's list stay.
--
-- Locks. As the join: no table lock, and never a wait for a row. Each record
-- it will empty is locked FOR NO KEY UPDATE SKIP LOCKED, still naming the
-- recorded event; an event it will delete is taken after its records (the
-- writers' order: bookings, the proposal, the enquiry, the deal, the event)
-- FOR UPDATE SKIP LOCKED, which no row can be attached to while it is held,
-- then its phases FOR UPDATE SKIP LOCKED, and it is decided again under those
-- locks. A row it cannot have at once is left: its join stays in force and is
-- counted in left_alone, so a second run finishes the job. An event a writer
-- is attaching a row to is held by that writer's key share, so it is kept.
--
-- The link trigger lets a link be emptied only while venviewer.undo_event_links
-- is 'on'. The undo sets it for its own transaction and puts back what was
-- there before it returns; when it raises, the (sub)transaction that rolls
-- back puts it back, as it does every setting made in it.
CREATE OR REPLACE FUNCTION "spine_undo_joins"()
  RETURNS TABLE ("emptied" integer, "events_removed" integer, "left_alone" integer)
  LANGUAGE plpgsql
  AS $undo$
DECLARE
  v_prior text := current_setting('venviewer.undo_event_links', true);
  -- Every foreign key to events (but an event's own phases) or to event_phases:
  v_fk_tables text[];   -- the referencing table, quoted
  v_fk_columns text[];  -- its column that names the event's or the phase's id
  v_fk_targets text[];  -- 'event' or 'phase'
  v_fk_kinds text[];    -- the kind of record the join records in that table, or NULL
  v_event uuid;
  v_join record;
  v_joins integer;
  v_held integer;
  v_phases integer;
  v_may_go boolean;
  v_locked boolean;
  v_attached boolean;
  v_i integer;
  v_removable uuid[] := '{}';
  v_emptied integer := 0;
  v_events_removed integer := 0;
  v_left_alone integer := 0;
BEGIN
  PERFORM set_config('venviewer.undo_event_links', 'on', true);

  SELECT coalesce(array_agg(f."tbl" ORDER BY f."ord"), '{}'),
    coalesce(array_agg(f."col" ORDER BY f."ord"), '{}'),
    coalesce(array_agg(f."target" ORDER BY f."ord"), '{}'),
    coalesce(array_agg(f."kind" ORDER BY f."ord"), '{}')
  INTO v_fk_tables, v_fk_columns, v_fk_targets, v_fk_kinds
  FROM (
    SELECT c."conrelid"::regclass::text AS "tbl", a."attname"::text AS "col",
      CASE WHEN c."confrelid"::regclass = '"events"'::regclass THEN 'event' ELSE 'phase' END AS "target",
      CASE c."conrelid"::regclass
        WHEN '"enquiries"'::regclass THEN 'enquiry'
        WHEN '"opportunities"'::regclass THEN 'opportunity'
        WHEN '"proposals"'::regclass THEN 'proposal'
        WHEN '"proposal_deposit_requests"'::regclass THEN 'deposit_request'
      END AS "kind",
      row_number() OVER (ORDER BY c."conname", k."n") AS "ord"
    FROM pg_constraint c
    CROSS JOIN LATERAL unnest(c."conkey", c."confkey") WITH ORDINALITY AS k("referencing", "referenced", "n")
    JOIN pg_attribute a ON a."attrelid" = c."conrelid" AND a."attnum" = k."referencing"
    JOIN pg_attribute r ON r."attrelid" = c."confrelid" AND r."attnum" = k."referenced" AND r."attname" = 'id'
    WHERE c."contype" = 'f'
      AND c."confrelid"::regclass IN ('"events"'::regclass, '"event_phases"'::regclass)
      -- An event's own phases are judged by what they hold, below.
      AND NOT (c."conrelid"::regclass = '"event_phases"'::regclass AND c."confrelid"::regclass = '"events"'::regclass)
  ) f;

  -- 1. Which events the join made may go. ----------------------------------
  FOR v_event IN
    SELECT DISTINCT j."event_id" FROM "event_link_joins" j
    WHERE j."event_made" AND j."undone_at" IS NULL
    ORDER BY j."event_id"
  LOOP
    v_locked := false;
    LOOP
      -- Decided on a plain read, then again under its locks.
      v_may_go :=
        -- Every join recorded to it still holds.
        NOT EXISTS (SELECT 1 FROM "event_link_joins" j
          WHERE j."event_id" = v_event AND j."undone_at" IS NULL
            AND j."event_id" IS DISTINCT FROM (CASE j."subject_kind"
              WHEN 'enquiry' THEN (SELECT x."event_id" FROM "enquiries" x WHERE x."id" = j."subject_id")
              WHEN 'opportunity' THEN (SELECT x."event_id" FROM "opportunities" x WHERE x."id" = j."subject_id")
              WHEN 'proposal' THEN (SELECT x."event_id" FROM "proposals" x WHERE x."id" = j."subject_id")
              ELSE (SELECT x."event_id" FROM "proposal_deposit_requests" x WHERE x."id" = j."subject_id")
            END))
        -- The event is as the join made it.
        AND EXISTS (SELECT 1 FROM "events" e
          WHERE e."id" = v_event AND e."deleted_at" IS NULL AND e."updated_at" = e."created_at")
        -- No phase of it has been given a room or a time, or edited.
        AND NOT EXISTS (SELECT 1 FROM "event_phases" ph
          WHERE ph."event_id" = v_event
            AND (ph."space_id" IS NOT NULL OR ph."starts_at" IS NOT NULL OR ph."updated_at" <> ph."created_at"));
      -- Nothing else points at it or at one of its phases.
      v_i := 0;
      WHILE v_may_go AND v_i < cardinality(v_fk_tables) LOOP
        v_i := v_i + 1;
        IF v_fk_targets[v_i] = 'phase' THEN
          EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s t WHERE t.%I IN '
              '(SELECT ph."id" FROM "event_phases" ph WHERE ph."event_id" = $1))',
            v_fk_tables[v_i], v_fk_columns[v_i])
          INTO v_attached USING v_event;
        ELSIF v_fk_kinds[v_i] IS NULL THEN
          EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s t WHERE t.%I = $1)', v_fk_tables[v_i], v_fk_columns[v_i])
          INTO v_attached USING v_event;
        ELSE
          -- A table the join records in: its records joined to this event are left out.
          EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s t WHERE t.%I = $1 AND t."id" NOT IN '
              '(SELECT j."subject_id" FROM "event_link_joins" j '
              'WHERE j."event_id" = $1 AND j."undone_at" IS NULL AND j."subject_kind" = $2))',
            v_fk_tables[v_i], v_fk_columns[v_i])
          INTO v_attached USING v_event, v_fk_kinds[v_i];
        END IF;
        v_may_go := NOT v_attached;
      END LOOP;
      EXIT WHEN NOT v_may_go;

      -- Its records, in the writers' order, each still naming it (on the
      -- second pass these are already held, and nothing new can be joined to
      -- the event while it is held).
      v_joins := (SELECT count(*) FROM "event_link_joins" j WHERE j."event_id" = v_event AND j."undone_at" IS NULL);
      v_held :=
        (SELECT count(*) FROM (SELECT 1 FROM "proposals" x
          WHERE x."event_id" = v_event AND x."id" IN (SELECT j."subject_id" FROM "event_link_joins" j
            WHERE j."event_id" = v_event AND j."undone_at" IS NULL AND j."subject_kind" = 'proposal')
          FOR NO KEY UPDATE SKIP LOCKED) s)
        + (SELECT count(*) FROM (SELECT 1 FROM "enquiries" x
          WHERE x."event_id" = v_event AND x."id" IN (SELECT j."subject_id" FROM "event_link_joins" j
            WHERE j."event_id" = v_event AND j."undone_at" IS NULL AND j."subject_kind" = 'enquiry')
          FOR NO KEY UPDATE SKIP LOCKED) s)
        + (SELECT count(*) FROM (SELECT 1 FROM "proposal_deposit_requests" x
          WHERE x."event_id" = v_event AND x."id" IN (SELECT j."subject_id" FROM "event_link_joins" j
            WHERE j."event_id" = v_event AND j."undone_at" IS NULL AND j."subject_kind" = 'deposit_request')
          FOR NO KEY UPDATE SKIP LOCKED) s)
        + (SELECT count(*) FROM (SELECT 1 FROM "opportunities" x
          WHERE x."event_id" = v_event AND x."id" IN (SELECT j."subject_id" FROM "event_link_joins" j
            WHERE j."event_id" = v_event AND j."undone_at" IS NULL AND j."subject_kind" = 'opportunity')
          FOR NO KEY UPDATE SKIP LOCKED) s);
      IF v_held < v_joins THEN
        v_may_go := false;
        EXIT;
      END IF;
      EXIT WHEN v_locked;
      -- Then the event, and then every one of its phases.
      PERFORM 1 FROM "events" e WHERE e."id" = v_event FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN
        v_may_go := false;
        EXIT;
      END IF;
      v_phases := (SELECT count(*) FROM "event_phases" ph WHERE ph."event_id" = v_event);
      IF (SELECT count(*) FROM (SELECT 1 FROM "event_phases" ph WHERE ph."event_id" = v_event
          FOR UPDATE SKIP LOCKED) s) < v_phases THEN
        v_may_go := false;
        EXIT;
      END IF;
      v_locked := true;
    END LOOP;
    IF v_may_go THEN
      v_removable := v_removable || v_event;
    END IF;
  END LOOP;

  -- 2. Every join in force, newest first. ----------------------------------
  FOR v_join IN
    SELECT j."id", j."subject_kind", j."subject_id", j."event_id"
    FROM "event_link_joins" j
    WHERE j."undone_at" IS NULL
    ORDER BY j."joined_at" DESC, j."id"
  LOOP
    -- A join to an event the join made that is kept stays with its event.
    IF v_join."event_id" <> ALL (v_removable) AND EXISTS (SELECT 1 FROM "event_link_joins" m
        WHERE m."event_id" = v_join."event_id" AND m."event_made" AND m."undone_at" IS NULL) THEN
      v_left_alone := v_left_alone + 1;
      CONTINUE;
    END IF;
    -- Its record, still naming the event it was given.
    CASE v_join."subject_kind"
      WHEN 'enquiry' THEN
        PERFORM 1 FROM "enquiries" x WHERE x."id" = v_join."subject_id" AND x."event_id" = v_join."event_id"
        FOR NO KEY UPDATE SKIP LOCKED;
      WHEN 'opportunity' THEN
        PERFORM 1 FROM "opportunities" x WHERE x."id" = v_join."subject_id" AND x."event_id" = v_join."event_id"
        FOR NO KEY UPDATE SKIP LOCKED;
      WHEN 'proposal' THEN
        PERFORM 1 FROM "proposals" x WHERE x."id" = v_join."subject_id" AND x."event_id" = v_join."event_id"
        FOR NO KEY UPDATE SKIP LOCKED;
      ELSE
        PERFORM 1 FROM "proposal_deposit_requests" x WHERE x."id" = v_join."subject_id" AND x."event_id" = v_join."event_id"
        FOR NO KEY UPDATE SKIP LOCKED;
    END CASE;
    IF NOT FOUND THEN
      -- A person moved it, or a writer holds it.
      v_left_alone := v_left_alone + 1;
      CONTINUE;
    END IF;
    CASE v_join."subject_kind"
      WHEN 'enquiry' THEN
        UPDATE "enquiries" SET "event_id" = NULL WHERE "id" = v_join."subject_id";
      WHEN 'opportunity' THEN
        UPDATE "opportunities" SET "event_id" = NULL WHERE "id" = v_join."subject_id";
      WHEN 'proposal' THEN
        UPDATE "proposals" SET "event_id" = NULL WHERE "id" = v_join."subject_id";
      ELSE
        UPDATE "proposal_deposit_requests" SET "event_id" = NULL WHERE "id" = v_join."subject_id";
    END CASE;
    UPDATE "event_link_joins" SET "undone_at" = now() WHERE "id" = v_join."id";
    v_emptied := v_emptied + 1;
  END LOOP;

  -- 3. The events that may go, and their phases with them. ------------------
  DELETE FROM "events" e WHERE e."id" = ANY (v_removable);
  GET DIAGNOSTICS v_events_removed = ROW_COUNT;

  -- 4. The open questions the join wrote; a question a person is answering at
  --    this moment is left to the next run. Copies of October's list stay.
  DELETE FROM "event_link_reviews" v
  WHERE v."id" IN (SELECT l."id" FROM "event_link_reviews" l
    WHERE l."binding_review_id" IS NULL AND l."resolved_at" IS NULL
    FOR UPDATE SKIP LOCKED);

  PERFORM set_config('venviewer.undo_event_links', coalesce(v_prior, ''), true);
  "emptied" := v_emptied;
  "events_removed" := v_events_removed;
  "left_alone" := v_left_alone;
  RETURN NEXT;
END;
$undo$;
--> statement-breakpoint
-- Join what is already there.
SELECT * FROM spine_join_old_records();
--> statement-breakpoint

-- The five-second lock limit was for this file alone; anything after it in
-- the same migration run waits as the migrator itself allows.
SET LOCAL lock_timeout TO DEFAULT;
