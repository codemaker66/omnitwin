import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import { checkEventRules, exitCodeOf, isFailedJoin, type EventRulesReport } from "../scripts/check-booking-event-bind.js";
import { SPINE_INVARIANT_FIELDS } from "../services/event-spine-invariant.js";
import {
  deal,
  enquiry,
  event,
  insertReview,
  openSpineDatabase,
  platformTarget,
  proposal,
  venue,
  type SpineDatabase,
} from "./helpers/event-spine-fixtures.js";

// ---------------------------------------------------------------------------
// The operator's read of the event rules (scripts/check-booking-event-bind.ts),
// which the deploy and the nightly workflows run with --join, on a database of
// its own (openSpineDatabase; the shared platform database is only the door to
// the cluster). The cases run in order on that one database, because the
// script reads and joins the whole database, as it does in production:
//
//   1. Without --join the run writes nothing and reports the two bind counts,
//      the nine spine counts and both lists, and no joinRun.
//   2. A join that cannot have a lock within its 5 s limit rolls back whole,
//      is reported by its SQLSTATE alone, and the counts are still read.
//   3. With --join, one unjoined worked chain (an answered enquiry, its deal,
//      a sent proposal and its deposit request) is joined, and the counts
//      then read zero: the rules hold.
//   4. Open questions on the list of joins to check, and October's list, are
//      reported and leave the status to the counts.
//   5. The command itself prints one line of JSON and never the connection
//      string, and exits 0 when the rules hold.
// ---------------------------------------------------------------------------

const target = platformTarget();
const API_ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT = resolve(API_ROOT, "src/scripts/check-booking-event-bind.ts");

describe.skipIf(target === undefined)("the event rules: the operator's read and the join it runs", () => {
  let spine: SpineDatabase;
  let pool: Pool;
  let db: Database;
  /** The worked chain of case 1, joined in case 3. */
  let chain: { readonly venueId: string; readonly enquiryId: string; readonly dealId: string;
    readonly proposalId: string; readonly requestId: string };

  beforeAll(async () => {
    spine = await openSpineDatabase("event_rules_check");
    pool = spine.pool;
    db = spine.db;
  }, 180_000);
  afterAll(async () => { await spine?.close(); });

  /** What any write by the script would change: the rows the join makes and the links it sets. */
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

  it("reads without writing: the two bind counts, the nine spine counts, both lists and no joinRun", async () => {
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
    const report = await checkEventRules(db, { join: false });
    expect(await footprint()).toEqual(before);

    expect(report).not.toHaveProperty("joinRun");
    expect(report.status).toBe("broken");
    expect(report.unboundBookings).toBe(0);
    expect(report.contradictingEvents).toBe(0);
    expect(spineCounts(report)).toEqual(BEFORE_THE_JOIN);
    expect(report.reviewList).toEqual({});
    expect(report.joinsToCheck).toEqual({});
    expect(Object.keys(report)).toEqual(["status", "unboundBookings", "contradictingEvents", ...SPINE_INVARIANT_FIELDS,
      "reviewList", "joinsToCheck"]);
    expect(exitCodeOf(report)).toBe(1);
  });

  it("rolls a join that cannot have its lock back whole, names it by SQLSTATE alone, and still reads the counts", async () => {
    // The event the join would make for the enquiry needs a key share on its
    // venue; a venue row held FOR UPDATE refuses it until the join's own 5 s
    // lock limit (the pool's own limit is 20 s).
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM venues WHERE id = $1 FOR UPDATE", [chain.venueId]);
      const before = await footprint();
      const started = Date.now();
      const report = await checkEventRules(db, { join: true });
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
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
  }, 60_000);

  it("joins one unjoined worked chain with --join, and the counts then read zero", async () => {
    const report = await checkEventRules(db, { join: true });

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
    expect((await checkEventRules(db, { join: true })).joinRun).toEqual({ joined: 0, eventsMade: 0, listed: 0 });
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

    const report = await checkEventRules(db, { join: false });

    expect(report.joinsToCheck).toEqual({ possibly_same_event: 1, reaches_many_events: 1 });
    expect(report.reviewList).toEqual({ event_status_derived: 1 });
    expect(report.status).toBe("holds");
    expect(exitCodeOf(report)).toBe(0);
  });

  it("prints one line of JSON from the command, never the connection string, and exits 0 when the rules hold", async () => {
    const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
    const run = await new Promise<{ code: number | null; stdout: string; stderr: string }>((done, fail) => {
      const child = spawn(process.execPath, [tsxCli, SCRIPT, "--join"], {
        cwd: API_ROOT,
        env: { ...process.env, DATABASE_URL: spine.url },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
      child.on("error", fail);
      child.on("close", (code) => { done({ code, stdout, stderr }); });
    });

    const url = new URL(spine.url);
    for (const secretish of [spine.url, url.host, url.pathname.slice(1)]) {
      expect(run.stdout).not.toContain(secretish);
      expect(run.stderr).not.toContain(secretish);
    }
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
    expect(run.stdout.endsWith("\n")).toBe(true);
    expect(run.stdout.slice(0, -1)).not.toContain("\n");
    const printed = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(printed).toMatchObject({
      status: "holds",
      unboundBookings: 0,
      contradictingEvents: 0,
      joinsToCheck: { possibly_same_event: 1, reaches_many_events: 1 },
      reviewList: { event_status_derived: 1 },
      joinRun: { joined: 0, eventsMade: 0, listed: 0 },
    });
    for (const field of SPINE_INVARIANT_FIELDS) expect(printed[field]).toBe(0);
  }, 120_000);
});
