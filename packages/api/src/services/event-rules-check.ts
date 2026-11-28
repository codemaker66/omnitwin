import { Pool as NeonPool } from "@neondatabase/serverless";
import { Pool as PgPool } from "pg";
import { sql, type SQL } from "drizzle-orm";
import { drizzle as neonDrizzle } from "drizzle-orm/neon-serverless";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { NEON_POOL_IDLE_TIMEOUT_MS, isLocalDatabaseUrl, type Database, type DatabaseConnection } from "../db/client.js";
import { loadBundledJournal, readMigrationReadiness } from "../db/migration-readiness.js";
import * as schema from "../db/schema.js";
import { sqlStateOf } from "../utils/sql-state.js";
import { readBindInvariant, type BindInvariant, type InvariantReader } from "./event-binding.js";
import { readSpineInvariant, spineInvariantHolds, type SpineInvariant } from "./event-spine-invariant.js";

// ---------------------------------------------------------------------------
// The event rules, read against a real database: the bind's two counts
// (migration 0090: every hold and ink has its event) and the spine's nine
// (the links, migration *_event_spine_links: every proposal, deal and enquiry
// that must have an event has one), with the database's migration state.
// scripts/check-booking-event-bind.ts is the command that runs it; the
// nightly Event rules workflow runs that command with --join.
//
// With join, spine_join_old_records() runs first, in a READ COMMITTED
// transaction of its own (the join decides each record on a plain read and
// again under its lock, which needs a fresh snapshot per statement), with a
// 5 s lock limit, a statement limit (JOIN_STATEMENT_TIMEOUT_MS) and a 30 s
// idle-in-transaction limit, so a client that stalls before COMMIT cannot keep
// its key shares. That join is the check's only write. A join that fails
// rolls back whole and is reported in joinRun; the read still runs.
//
// Then one REPEATABLE READ, READ ONLY transaction reads the counts, the
// two lists and the enquiries apart from their bookings (a number of its
// own, which never changes the status) on one snapshot, and a short
// read-only transaction of its own reads the migration state (the bundled
// journal against the migrations ledger: how many are applied and which tags
// are pending), so a stale or half-migrated database announces itself. A
// read that fails gives an "unread" outcome that still carries the join's
// outcome and the migration state.
//
// Nothing here returns a database error's message: a failure is named by its
// error's name and SQLSTATE (or system code), and an undefined function,
// table or column (42883, 42P01, 42703) is said in plain words to mean that
// the spine's migration is not applied to the database. The command's own
// connection (openEventRulesConnection) names an idle client's failure the
// same way.
// ---------------------------------------------------------------------------

/**
 * The longest the join may run. The workflow job stops at five minutes, of
 * which checkout, install and the types build take one to two; the join's
 * 60 s, the read's five statements at up to 15 s each and the migration
 * state's 10 s then end inside it, with room to print. Every event the join
 * links stays key-share-locked until the join commits, so a short run is a
 * short hold.
 */
export const JOIN_STATEMENT_TIMEOUT_MS = 60_000;

/** What one run of the join did. */
export interface JoinRun {
  readonly joined: number;
  readonly eventsMade: number;
  readonly listed: number;
}

/** A join that failed and was rolled back whole: its error's name and code, never its message. */
export interface FailedJoinRun {
  readonly error: string;
}

/** The migrations ledger against the journal this code ships, or why it could not be read. */
export type MigrationState =
  | { readonly applied: number; readonly local: number; readonly pending: readonly string[] }
  | { readonly error: string };

/** A database that was read. */
export interface EventRulesReport extends BindInvariant, SpineInvariant {
  readonly status: "holds" | "broken";
  /** Information, not one of the counts: it never changes the status (readEnquiriesApartFromTheirBookings). */
  readonly enquiriesApartFromTheirBookings: number;
  readonly reviewList: Readonly<Record<string, number>>;
  readonly joinsToCheck: Readonly<Record<string, number>>;
  readonly migrations: MigrationState;
  /** Present only when the join was asked for. */
  readonly joinRun?: JoinRun | FailedJoinRun;
}

/** A database whose read failed: why, and what is known besides. */
export interface UnreadEventRules {
  readonly status: "unread";
  readonly readError: string;
  readonly migrations: MigrationState;
  readonly joinRun?: JoinRun | FailedJoinRun;
}

export type EventRulesOutcome = EventRulesReport | UnreadEventRules;

