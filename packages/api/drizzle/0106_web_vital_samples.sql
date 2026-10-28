-- Field web vitals (goal 07; the cloud office-desk session, 28 October 2026).
-- 0106 is PROVISIONAL: 0103 and 0104 are taken and 0105 onward is reserved for
-- another lane (0105_decisions in #287). The release queue confirms the number
-- at the merge slot: renumber the tag AND the journal `when` so the migrator
-- orders it after everything merged first.
--
-- Goal 07 judges the front of house on Core Web Vitals at the 75th percentile
-- on production, by device class, and nothing recorded them. A sampled page
-- load sends its LCP, INP, CLS and TTFB once (POST /public/web-vitals, off
-- unless WEB_VITALS_COLLECTION=on), one row each: the route's pattern (never
-- the address opened, so no share token or layout id), a device class, the
-- value, its rating and how the page was reached. Nothing names or follows the
-- visitor. Rows go after 90 days (the nightly cleanup).
--
-- Additive only: one new table, no change to existing rows. The file is one
-- transaction; a failed statement leaves the database as it was.

CREATE TABLE IF NOT EXISTS "web_vital_samples" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL DEFAULT now(),
  "page" varchar(160) NOT NULL,
  "device" varchar(10) NOT NULL,
  "metric" varchar(8) NOT NULL,
  "value" double precision NOT NULL,
  "rating" varchar(20) NOT NULL,
  "navigation_type" varchar(24) NOT NULL,
  CONSTRAINT "web_vital_samples_page_shape" CHECK ("page" ~ '^/$|^(/([a-z][a-z-]{0,39}|:[A-Za-z]{1,40}|\*))+$'),
  CONSTRAINT "web_vital_samples_device_check" CHECK ("device" IN ('phone', 'tablet', 'desktop')),
  CONSTRAINT "web_vital_samples_metric_check" CHECK ("metric" IN ('LCP', 'INP', 'CLS', 'TTFB')),
  CONSTRAINT "web_vital_samples_rating_check" CHECK ("rating" IN ('good', 'needs-improvement', 'poor')),
  CONSTRAINT "web_vital_samples_navigation_check" CHECK ("navigation_type" IN ('navigate', 'reload', 'back-forward', 'back-forward-cache', 'prerender', 'restore', 'soft-navigation')),
  CONSTRAINT "web_vital_samples_value_check" CHECK ("value" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "web_vital_samples_metric_recorded_idx" ON "web_vital_samples" USING btree ("metric", "recorded_at");
