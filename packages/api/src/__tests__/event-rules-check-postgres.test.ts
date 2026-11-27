import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { loadBundledJournal } from "../db/migration-readiness.js";
import {
  JOIN_STATEMENT_TIMEOUT_MS,
  checkEventRules,
  exitCodeOf,
  isFailedJoin,
  openEventRulesConnection,
  readEnquiriesApartFromTheirBookings,
  type EventRulesOutcome,
  type EventRulesReport,
} from "../services/event-rules-check.js";
import { SPINE_INVARIANT_FIELDS } from "../services/event-spine-invariant.js";
import {
  deal,
  enquiry,
  event,
  insertReview,
  link,
  openSpineDatabase,
  openSpineDatabaseBefore,
  platformTarget,
  proposal,
  venue,
  type SpineDatabase,
  type SpineDatabaseBefore,
} from "./helpers/event-spine-fixtures.js";

// ---------------------------------------------------------------------------
// The operator's read of the event rules (services/event-rules-check.ts, run
// by scripts/check-booking-event-bind.ts), which the nightly Event rules
// workflow runs with --join, on databases of its own (openSpineDatabase; the
// shared platform database is only the door to the cluster). The cases of the
// first block run in order on one database, because the check reads and joins
// the whole database, as it does in production:
//
//   1. Without --join the run writes nothing and reports the two bind counts,
//      the nine spine counts, both lists and the migration state, and no
//      joinRun.
//   2. A join that cannot have a lock within its 5 s limit rolls back whole,
//      is reported by its SQLSTATE alone, and the counts are still read; with
//      a shorter statement limit, that limit ends it first.
//   3. With --join, one unjoined worked chain (an answered enquiry, its deal,
//      a sent proposal and its deposit request) is joined, and the counts
//      then read zero: the rules hold.
//   4. Open questions on the list of joins to check, and October's list, are
//      reported and leave the status to the counts.
//   5. The command refuses an unknown argument with exit 2 before anything is
//      read or written, and otherwise prints one line of JSON, with the
//      migration state, never the connection string, exiting 0 when the rules
//      hold.
//   6. The command's own pool names an idle connection's failure by its
//      SQLSTATE alone, never by its message.
//   7. A command whose connection is ended mid-read stops with exit 2, and
//      both streams hold only its own named lines: no message, no stack, no
//      connection details.
//   8. Enquiries apart from their bookings are a number of their own, which
//      leaves the status and the counts alone.
//
// The second block runs the command against a database the spine's migration
// has not reached: the join and the read fail, it exits 2, and the line says
// so in plain words, with the join's outcome and the pending migration.
// ---------------------------------------------------------------------------

const target = platformTarget();
const API_ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT = resolve(API_ROOT, "src/scripts/check-booking-event-bind.ts");
const NOT_APPLIED = "the spine's migration is not applied to this database";

