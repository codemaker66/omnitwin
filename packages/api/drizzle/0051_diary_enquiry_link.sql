-- -----------------------------------------------------------------------------
-- 0051_diary_enquiry_link
--
-- Enquiry→hold conversion provenance (T-496; Canon §12 P0 "enquiry→hold").
-- A booking pencilled in from an enquiry keeps a nullable link back to it so
-- the client journey (Canon §6) can trace where a pencil came from. Strictly
-- additive; the enquiry's own lifecycle is untouched by conversion — the
-- commitment axis and the enquiry axis stay independent (Canon §1).
-- -----------------------------------------------------------------------------

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "enquiry_id" uuid REFERENCES "enquiries"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "bookings_enquiry_idx" ON "bookings" ("enquiry_id");
