-- Pricing rule windows (goal 19 S6, T-651).
--
-- A pricing rule may now state the time of day it is for. Until now every
-- active rule for a room was added to every estimate for that room, so a
-- Grand Hall evening was priced as half day + full day + evening together.
--
-- Additive only: two nullable columns. A rule with no window keeps today's
-- behaviour. Windows are filled in ONLY from what each rule's own name
-- states, in the venue's price-sheet form "HH:MM–HH:MM" (en dash or hyphen):
--   one window in the name  -> that window
--   two windows joined by " or " -> two rules, one per window, the names
--                                   rewritten to state one window each
--   anything else           -> null, and the office is told
-- Nothing already issued changes: quote lines carry their own description
-- and amounts, and proposal versions are immutable snapshots. Only new
-- calculations read the windows.
--
-- The whole file is one transaction: a failed statement leaves the table as
-- it was.

ALTER TABLE "pricing_rules" ADD COLUMN "applies_from" time;
--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD COLUMN "applies_until" time;
--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_window_pair_check"
  CHECK (("applies_from" IS NULL) = ("applies_until" IS NULL));
--> statement-breakpoint

-- Two windows joined by " or ": the second window becomes a sibling rule
-- (same venue, room, type, amount, currency, limits, validity and state),
-- named for its own window.
INSERT INTO "pricing_rules" (
  "venue_id", "space_id", "name", "type", "amount", "currency",
  "min_hours", "min_guests", "tiers", "day_of_week_modifiers", "seasonal_modifiers",
  "valid_from", "valid_to", "is_active", "deleted_at", "created_at", "updated_at",
  "applies_from", "applies_until"
)
SELECT
  r."venue_id", r."space_id",
  regexp_replace(r."name", '\((\d{2}:\d{2})[–-](\d{2}:\d{2}) or (\d{2}:\d{2})[–-](\d{2}:\d{2})\)', '(\3–\4)'),
  r."type", r."amount", r."currency",
  r."min_hours", r."min_guests", r."tiers", r."day_of_week_modifiers", r."seasonal_modifiers",
  r."valid_from", r."valid_to", r."is_active", r."deleted_at", r."created_at", now(),
  (regexp_match(r."name", '\((\d{2}:\d{2})[–-](\d{2}:\d{2}) or (\d{2}:\d{2})[–-](\d{2}:\d{2})\)'))[3]::time,
  (regexp_match(r."name", '\((\d{2}:\d{2})[–-](\d{2}:\d{2}) or (\d{2}:\d{2})[–-](\d{2}:\d{2})\)'))[4]::time
FROM "pricing_rules" r
WHERE r."applies_from" IS NULL
  AND r."name" ~ '\(\d{2}:\d{2}[–-]\d{2}:\d{2} or \d{2}:\d{2}[–-]\d{2}:\d{2}\)';
--> statement-breakpoint

-- ...and the original keeps the first window, named for it.
UPDATE "pricing_rules" r SET
  "applies_from" = (regexp_match(r."name", '\((\d{2}:\d{2})[–-](\d{2}:\d{2}) or (\d{2}:\d{2})[–-](\d{2}:\d{2})\)'))[1]::time,
  "applies_until" = (regexp_match(r."name", '\((\d{2}:\d{2})[–-](\d{2}:\d{2}) or (\d{2}:\d{2})[–-](\d{2}:\d{2})\)'))[2]::time,
  "name" = regexp_replace(r."name", '\((\d{2}:\d{2})[–-](\d{2}:\d{2}) or (\d{2}:\d{2})[–-](\d{2}:\d{2})\)', '(\1–\2)'),
  "updated_at" = now()
WHERE r."applies_from" IS NULL
  AND r."name" ~ '\(\d{2}:\d{2}[–-]\d{2}:\d{2} or \d{2}:\d{2}[–-]\d{2}:\d{2}\)';
--> statement-breakpoint

-- Exactly one window in the name: that window. A name with a window outside
-- the "(HH:MM–HH:MM)" form, or more than one not joined by " or ", stays null.
UPDATE "pricing_rules" r SET
  "applies_from" = (regexp_match(r."name", '\((\d{2}:\d{2})[–-](\d{2}:\d{2})\)'))[1]::time,
  "applies_until" = (regexp_match(r."name", '\((\d{2}:\d{2})[–-](\d{2}:\d{2})\)'))[2]::time,
  "updated_at" = now()
WHERE r."applies_from" IS NULL
  AND r."name" ~ '\(\d{2}:\d{2}[–-]\d{2}:\d{2}\)'
  AND (SELECT count(*) FROM regexp_matches(r."name", '\d{2}:\d{2}[–-]\d{2}:\d{2}', 'g')) = 1;