export interface EventRulesOptions {
  readonly join: boolean;
  /** The join's statement limit; JOIN_STATEMENT_TIMEOUT_MS unless a test shortens it. */
  readonly joinStatementTimeoutMs?: number;
}

const count = z.number().int().nonnegative();
const JoinRowSchema = z.object({ joined: count, events_made: count, listed: count });
const ReasonRowSchema = z.object({ reason: z.string(), count });
const ApartRowSchema = z.object({ apart: count });

/** Undefined function, table, column: what a database without the spine's migration answers. */
const NOT_MIGRATED_STATES: ReadonlySet<string> = new Set(["42883", "42P01", "42703"]);

/** A failure as a public log may show it: its name and its SQLSTATE (or system code), never its message. */
export function describeFailure(failure: unknown): string {
  const name = failure instanceof Error ? failure.name : typeof failure;
  const state = sqlStateOf(failure);
  if (state !== null) {
    const named = `${name} (SQLSTATE ${state})`;
    return NOT_MIGRATED_STATES.has(state) ? `${named}: the spine's migration is not applied to this database` : named;
  }
  const code = typeof failure === "object" && failure !== null && "code" in failure ? failure.code : undefined;
  return typeof code === "string" && /^E[A-Z]{2,20}$/u.test(code) ? `${name} (${code})` : name;
}

/**
 * The command's own connection, for a log that is public: the driver
 * db/client.ts's createDbConnection chooses (PostgreSQL over TCP for a local
 * URL, else Neon over a WebSocket, with the same idle limit), but its pool's
 * error handler gives `report` an idle client's failure as describeFailure
 * names it, never its message (the shared pool's handler prints the message,
 * for the API's private log). pg-pool listens only on idle clients: an error
 * on a client in use between two statements reaches no pool handler, and the
 * command's process handlers name it (scripts/check-booking-event-bind.ts).
 */
export function openEventRulesConnection(databaseUrl: string, report: (line: string) => void): DatabaseConnection {
  const pool = isLocalDatabaseUrl(databaseUrl)
    ? new PgPool({ connectionString: databaseUrl })
    : new NeonPool({ connectionString: databaseUrl, idleTimeoutMillis: NEON_POOL_IDLE_TIMEOUT_MS });
  pool.on("error", (error) => {
    report(`an idle connection failed: ${describeFailure(error)}`);
  });
  const db: Database = pool instanceof PgPool
    ? pgDrizzle(pool, { schema })
    : neonDrizzle(pool, { schema });
  let closing: Promise<void> | undefined;
  return {
    db,
    close: () => {
      closing ??= pool.end();
      return closing;
    },
  };
}

export function isFailedJoin(run: JoinRun | FailedJoinRun | undefined): run is FailedJoinRun {
  return run !== undefined && "error" in run;
}

async function joinOldRecords(db: Database, statementTimeoutMs: number): Promise<JoinRun | FailedJoinRun> {
  if (!Number.isSafeInteger(statementTimeoutMs) || statementTimeoutMs <= 0) {
    throw new Error("The join's statement limit must be a positive whole number of milliseconds");
  }
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL READ COMMITTED`);
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql`SELECT set_config('statement_timeout', ${String(statementTimeoutMs)}, true)`);
      await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '30s'`);
      const result = await tx.execute(sql`SELECT joined, events_made, listed FROM spine_join_old_records()`);
      const row = JoinRowSchema.parse(result.rows[0]);
      return { joined: row.joined, eventsMade: row.events_made, listed: row.listed };
    });
  } catch (error: unknown) {
    return { error: describeFailure(error) };
  }
}

/**
 * Enquiries apart from their bookings: an enquiry whose link names an event
 * that holds none of its undeleted bookings, while some of those bookings sit
 * in another live event of its venue. One number, read only; of one venue, or
 * of every venue when none is named, as the count's parts are. No writer of
 * this release makes one, so it is expected to read 0 after a release; an
 * instance still running the release before the links can make one during
 * the switch-over, because it ignores an enquiry's link and gives the first
 * hold a new event (the-spine.md, "Repairs by hand", says how to repair one).
 * It is not one of the spine's nine: it never changes the status.
 */
