-- -----------------------------------------------------------------------------
-- 0012_configuration_reviews
--
-- Adds the review workflow to configurations. Review lifecycle is
-- ORTHOGONAL to the existing `state` column (draft/published): a config
-- can be state=draft + review_status=approved (approved but not yet
-- visible to guests) or state=published + review_status=draft (legacy
-- rows backfilled below).
--
-- Eight review statuses mirror the enquiry lifecycle with two additions:
--   - `changes_requested` — staff push back with notes; planner revises
--     and re-submits without losing history
--   - `withdrawn` — planner pulls their submission back (may be because
--     they noticed the error themselves)
--
-- The history table is structurally identical to `enquiry_status_history`
-- so both entities can be visualised with the same UI timeline
-- primitives on the web side.
--
-- Backfill policy: all existing rows get review_status='draft'. The
-- product currently has no published configurations in production
-- (confirmed 2026-04-18 — Blake default #7 on the pre-approved plan);
-- should that change, an operational backfill script can retroactively
-- create approval snapshots for historically-published rows.
-- -----------------------------------------------------------------------------

ALTER TABLE "configurations"
  ADD COLUMN IF NOT EXISTS "review_status" varchar(30) NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS "submitted_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "approved_by" uuid REFERENCES "users"("id"),
  ADD COLUMN IF NOT EXISTS "review_note" text;

-- Hot query: "what reviews are awaiting me at this venue?"
CREATE INDEX IF NOT EXISTS "configurations_venue_review_status_idx"
  ON "configurations" ("venue_id", "review_status");

-- Approval denormalisation invariant: both approval columns must be
-- populated together, or both null. Enforced at the DB level so a
-- malformed UPDATE from any service (migration script, admin panel,
-- test harness) can never leave the pair half-set.
ALTER TABLE "configurations"
  ADD CONSTRAINT "configurations_approval_cols_coherent"
  CHECK (
    ("approved_at" IS NULL AND "approved_by" IS NULL)
    OR ("approved_at" IS NOT NULL AND "approved_by" IS NOT NULL)
  );

CREATE TABLE IF NOT EXISTS "configuration_review_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "configuration_id" uuid NOT NULL REFERENCES "configurations"("id") ON DELETE CASCADE,
  "from_status" varchar(30) NOT NULL,
  "to_status" varchar(30) NOT NULL,
  "changed_by" uuid REFERENCES "users"("id"),
  "note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "config_review_history_config_idx"
  ON "configuration_review_history" ("configuration_id");