interface CommandRun {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** The real command, as the workflow runs it, against the given database. */
function runCommand(databaseUrl: string, args: readonly string[]): Promise<CommandRun> {
  const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
  return new Promise<CommandRun>((done, fail) => {
    const child = spawn(process.execPath, [tsxCli, SCRIPT, ...args], {
      cwd: API_ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", fail);
    child.on("close", (code) => { done({ code, stdout, stderr }); });
  });
}

/** Neither stream names the database: not its URL, its host or its name. */
function expectNoConnectionDetails(run: CommandRun, databaseUrl: string): void {
  const url = new URL(databaseUrl);
  for (const detail of [databaseUrl, url.host, url.pathname.slice(1)]) {
    expect(run.stdout).not.toContain(detail);
    expect(run.stderr).not.toContain(detail);
  }
}

/** The one line the command prints, parsed to unknown. */
function theLine(run: CommandRun): unknown {
  expect(run.stdout.endsWith("\n")).toBe(true);
  expect(run.stdout.slice(0, -1)).not.toContain("\n");
  return JSON.parse(run.stdout) as unknown;
}

const count = z.number().int().nonnegative();
const MigrationsSchema = z.object({ applied: count, local: count, pending: z.array(z.string()) }).strict();
const JoinRunSchema = z.union([
  z.object({ joined: count, eventsMade: count, listed: count }).strict(),
  z.object({ error: z.string() }).strict(),
]);
const ReadLineSchema = z.object({
  status: z.enum(["holds", "broken"]),
  unboundBookings: count,
  contradictingEvents: count,
  proposalsWithoutEvent: count,
  agreementsWithoutEvent: count,
  depositRequestsWithoutEvent: count,
  openDealsWithoutEvent: count,
  workedEnquiriesWithoutEvent: count,
  eventsWithTwoOpenDeals: count,
  disagreeingLinks: count,
  linksToClosedEvents: count,
  eventDealPointersInUse: count,
  enquiriesApartFromTheirBookings: count,
  reviewList: z.record(z.string(), count),
  joinsToCheck: z.record(z.string(), count),
  migrations: MigrationsSchema,
  joinRun: JoinRunSchema.optional(),
}).strict();
const UnreadLineSchema = z.object({
  status: z.literal("unread"),
  readError: z.string(),
  migrations: MigrationsSchema,
  joinRun: JoinRunSchema.optional(),
}).strict();

function readReport(outcome: EventRulesOutcome): EventRulesReport {
  if (outcome.status === "unread") throw new Error(`The read failed: ${outcome.readError}`);
  return outcome;
}

describe.skipIf(target === undefined)("the event rules: the operator's read and the join it runs", () => {
  let spine: SpineDatabase;
  let pool: Pool;
  let db: Database;
  let journalTags: readonly string[];
  /** The worked chain of case 1, joined in case 3. */
  let chain: { readonly venueId: string; readonly enquiryId: string; readonly dealId: string;
    readonly proposalId: string; readonly requestId: string };

  beforeAll(async () => {
    spine = await openSpineDatabase("event_rules_check");
    pool = spine.pool;
    db = spine.db;
    journalTags = (await loadBundledJournal()).map((entry) => entry.tag);
  }, 180_000);
  afterAll(async () => { await spine?.close(); });

  /** What any write by the check would change: the rows the join makes and the links it sets. */
  async function footprint(): Promise<Record<string, number>> {
    const [row] = (await pool.query<Record<string, number>>(`SELECT
      (SELECT count(*) FROM events)::int AS events,
      (SELECT count(*) FROM event_phases)::int AS phases,
      (SELECT count(*) FROM event_link_joins)::int AS joins,
      (SELECT count(*) FROM event_link_reviews)::int AS reviews,
      (SELECT count(*) FROM event_link_reviews WHERE resolved_at IS NOT NULL)::int AS answered,
      (SELECT count(*) FROM enquiries WHERE event_id IS NOT NULL)::int AS linked_enquiries,
      (SELECT count(*) FROM opportunities WHERE event_id IS NOT NULL)::int AS linked_deals,
      (SELECT count(*) FROM proposals WHERE event_id IS NOT NULL)::int AS linked_proposals,
      (SELECT count(*) FROM proposal_deposit_requests WHERE event_id IS NOT NULL)::int AS linked_requests`)).rows;
    if (row === undefined) throw new Error("No footprint");
    return row;
  }

  async function eventOf(table: "enquiries" | "opportunities" | "proposals" | "proposal_deposit_requests", id: string): Promise<string | null> {
    const [row] = (await pool.query<{ event_id: string | null }>(`SELECT event_id FROM ${table} WHERE id = $1`, [id])).rows;
    if (row === undefined) throw new Error(`No ${table} row ${id}`);
    return row.event_id;
  }

  /** Runs with the chain's venue row held FOR UPDATE, which refuses the key share the join's new event needs. */
  async function withVenueHeld<T>(run: () => Promise<T>): Promise<T> {
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM venues WHERE id = $1 FOR UPDATE", [chain.venueId]);
      return await run();
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
  }

  const spineCounts = (report: EventRulesReport): Record<string, number> =>
    Object.fromEntries(SPINE_INVARIANT_FIELDS.map((field) => [field, report[field]]));

  const BEFORE_THE_JOIN = {
    proposalsWithoutEvent: 1,
    agreementsWithoutEvent: 0,
    depositRequestsWithoutEvent: 1,
    openDealsWithoutEvent: 1,
    workedEnquiriesWithoutEvent: 1,
    eventsWithTwoOpenDeals: 0,
    disagreeingLinks: 0,
    linksToClosedEvents: 0,
    eventDealPointersInUse: 0,
  };

  it("reads without writing: both counts, both lists, the migration state and no joinRun", async () => {
    const v = await venue(pool, "event rules chain");
    const enquiryId = await enquiry(pool, v.venueId);
    await pool.query(`UPDATE enquiries SET first_response_at = created_at, first_response_channel = 'email',
      first_response_recorded_at = created_at WHERE id = $1`, [enquiryId]);
    const dealId = await deal(pool, v.venueId, "proposal_sent", enquiryId);
    const proposalId = await proposal(pool, v.venueId, "sent", { opportunityId: dealId, enquiryId });
    const [request] = (await pool.query<{ id: string }>(`INSERT INTO proposal_deposit_requests
        (venue_id, proposal_id, event_id, proposal_version, proposal_version_hash, basis, quote_total_minor, amount_minor, currency)
      VALUES ($1, $2, NULL, 1, repeat('a', 64), 'amount', 100000, 25000, 'GBP') RETURNING id`, [v.venueId, proposalId])).rows;
    if (request === undefined) throw new Error("No deposit request");
    chain = { venueId: v.venueId, enquiryId, dealId, proposalId, requestId: request.id };

    const before = await footprint();
    const report = readReport(await checkEventRules(db, { join: false }));
    expect(await footprint()).toEqual(before);

    expect(report).not.toHaveProperty("joinRun");
    expect(report.status).toBe("broken");
    expect(report.unboundBookings).toBe(0);
    expect(report.contradictingEvents).toBe(0);
    expect(spineCounts(report)).toEqual(BEFORE_THE_JOIN);
    expect(report.enquiriesApartFromTheirBookings).toBe(0);
    expect(report.reviewList).toEqual({});
    expect(report.joinsToCheck).toEqual({});
    expect(report.migrations).toEqual({ applied: journalTags.length, local: journalTags.length, pending: [] });
    expect(Object.keys(report)).toEqual(["status", "unboundBookings", "contradictingEvents", ...SPINE_INVARIANT_FIELDS,
      "enquiriesApartFromTheirBookings", "reviewList", "joinsToCheck", "migrations"]);
    expect(exitCodeOf(report)).toBe(1);
  });

  it("rolls a join that cannot have its lock back whole, names it by SQLSTATE alone, and still reads the counts", async () => {
    // The pool's own lock limit is 20 s, so failing near 5 s proves the join's own limit.
    const before = await footprint();
    const started = Date.now();
    const report = readReport(await withVenueHeld(() => checkEventRules(db, { join: true })));
    const waited = Date.now() - started;
    expect(await footprint()).toEqual(before);

    const joinRun = report.joinRun;
    if (!isFailedJoin(joinRun)) throw new Error("The join did not fail");
    expect(Object.keys(joinRun)).toEqual(["error"]);
    expect(joinRun.error).toMatch(/^\w+ \(SQLSTATE 55P03\)$/u);
    expect(waited).toBeGreaterThanOrEqual(4_500);
    expect(waited).toBeLessThan(15_000);
    expect(report.status).toBe("broken");
    expect(spineCounts(report)).toEqual(BEFORE_THE_JOIN);
    expect(JSON.stringify(report)).not.toContain(spine.url);
    expect(exitCodeOf(report)).toBe(1);
  }, 60_000);

  it("ends a join at its statement limit, inside its own transaction", async () => {
    // The production limit, and the limit doing its work: one shorter than the
    // 5 s lock limit ends the same wait first (57014), and nothing is written.
    expect(JOIN_STATEMENT_TIMEOUT_MS).toBe(60_000);
    const before = await footprint();
    const started = Date.now();
    const report = readReport(await withVenueHeld(() => checkEventRules(db, { join: true, joinStatementTimeoutMs: 1_000 })));
    const waited = Date.now() - started;
    expect(await footprint()).toEqual(before);

    const joinRun = report.joinRun;
    if (!isFailedJoin(joinRun)) throw new Error("The join did not fail");
    expect(joinRun.error).toMatch(/^\w+ \(SQLSTATE 57014\)$/u);
    expect(waited).toBeLessThan(4_500);
    expect(spineCounts(report)).toEqual(BEFORE_THE_JOIN);
  }, 60_000);

  it("joins one unjoined worked chain with --join, and the counts then read zero", async () => {
    const report = readReport(await checkEventRules(db, { join: true }));

    expect(report.joinRun).toEqual({ joined: 4, eventsMade: 1, listed: 0 });
    const eventId = await eventOf("enquiries", chain.enquiryId);
    expect(eventId).not.toBeNull();
    expect(await eventOf("opportunities", chain.dealId)).toBe(eventId);
    expect(await eventOf("proposals", chain.proposalId)).toBe(eventId);
    expect(await eventOf("proposal_deposit_requests", chain.requestId)).toBe(eventId);
    expect(spineCounts(report)).toEqual(Object.fromEntries(SPINE_INVARIANT_FIELDS.map((field) => [field, 0])));
    expect(report.unboundBookings).toBe(0);
    expect(report.contradictingEvents).toBe(0);
    expect(report.status).toBe("holds");
    expect(exitCodeOf(report)).toBe(0);

    // Run again, it has nothing left to do.
    expect(readReport(await checkEventRules(db, { join: true })).joinRun).toEqual({ joined: 0, eventsMade: 0, listed: 0 });
  });

  it("reports the open questions and October's list by reason, and leaves the status to the counts", async () => {
    const v = await venue(pool, "event rules questions");
    // A draft enquiry need not have an event, so a question about it is counted nowhere.
    const draftId = await enquiry(pool, v.venueId, "draft");
    const eventId = await event(pool, v.venueId, "Fixture event");
    await insertReview(pool, { venue_id: v.venueId, subject_kind: "enquiry", subject_id: draftId,
      reason: "reaches_many_events", detail: "Fixture question.", candidate_event_ids: [eventId] });
    await insertReview(pool, { venue_id: v.venueId, subject_kind: "event", subject_id: eventId,
      reason: "possibly_same_event", detail: "Fixture copy of an October question.", binding_review_id: randomUUID() });
    const answered = await insertReview(pool, { venue_id: v.venueId, subject_kind: "event", subject_id: eventId,
      reason: "paths_disagree", detail: "Fixture question, answered." });
    await pool.query(`UPDATE event_link_reviews SET resolved_at = now(), resolution = 'noted' WHERE id = $1`, [answered]);
    await pool.query(`INSERT INTO event_binding_reviews (venue_id, event_id, reason, detail, previous_status)
      VALUES ($1, $2, 'event_status_derived', 'Fixture note.', 'draft')`, [v.venueId, eventId]);

    const report = readReport(await checkEventRules(db, { join: false }));

    expect(report.joinsToCheck).toEqual({ possibly_same_event: 1, reaches_many_events: 1 });
    expect(report.reviewList).toEqual({ event_status_derived: 1 });
    expect(report.status).toBe("holds");
    expect(exitCodeOf(report)).toBe(0);
  });

  it("refuses an unknown argument with exit 2 before anything is read or written", async () => {
    const before = await footprint();
    const run = await runCommand(spine.url, ["--jion"]);

    expect(run.code).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toBe("[event-rules] the only argument is --join\n");
    expect(await footprint()).toEqual(before);
  }, 120_000);

  it("prints one line of JSON from the command, with the migration state and never the connection string", async () => {
    const run = await runCommand(spine.url, ["--join"]);

    expectNoConnectionDetails(run, spine.url);
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
    const printed = ReadLineSchema.parse(theLine(run));
    expect(printed).toMatchObject({
      status: "holds",
      unboundBookings: 0,
      contradictingEvents: 0,
      enquiriesApartFromTheirBookings: 0,
      joinsToCheck: { possibly_same_event: 1, reaches_many_events: 1 },
      reviewList: { event_status_derived: 1 },
      migrations: { applied: journalTags.length, local: journalTags.length, pending: [] },
      joinRun: { joined: 0, eventsMade: 0, listed: 0 },
    });
    for (const field of SPINE_INVARIANT_FIELDS) expect(printed[field]).toBe(0);
  }, 120_000);

  it("names an idle connection's failure on the command's own pool by its SQLSTATE alone, never by its message", async () => {
    const lines: string[] = [];
    const connection = openEventRulesConnection(spine.url, (line) => { lines.push(line); });
    try {
      // One client, back in the pool and idle once the statement is done; its backend is then ended.
      const pid = z.object({ pid: z.number().int() }).parse((await connection.db.execute(sql`SELECT pg_backend_pid() AS pid`)).rows[0]).pid;
      expect((await pool.query("SELECT pg_terminate_backend($1) AS ended", [pid])).rows).toEqual([{ ended: true }]);
      await expect.poll(() => lines.length, { timeout: 10_000 }).toBeGreaterThan(0);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^an idle connection failed: \w+ \(SQLSTATE 57P01\)$/u);
    } finally {
      await connection.close();
    }
  }, 60_000);

  it("stops with 2 when its connection is ended mid-read, printing only its own named lines: no message, no stack, no connection details", async () => {
    const holder = await pool.connect();
    let running: Promise<CommandRun> | undefined;
    try {
      // The read waits on October's list while the holder has it.
      await holder.query("BEGIN");
      await holder.query("LOCK TABLE event_binding_reviews IN ACCESS EXCLUSIVE MODE");
      const holderPid = z.object({ pid: z.number().int() }).parse((await holder.query("SELECT pg_backend_pid() AS pid")).rows[0]).pid;
      let finished = false;
      const isFinished = (): boolean => finished;
      const started = runCommand(spine.url, []).finally(() => { finished = true; });
      running = started;

      // The command is seen waiting for the table (its read waits up to its 15 s statement limit), then ended.
      let pid: number | undefined;
      while (pid === undefined && !isFinished()) {
        const [row] = (await pool.query<{ pid: number }>(`SELECT pid FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> $1`, [holderPid])).rows;
        pid = row?.pid;
        if (pid === undefined) await new Promise((done) => setTimeout(done, 20));
      }
      if (pid === undefined) throw new Error("The command was never seen waiting for the table");
      expect((await pool.query("SELECT pg_terminate_backend($1) AS ended", [pid])).rows).toEqual([{ ended: true }]);
      const run = await started;

      expectNoConnectionDetails(run, spine.url);
      expect(run.code).toBe(2);
      const lines = run.stderr.split("\n").filter((line) => line !== "");
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(line).toMatch(/^\[event-rules\] [^:]+: \w+( \(SQLSTATE [0-9A-Z]{5}\)| \(E[A-Z]{2,20}\))?$/u);
      expect(run.stderr).not.toContain(" at ");
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
      await running?.catch(() => undefined);
    }
  }, 120_000);

  it("counts an enquiry apart from its bookings, not its near neighbours, and leaves the status and the counts alone", async () => {
    const v = await venue(pool, "event rules apart");
    let day = 0;
    /** A live hold for the enquiry in the event, each on a day of its own; a deleted one when asked. */
    const holdIn = async (enquiryId: string, eventId: string, deleted = false): Promise<void> => {
      day += 1;
      await pool.query(`INSERT INTO bookings (venue_id, space_id, event_id, enquiry_id, kind, status, title, starts_at, ends_at, deleted_at)
        VALUES ($1, $2, $3, $4, 'hold', 'active', 'Held date', $5::timestamptz, $5::timestamptz + interval '4 hours',
          CASE WHEN $6 THEN now() END)`,
      [v.venueId, v.rooms.hall, eventId, enquiryId, new Date(Date.parse("2032-02-02T18:00:00Z") + day * 86_400_000).toISOString(), deleted]);
    };
    /** An enquiry linked to an event of its own name. */
    const linked = async (name: string): Promise<{ readonly enquiryId: string; readonly linkedTo: string }> => {
      const enquiryId = await enquiry(pool, v.venueId);
      const linkedTo = await event(pool, v.venueId, name);
      await link(pool, "enquiries", enquiryId, linkedTo);
      return { enquiryId, linkedTo };
    };
    const before = readReport(await checkEventRules(db, { join: false }));

    // Apart: linked to one event, its only booking in another live one.
    const apart = await linked("Apart, linked");
    await holdIn(apart.enquiryId, await event(pool, v.venueId, "Apart, booked"));
    // Its near neighbours, none counted:
    // the linked event holds one of its bookings, another sits elsewhere;
    const both = await linked("Both, linked");
    await holdIn(both.enquiryId, both.linkedTo);
    await holdIn(both.enquiryId, await event(pool, v.venueId, "Both, elsewhere"));
    // no bookings at all;
    await linked("None");
    // its only booking elsewhere is deleted;
    const deletedBooking = await linked("Deleted booking, linked");
    await holdIn(deletedBooking.enquiryId, await event(pool, v.venueId, "Deleted booking, elsewhere"), true);
    // its only booking elsewhere sits in a deleted event.
    const deletedEvent = await linked("Deleted event, linked");
    const gone = await event(pool, v.venueId, "Since deleted");
    await holdIn(deletedEvent.enquiryId, gone);
    await pool.query("UPDATE events SET deleted_at = now() WHERE id = $1", [gone]);

    expect(await readEnquiriesApartFromTheirBookings(db, v.venueId)).toBe(1);
    const after = readReport(await checkEventRules(db, { join: false }));
    expect(after.enquiriesApartFromTheirBookings).toBe(before.enquiriesApartFromTheirBookings + 1);
    expect(after.status).toBe(before.status);
    expect([after.unboundBookings, after.contradictingEvents, spineCounts(after)])
      .toEqual([before.unboundBookings, before.contradictingEvents, spineCounts(before)]);
  });
});

describe.skipIf(target === undefined)("the event rules on a database the spine's migration has not reached", () => {
  let before: SpineDatabaseBefore;

  beforeAll(async () => {
    before = await openSpineDatabaseBefore("event_rules_unmigrated");
  }, 180_000);
  afterAll(async () => { await before?.close(); });

  it("exits 2 and says in plain words that the migration is not applied, with the join's outcome and what is pending", async () => {
    const run = await runCommand(before.url, ["--join"]);

    expectNoConnectionDetails(run, before.url);
    expect(run.code).toBe(2);
    const printed = UnreadLineSchema.parse(theLine(run));
    // Pending is the spine's migration and every one after it; applied is every one before it. True
    // whether or not later migrations follow the spine's.
    const tags = (await loadBundledJournal()).map((entry) => entry.tag);
    const spineTag = tags.find((tag) => tag.endsWith("_event_spine_links"));
    if (spineTag === undefined) throw new Error("The journal holds no *_event_spine_links migration");
    const spinePlace = tags.indexOf(spineTag);
    expect(printed.migrations.pending).toEqual(tags.slice(spinePlace));
    expect(printed.migrations.applied).toBe(spinePlace);
    expect(printed.migrations.local).toBe(tags.length);
    // The join fails first, on the function the migration makes; then the read, on what it adds.
    const joinRun = printed.joinRun;
    if (joinRun === undefined || !("error" in joinRun)) throw new Error("The join did not fail");
    expect(joinRun.error).toMatch(new RegExp(`^\\w+ \\(SQLSTATE 42883\\): ${NOT_APPLIED}$`, "u"));
    expect(printed.readError).toMatch(new RegExp(`^\\w+ \\(SQLSTATE 42(703|P01)\\): ${NOT_APPLIED}$`, "u"));
    expect(run.stderr).toContain("[event-rules] the join failed and was rolled back: ");
    expect(run.stderr).toContain("[event-rules] the read failed: ");
    expect(run.stderr).not.toContain(" at ");
  }, 120_000);
});
