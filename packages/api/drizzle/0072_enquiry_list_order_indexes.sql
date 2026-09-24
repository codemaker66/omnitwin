-- Newest-first enquiry lists within a venue.
--
-- The staff dashboard pages a venue's enquiries newest first
-- (GET /enquiries?order=created_desc: ORDER BY created_at DESC, id DESC with
-- LIMIT/OFFSET), for every status or one. enquiries_venue_state_idx finds a
-- venue's rows but not in that order, so each page read and sorted all of
-- them. EXPLAIN (ANALYZE, BUFFERS) on disposable PostgreSQL 16 with 20,000
-- enquiries in one venue among 120,000: a page went from 1,694 buffers to 28
-- unfiltered and from 1,673 to 23 for a common status. The state-led index is
-- needed as well: with the venue index alone the planner walked the whole
-- venue for a rare status (20,277 buffers for 12 rows); with both, 16.
--
-- Additive only: no rows, columns or constraints change. Drizzle runs the
-- migration in one transaction, so the builds are not concurrent and hold
-- enquiry writes while they run (89 ms and 145 ms at 120,000 rows in that
-- measurement). IF NOT EXISTS keeps a manual replay inert.
CREATE INDEX IF NOT EXISTS "enquiries_venue_created_idx" ON "enquiries" USING btree ("venue_id","created_at","id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enquiries_venue_state_created_idx" ON "enquiries" USING btree ("venue_id","state","created_at","id");
