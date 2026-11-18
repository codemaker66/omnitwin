import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { createDbConnection, type Database } from "../db/client.js";
import { readBindInvariant, type BindInvariant, type InvariantReader } from "../services/event-binding.js";
import { readSpineInvariant, spineInvariantHolds, type SpineInvariant } from "../services/event-spine-invariant.js";
import { sqlStateOf } from "../utils/sql-state.js";

// ---------------------------------------------------------------------------
// The event rules, read against a real database: the bind's two counts
// (migration 0090: every hold and ink has its event) and the spine's nine
// (the links, migration *_event_spine_links: every proposal, deal and enquiry
// that must have an event has one). CI proves both counts on PostgreSQL
// (booking-event-bind-postgres, event-spine-invariant-postgres) and this
// script on a throwaway database (event-rules-check-postgres). It is the
// operator's read, and the one the deploy and the nightly workflows run (their
// "event-rules" jobs, with --join):
//
//   pnpm --filter @omnitwin/api exec tsx src/scripts/check-booking-event-bind.ts [--join]
//
// With --join it first runs spine_join_old_records() in a transaction of its
// own, with a 5 s lock limit and a statement limit (JOIN_STATEMENT_TIMEOUT),
// so that records made since the last run are joined to their events. That
// join is the script's only write. A join that fails rolls back whole and is
// reported in joinRun; the read still runs and prints.
//
// Then one READ ONLY transaction, on one snapshot, reads everything below and
// the script prints it as one line of JSON:
//   status               "holds" when the two bind counts and the nine spine
//                        counts are all zero, else "broken"
//   unboundBookings      holds and inks without an event
//   contradictingEvents  events whose status disagrees with their Diary bookings
//   proposalsWithoutEvent ... eventDealPointersInUse
//                        the spine's nine counts (readSpineInvariant)
//   reviewList           what migration 0090 left for a person to look at,
//                        counted by reason (event_binding_reviews)
//   joinsToCheck         the open questions on the list of joins to check,
//                        counted by reason (event_link_reviews, October's
//                        copied questions among them)
//   joinRun              with --join only: { joined, eventsMade, listed }, or
//                        { error } when the join failed
// reviewList and joinsToCheck are information and never change the status:
// a question that matters already shows in a count.
//
// Exit codes: 0 = the rules hold (and the join, when asked for, ran);
// 1 = a count is not zero, or the join failed though the counts were read;
// 2 = setup error (no DATABASE_URL, an unknown argument, or the read failed).
// Neither the connection string nor a database error's message is printed:
// a failure is named by its error's name and its SQLSTATE (or system code),
// because the workflows' logs are public with the repository.
// ---------------------------------------------------------------------------

/**
 * The longest the join may run. The workflow jobs that run it stop at five
 * minutes, of which checkout, install and the types build take one to two
 * and the read up to its own 30 s; 90 s leaves the read room to run and print
 * after a join that reached this limit. Every event the join links stays
 * key-share-locked until the join commits, so a short run is a short hold.
 */
const JOIN_STATEMENT_TIMEOUT = "90s";

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

export interface EventRulesReport extends BindInvariant, SpineInvariant {
  readonly status: "holds" | "broken";
  readonly reviewList: Readonly<Record<string, number>>;
  readonly joinsToCheck: Readonly<Record<string, number>>;
  /** Present only when the join was asked for. */
  readonly joinRun?: JoinRun | FailedJoinRun;
}

const count = z.number().int().nonnegative();
const JoinRowSchema = z.object({ joined: count, events_made: count, listed: count });
const ReasonRowSchema = z.object({ reason: z.string(), count });

/** A failure as a public log may show it: its name and its SQLSTATE (or system code), never its message. */
export function describeFailure(failure: unknown): string {
  const name = failure instanceof Error ? failure.name : typeof failure;
  const state = sqlStateOf(failure);
  if (state !== null) return `${name} (SQLSTATE ${state})`;
  const code = typeof failure === "object" && failure !== null && "code" in failure ? failure.code : undefined;
  return typeof code === "string" && /^E[A-Z]{2,20}$/u.test(code) ? `${name} (${code})` : name;
}

