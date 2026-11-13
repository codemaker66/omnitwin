import { createHmac, randomBytes, randomInt as cryptoRandomInt } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import {
  WEB_VITAL_P75_TARGETS,
  WEB_VITAL_RETENTION_DAYS,
  stepWebVitalSample,
  type WebVitalDeviceClass,
  type WebVitalName,
  type WebVitalRating,
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
  /** Gives back the place of a report none of whose samples was kept (its
   *  batch was refused, or every group it joined fell short). A place taken
   *  on an earlier day went with that day's count. */
  readonly release: (place: CeilingPlace) => void;
}

/**
 * This process's count of the day's reports, from midnight UTC. Each process
 * counts for itself and from nothing: a restart (every deploy) starts the
 * day's count again, and each replica keeps its own, so a day can keep up to
 * the ceiling once for every process that ran that day. A report holds its
 * place only if something of it is kept: once none of its samples was written
 * and none still can be, the place is given back.
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

/**
 * The fewest samples of one group a batch is written with (Blake, 13 November
 * 2026: shuffled hourly batches). A group is one vital of one page, one device
 * class and one UTC day: everything a stored row and the host's request log
 * can both tell apart. The page: a share page's own API call, logged with its
 * token just before the report, names it. The device class: a user agent says
 * roughly which. The day: each row keeps it. The vital: CLS comes only from
 * Chromium, so a lone Android phone's CLS among iPhones' samples would be its
 * batch's only CLS row. Below its vital's step a value says nothing
 * (WEB_VITAL_STEPS: a clock's precision names its engine), and every report
 * is sent at one size (WEB_VITALS_REPORT_BYTES), so the log's byte counts say
 * nothing either. With at least this many in every group written, a row can
 * be narrowed, on what it shares with that log, only to that many samples,
 * short of the residuals docs/engineering/web-vitals.md names (values rare in
 * their group, which values go together). A row carries nothing that joins it
 * to the other vitals of its report, so a report's samples may be written
 * apart. Samples, not people: one visitor's repeated loads, or reports posted
 * on purpose to fill a group, count as many.
 */
export const WEB_VITALS_BATCH_MIN_SAMPLES = 10;

/** How often the route writes the held samples (and once more as it closes). */
export const WEB_VITALS_BATCH_EVERY_MS = 60 * 60_000;

/** How long a flush waits for the write before it, and for its own, and the
 *  database's bound on each statement: well inside the API's 25-second
 *  shutdown grace. */
export const WEB_VITALS_BATCH_WRITE_TIMEOUT_MS = 15_000;

/** Rows per insert statement: PostgreSQL takes at most 65,535 bind
 *  parameters, and a row has six. */
const BATCH_INSERT_ROWS = 5_000;

const DAY_MS = 86_400_000;

/** A report taken in: its place under the day's ceiling (the UTC day it
 *  arrived), and how its samples have fared. */
interface Admitted {
  readonly place: CeilingPlace;
  /** Its samples not yet written, dropped or refused. */
  open: number;
  /** Whether one of its samples was written. */
  kept: boolean;
}

interface HeldSample {
  readonly from: Admitted;
  readonly page: WebVitalsReport["page"];
  readonly device: WebVitalDeviceClass;
  readonly name: WebVitalName;
  /** On its vital's step, with the rating that value earns (stepWebVitalSample). */
  readonly value: number;
  readonly rating: WebVitalRating;
}

interface HeldGroup {
  /** The UTC day its samples arrived (a day number). */
  readonly day: CeilingPlace;
  readonly samples: HeldSample[];
}

/** One vital of one page, one device class and one arrival day
 *  (WEB_VITALS_BATCH_MIN_SAMPLES). */
function groupOf(page: string, device: WebVitalDeviceClass, day: CeilingPlace, name: WebVitalName): string {
  return `${page}|${device}|${String(day)}|${name}`;
}

