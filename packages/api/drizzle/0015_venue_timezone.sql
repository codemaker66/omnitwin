-- -----------------------------------------------------------------------------
-- 0015_venue_timezone
--
-- Adds `timezone` to the venues table — a per-venue IANA timezone
-- identifier that drives audit-timestamp rendering across the hallkeeper
-- sheet (PDF + tablet + emails).
--
-- Before this migration, renderers hardcoded 'Europe/London' (Trades
-- Hall Glasgow). When OMNITWIN onboards venues outside the UK, the
-- approval-stamp / footer timestamps need to reflect the venue's
-- local clock rather than the server's process locale.
--
-- Backfill: every existing row gets 'Europe/London' — matches prior
-- behavior for the flagship tenant. New venues created via
-- CreateVenueSchema also default to this value unless overridden.
-- -----------------------------------------------------------------------------

ALTER TABLE "venues"
  ADD COLUMN IF NOT EXISTS "timezone" varchar(100) NOT NULL DEFAULT 'Europe/London';