export async function readEnquiriesApartFromTheirBookings(conn: InvariantReader, venueId: string | null = null): Promise<number> {
  const inVenue = venueId === null ? sql`true` : sql`q.venue_id = ${venueId}`;
  const result = await conn.execute(sql`
    SELECT count(*)::int AS apart FROM enquiries q
    WHERE q.event_id IS NOT NULL AND ${inVenue}
      AND NOT EXISTS (SELECT 1 FROM bookings b
        WHERE b.enquiry_id = q.id AND b.deleted_at IS NULL AND b.event_id = q.event_id)
      AND EXISTS (SELECT 1 FROM bookings b JOIN events e ON e.id = b.event_id
        WHERE b.enquiry_id = q.id AND b.deleted_at IS NULL
          AND e.deleted_at IS NULL AND e.venue_id = q.venue_id AND e.id <> q.event_id)`);
  return ApartRowSchema.parse(result.rows[0]).apart;
}

async function countsByReason(tx: InvariantReader, query: SQL): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const row of (await tx.execute(query)).rows) {
    const parsed = ReasonRowSchema.parse(row);
    counts[parsed.reason] = parsed.count;
  }
  return counts;
}

async function readCounts(db: Database): Promise<Omit<EventRulesReport, "migrations" | "joinRun">> {
  const read = await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
    await tx.execute(sql`SET LOCAL statement_timeout = '15s'`);
    const bind = await readBindInvariant(tx);
    const spine = await readSpineInvariant(tx);
    const apart = await readEnquiriesApartFromTheirBookings(tx);
    const reviewList = await countsByReason(tx, sql`
      SELECT reason, count(*)::int AS count FROM event_binding_reviews GROUP BY reason ORDER BY reason`);
    const joinsToCheck = await countsByReason(tx, sql`
      SELECT reason, count(*)::int AS count FROM event_link_reviews WHERE resolved_at IS NULL
      GROUP BY reason ORDER BY reason`);
    return { bind, spine, apart, reviewList, joinsToCheck };
  });
  const holds = read.bind.unboundBookings === 0 && read.bind.contradictingEvents === 0 && spineInvariantHolds(read.spine);
  return {
    status: holds ? "holds" : "broken",
    unboundBookings: read.bind.unboundBookings,
    contradictingEvents: read.bind.contradictingEvents,
    ...read.spine,
    enquiriesApartFromTheirBookings: read.apart,
    reviewList: read.reviewList,
    joinsToCheck: read.joinsToCheck,
  };
}

/** The bundled journal against the ledger, in a short read-only transaction of its own. */
async function readMigrationState(db: Database): Promise<MigrationState> {
  let journal: Awaited<ReturnType<typeof loadBundledJournal>>;
  try {
    journal = await loadBundledJournal();
  } catch (error: unknown) {
    return { error: describeFailure(error) };
  }
  try {
    const readiness = await db.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION READ ONLY`);
      await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
      return readMigrationReadiness(tx, journal);
    });
    return { applied: readiness.applied, local: readiness.local, pending: [...readiness.pendingTags] };
  } catch (error: unknown) {
    // A database never migrated has no ledger. The driver's code sits on the
    // error's cause, which readMigrationReadiness's own check does not read.
    if (sqlStateOf(error) === "42P01") {
      return { applied: 0, local: journal.length, pending: journal.map((entry) => entry.tag) };
    }
    return { error: describeFailure(error) };
  }
}

/**
 * The event rules: with join, the join of old records first (the only
 * write), then the read-only counts and lists, then the migration state.
 * Never throws for a database failure: a failed join is reported in joinRun,
 * a failed read as an "unread" outcome.
 */
export async function checkEventRules(db: Database, options: EventRulesOptions): Promise<EventRulesOutcome> {
  const joinRun = options.join
    ? await joinOldRecords(db, options.joinStatementTimeoutMs ?? JOIN_STATEMENT_TIMEOUT_MS)
    : undefined;
  const joined = joinRun === undefined ? {} : { joinRun };
  let counts: Omit<EventRulesReport, "migrations" | "joinRun">;
  try {
    counts = await readCounts(db);
  } catch (error: unknown) {
    return { status: "unread", readError: describeFailure(error), migrations: await readMigrationState(db), ...joined };
  }
  return { ...counts, migrations: await readMigrationState(db), ...joined };
}

/** 0 when the rules hold and no asked-for join failed; 1 when a count is not zero or the join failed; 2 when unread. */
export function exitCodeOf(outcome: EventRulesOutcome): 0 | 1 | 2 {
  if (outcome.status === "unread") return 2;
  return outcome.status === "holds" && !isFailedJoin(outcome.joinRun) ? 0 : 1;
}
