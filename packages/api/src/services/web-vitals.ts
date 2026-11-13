import { createHmac, randomBytes } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
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
 * The most reports one server process keeps in a day (UTC), from every source
 * together. Anyone can post a report, and the per-address limit alone would
 * let a handful of addresses fill the table for the 90 days it is kept. Set
 * well above what sampling one venue's pages should need; when it is reached
 * the rest of the day's reports are refused, and the sample rate is the lever.
 */
export const WEB_VITALS_DAILY_REPORT_CEILING = 5_000;

/** A place under the day's ceiling: the UTC day it was taken on. */
export type CeilingPlace = number;

export interface DailyCeiling {
  /** Takes one of today's places for a report: the place, or null once they
   *  are all taken. */
  readonly admit: () => CeilingPlace | null;
  /** Gives back the place of a report that was not kept (its insert failed).
   *  A place taken on an earlier day went with that day's count. */
  readonly release: (place: CeilingPlace) => void;
}

/**
 * This process's count of the day's reports, from midnight UTC. Each process
 * counts for itself and from nothing: a restart (every deploy) starts the
 * day's count again, and each replica keeps its own, so a day can keep up to
 * the ceiling once for every process that ran that day. A report holds its
 * place only if it is kept: a failed insert gives it back.
 */
export function createDailyCeiling(limit: number, now: () => number = Date.now): DailyCeiling {
  let day = Number.NaN;
  let count = 0;
  const rollOver = (): void => {
    const today = Math.floor(now() / 86_400_000);
    if (today !== day) {
      day = today;
      count = 0;
    }
  };
  return {
    admit: () => {
      rollOver();
      if (count >= limit) return null;
      count += 1;
      return day;
    },
    release: (place) => {
      rollOver();
      // Yesterday's place went with yesterday's count: giving it back after
      // midnight must free none of today's.
      if (place === day && count > 0) count -= 1;
    },
  };
}

/** How often the per-address limiter's secret is replaced (createAddressKey). */
export const WEB_VITALS_ADDRESS_KEY_ROTATION_MS = 10 * 60_000;

export interface AddressKey {
  /** The limiter's key for an address, which never contains the address. */
  readonly keyFor: (address: string) => string;
  /** Replaces the secret, after which no earlier key leads back to an address. */
  readonly rotate: () => void;
}

/**
 * The per-address limiter's key without the address: an HMAC of it under a
 * secret held only in memory. The limiter needs one key per address within a
 * minute's window; once the secret is replaced (every ten minutes, by the
 * route) no key it stored can be traced back to an address. So the address is
 * used briefly and in memory only, as the privacy page says, rather than kept
 * as the limiter's key until newer ones push it out. The global limiter keys
 * every other route by `ip:<address>`; this route's own key overrides it.
 */
export function createAddressKey(secret: () => Buffer = () => randomBytes(32)): AddressKey {
  let current = secret();
  return {
    keyFor: (address) => `web-vitals:${createHmac("sha256", current).update(address).digest("base64url")}`,
    rotate: () => { current = secret(); },
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
 * Where a window of the last `days` UTC days begins, today included: the UTC
 * midnight `days - 1` days before today's. Counted in hours: an interval of
 * days follows the session's time zone, so across a change of clocks it would
 * start an hour off midnight and drop (or add) a whole day of rows, which are
 * stored at UTC midnight.
 */
export function webVitalsWindowStart(days: number, now: SQL = sql`now()`): SQL {
  return sql`date_trunc('day', ${now}, 'UTC') - make_interval(hours => ${24 * (days - 1)})`;
}

/**
 * The 75th percentile of each vital over the last `days` UTC days, today
 * included (a row keeps only its day, so a window of "the last 28 days" is
 * today and the 27 whole days before it), by device class across every page
 * and by device class and page, as goal 07 judges them. Read-only; the
 * samples are a measure, not a guarantee (anyone can post one).
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
    .where(sql`${v.recordedAt} >= ${webVitalsWindowStart(days)}`)
    .groupBy(sql`GROUPING SETS ((${v.metric}, ${v.device}), (${v.metric}, ${v.device}, ${v.page}))`)
    .orderBy(v.metric, v.device, sql`${v.page} NULLS FIRST`);
  return rows.map((row) => {
    const target = WEB_VITAL_P75_TARGETS[row.metric];
    return { ...row, target, meetsTarget: row.p75 <= target };
  });
}
