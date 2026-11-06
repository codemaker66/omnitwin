import { sql } from "drizzle-orm";
import {
  WEB_VITAL_P75_TARGETS,
  WEB_VITAL_RETENTION_DAYS,
  type WebVitalDeviceClass,
  type WebVitalName,
  type WebVitalsReport,
} from "@omnitwin/types";
import { webVitalSamples } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// Field web vitals (goal 07): the samples' one writer, their retention and
// their p75. docs/engineering/web-vitals.md says why collection is off until
// the privacy page describes it.
// ---------------------------------------------------------------------------

/**
 * Whether the server keeps what a browser reports of its page loads. Off
 * unless WEB_VITALS_COLLECTION is "on", which is set only once the privacy
 * page describes it and a visitor can object (PECR Schedule A1, as for the
 * enquiry funnel's browser signals; Blake, 19 October 2026). While off the
 * route answers 404 and keeps nothing, whatever a page sends.
 */
export function webVitalsCollectionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["WEB_VITALS_COLLECTION"] === "on";
}

/**
 * The most reports the server keeps in a day (UTC), from every source
 * together. Anyone can post a report, and the per-address limit alone would
 * let a handful of addresses fill the table for the 90 days it is kept. Set
 * well above what sampling one venue's pages should need; when it is reached
 * the rest of the day's reports are refused, and the sample rate is the lever.
 */
export const WEB_VITALS_DAILY_REPORT_CEILING = 5_000;

export interface DailyCeiling {
  /** Counts one more report today; false once the day's ceiling is reached. */
  readonly admit: () => boolean;
}

/** One server's count of the day's reports; it starts again at midnight UTC
 *  (and on a restart, which only ever lets fewer through in a day than two). */
export function createDailyCeiling(limit: number, now: () => number = Date.now): DailyCeiling {
  let day = Number.NaN;
  let count = 0;
  return {
    admit: () => {
      const today = Math.floor(now() / 86_400_000);
      if (today !== day) {
        day = today;
        count = 0;
      }
      if (count >= limit) return false;
      count += 1;
      return true;
    },
  };
}

/** One row per vital of a report. Returns how many were kept. */
export async function recordWebVitals(db: Database, report: WebVitalsReport): Promise<number> {
  const rows = await db.insert(webVitalSamples)
    .values(report.metrics.map((metric) => ({
      page: report.page,
      device: report.device,
      metric: metric.name,
      value: metric.value,
      rating: metric.rating,
      navigationType: metric.navigationType,
    })))
    .returning({ id: webVitalSamples.id });
  return rows.length;
}

/** The nightly retention pass: every sample older than
 *  WEB_VITAL_RETENTION_DAYS goes. Returns how many went. */
export async function removeExpiredWebVitalSamples(db: Database): Promise<number> {
  const removed = await db.delete(webVitalSamples)
    .where(sql`${webVitalSamples.recordedAt} < now() - make_interval(days => ${WEB_VITAL_RETENTION_DAYS})`)
    .returning({ id: webVitalSamples.id });
  return removed.length;
}

export interface WebVitalP75 {
  readonly metric: WebVitalName;
  readonly device: WebVitalDeviceClass;
  /** The route pattern, or null for every page of the device class together. */
  readonly page: string | null;
  readonly samples: number;
  readonly p75: number;
  /** Goal 07's target for the vital (TTFB: web.dev's "good" bound). */
  readonly target: number;
  readonly meetsTarget: boolean;
}

/**
 * The 75th percentile of each vital over the last `days`, by device class
 * across every page and by device class and page, as goal 07 judges them.
 * Read-only; the samples are a measure, not a guarantee (anyone can post one).
 */
export async function webVitalsP75(db: Database, days: number): Promise<WebVitalP75[]> {
  const v = webVitalSamples;
  const rows = await db.select({
    metric: v.metric,
    device: v.device,
    // NULL on the rows that group every page of a device class together.
    page: sql<string | null>`${v.page}`,
    samples: sql<number>`count(*)`.mapWith(Number),
    p75: sql<number>`percentile_cont(0.75) WITHIN GROUP (ORDER BY ${v.value})`.mapWith(Number),
  })
    .from(v)
    .where(sql`${v.recordedAt} >= now() - make_interval(days => ${days})`)
    .groupBy(sql`GROUPING SETS ((${v.metric}, ${v.device}), (${v.metric}, ${v.device}, ${v.page}))`)
    .orderBy(v.metric, v.device, sql`${v.page} NULLS FIRST`);
  return rows.map((row) => {
    const target = WEB_VITAL_P75_TARGETS[row.metric];
    return { ...row, target, meetsTarget: row.p75 <= target };
  });
}
