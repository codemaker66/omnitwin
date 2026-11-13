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
-- value and its rating. How the page was reached is not kept (dropped on
-- 12 November: the privacy page does not mention it). Nothing names or follows
-- the visitor. A row keeps only the day it arrived (the UTC day, whatever the
-- session's time zone), not the moment. The day alone would leave row order,
-- each row's inserting transaction id (xmin, which any reader of the table can
-- see) and the database's restore history following arrival, so the API
-- writes rows in shuffled hourly batches of at least ten reports of one device
-- class, day and set of vitals, one transaction each (createWebVitalsBatch),
-- and no row can be paired with a hosting provider's request log. Rows go
-- after 90 days (the nightly cleanup); the index beside the key, on the day,
-- serves that cleanup and the p75 report.
--
-- Additive only: one new table, no change to existing rows. The file is one
-- transaction; a failed statement leaves the database as it was.

CREATE TABLE IF NOT EXISTS "web_vital_samples" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL DEFAULT date_trunc('day', now(), 'UTC'),
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
CREATE INDEX IF NOT EXISTS "web_vital_samples_recorded_idx" ON "web_vital_samples" USING btree ("recorded_at");
