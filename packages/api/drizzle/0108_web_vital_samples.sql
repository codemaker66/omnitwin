-- Field web vitals (goal 07; the cloud office-desk session, 28 October 2026).
-- Written as 0106; renumbered 0108 (journal idx 105) at its merge slot on
-- 12 November 2026, after 0107, with a `when` later than every entry merged
-- before it, so the migrator does not skip it.
--
-- Goal 07 judges the front of house on Core Web Vitals at the 75th percentile
-- on production, by device class, and nothing recorded them. A sampled page
-- load sends its LCP, INP, CLS and TTFB once (POST /public/web-vitals, off
-- unless WEB_VITALS_COLLECTION=on), one row each: the route's pattern (never
-- the address opened, so no share token or layout id), a device class, the
-- value and its rating, and nothing the privacy page does not name (how the
-- page was reached was dropped on 12 November). Nothing names or follows the
-- visitor. A row keeps the day it arrived, not the moment, so it cannot be
-- matched to a hosting provider's request log by time. Rows go after 90 days
-- (the nightly cleanup).
--
-- Additive only: one new table, no change to existing rows. The file is one
-- transaction; a failed statement leaves the database as it was.

CREATE TABLE IF NOT EXISTS "web_vital_samples" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL DEFAULT date_trunc('day', now()),
  "page" varchar(160) NOT NULL,
  "device" varchar(10) NOT NULL,
  "metric" varchar(8) NOT NULL,
  "value" double precision NOT NULL,
  "rating" varchar(20) NOT NULL,
  CONSTRAINT "web_vital_samples_page_shape" CHECK ("page" ~ '^/$|^(/([a-z][a-z-]{0,39}|:[A-Za-z]{1,40}|\*))+$'),
  CONSTRAINT "web_vital_samples_device_check" CHECK ("device" IN ('phone', 'tablet', 'desktop')),
  CONSTRAINT "web_vital_samples_metric_check" CHECK ("metric" IN ('LCP', 'INP', 'CLS', 'TTFB')),
  CONSTRAINT "web_vital_samples_rating_check" CHECK ("rating" IN ('good', 'needs-improvement', 'poor')),
  CONSTRAINT "web_vital_samples_value_check" CHECK ("value" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "web_vital_samples_metric_recorded_idx" ON "web_vital_samples" USING btree ("metric", "recorded_at");
