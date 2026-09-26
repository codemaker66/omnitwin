-- ---------------------------------------------------------------------------
-- 0078 — the staff rota, version 1 (T-637, slice B)
--
-- Blake asked for a rota inside the platform: who is on, when, and in what
-- role, so changeovers can later be planned from the crew actually on shift.
-- This migration adds four tables and changes no existing one:
--   1. staff_members: the people rostered, with or without a login, and the
--      facts the law needs (bar training, an under-18's eighteenth birthday,
--      the right-to-work check, the 48-hour opt-out);
--   2. rota_shifts: a shift in draft, published or cancelled, filled or not,
--      optionally tied to one of the venue's events and rooms;
--   3. staff_unavailability: leave, and times someone cannot work;
--   4. rota_shift_changes: every publish, change and cancellation after
--      publishing, with who, when and the notice given, kept unaltered.
--
-- Every reference to a person, event or room carries the venue as well, so a
-- shift can never name another venue's person, event or room. The two
-- composite keys it relies on are asserted first; a database without them
-- stops with a named 23514 and nothing changes.
-- ---------------------------------------------------------------------------

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
DO $rota$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_id_venue_unique') THEN
    RAISE EXCEPTION 'ROTA_EVENT_VENUE_KEY: events_id_venue_unique is missing, so a shift could name another venue''s event'
      USING ERRCODE = '23514',
        HINT = 'Apply the migration that adds events_id_venue_unique (0046), then run this one again.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spaces_id_venue_unique') THEN
    RAISE EXCEPTION 'ROTA_SPACE_VENUE_KEY: spaces_id_venue_unique is missing, so a shift could name another venue''s room'
      USING ERRCODE = '23514',
        HINT = 'Apply the migration that adds spaces_id_venue_unique (0050), then run this one again.';
  END IF;
END
$rota$;
--> statement-breakpoint
CREATE TABLE "staff_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "display_name" varchar(120) NOT NULL,
  "email" varchar(255),
  "phone" varchar(40),
  "employment_type" varchar(20) NOT NULL,
  "skills" text[] DEFAULT '{}'::text[] NOT NULL,
  "bar_trained_on" date,
  "turns_18_on" date,
  "right_to_work_checked_on" date,
  "right_to_work_expires_on" date,
  "working_time_opt_out" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "staff_members_id_venue_unique" UNIQUE ("id", "venue_id"),
  CONSTRAINT "staff_members_name" CHECK (length(btrim("display_name")) > 0),
  CONSTRAINT "staff_members_employment" CHECK ("employment_type" IN ('employed', 'casual', 'agency')),
  CONSTRAINT "staff_members_skills" CHECK ("skills" <@ ARRAY['setup', 'bar', 'duty_manager', 'first_aid', 'av']::text[]),
  CONSTRAINT "staff_members_right_to_work" CHECK (
    "right_to_work_expires_on" IS NULL
    OR ("right_to_work_checked_on" IS NOT NULL AND "right_to_work_expires_on" >= "right_to_work_checked_on")),
  CONSTRAINT "staff_members_revision" CHECK ("revision" >= 1)
);
--> statement-breakpoint
-- One record per account at a venue: an account is one person.
CREATE UNIQUE INDEX "staff_members_one_per_account" ON "staff_members" ("venue_id", "user_id")
  WHERE "user_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "staff_members_venue_name_idx" ON "staff_members" ("venue_id", "display_name");
