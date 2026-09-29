-- ---------------------------------------------------------------------------
-- 0085 — proposal templates by room and occasion (T-635, X1; Tier B #16)
--
-- A booker writes the same Grand Hall wedding proposal many times a year. A
-- template keeps its message and quote lines, for a room (or any room) and an
-- occasion (or any occasion), so the next one starts from it instead of being
-- typed again.
--
-- A template holds no price. A line from the price list is kept as a
-- reference to the entry and priced from the live list each time the
-- template is used; a per-head line follows that event's guests; a typed
-- line keeps its words and asks for its price. The lines are validated by
-- the API (ProposalTemplateLineSchema) on every write and read; here they
-- are held to an array of at most 40.
--
-- The room belongs to the template's venue (the composite key, as 0076 did
-- for changeover rules). A removed template is kept, with who removed it and
-- when, so Remove can be undone; one live template per name at a venue,
-- whatever its case.
--
-- Schema first: no running code reads this table until the next release.
-- Its keys briefly hold writes to venues, users and spaces, which are rarely
-- written: a busy moment holds writes to those tables for up to ten seconds a
-- lock, then fails the deploy rather than holding them longer. Each
-- constraint is looked for on this table alone (as 0073 does), so a copy of
-- the table elsewhere in the same database, a test's own, never stops one
-- being added here.
-- ---------------------------------------------------------------------------

SET LOCAL lock_timeout = '10s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposal_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id"),
  "space_id" uuid,
  "occasion" varchar(100),
  "name" varchar(120) NOT NULL,
  "message" text NOT NULL DEFAULT '',
  "lines" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "deleted_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'proposal_templates_space_venue_fk' AND conrelid = to_regclass('proposal_templates')) THEN
    ALTER TABLE "proposal_templates" ADD CONSTRAINT "proposal_templates_space_venue_fk"
      FOREIGN KEY ("space_id", "venue_id") REFERENCES "spaces"("id", "venue_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'proposal_templates_name_shape' AND conrelid = to_regclass('proposal_templates')) THEN
    ALTER TABLE "proposal_templates" ADD CONSTRAINT "proposal_templates_name_shape"
      CHECK ("name" = btrim("name") AND "name" <> '');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'proposal_templates_occasion_shape' AND conrelid = to_regclass('proposal_templates')) THEN
    ALTER TABLE "proposal_templates" ADD CONSTRAINT "proposal_templates_occasion_shape"
      CHECK ("occasion" IS NULL OR ("occasion" = lower(btrim("occasion")) AND "occasion" <> ''));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'proposal_templates_message_length' AND conrelid = to_regclass('proposal_templates')) THEN
    ALTER TABLE "proposal_templates" ADD CONSTRAINT "proposal_templates_message_length"
      CHECK (char_length("message") <= 4000);
  END IF;
  -- CASE, not AND: jsonb_array_length raises on a non-array, and AND does
  -- not promise to test the type first.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'proposal_templates_lines_shape' AND conrelid = to_regclass('proposal_templates')) THEN
    ALTER TABLE "proposal_templates" ADD CONSTRAINT "proposal_templates_lines_shape"
      CHECK (CASE WHEN jsonb_typeof("lines") = 'array' THEN jsonb_array_length("lines") <= 40 ELSE false END);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'proposal_templates_not_empty' AND conrelid = to_regclass('proposal_templates')) THEN
    ALTER TABLE "proposal_templates" ADD CONSTRAINT "proposal_templates_not_empty"
      CHECK ("message" <> '' OR CASE WHEN jsonb_typeof("lines") = 'array' THEN jsonb_array_length("lines") > 0 ELSE false END);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'proposal_templates_removal' AND conrelid = to_regclass('proposal_templates')) THEN
    ALTER TABLE "proposal_templates" ADD CONSTRAINT "proposal_templates_removal"
      CHECK ("deleted_by" IS NULL OR "deleted_at" IS NOT NULL);
  END IF;
END
$constraints$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "proposal_templates_live_name"
  ON "proposal_templates" ("venue_id", lower("name"))
  WHERE "deleted_at" IS NULL;
