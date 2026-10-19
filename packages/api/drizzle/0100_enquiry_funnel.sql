-- ---------------------------------------------------------------------------
-- 0100 — the enquiry funnel (run-first item 1 of the 16 October 2026 report
-- "Deeper upgrades across the Venviewer stack")
--
-- A booking-rate lift at one venue would need about 1,090 enquiries per arm to
-- detect, so the venue's value is judged on leading measures: hours to the
-- first substantive reply, show-rounds per booking, why bookings are lost,
-- how proposals are opened, and where enquiries come from. Nothing recorded
-- any of these. This migration adds six things, each inside the venue's
-- tenancy:
--
--   1. enquiries.first_response_at / _by / _channel / _recorded_at: the
--      earliest reply Venviewer knows of, who made it, how, and when Venviewer
--      learned of it. The four are set together or not at all; the reply is
--      never before the enquiry arrived nor after it was recorded. Filled here
--      from the replies Venviewer itself sent before today: the enquiry's
--      approval or decline (each emailed to the guest) and a proposal for it
--      marked sent. A reply sent outside Venviewer is not in any row, so it
--      waits for a person to report it.
--   2. proposal_share_tokens.first_viewed_at and view_count: the link's first
--      visit and how many visits it has had. last_viewed_at was overwritten
--      on every opening, so a link opened before today has neither known:
--      both stay NULL for it, never a guess. A link never opened counts from 0.
--   3. bookings kind 'viewing': a show-round. It belongs to an enquiry, never
--      to an event (bookings_viewing_has_no_event), so every event-scoped read
--      (the client's schedule, the hallkeeper sheet, supplier passes) is
--      unchanged by it.
--   4. bookings.lost_reason: why a booking was lost, from a short fixed list,
--      only ever on a lost booking.
--   5. enquiries.referrer_host, utm_source / _medium / _campaign / _term /
--      _content and acquisition_channel: where the person found the venue,
--      kept as the referring site's host and the cleaned UTM tags only. The
--      source check widens from five touchpoints to seven, adding a listing
--      site's own enquiry form and an AI assistant.
--   6. venue_engagement_events: a moment of interest (a 30-second walk of the
--      twin) attached to exactly one enquiry or proposal of the venue's, by
--      composite keys that pin it to that venue. Never a visitor who sent and
--      opened nothing: no device, address, cookie or session is stored.
--      Removed with its enquiry or proposal, and after 24 months by the
--      nightly cleanup in any case.
--
-- Additive for the release before it: that release writes none of the new
-- columns, and every new constraint holds for what it writes (it never makes
-- a viewing or names a lost reason). A link it opens after this applies keeps
-- view_count 0 with last_viewed_at set; this release reads that as a visit
-- before counting began and leaves both NULL rather than calling the next
-- visit the first.
--
-- Each constraint is looked for on its own table before it is added, so the
-- file runs again without changing anything. The whole file is one
-- transaction; a lock not had within ten seconds fails it and nothing changes.
-- ---------------------------------------------------------------------------

SET LOCAL lock_timeout = '10s';
--> statement-breakpoint

-- 1. The first substantive reply ---------------------------------------------
ALTER TABLE "enquiries" ADD COLUMN IF NOT EXISTS "first_response_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN IF NOT EXISTS "first_response_by" uuid;
--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN IF NOT EXISTS "first_response_channel" varchar(20);
--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN IF NOT EXISTS "first_response_recorded_at" timestamp with time zone;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enquiries_first_response_by_fk' AND conrelid = 'enquiries'::regclass) THEN
    ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_first_response_by_fk"
      FOREIGN KEY ("first_response_by") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enquiries_first_response_channel_check' AND conrelid = 'enquiries'::regclass) THEN
    ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_first_response_channel_check"
      CHECK ("first_response_channel" IS NULL OR "first_response_channel" IN
        ('email', 'phone', 'in_person', 'video_call', 'text_message', 'proposal', 'decision'));
  END IF;
  -- When, how and when it was recorded go together; who may be gone (the
  -- person deleted) but never names a reply that is not there.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enquiries_first_response_whole' AND conrelid = 'enquiries'::regclass) THEN
    ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_first_response_whole"
      CHECK (("first_response_at" IS NULL) = ("first_response_channel" IS NULL)
        AND ("first_response_at" IS NULL) = ("first_response_recorded_at" IS NULL)
        AND ("first_response_by" IS NULL OR "first_response_at" IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enquiries_first_response_order' AND conrelid = 'enquiries'::regclass) THEN
    ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_first_response_order"
      CHECK ("first_response_at" IS NULL
        OR ("first_response_at" >= "created_at" AND "first_response_at" <= "first_response_recorded_at"));
  END IF;
END $$;
--> statement-breakpoint
-- The replies Venviewer sent itself before today. A decision is the approve
-- or decline move (each emails the guest); a proposal is its first move to
-- sent, for the enquiry it carries or its deal's enquiry, at the same venue.
-- The earliest at or after the enquiry's arrival is kept; Venviewer knew of
-- each when it sent it, so it was recorded then.
WITH "replies" AS (
  SELECT h."enquiry_id", h."created_at" AS "at", h."changed_by" AS "by", 'decision'::varchar(20) AS "channel"
  FROM "enquiry_status_history" h
  WHERE h."to_status" IN ('approved', 'rejected')
  UNION ALL
  SELECT e."id", ph."created_at", ph."changed_by", 'proposal'::varchar(20)
  FROM "proposal_status_history" ph
  JOIN "proposals" p ON p."id" = ph."proposal_id"
  LEFT JOIN "opportunities" o ON o."id" = p."opportunity_id" AND o."venue_id" = p."venue_id"
  JOIN "enquiries" e ON e."id" = COALESCE(p."enquiry_id", o."source_enquiry_id") AND e."venue_id" = p."venue_id"
  WHERE ph."to_status" = 'sent'
), "earliest" AS (
  SELECT DISTINCT ON (r."enquiry_id") r."enquiry_id", r."at", r."by", r."channel"
  FROM "replies" r
  JOIN "enquiries" e ON e."id" = r."enquiry_id"
  WHERE r."at" >= e."created_at"
  ORDER BY r."enquiry_id", r."at", r."channel"
)
UPDATE "enquiries" SET
  "first_response_at" = "earliest"."at",
  "first_response_by" = "earliest"."by",
  "first_response_channel" = "earliest"."channel",
  "first_response_recorded_at" = "earliest"."at"
FROM "earliest"
WHERE "enquiries"."id" = "earliest"."enquiry_id" AND "enquiries"."first_response_at" IS NULL;
--> statement-breakpoint
-- The enquiries still waiting for a reply, oldest first: the reply-time alarm's read.
CREATE INDEX IF NOT EXISTS "enquiries_venue_unanswered_idx"
  ON "enquiries" ("venue_id", "created_at") WHERE "first_response_at" IS NULL;
--> statement-breakpoint

-- 2. Proposal link visits ------------------------------------------------------
ALTER TABLE "proposal_share_tokens" ADD COLUMN IF NOT EXISTS "first_viewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "proposal_share_tokens" ADD COLUMN IF NOT EXISTS "view_count" integer DEFAULT 0;
--> statement-breakpoint
-- Opened before today: its visits were never counted and its first is lost.
UPDATE "proposal_share_tokens" SET "view_count" = NULL, "first_viewed_at" = NULL
WHERE "last_viewed_at" IS NOT NULL AND "first_viewed_at" IS NULL AND "view_count" = 0;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proposal_share_tokens_views_known' AND conrelid = 'proposal_share_tokens'::regclass) THEN
    ALTER TABLE "proposal_share_tokens" ADD CONSTRAINT "proposal_share_tokens_views_known"
      CHECK (("view_count" IS NULL AND "first_viewed_at" IS NULL)
        OR ("view_count" = 0 AND "first_viewed_at" IS NULL)
        OR ("view_count" > 0 AND "first_viewed_at" IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proposal_share_tokens_first_view_order' AND conrelid = 'proposal_share_tokens'::regclass) THEN
    ALTER TABLE "proposal_share_tokens" ADD CONSTRAINT "proposal_share_tokens_first_view_order"
      CHECK ("first_viewed_at" IS NULL
        OR ("last_viewed_at" IS NOT NULL AND "first_viewed_at" <= "last_viewed_at"));
  END IF;
END $$;
--> statement-breakpoint

-- 3 and 4. Viewings and lost reasons -------------------------------------------
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "lost_reason" varchar(30);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_kind_check' AND conrelid = 'bookings'::regclass
      AND pg_get_constraintdef(oid) NOT LIKE '%viewing%') THEN
    ALTER TABLE "bookings" DROP CONSTRAINT "bookings_kind_check";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_kind_check' AND conrelid = 'bookings'::regclass) THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_kind_check"
      CHECK ("kind" IN ('prospect', 'hold', 'ink', 'internal_block', 'viewing'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_viewing_has_no_event' AND conrelid = 'bookings'::regclass) THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_viewing_has_no_event"
      CHECK ("kind" <> 'viewing' OR "event_id" IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_lost_reason_check' AND conrelid = 'bookings'::regclass) THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_lost_reason_check"
      CHECK ("lost_reason" IS NULL OR ("status" = 'lost' AND "lost_reason" IN
        ('price', 'date_taken', 'room_unsuitable', 'chose_elsewhere', 'plans_changed', 'no_reply', 'other')));
  END IF;
END $$;
--> statement-breakpoint

-- 5. Where an enquiry came from ------------------------------------------------
ALTER TABLE "enquiries" ADD COLUMN IF NOT EXISTS "referrer_host" varchar(253);
--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN IF NOT EXISTS "utm_source" varchar(100);
--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN IF NOT EXISTS "utm_medium" varchar(100);
--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN IF NOT EXISTS "utm_campaign" varchar(100);
--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN IF NOT EXISTS "utm_term" varchar(100);
--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN IF NOT EXISTS "utm_content" varchar(100);
--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN IF NOT EXISTS "acquisition_channel" varchar(20);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enquiries_source_check' AND conrelid = 'enquiries'::regclass
      AND pg_get_constraintdef(oid) NOT LIKE '%assistant%') THEN
    ALTER TABLE "enquiries" DROP CONSTRAINT "enquiries_source_check";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enquiries_source_check' AND conrelid = 'enquiries'::regclass) THEN
    ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_source_check"
      CHECK ("source" IS NULL OR "source" IN ('website', 'walkthrough', 'planner', 'phone', 'email', 'listing', 'assistant'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enquiries_acquisition_channel_check' AND conrelid = 'enquiries'::regclass) THEN
    ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_acquisition_channel_check"
      CHECK ("acquisition_channel" IS NULL OR "acquisition_channel" IN
        ('assistant', 'listing', 'paid', 'email', 'social', 'search', 'venue_website', 'referral', 'other', 'direct'));
  END IF;
  -- A referrer or a tag is kept only with the channel worked out from them.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enquiries_attribution_whole' AND conrelid = 'enquiries'::regclass) THEN
    ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_attribution_whole"
      CHECK ("acquisition_channel" IS NOT NULL OR ("referrer_host" IS NULL AND "utm_source" IS NULL
        AND "utm_medium" IS NULL AND "utm_campaign" IS NULL AND "utm_term" IS NULL AND "utm_content" IS NULL));
  END IF;
  -- The keys an engagement event pins itself to its enquiry's or proposal's venue by.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enquiries_id_venue_unique' AND conrelid = 'enquiries'::regclass) THEN
    ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_id_venue_unique" UNIQUE ("id", "venue_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proposals_id_venue_unique' AND conrelid = 'proposals'::regclass) THEN
    ALTER TABLE "proposals" ADD CONSTRAINT "proposals_id_venue_unique" UNIQUE ("id", "venue_id");
  END IF;
END $$;
--> statement-breakpoint

-- 6. Engagement attached to an enquiry or a proposal ---------------------------
CREATE TABLE IF NOT EXISTS "venue_engagement_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "kind" varchar(40) NOT NULL,
  "enquiry_id" uuid,
  "proposal_id" uuid,
  "space_id" uuid,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "venue_engagement_events_kind_check" CHECK ("kind" IN ('twin_walk_30s')),
  CONSTRAINT "venue_engagement_events_one_subject" CHECK (num_nonnulls("enquiry_id", "proposal_id") = 1),
  CONSTRAINT "venue_engagement_events_enquiry_venue_fk" FOREIGN KEY ("enquiry_id", "venue_id")
    REFERENCES "enquiries"("id", "venue_id") ON DELETE CASCADE,
  CONSTRAINT "venue_engagement_events_proposal_venue_fk" FOREIGN KEY ("proposal_id", "venue_id")
    REFERENCES "proposals"("id", "venue_id") ON DELETE CASCADE,
  CONSTRAINT "venue_engagement_events_space_venue_fk" FOREIGN KEY ("space_id", "venue_id")
    REFERENCES "spaces"("id", "venue_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venue_engagement_events_venue_recorded_idx" ON "venue_engagement_events" ("venue_id", "recorded_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venue_engagement_events_enquiry_idx" ON "venue_engagement_events" ("enquiry_id") WHERE "enquiry_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venue_engagement_events_proposal_idx" ON "venue_engagement_events" ("proposal_id", "kind", "recorded_at") WHERE "proposal_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "venue_engagement_events_space_idx" ON "venue_engagement_events" ("space_id") WHERE "space_id" IS NOT NULL;