export interface WebVitalsBatch {
  /** Holds a report's samples, each on its vital's step and without anything
   *  about who sent it, until their batches are written. False once the
   *  day's ceiling is reached: nothing is held. */
  readonly hold: (report: WebVitalsReport) => boolean;
  /**
   * Writes every group that holds at least the minimum, all its rows in
   * random order and all in one transaction, so neither row order nor the
   * inserting transaction's id (xmin) follows arrival. A group of today with
   * fewer waits for a later write; one of an earlier day can no longer grow
   * and is dropped, as is every group short of the minimum when closing.
   * One write at a time: a flush first waits, within its bound, for the write
   * under way. If it is still unfinished, an hourly flush writes nothing but
   * drops an earlier day's groups, and a closing one drops all it holds.
   * Resolves to how many samples were written. Rejects when the database
   * refuses the batch, which is then dropped, or when the write is unfinished
   * after its bound: it may still be stored, and is never tried again.
   */
  readonly flush: (options?: { readonly closing?: boolean }) => Promise<number>;
  /** How many samples are held now. */
  readonly held: () => number;
}

export interface WebVitalsBatchOptions {
  readonly minSamples?: number;
  /** The clock for the day; the default ceiling counts on it too. */
  readonly now?: () => number;
  readonly ceiling?: DailyCeiling;
  /** A whole number from 0 up to, not including, `bound`; crypto's by default. */
  readonly randomInt?: (bound: number) => number;
  /** Rows per insert statement (tests make a batch span several). */
  readonly rowsPerInsert?: number;
  readonly writeTimeoutMs?: number;
}

/** Fisher-Yates, in place: every order equally likely, given a fair draw. */
export function shuffleInPlace(items: unknown[], randomInt: (bound: number) => number): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = randomInt(index + 1);
    const item = items[index];
    const swapped = items[other];
    if (item === undefined || swapped === undefined) continue;
    items[index] = swapped;
    items[other] = item;
  }
}

/** Whether a promise settles, either way, within the time: false when the
 *  time runs out first. The timer never keeps the process alive. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>((resolve) => {
    timer = setTimeout(() => { resolve(false); }, Math.max(0, ms));
    timer.unref();
  });
  try {
    return await Promise.race([promise.then(() => true, () => true), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The field web vitals' one writer. Samples wait in memory (never with the
 * address, which the route does not hand over), each on its vital's step,
 * and are written in shuffled batches, so a stored row cannot be paired with
 * the request that brought it by its position, its transaction, its time or
 * its precision: it keeps only the UTC day it arrived. A group short of the
 * minimum waits, for the rest of its day if it must, and a restart (every
 * deploy) drops what is held, so a page opened only a few times a day may
 * never be written. At most one day's ceiling of reports is held per process,
 * up to four samples each, even while a write is stuck. A write stuck on a
 * stalled connection of the server's own pool still holds that connection:
 * the close gives up waiting at its bound, and the pool's own close then waits
 * until the API's 25-second stop ends the process.
 */
