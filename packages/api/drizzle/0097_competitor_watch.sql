-- ---------------------------------------------------------------------------
-- 0095 — the competitor watch (Blake approved the proposal, 17 October 2026)
--
-- A dated notebook beside the Pricing desk, never a pricing input. Four
-- tables, every row one venue's own, every child bound to its venue by a
-- composite key so one venue's watch can never point into another's:
--
--   competitor_venues          the comp set: name, website, the page a change
--                              check may read, primary or secondary, the
--                              reason it is in the set (required), a review
--                              date, who recorded that the site's terms and
--                              robots.txt allow the check, and the check's
--                              last hash and date. Removed venues are kept,
--                              with who removed them, so their captures and
--                              lost deals keep their name.
--   competitor_price_captures  one figure a person saw on a competitor's own
--                              page or brochure: where, when, who, the
--                              package, its basis, guests, year, inclusions
--                              and VAT. Append-only, enforced here: a row is
--                              never deleted and never edited, except once to
--                              mark its source gone. A newer capture names
--                              the one it replaces (at most one replacement
--                              each, same competitor, same venue).
--   competitor_page_checks     every check the page-change alert ran: when,
--                              the address, what robots.txt said, the HTTP
--                              status and a SHA-256 of the page's text. Never
--                              the page itself, never a price.
--   competitor_losses          who won a deal marked lost, written with the
--                              stage move that holds the reason: a venue in
--                              the set or another by name, and any figure the
--                              client volunteered, which is the client's
--                              report, unverified.
--
-- Nothing reads these tables to set or suggest a price
-- (services/pricing-advice.ts and pricing-desk-data.ts never name them; a
-- test keeps it so). No query joins one venue's watch to another's.
--
-- Schema only: no running code reads these tables until the release that
-- ships them. Its keys briefly hold writes to venues, users, files,
-- opportunities and their history; a busy moment fails the deploy after ten
-- seconds a lock rather than holding writes longer. Each constraint is
-- looked for on its own table (as 0085 does), so re-running the file changes
-- nothing.
-- ---------------------------------------------------------------------------