--> statement-breakpoint
CREATE TABLE "rota_shifts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "staff_member_id" uuid,
  "role" varchar(20) NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "break_minutes" integer DEFAULT 0 NOT NULL,
  "event_id" uuid,
  "space_id" uuid,
  "note" varchar(500),
  "status" varchar(20) DEFAULT 'draft' NOT NULL,
  "kept_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "published_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "cancellation_notice_hours" integer,
  CONSTRAINT "rota_shifts_id_venue_unique" UNIQUE ("id", "venue_id"),
  CONSTRAINT "rota_shifts_staff_venue_fk" FOREIGN KEY ("staff_member_id", "venue_id")
    REFERENCES "staff_members"("id", "venue_id"),
  CONSTRAINT "rota_shifts_event_venue_fk" FOREIGN KEY ("event_id", "venue_id")
    REFERENCES "events"("id", "venue_id") ON DELETE SET NULL ("event_id"),
  CONSTRAINT "rota_shifts_space_venue_fk" FOREIGN KEY ("space_id", "venue_id")
    REFERENCES "spaces"("id", "venue_id") ON DELETE SET NULL ("space_id"),
  CONSTRAINT "rota_shifts_role" CHECK ("role" IN ('setup', 'bar', 'duty_manager', 'first_aid', 'av')),
  CONSTRAINT "rota_shifts_time" CHECK ("ends_at" > "starts_at" AND "ends_at" - "starts_at" <= interval '24 hours'),
  CONSTRAINT "rota_shifts_break" CHECK (
    "break_minutes" >= 0 AND make_interval(mins => "break_minutes") < "ends_at" - "starts_at"),
  CONSTRAINT "rota_shifts_status" CHECK ("status" IN ('draft', 'published', 'cancelled')),
  -- A draft has never been published; a cancelled shift was published first
  -- (a draft nobody was told about is removed, not cancelled).
  CONSTRAINT "rota_shifts_published" CHECK (("status" = 'draft') = ("published_at" IS NULL)),
  CONSTRAINT "rota_shifts_cancelled" CHECK (
    ("status" = 'cancelled') = ("cancelled_at" IS NOT NULL)
    AND ("cancelled_at" IS NULL) = ("cancellation_notice_hours" IS NULL)
    AND ("cancellation_notice_hours" IS NULL OR "cancellation_notice_hours" >= 0)),
  CONSTRAINT "rota_shifts_note" CHECK ("note" IS NULL OR length(btrim("note")) > 0),
  CONSTRAINT "rota_shifts_kept_warnings" CHECK (jsonb_typeof("kept_warnings") = 'array'),
  CONSTRAINT "rota_shifts_revision" CHECK ("revision" >= 1)
);
--> statement-breakpoint
CREATE INDEX "rota_shifts_venue_starts_idx" ON "rota_shifts" ("venue_id", "starts_at");
--> statement-breakpoint
CREATE INDEX "rota_shifts_staff_starts_idx" ON "rota_shifts" ("staff_member_id", "starts_at");
--> statement-breakpoint
CREATE INDEX "rota_shifts_event_idx" ON "rota_shifts" ("event_id");
--> statement-breakpoint
CREATE TABLE "staff_unavailability" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "staff_member_id" uuid NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "reason" varchar(20) NOT NULL,
  "note" varchar(300),
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "staff_unavailability_staff_venue_fk" FOREIGN KEY ("staff_member_id", "venue_id")
    REFERENCES "staff_members"("id", "venue_id"),
  CONSTRAINT "staff_unavailability_time" CHECK ("ends_at" > "starts_at" AND "ends_at" - "starts_at" <= interval '366 days'),
  CONSTRAINT "staff_unavailability_reason" CHECK ("reason" IN ('leave', 'unavailable')),
  CONSTRAINT "staff_unavailability_note" CHECK ("note" IS NULL OR length(btrim("note")) > 0)
);
--> statement-breakpoint
CREATE INDEX "staff_unavailability_staff_starts_idx" ON "staff_unavailability" ("staff_member_id", "starts_at");
--> statement-breakpoint
CREATE INDEX "staff_unavailability_venue_starts_idx" ON "staff_unavailability" ("venue_id", "starts_at");
--> statement-breakpoint
-- What each person was told, and how much notice they had: kept for the
-- notice and pay rules of the Employment Rights Act 2025 when they start.
CREATE TABLE "rota_shift_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL,
  "shift_id" uuid NOT NULL,
  "kind" varchar(20) NOT NULL,
  "changed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "notice_hours" integer NOT NULL,
  "before" jsonb,
  "after" jsonb,
  CONSTRAINT "rota_shift_changes_shift_venue_fk" FOREIGN KEY ("shift_id", "venue_id")
    REFERENCES "rota_shifts"("id", "venue_id"),
  CONSTRAINT "rota_shift_changes_kind" CHECK ("kind" IN ('published', 'changed', 'cancelled')),
  CONSTRAINT "rota_shift_changes_notice" CHECK ("notice_hours" >= 0),
  CONSTRAINT "rota_shift_changes_states" CHECK (
    ("before" IS NULL OR jsonb_typeof("before") = 'object')
    AND ("after" IS NULL OR jsonb_typeof("after") = 'object')
    AND ("kind" <> 'published' OR ("before" IS NULL AND "after" IS NOT NULL))
    AND ("kind" <> 'changed' OR ("before" IS NOT NULL AND "after" IS NOT NULL))
    AND ("kind" <> 'cancelled' OR ("before" IS NOT NULL AND "after" IS NULL)))
);
--> statement-breakpoint
CREATE INDEX "rota_shift_changes_shift_idx" ON "rota_shift_changes" ("shift_id", "changed_at");
--> statement-breakpoint
CREATE INDEX "rota_shift_changes_venue_idx" ON "rota_shift_changes" ("venue_id", "changed_at");
--> statement-breakpoint
CREATE FUNCTION "rota_shift_changes_unaltered"() RETURNS trigger
  LANGUAGE plpgsql AS $unaltered$
BEGIN
  -- Deleting an account clears who made a change (changed_by's ON DELETE SET
  -- NULL). That is the one update allowed; nothing else about a record may
  -- change, and no record may be removed.
  IF TG_OP = 'UPDATE' AND NEW."changed_by" IS NULL
    AND (NEW."id", NEW."venue_id", NEW."shift_id", NEW."kind", NEW."changed_at", NEW."notice_hours", NEW."before", NEW."after")
      IS NOT DISTINCT FROM (OLD."id", OLD."venue_id", OLD."shift_id", OLD."kind", OLD."changed_at", OLD."notice_hours", OLD."before", OLD."after") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ROTA_CHANGE_RECORD: a rota change record is kept as it was written'
    USING ERRCODE = '23514';
END
$unaltered$;
--> statement-breakpoint
CREATE TRIGGER "rota_shift_changes_unaltered"
  BEFORE UPDATE OR DELETE ON "rota_shift_changes"
  FOR EACH ROW EXECUTE FUNCTION "rota_shift_changes_unaltered"();