export function createWebVitalsBatch(db: Database, options: WebVitalsBatchOptions = {}): WebVitalsBatch {
  const minSamples = options.minSamples ?? WEB_VITALS_BATCH_MIN_SAMPLES;
  const now = options.now ?? Date.now;
  const ceiling = options.ceiling ?? createDailyCeiling(WEB_VITALS_DAILY_REPORT_CEILING, now);
  const randomInt = options.randomInt ?? ((bound: number) => cryptoRandomInt(bound));
  const rowsPerInsert = options.rowsPerInsert ?? BATCH_INSERT_ROWS;
  const writeTimeoutMs = options.writeTimeoutMs ?? WEB_VITALS_BATCH_WRITE_TIMEOUT_MS;
  const held = new Map<string, HeldGroup>();
  /** The write under way, until its transaction settles, either way. */
  let inFlight: Promise<void> | null = null;

  /** One of a report's samples is written, dropped or refused. A report
   *  counts against its day only once one of its samples is written: when
   *  none is and none still can be, its place is given back. */
  function settle(from: Admitted, written: boolean): void {
    from.open -= 1;
    if (written) from.kept = true;
    else if (from.open === 0 && !from.kept) ceiling.release(from.place);
  }

  function drop(group: HeldGroup): void {
    for (const sample of group.samples) settle(sample.from, false);
  }

  /** Starts one batch's transaction. Its samples are settled when the
   *  transaction itself settles, never on a timer: a write a flush stopped
   *  waiting for may still commit, and its places stay counted until then. */
  function write(batch: readonly HeldSample[], boundMs: number): Promise<number> {
    const rows = batch.map((sample) => ({
      page: sample.page,
      device: sample.device,
      metric: sample.name,
      value: sample.value,
      rating: sample.rating,
      recordedAt: new Date(sample.from.place * DAY_MS),
    }));
    shuffleInPlace(rows, randomInt);
    const bound = String(Math.max(1, Math.trunc(boundMs)));
    async function run(): Promise<number> {
      try {
        await db.transaction(async (tx) => {
          // The database ends a statement past the bound and rolls the whole
          // batch back. (Not idle_in_transaction_session_timeout: it ends the
          // session, and a checked-out client's error would end the process.)
          await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${bound}`));
          for (let start = 0; start < rows.length; start += rowsPerInsert) {
            await tx.insert(webVitalSamples).values(rows.slice(start, start + rowsPerInsert));
          }
        });
      } catch (error) {
        // Rolled back: nothing of it was kept.
        for (const sample of batch) settle(sample.from, false);
        throw error;
      }
      for (const sample of batch) settle(sample.from, true);
      return batch.length;
    }
    const written = run();
    const tracked: Promise<void> = written.then(() => undefined, () => undefined).then(() => {
      if (inFlight === tracked) inFlight = null;
    });
    inFlight = tracked;
    return written;
  }

  return {
    hold: (report) => {
      const place = ceiling.admit();
      if (place === null) return false;
      const from: Admitted = { place, open: report.metrics.length, kept: false };
      for (const metric of report.metrics) {
        const { name, value, rating } = stepWebVitalSample(metric);
        const key = groupOf(report.page, report.device, place, name);
        const group = held.get(key) ?? { day: place, samples: [] };
        group.samples.push({ from, page: report.page, device: report.device, name, value, rating });
        held.set(key, group);
      }
      return true;
    },
    flush: async (flushOptions = {}) => {
      const closing = flushOptions.closing === true;
      const started = Date.now();
      // A closing flush has one bound for its waiting and its write together.
      const left = (): number => (closing ? writeTimeoutMs - (Date.now() - started) : writeTimeoutMs);
      // One write at a time, and a flush waits for the one under way only
      // within its bound: a write stuck on a stalled connection may never
      // settle, and must hold neither the server's close nor the day's
      // housekeeping. Nothing is ever written beside it.
      while (inFlight !== null) {
        if (await settlesWithin(inFlight, left())) continue;
        if (closing) {
          for (const group of held.values()) drop(group);
          held.clear();
          throw new Error(`A web vitals batch was still being written ${String(writeTimeoutMs)} ms into closing: what is held is dropped`);
        }
        // An earlier day's groups can no longer grow and still go, so what is
        // held stays within one day's ceiling for as long as the write is stuck.
        const day = Math.floor(now() / DAY_MS);
        for (const [key, group] of held) {
          if (group.day < day) {
            drop(group);
            held.delete(key);
          }
        }
        throw new Error(`The web vitals batch before was still being written after ${String(writeTimeoutMs)} ms: nothing is written this hour`);
      }
      const today = Math.floor(now() / DAY_MS);
      const batch: HeldSample[] = [];
      for (const [key, group] of held) {
        if (group.samples.length >= minSamples) {
          batch.push(...group.samples);
          held.delete(key);
        } else if (closing || group.day < today) {
          // Short of the minimum and unable to grow: never written.
          drop(group);
          held.delete(key);
        }
      }
      if (batch.length === 0) return 0;
      const boundMs = left();
      if (closing && boundMs < writeTimeoutMs / 10) {
        // Too little of the close's bound is left to start a write and wait
        // for it: what it would have written is dropped.
        for (const sample of batch) settle(sample.from, false);
        throw new Error(`A web vitals closing write had ${String(Math.max(0, Math.trunc(boundMs)))} ms of its bound left: what it held is dropped`);
      }
      const written = write(batch, boundMs);
      if (await settlesWithin(written, boundMs)) return await written;
      throw new Error(`A web vitals batch was unfinished after ${String(Math.trunc(boundMs))} ms: it may still be stored, and is never tried again`);
    },
    held: () => [...held.values()].reduce((total, group) => total + group.samples.length, 0),
  };
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