SET LOCAL lock_timeout = '10s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "competitor_venues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "name" varchar(160) NOT NULL,
  "website" text,
  "price_page_url" text,
  "tier" varchar(10) NOT NULL,
  "reason" text NOT NULL,
  "review_due_on" date NOT NULL,
  "reviewed_at" timestamp with time zone,
  "reviewed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "checks_allowed_at" timestamp with time zone,
  "checks_allowed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "page_hash" char(64),
  "page_checked_at" timestamp with time zone,
  "page_check_outcome" varchar(20),
  "page_check_status" integer,
  "page_changed_at" timestamp with time zone,
  "page_change_dismissed_at" timestamp with time zone,
  "page_change_dismissed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "next_check_after" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "removed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "removed_at" timestamp with time zone
);
--> statement-breakpoint
DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_venues_id_venue' AND conrelid = to_regclass('competitor_venues')) THEN
    ALTER TABLE "competitor_venues" ADD CONSTRAINT "competitor_venues_id_venue" UNIQUE ("id", "venue_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_venues_tier' AND conrelid = to_regclass('competitor_venues')) THEN
    ALTER TABLE "competitor_venues" ADD CONSTRAINT "competitor_venues_tier"
      CHECK ("tier" IN ('primary', 'secondary'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_venues_name_shape' AND conrelid = to_regclass('competitor_venues')) THEN
    ALTER TABLE "competitor_venues" ADD CONSTRAINT "competitor_venues_name_shape"
      CHECK ("name" = btrim("name") AND "name" <> '');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_venues_reason_shape' AND conrelid = to_regclass('competitor_venues')) THEN
    ALTER TABLE "competitor_venues" ADD CONSTRAINT "competitor_venues_reason_shape"
      CHECK (btrim("reason") <> '' AND char_length("reason") <= 400);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_venues_check_permission' AND conrelid = to_regclass('competitor_venues')) THEN
    ALTER TABLE "competitor_venues" ADD CONSTRAINT "competitor_venues_check_permission"
      CHECK ("checks_allowed_by" IS NULL OR "checks_allowed_at" IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_venues_check_outcome' AND conrelid = to_regclass('competitor_venues')) THEN
    ALTER TABLE "competitor_venues" ADD CONSTRAINT "competitor_venues_check_outcome"
      CHECK ("page_check_outcome" IS NULL OR "page_check_outcome" IN
        ('first_seen', 'unchanged', 'changed', 'robots_disallowed', 'refused', 'not_found', 'moved', 'failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_venues_page_hash_shape' AND conrelid = to_regclass('competitor_venues')) THEN
    ALTER TABLE "competitor_venues" ADD CONSTRAINT "competitor_venues_page_hash_shape"
      CHECK ("page_hash" IS NULL OR "page_hash" ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_venues_removal' AND conrelid = to_regclass('competitor_venues')) THEN
    ALTER TABLE "competitor_venues" ADD CONSTRAINT "competitor_venues_removal"
      CHECK ("removed_by" IS NULL OR "removed_at" IS NOT NULL);
  END IF;
END
$constraints$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "competitor_venues_live_name"
  ON "competitor_venues" ("venue_id", lower("name"))
  WHERE "removed_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "competitor_venues_due_check"
  ON "competitor_venues" ("next_check_after")
  WHERE "removed_at" IS NULL AND "checks_allowed_at" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "competitor_price_captures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "competitor_id" uuid NOT NULL,
  "source_url" text NOT NULL,
  "source_kind" varchar(12) NOT NULL,
  "seen_on" date NOT NULL,
  "captured_by" uuid NOT NULL REFERENCES "users"("id"),
  "captured_at" timestamp with time zone NOT NULL DEFAULT now(),
  "package_name" varchar(160) NOT NULL,
  "amount_minor" integer NOT NULL,
  "currency" char(3) NOT NULL DEFAULT 'GBP',
  "price_basis" varchar(10) NOT NULL,
  "guests" integer,
  "price_year" smallint,
  "includes" text[] NOT NULL DEFAULT '{}'::text[],
  "includes_note" text,
  "vat" varchar(12) NOT NULL,
  "evidence_file_id" uuid REFERENCES "files"("id"),
  "note" text,
  "supersedes_id" uuid,
  "source_gone_at" timestamp with time zone,
  "source_gone_by" uuid REFERENCES "users"("id")
);
--> statement-breakpoint
DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_price_captures_competitor_venue' AND conrelid = to_regclass('competitor_price_captures')) THEN
    ALTER TABLE "competitor_price_captures" ADD CONSTRAINT "competitor_price_captures_competitor_venue"
      FOREIGN KEY ("competitor_id", "venue_id") REFERENCES "competitor_venues"("id", "venue_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_price_captures_identity' AND conrelid = to_regclass('competitor_price_captures')) THEN
    ALTER TABLE "competitor_price_captures" ADD CONSTRAINT "competitor_price_captures_identity"
      UNIQUE ("id", "competitor_id", "venue_id");
  END IF;
  -- A replacement names a capture of the same competitor at the same venue.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_price_captures_supersedes' AND conrelid = to_regclass('competitor_price_captures')) THEN
    ALTER TABLE "competitor_price_captures" ADD CONSTRAINT "competitor_price_captures_supersedes"
      FOREIGN KEY ("supersedes_id", "competitor_id", "venue_id")
      REFERENCES "competitor_price_captures"("id", "competitor_id", "venue_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_price_captures_not_self' AND conrelid = to_regclass('competitor_price_captures')) THEN
    ALTER TABLE "competitor_price_captures" ADD CONSTRAINT "competitor_price_captures_not_self"
      CHECK ("supersedes_id" IS NULL OR "supersedes_id" <> "id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_price_captures_source_kind' AND conrelid = to_regclass('competitor_price_captures')) THEN
    ALTER TABLE "competitor_price_captures" ADD CONSTRAINT "competitor_price_captures_source_kind"
      CHECK ("source_kind" IN ('own_page', 'brochure'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_price_captures_basis' AND conrelid = to_regclass('competitor_price_captures')) THEN
    ALTER TABLE "competitor_price_captures" ADD CONSTRAINT "competitor_price_captures_basis"
      CHECK ("price_basis" IN ('per_head', 'fixed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_price_captures_vat' AND conrelid = to_regclass('competitor_price_captures')) THEN
    ALTER TABLE "competitor_price_captures" ADD CONSTRAINT "competitor_price_captures_vat"
      CHECK ("vat" IN ('included', 'excluded', 'not_stated'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_price_captures_figures' AND conrelid = to_regclass('competitor_price_captures')) THEN
    ALTER TABLE "competitor_price_captures" ADD CONSTRAINT "competitor_price_captures_figures"
      CHECK ("amount_minor" > 0
        AND "currency" ~ '^[A-Z]{3}$'
        AND ("guests" IS NULL OR "guests" BETWEEN 1 AND 5000)
        AND ("price_year" IS NULL OR "price_year" BETWEEN 2000 AND 2100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_price_captures_includes' AND conrelid = to_regclass('competitor_price_captures')) THEN
    ALTER TABLE "competitor_price_captures" ADD CONSTRAINT "competitor_price_captures_includes"
      CHECK ("includes" <@ ARRAY['room_hire', 'catering', 'drinks', 'evening_food', 'ceremony_room', 'entertainment', 'accommodation']::text[]);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_price_captures_words' AND conrelid = to_regclass('competitor_price_captures')) THEN
    ALTER TABLE "competitor_price_captures" ADD CONSTRAINT "competitor_price_captures_words"
      CHECK ("package_name" = btrim("package_name") AND "package_name" <> ''
        AND char_length("source_url") <= 2000
        AND ("includes_note" IS NULL OR char_length("includes_note") <= 400)
        AND ("note" IS NULL OR char_length("note") <= 1000));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_price_captures_source_gone' AND conrelid = to_regclass('competitor_price_captures')) THEN
    ALTER TABLE "competitor_price_captures" ADD CONSTRAINT "competitor_price_captures_source_gone"
      CHECK ("source_gone_by" IS NULL OR "source_gone_at" IS NOT NULL);
  END IF;
END
$constraints$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "competitor_price_captures_replaced_once"
  ON "competitor_price_captures" ("supersedes_id")
  WHERE "supersedes_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "competitor_price_captures_venue_competitor"
  ON "competitor_price_captures" ("venue_id", "competitor_id", "captured_at");
--> statement-breakpoint
-- Append-only, held by the database: a capture is never deleted, and never
-- changed except once, to record that its source has gone.
CREATE OR REPLACE FUNCTION "competitor_price_captures_append_only"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'competitor_price_captures is append-only: a capture is replaced by a newer one, never deleted';
  END IF;
  IF OLD."source_gone_at" IS NOT NULL
    OR (to_jsonb(NEW) - 'source_gone_at' - 'source_gone_by') IS DISTINCT FROM (to_jsonb(OLD) - 'source_gone_at' - 'source_gone_by') THEN
    RAISE EXCEPTION 'competitor_price_captures is append-only: only an unmarked source may be marked gone';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "competitor_price_captures_append_only" ON "competitor_price_captures";
--> statement-breakpoint
CREATE TRIGGER "competitor_price_captures_append_only"
  BEFORE UPDATE OR DELETE ON "competitor_price_captures"
  FOR EACH ROW EXECUTE FUNCTION "competitor_price_captures_append_only"();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "competitor_page_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "competitor_id" uuid NOT NULL,
  "checked_at" timestamp with time zone NOT NULL DEFAULT now(),
  "url" text NOT NULL,
  "robots" varchar(12) NOT NULL,
  "outcome" varchar(20) NOT NULL,
  "http_status" integer,
  "content_hash" char(64),
  "run_by" varchar(10) NOT NULL,
  "triggered_by" uuid REFERENCES "users"("id") ON DELETE SET NULL
);
--> statement-breakpoint
DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_page_checks_competitor_venue' AND conrelid = to_regclass('competitor_page_checks')) THEN
    ALTER TABLE "competitor_page_checks" ADD CONSTRAINT "competitor_page_checks_competitor_venue"
      FOREIGN KEY ("competitor_id", "venue_id") REFERENCES "competitor_venues"("id", "venue_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_page_checks_robots' AND conrelid = to_regclass('competitor_page_checks')) THEN
    ALTER TABLE "competitor_page_checks" ADD CONSTRAINT "competitor_page_checks_robots"
      CHECK ("robots" IN ('allowed', 'disallowed', 'unreadable'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_page_checks_outcome' AND conrelid = to_regclass('competitor_page_checks')) THEN
    ALTER TABLE "competitor_page_checks" ADD CONSTRAINT "competitor_page_checks_outcome"
      CHECK ("outcome" IN ('first_seen', 'unchanged', 'changed', 'robots_disallowed', 'refused', 'not_found', 'moved', 'failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_page_checks_hash_shape' AND conrelid = to_regclass('competitor_page_checks')) THEN
    ALTER TABLE "competitor_page_checks" ADD CONSTRAINT "competitor_page_checks_hash_shape"
      CHECK ("content_hash" IS NULL OR "content_hash" ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_page_checks_run_by' AND conrelid = to_regclass('competitor_page_checks')) THEN
    ALTER TABLE "competitor_page_checks" ADD CONSTRAINT "competitor_page_checks_run_by"
      CHECK ("run_by" IN ('person', 'schedule'));
  END IF;
END
$constraints$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "competitor_page_checks_competitor"
  ON "competitor_page_checks" ("competitor_id", "checked_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "competitor_losses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "opportunity_id" uuid NOT NULL REFERENCES "opportunities"("id") ON DELETE CASCADE,
  "status_history_id" uuid NOT NULL REFERENCES "opportunity_status_history"("id") ON DELETE CASCADE,
  "competitor_id" uuid,
  "other_name" varchar(160),
  "client_figure_minor" integer,
  "client_figure_basis" varchar(10),
  "currency" char(3) NOT NULL DEFAULT 'GBP',
  "recorded_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "recorded_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_losses_competitor_venue' AND conrelid = to_regclass('competitor_losses')) THEN
    ALTER TABLE "competitor_losses" ADD CONSTRAINT "competitor_losses_competitor_venue"
      FOREIGN KEY ("competitor_id", "venue_id") REFERENCES "competitor_venues"("id", "venue_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_losses_one_move' AND conrelid = to_regclass('competitor_losses')) THEN
    ALTER TABLE "competitor_losses" ADD CONSTRAINT "competitor_losses_one_move" UNIQUE ("status_history_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_losses_one_winner' AND conrelid = to_regclass('competitor_losses')) THEN
    ALTER TABLE "competitor_losses" ADD CONSTRAINT "competitor_losses_one_winner"
      CHECK (("competitor_id" IS NULL) <> ("other_name" IS NULL)
        AND ("other_name" IS NULL OR ("other_name" = btrim("other_name") AND "other_name" <> '')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'competitor_losses_client_figure' AND conrelid = to_regclass('competitor_losses')) THEN
    ALTER TABLE "competitor_losses" ADD CONSTRAINT "competitor_losses_client_figure"
      CHECK (("client_figure_minor" IS NULL) = ("client_figure_basis" IS NULL)
        AND ("client_figure_minor" IS NULL OR "client_figure_minor" > 0)
        AND ("client_figure_basis" IS NULL OR "client_figure_basis" IN ('per_head', 'fixed'))
        AND "currency" ~ '^[A-Z]{3}$');
  END IF;
END
$constraints$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "competitor_losses_venue_competitor"
  ON "competitor_losses" ("venue_id", "competitor_id", "recorded_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "competitor_losses_opportunity"
  ON "competitor_losses" ("opportunity_id");
--> statement-breakpoint

-- The ten-second lock limit was for this file alone (as 0090 does); anything
-- after it in the same migration run waits as the migrator itself allows.
SET LOCAL lock_timeout TO DEFAULT;