export function isFailedJoin(run: JoinRun | FailedJoinRun | undefined): run is FailedJoinRun {
  return run !== undefined && "error" in run;
}

async function joinOldRecords(db: Database): Promise<JoinRun | FailedJoinRun> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${JOIN_STATEMENT_TIMEOUT}'`));
      const result = await tx.execute(sql`SELECT joined, events_made, listed FROM spine_join_old_records()`);
      const row = JoinRowSchema.parse(result.rows[0]);
      return { joined: row.joined, eventsMade: row.events_made, listed: row.listed };
    });
  } catch (error: unknown) {
    return { error: describeFailure(error) };
  }
}

async function countsByReason(tx: InvariantReader, query: SQL): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const row of (await tx.execute(query)).rows) {
    const parsed = ReasonRowSchema.parse(row);
    counts[parsed.reason] = parsed.count;
  }
  return counts;
}

/**
 * The event rules: with join, the join of old records first (the only
 * write), then the read-only counts and lists. Throws only when the read
 * fails; a failed join is reported in joinRun.
 */
export async function checkEventRules(db: Database, options: { readonly join: boolean }): Promise<EventRulesReport> {
  const joinRun = options.join ? await joinOldRecords(db) : undefined;
  const read = await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
    await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
    const bind = await readBindInvariant(tx);
    const spine = await readSpineInvariant(tx);
    const reviewList = await countsByReason(tx, sql`
      SELECT reason, count(*)::int AS count FROM event_binding_reviews GROUP BY reason ORDER BY reason`);
    const joinsToCheck = await countsByReason(tx, sql`
      SELECT reason, count(*)::int AS count FROM event_link_reviews WHERE resolved_at IS NULL
      GROUP BY reason ORDER BY reason`);
    return { bind, spine, reviewList, joinsToCheck };
  });
  const holds = read.bind.unboundBookings === 0 && read.bind.contradictingEvents === 0 && spineInvariantHolds(read.spine);
  return {
    status: holds ? "holds" : "broken",
    unboundBookings: read.bind.unboundBookings,
    contradictingEvents: read.bind.contradictingEvents,
    ...read.spine,
    reviewList: read.reviewList,
    joinsToCheck: read.joinsToCheck,
    ...(joinRun === undefined ? {} : { joinRun }),
  };
}

/** The exit code for a report that was read: 0 when the rules hold and no asked-for join failed, else 1. */
export function exitCodeOf(report: EventRulesReport): 0 | 1 {
  return report.status === "holds" && !isFailedJoin(report.joinRun) ? 0 : 1;
}

async function main(args: readonly string[]): Promise<void> {
  // Loaded here, not on import, so a test that imports the check never reads .env.
  // dotenv never overrides a variable that is already set.
  await import("dotenv/config");
  if (args.some((arg) => arg !== "--join")) {
    process.stderr.write("[event-rules] the only argument is --join\n");
    process.exitCode = 2;
    return;
  }
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    process.stderr.write("[event-rules] DATABASE_URL is not set\n");
    process.exitCode = 2;
    return;
  }
  const connection = createDbConnection(databaseUrl);
  try {
    const report = await checkEventRules(connection.db, { join: args.includes("--join") });
    if (isFailedJoin(report.joinRun)) {
      process.stderr.write(`[event-rules] the join failed and was rolled back: ${report.joinRun.error}\n`);
    }
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = exitCodeOf(report);
  } catch (error: unknown) {
    process.stderr.write(`[event-rules] the read failed: ${describeFailure(error)}\n`);
    process.exitCode = 2;
  } finally {
    await connection.close();
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  await main(process.argv.slice(2));
}
