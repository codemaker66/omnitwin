import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readSpineInvariant, type SpineInvariant } from "../services/event-spine-invariant.js";
import {
  deal as dealIn,
  enquiry as enquiryIn,
  event as eventIn,
  openSpineDatabase,
  openSpineDatabaseBefore,
  platformTarget,
  venue as venueIn,
  type SpineDatabase,
  type SpineDatabaseBefore,
} from "./helpers/event-spine-fixtures.js";

// ---------------------------------------------------------------------------
// The spine's join of old records (spine_join_old_records, in migration
// *_event_spine_links), run by the real migrator over a database written
// before it. A proposal, deal or enquiry that has no event joins the one event
// a path reaches: its enquiry's held dates, its floor plan's link, its deal or
// enquiry, its deposit request. One that paths place in more than one event,
// or two paths in different events, goes on the list of joins to check. One
// that must have an event and that no path reaches gets an event of its own.
// Nothing is matched by name, email, title or date. An enquiry is carried onto
// any event its deal or proposal is given. Run again, it changes nothing, and
// a listed record stays untouched even once a path reaches it.
//
// The cases, by letter. Venue `mixed` holds every one; venue `clean` only A,
// B, F, I and the second K, so nothing in it is in doubt.
//  A  a worked enquiry, no held date, with one open deal and one sent proposal for that deal
//  B  an enquiry with two holds in one event, its deal and its proposal
//  C  an enquiry whose holds sit in two live events, with an open deal and a sent proposal
//  D  an unworked, submitted enquiry
//  E  a turned-down enquiry that had a reply
//  F  an enquiry with no held date whose plan is linked to one live event (and to a deleted one)
//  G  an enquiry with a hold in X whose plan is linked to Y
//  H  one worked enquiry with two open deals and one lost deal
//  I  an open deal with no enquiry; a lost deal with no enquiry
//  J  proposals from a plan alone: a draft (its plan linked to one event); a sent one whose plan is
//     linked to one event; to two; to none; and two declined ones, whose plans reach one event and two
//  K  an accepted proposal whose deposit request in force names Z while its deal's event is W;
//     one whose deposit request names no event (a withdrawn one of it names Z); and one whose
//     deposit request names an event since deleted
//  L  an access request (event_type 'venue-access') with a reply; the same type ending in a tab;
//     a pricing request whose type is padded with spaces, with a reply
//  M  an enquiry named only by an email address, worked; one whose name is blank; and one whose
//     event_type is 100 characters long
//  N  three event_binding_reviews rows, one of each reason, whose detail text holds a booking's title
//  O  a withdrawn enquiry with a sent proposal and no path to any event
//  P  a turned-down enquiry with a lost deal, which a writer later gives an event
//  R  a withdrawn enquiry with two sent proposals, one whose plan reaches one event and one that
//     reaches nothing, written in both orders
//
// The same cases then show the undo (spine_undo_joins): after a person moves
// one joined record and links a floor plan to one event the join made, the
// undo puts every other link, event and phase back as it was before the
// migration, row for row, keeps those two with their joins, and the join run
// again lands where it did.
//
// A second block runs the join beside a writer on another connection: a row
// the writer holds is left for the next run, never waited for; a writer's
// uncommitted open deal on the same event is waited for 100 ms at most, and
// the event is held only as a key share, so a writer taking it FOR NO KEY
// UPDATE never waits and one taking it FOR UPDATE is never half of a
// deadlock; and while a writer holds the event an enquiry's held dates sit in,
// nothing is made for the enquiry or its deal. A third runs the undo beside a
// writer: a record or an event the writer holds is left to the undo's next
// run, never waited for.
//
// The suites run on throwaway databases of their own (openSpineDatabaseBefore,
// a fresh one for each case of the first block, and openSpineDatabase); the
// shared platform database is only the door to the cluster.
// ---------------------------------------------------------------------------

const target = platformTarget();

type Row = Record<string, unknown>;
type LinkedTable = "enquiries" | "opportunities" | "proposals";
type Question = readonly [kind: string, subjectId: string, reason: string];

interface Place { readonly venueId: string; readonly room: string }

/** The count of records without their event (readSpineInvariant) where nothing is owed. */
const allZero: SpineInvariant = {
  proposalsWithoutEvent: 0, agreementsWithoutEvent: 0, depositRequestsWithoutEvent: 0, openDealsWithoutEvent: 0,
  workedEnquiriesWithoutEvent: 0, eventsWithTwoOpenDeals: 0, disagreeingLinks: 0, linksToClosedEvents: 0, eventDealPointersInUse: 0,
};

describe.skipIf(target === undefined)("the spine: the join of old records", () => {
  let before: SpineDatabaseBefore | undefined;
  let legacy: Pool;

  // Each case runs the migration once, so each has a database written before it.
  beforeEach(async () => {
    before = await openSpineDatabaseBefore("links_migration");
    legacy = before.pool;
  }, 180_000);
  afterEach(async () => {
    const done = before;
    before = undefined;
    await done?.close();
  });

  const q = (text: string, values: readonly unknown[] = []) => legacy.query<Row>(text, [...values]);

  async function id(text: string, values: readonly unknown[]): Promise<string> {
    const [row] = (await legacy.query<{ id: string }>(text, [...values])).rows;
    if (row === undefined) throw new Error("The fixture wrote no row");
    return row.id;
  }

  // Rows are written a minute apart in the order they are made, so "oldest first" is fixed;
  // each held date is on a day of its own.
  let clock = Date.parse("2026-01-05T09:00:00.000Z");
  const written = (): string => { clock += 60_000; return new Date(clock).toISOString(); };
  let day = 0;
  const nextDay = (): readonly [string, string] => {
    day += 1;
    const start = Date.parse("2031-03-01T18:00:00.000Z") + day * 86_400_000;
    return [new Date(start).toISOString(), new Date(start + 4 * 3_600_000).toISOString()];
  };

  // -- Rows, written with plain SQL against the schema before the spine -----

  async function place(label: string): Promise<Place> {
    const venueId = randomUUID(), room = randomUUID();
    await q("INSERT INTO venues (id, name, slug, address) VALUES ($1, $2, $3, 'Disposable fixture')",
      [venueId, `TEST ONLY ${label}`, `spine-join-${venueId}`]);
    await q(`INSERT INTO spaces (id, venue_id, name, slug, width_m, length_m, height_m, floor_plan_outline, sort_order)
      VALUES ($1, $2, 'Grand Hall', $3, 20, 10, 6, '[]'::jsonb, 0)`, [room, venueId, `room-${room}`]);
    return { venueId, room };
  }

  const event = (p: Place, name: string, deleted = false): Promise<string> =>
    id("INSERT INTO events (venue_id, name, status, deleted_at) VALUES ($1, $2, 'draft', CASE WHEN $3 THEN now() END) RETURNING id",
      [p.venueId, name, deleted]);

  interface EnquiryInput {
    readonly name?: string;
    readonly state?: string;
    readonly eventType?: string | null;
    readonly replied?: boolean;
    readonly plan?: string;
  }

  /** An enquiry; a reply, when given, is recorded the moment it was written. */
  async function enquiry(p: Place, input: EnquiryInput = {}): Promise<string> {
    const enquiryId = randomUUID();
    return id(`INSERT INTO enquiries (id, venue_id, space_id, state, name, email, event_type, configuration_id, created_at,
        first_response_at, first_response_channel, first_response_recorded_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
        CASE WHEN $10 THEN $9::timestamptz END, CASE WHEN $10 THEN 'email' END, CASE WHEN $10 THEN $9::timestamptz END)
      RETURNING id`, [enquiryId, p.venueId, p.room, input.state ?? "under_review", input.name ?? "Fixture enquirer",
      `${enquiryId}@legacy.invalid`, input.eventType === undefined ? "wedding" : input.eventType, input.plan ?? null,
      written(), input.replied ?? false]);
  }

  /** A hold for an enquiry, in the event it already sits in (0090's rule). */
  async function hold(p: Place, enquiryId: string, eventId: string): Promise<string> {
    const [startsAt, endsAt] = nextDay();
    return id(`INSERT INTO bookings (venue_id, space_id, event_id, enquiry_id, kind, status, title, starts_at, ends_at, created_at)
      VALUES ($1, $2, $3, $4, 'hold', 'active', 'Held date', $5, $6, $7) RETURNING id`,
    [p.venueId, p.room, eventId, enquiryId, startsAt, endsAt, written()]);
  }

  interface DealInput { readonly title?: string; readonly stage?: string; readonly enquiryId?: string }

  const deal = (p: Place, input: DealInput = {}): Promise<string> => {
    const stage = input.stage ?? "new";
    return id(`INSERT INTO opportunities (venue_id, title, stage, source_enquiry_id, created_at, closed_at)
      VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN $5::timestamptz END) RETURNING id`,
    [p.venueId, input.title ?? "Fixture deal", stage, input.enquiryId ?? null, written(), ["won", "lost", "archived"].includes(stage)]);
  };

  interface ProposalInput {
    readonly status?: string;
    readonly dealId?: string;
    readonly enquiryId?: string;
    readonly plan?: string;
    readonly title?: string;
  }

  /** A proposal; one that was sent carries the moment it was sent, as its CHECK asks. */
  const proposal = (p: Place, input: ProposalInput = {}): Promise<string> => {
    const status = input.status ?? "sent";
    const sent = ["sent", "changes_requested", "accepted", "declined", "expired"].includes(status);
    return id(`INSERT INTO proposals (venue_id, title, status, sent_at, opportunity_id, enquiry_id, configuration_id, created_at)
      VALUES ($1, $2, $3, CASE WHEN $8 THEN $7::timestamptz END, $4, $5, $6, $7) RETURNING id`,
    [p.venueId, input.title ?? "Fixture proposal", status, input.dealId ?? null, input.enquiryId ?? null, input.plan ?? null,
      written(), sent]);
  };

  /** A floor plan, and its link to an event. */
  const plan = (p: Place): Promise<string> =>
    id("INSERT INTO configurations (space_id, venue_id, name, layout_style) VALUES ($1, $2, 'Fixture plan', 'dinner-rounds') RETURNING id",
      [p.room, p.venueId]);
  const linkPlan = async (eventId: string, planId: string): Promise<void> => {
    await q("INSERT INTO event_configuration_links (event_id, configuration_id, link_type) VALUES ($1, $2, 'source_configuration')",
      [eventId, planId]);
  };

  /** A deposit request on a proposal, naming an event or none; a withdrawn one is not in force. */
  const depositRequest = (p: Place, proposalId: string, eventId: string | null, withdrawn = false): Promise<string> =>
    id(`INSERT INTO proposal_deposit_requests (venue_id, proposal_id, event_id, proposal_version, proposal_version_hash, basis,
        quote_total_minor, amount_minor, currency, cancelled_at)
      VALUES ($1, $2, $3, 1, $4, 'amount', 100000, 25000, 'GBP', CASE WHEN $5 THEN now() END) RETURNING id`,
    [p.venueId, proposalId, eventId, "a".repeat(64), withdrawn]);

  // -- The cases -------------------------------------------------------------

  async function caseA(p: Place) {
    const enquiryId = await enquiry(p);
    const dealId = await deal(p, { stage: "qualified", enquiryId });
    return { enquiry: enquiryId, deal: dealId, proposal: await proposal(p, { status: "sent", dealId }) };
  }

  async function caseB(p: Place) {
    const eventId = await event(p, "Burns supper");
    const enquiryId = await enquiry(p);
    await hold(p, enquiryId, eventId);
    await hold(p, enquiryId, eventId);
    const dealId = await deal(p, { stage: "negotiation", enquiryId });
    return { event: eventId, enquiry: enquiryId, deal: dealId,
      proposal: await proposal(p, { status: "changes_requested", dealId, enquiryId }) };
  }

  async function caseC(p: Place) {
    const first = await event(p, "Mair, first date"), second = await event(p, "Mair, second date");
    const enquiryId = await enquiry(p);
    await hold(p, enquiryId, first);
    await hold(p, enquiryId, second);
    const dealId = await deal(p, { stage: "proposal_sent", enquiryId });
    return { second, enquiry: enquiryId, deal: dealId, proposal: await proposal(p, { status: "sent", dealId, enquiryId }) };
  }

  async function caseF(p: Place) {
    const eventId = await event(p, "Lennox dinner");
    const planId = await plan(p);
    await linkPlan(eventId, planId);
    await linkPlan(await event(p, "Lennox, deleted", true), planId);
    return { event: eventId, enquiry: await enquiry(p, { state: "submitted", plan: planId }) };
  }

  async function caseG(p: Place) {
    const x = await event(p, "Where the hold is"), y = await event(p, "Where the plan is");
    const planId = await plan(p);
    await linkPlan(y, planId);
    const enquiryId = await enquiry(p, { plan: planId });
    await hold(p, enquiryId, x);
    return { x, enquiry: enquiryId };
  }

  async function caseH(p: Place) {
    const enquiryId = await enquiry(p);
    const first = await deal(p, { stage: "new", enquiryId });
    const lost = await deal(p, { stage: "lost", enquiryId });
    const second = await deal(p, { stage: "qualified", enquiryId });
    return { enquiry: enquiryId, first, lost, second };
  }

  async function caseI(p: Place) {
    return { open: await deal(p, { title: "Chamber dinner", stage: "proposal_sent" }), lost: await deal(p, { title: "Spring ball", stage: "lost" }) };
  }

  async function caseJ(p: Place) {
    const eventId = await event(p, "The plan's one event");
    const onePlan = await plan(p), twoPlan = await plan(p), barePlan = await plan(p);
    await linkPlan(eventId, onePlan);
    await linkPlan(await event(p, "First of two"), twoPlan);
    await linkPlan(await event(p, "Second of two"), twoPlan);
    return {
      event: eventId,
      draft: await proposal(p, { status: "draft", plan: onePlan }),
      oneLink: await proposal(p, { status: "sent", plan: onePlan }),
      twoLinks: await proposal(p, { status: "sent", plan: twoPlan }),
      noLink: await proposal(p, { status: "sent", plan: barePlan }),
      declinedOne: await proposal(p, { status: "declined", plan: onePlan }),
      declinedTwo: await proposal(p, { status: "declined", plan: twoPlan }),
    };
  }

  async function caseK(p: Place, withDisagreement: boolean) {
    const w = await event(p, "W"), z = await event(p, "Z");
    const enquiryId = await enquiry(p);
    await hold(p, enquiryId, w);
    const dealId = await deal(p, { stage: "won", enquiryId });
    let disagrees: string | null = null, deadRequest: string | null = null;
    if (withDisagreement) {
      disagrees = await proposal(p, { status: "accepted", dealId });
      await depositRequest(p, disagrees, z);
      deadRequest = await proposal(p, { status: "accepted", dealId });
      await depositRequest(p, deadRequest, await event(p, "Since deleted", true));
    }
    const agrees = await proposal(p, { status: "accepted", dealId });
    const emptyRequest = await depositRequest(p, agrees, null);
    await depositRequest(p, agrees, z, true);
    return { w, disagrees, deadRequest, agrees, emptyRequest };
  }

  async function caseL(p: Place) {
    return {
      enquiry: await enquiry(p, { eventType: "venue-access", replied: true }),
      tabbed: await enquiry(p, { eventType: "venue-access\t", replied: true }),
      nonBreaking: await enquiry(p, { eventType: `${String.fromCodePoint(0xa0)}venue-access`, replied: true }),
      padded: await enquiry(p, { eventType: " venue-enquiry ", replied: true }),
    };
  }

  /** A withdrawn enquiry with two sent proposals and no deal: one reaches nothing, the other's plan
   *  is linked to one live event. Written in either order, all three end on that event. */
  async function caseR(p: Place, planFirst: boolean) {
    const y = await event(p, "Where the plan is");
    const planId = await plan(p);
    await linkPlan(y, planId);
    const enquiryId = await enquiry(p, { state: "withdrawn" });
    const linked = async () => proposal(p, { status: "sent", enquiryId, plan: planId });
    const bare = async () => proposal(p, { status: "sent", enquiryId });
    const first = planFirst ? await linked() : await bare();
    const second = planFirst ? await bare() : await linked();
    return { y, enquiry: enquiryId, withPlan: planFirst ? first : second, withoutPlan: planFirst ? second : first };
  }

  async function caseO(p: Place) {
    const enquiryId = await enquiry(p, { name: "Ross", state: "withdrawn" });
    return { enquiry: enquiryId, proposal: await proposal(p, { status: "sent", enquiryId, title: "Ross lunch" }) };
  }

  async function caseP(p: Place) {
    const enquiryId = await enquiry(p, { state: "rejected" });
    return { enquiry: enquiryId, deal: await deal(p, { stage: "lost", enquiryId }) };
  }

  async function caseM(p: Place) {
    return {
      address: await enquiry(p, { name: "jo.bloggs@legacy.invalid", replied: true }),
      blank: await enquiry(p, { name: "   ", replied: true }),
      longType: await enquiry(p, { name: "Kerr", eventType: "Dinner dance ".repeat(8).slice(0, 100), replied: true }),
    };
  }

  async function caseN(p: Place): Promise<void> {
    const eventId = await event(p, "Gordon–Hay ceremony");
    const [startsAt, endsAt] = nextDay();
    const bookingId = await id(`INSERT INTO bookings (venue_id, space_id, event_id, kind, status, title, starts_at, ends_at)
      VALUES ($1, $2, $3, 'prospect', 'active', 'Gordon–Hay ceremony', $4, $5) RETURNING id`, [p.venueId, p.room, eventId, startsAt, endsAt]);
    await q(`INSERT INTO event_binding_reviews (venue_id, event_id, booking_id, reason, detail, previous_status) VALUES
      ($1, $2, $3, 'enquiry_events_differ', 'Joined its enquiry''s event "Gordon–Hay ceremony".', NULL),
      ($1, $2, $3, 'possibly_same_event', 'Given a new event. "Gordon–Hay ceremony" is near the same time.', NULL),
      ($1, $2, NULL, 'event_status_derived', 'The status of "Gordon–Hay ceremony" now follows its bookings: confirmed became draft.', 'confirmed')`,
    [p.venueId, eventId, bookingId]);
  }

  // -- Reading what the join did ---------------------------------------------

  async function eventOf(table: LinkedTable, recordId: string): Promise<string | null> {
    const [row] = (await legacy.query<{ event_id: string | null }>(`SELECT event_id FROM ${table} WHERE id = $1`, [recordId])).rows;
    if (row === undefined) throw new Error(`No ${table} row ${recordId}`);
    return row.event_id;
  }

  async function eventRow(eventId: string | null): Promise<Row> {
    if (eventId === null) throw new Error("The record has no event");
    const [row] = (await q("SELECT * FROM events WHERE id = $1", [eventId])).rows;
    if (row === undefined) throw new Error(`No event ${eventId}`);
    return row;
  }

  async function count(text: string, values: readonly unknown[] = []): Promise<number> {
    const [row] = (await legacy.query<{ count: number }>(text, [...values])).rows;
    if (row === undefined) throw new Error("No count");
    return row.count;
  }

  const phaseCount = (eventId: string | null): Promise<number> =>
    count("SELECT count(*)::int AS count FROM event_phases WHERE event_id = $1", [eventId]);

  const depositEvent = async (requestId: string): Promise<string | null> =>
    (await legacy.query<{ event_id: string | null }>("SELECT event_id FROM proposal_deposit_requests WHERE id = $1", [requestId])).rows[0]?.event_id ?? null;

  const sorted = (rows: readonly Question[]): Question[] =>
    [...rows].sort((x, y) => (x.join(" ") < y.join(" ") ? -1 : x.join(" ") > y.join(" ") ? 1 : 0));

  /** The open questions the join wrote for a venue (copies of October's list stand apart). */
  async function openReviews(venueId: string): Promise<Question[]> {
    const rows = (await legacy.query<{ subject_kind: string; subject_id: string; reason: string }>(`SELECT subject_kind, subject_id, reason
      FROM event_link_reviews WHERE venue_id = $1 AND resolved_at IS NULL AND binding_review_id IS NULL`, [venueId])).rows;
    return sorted(rows.map((row) => [row.subject_kind, row.subject_id, row.reason] as const));
  }

  const copiedReviewCount = (venueId: string): Promise<number> =>
    count("SELECT count(*)::int AS count FROM event_link_reviews WHERE venue_id = $1 AND binding_review_id IS NOT NULL", [venueId]);

  /** October's notes of a derived status for a venue: still in its own table, and how many were copied. */
  const octoberStatusNotes = async (venueId: string): Promise<{ kept: number; copied: number }> => ({
    kept: await count("SELECT count(*)::int AS count FROM event_binding_reviews WHERE venue_id = $1 AND reason = 'event_status_derived'", [venueId]),
    copied: await count(`SELECT count(*)::int AS count FROM event_link_reviews l JOIN event_binding_reviews r ON r.id = l.binding_review_id
      WHERE l.venue_id = $1 AND r.reason = 'event_status_derived'`, [venueId]),
  });

  /** The join in force recorded for a record: how it was reached, and whether its event was made for it. */
  async function joinOf(kind: string, subjectId: string): Promise<readonly [path: string, eventMade: boolean] | null> {
    const [row] = (await legacy.query<{ path: string; event_made: boolean }>(`SELECT path, event_made FROM event_link_joins
      WHERE subject_kind = $1 AND subject_id = $2 AND undone_at IS NULL`, [kind, subjectId])).rows;
    return row === undefined ? null : [row.path, row.event_made];
  }

  const candidatesOf = async (subjectId: string): Promise<string[] | undefined> =>
    (await legacy.query<{ candidate_event_ids: string[] }>(`SELECT candidate_event_ids FROM event_link_reviews
      WHERE subject_id = $1 AND resolved_at IS NULL AND binding_review_id IS NULL`, [subjectId])).rows[0]?.candidate_event_ids;

  const venueEvents = (venueId: string): Promise<number> =>
    count("SELECT count(*)::int AS count FROM events WHERE venue_id = $1", [venueId]);

  const runJoin = async (): Promise<Row | undefined> => (await q("SELECT * FROM spine_join_old_records()")).rows[0];

  const reviewDetails = async (venueId: string): Promise<string[]> =>
    (await legacy.query<{ detail: string }>("SELECT detail FROM event_link_reviews WHERE venue_id = $1", [venueId])).rows.map((row) => row.detail);

  /** Links with no join in force recorded for them, and joins in force whose record no longer holds their event. */
  const joinsWithoutRecord = (): Promise<number> => count(`SELECT ((
      SELECT count(*) FROM (
        SELECT 'enquiry' AS kind, x.id, x.event_id FROM enquiries x WHERE x.event_id IS NOT NULL
        UNION ALL SELECT 'opportunity', x.id, x.event_id FROM opportunities x WHERE x.event_id IS NOT NULL
        UNION ALL SELECT 'proposal', x.id, x.event_id FROM proposals x WHERE x.event_id IS NOT NULL
      ) linked
      WHERE NOT EXISTS (SELECT 1 FROM event_link_joins j WHERE j.subject_kind = linked.kind AND j.subject_id = linked.id
        AND j.event_id = linked.event_id AND j.undone_at IS NULL)
    ) + (
      SELECT count(*) FROM event_link_joins j WHERE j.undone_at IS NULL AND j.event_id IS DISTINCT FROM (CASE j.subject_kind
        WHEN 'enquiry' THEN (SELECT x.event_id FROM enquiries x WHERE x.id = j.subject_id)
        WHEN 'opportunity' THEN (SELECT x.event_id FROM opportunities x WHERE x.id = j.subject_id)
        WHEN 'proposal' THEN (SELECT x.event_id FROM proposals x WHERE x.id = j.subject_id)
        ELSE (SELECT x.event_id FROM proposal_deposit_requests x WHERE x.id = j.subject_id) END)
    ))::int AS count`);

  /** Any link, deposit request or join row whose event is another venue's. */
  const crossVenueLinks = (): Promise<number> => count(`SELECT count(*)::int AS count FROM (
      SELECT x.venue_id, x.event_id FROM enquiries x
      UNION ALL SELECT x.venue_id, x.event_id FROM opportunities x
      UNION ALL SELECT x.venue_id, x.event_id FROM proposals x
      UNION ALL SELECT x.venue_id, x.event_id FROM proposal_deposit_requests x
      UNION ALL SELECT x.venue_id, x.event_id FROM event_link_joins x
    ) l JOIN events e ON e.id = l.event_id WHERE e.venue_id <> l.venue_id`);

  async function snapshot(): Promise<Record<string, Row[]>> {
    const links = async (table: string): Promise<Row[]> => (await q(`SELECT id, event_id FROM ${table} ORDER BY id`)).rows;
    return {
      enquiries: await links("enquiries"),
      opportunities: await links("opportunities"),
      proposals: await links("proposals"),
      depositRequests: await links("proposal_deposit_requests"),
      events: (await q("SELECT id, status, deleted_at FROM events ORDER BY id")).rows,
      counts: (await q(`SELECT (SELECT count(*)::int FROM event_phases) AS phases, (SELECT count(*)::int FROM event_link_joins) AS joins,
        (SELECT count(*)::int FROM event_link_reviews) AS reviews`)).rows,
    };
  }

  it("joins what one path reaches, lists what is in doubt, makes an event where none can be reached, and changes nothing when run again", async () => {
    if (before === undefined) throw new Error("The database before the spine was not made");
    const mixedPlace = await place("join mixed"), cleanPlace = await place("join clean");
    const mixed = mixedPlace.venueId, clean = cleanPlace.venueId;
    const a = await caseA(mixedPlace), b = await caseB(mixedPlace), c = await caseC(mixedPlace);
    const d = { enquiry: await enquiry(mixedPlace, { state: "submitted" }) };
    const e = { enquiry: await enquiry(mixedPlace, { state: "rejected", replied: true }) };
    const f = await caseF(mixedPlace), g = await caseG(mixedPlace), h = await caseH(mixedPlace), i = await caseI(mixedPlace);
    const j = await caseJ(mixedPlace), k = await caseK(mixedPlace, true), l = await caseL(mixedPlace), m = await caseM(mixedPlace);
    await caseN(mixedPlace);
    const o = await caseO(mixedPlace), p = await caseP(mixedPlace);
    const rPlanFirst = await caseR(mixedPlace, true), rPlanSecond = await caseR(mixedPlace, false);
    await caseA(cleanPlace);
    await caseB(cleanPlace);
    await caseF(cleanPlace);
    await caseI(cleanPlace);
    await caseK(cleanPlace, false);
    if (k.disagrees === null || k.deadRequest === null) throw new Error("Case K in `mixed` has its disagreements");
    const mixedEventsBefore = await venueEvents(mixed);

    await before.migrateToHead();

    // A: one new event; the enquiry, the deal and the proposal all on it.
    expect(new Set([await eventOf("enquiries", a.enquiry), await eventOf("opportunities", a.deal), await eventOf("proposals", a.proposal)]).size).toBe(1);
    expect(await eventRow(await eventOf("enquiries", a.enquiry))).toMatchObject({ status: "draft", guest_count: 0, starts_at: null, deleted_at: null });
    expect(await phaseCount(await eventOf("enquiries", a.enquiry))).toBe(8);
    // B and F: the event one path reaches.
    expect(await eventOf("enquiries", b.enquiry)).toBe(b.event);
    expect(await eventOf("proposals", b.proposal)).toBe(b.event);
    expect(await eventOf("enquiries", f.enquiry)).toBe(f.event);
    // C and G: listed, not joined; C's deal and proposal wait with it.
    for (const [table, recordId] of [["enquiries", c.enquiry], ["opportunities", c.deal], ["proposals", c.proposal], ["enquiries", g.enquiry]] as const) {
      expect(await eventOf(table, recordId)).toBeNull();
    }
    // D, E, L, P: nothing. (L's types are trimmed as JavaScript trims, tab included.)
    for (const enquiryId of [d.enquiry, e.enquiry, l.enquiry, l.tabbed, l.nonBreaking, l.padded, p.enquiry]) {
      expect(await eventOf("enquiries", enquiryId)).toBeNull();
    }
    expect(await eventOf("opportunities", p.deal)).toBeNull();
    // H: the older open deal joins, the lost one joins as history, the newer open one is listed.
    expect(await eventOf("opportunities", h.first)).toBe(await eventOf("enquiries", h.enquiry));
    expect(await eventOf("opportunities", h.lost)).toBe(await eventOf("enquiries", h.enquiry));
    expect(await eventOf("opportunities", h.second)).toBeNull();
    // I: an event of its own for the open one, named by the deal; none for the lost one.
    expect((await eventRow(await eventOf("opportunities", i.open)))["name"]).toBe("Chamber dinner");
    expect(await eventOf("opportunities", i.lost)).toBeNull();
    // J. A declined one joins its plan's one event as history; reaching two, it is left, not listed.
    expect(await eventOf("proposals", j.draft)).toBeNull();
    expect(await eventOf("proposals", j.oneLink)).toBe(j.event);
    expect(await eventOf("proposals", j.twoLinks)).toBeNull();
    expect(await eventOf("proposals", j.noLink)).not.toBeNull();
    expect(await eventOf("proposals", j.declinedOne)).toBe(j.event);
    expect(await eventOf("proposals", j.declinedTwo)).toBeNull();
    // K: the disagreement is listed; so is a deposit request naming a deleted event, with its
    // deal's event as the candidate; the empty deposit request takes its proposal's event.
    expect(await eventOf("proposals", k.disagrees)).toBeNull();
    expect(await eventOf("proposals", k.deadRequest)).toBeNull();
    expect(await candidatesOf(k.deadRequest)).toEqual([k.w]);
    expect(await depositEvent(k.emptyRequest)).toBe(await eventOf("proposals", k.agrees));
    // O: the withdrawn enquiry is carried onto the event made for its proposal, named for it.
    expect(await eventOf("proposals", o.proposal)).not.toBeNull();
    expect(await eventOf("enquiries", o.enquiry)).toBe(await eventOf("proposals", o.proposal));
    expect(await eventRow(await eventOf("enquiries", o.enquiry))).toMatchObject({ name: "Ross", client_name: "Ross" });
    // R, in both orders: the plan's event, for the enquiry and both proposals; no event is made.
    for (const r of [rPlanFirst, rPlanSecond]) {
      expect([await eventOf("enquiries", r.enquiry), await eventOf("proposals", r.withPlan), await eventOf("proposals", r.withoutPlan)])
        .toEqual([r.y, r.y, r.y]);
    }

    // How each was joined.
    for (const [kind, subjectId, path, eventMade] of [
      ["enquiry", a.enquiry, "new_event", true], ["opportunity", a.deal, "enquiry", false], ["proposal", a.proposal, "deal", false],
      ["enquiry", b.enquiry, "enquiry_bookings", false], ["opportunity", b.deal, "enquiry", false], ["proposal", b.proposal, "deal", false],
      ["enquiry", f.enquiry, "plan_link", false], ["opportunity", i.open, "new_event", true],
      ["proposal", j.oneLink, "plan_link", false], ["proposal", j.noLink, "new_event", true], ["proposal", j.declinedOne, "plan_link", false],
      ["deposit_request", k.emptyRequest, "deal", false],
      ["enquiry", o.enquiry, "new_event", true], ["proposal", o.proposal, "enquiry", false],
      ["proposal", rPlanFirst.withPlan, "plan_link", false], ["enquiry", rPlanFirst.enquiry, "proposal", false],
      ["proposal", rPlanFirst.withoutPlan, "enquiry", false],
      ["proposal", rPlanSecond.withPlan, "plan_link", false], ["enquiry", rPlanSecond.enquiry, "proposal", false],
      ["proposal", rPlanSecond.withoutPlan, "enquiry", false],
    ] as const) {
      expect([kind, subjectId, await joinOf(kind, subjectId)]).toEqual([kind, subjectId, [path, eventMade]]);
    }
    // What the migration's run did in `mixed`: 29 joins, 8 of them on an event made for them,
    // and 8 events made, each with its eight phases.
    expect(await count("SELECT count(*)::int AS count FROM event_link_joins WHERE venue_id = $1", [mixed])).toBe(29);
    expect(await count("SELECT count(*)::int AS count FROM event_link_joins WHERE venue_id = $1 AND event_made", [mixed])).toBe(8);
    expect(await venueEvents(mixed) - mixedEventsBefore).toBe(8);
    expect(await count(`SELECT count(*)::int AS count FROM event_phases ph JOIN event_link_joins jn ON jn.event_id = ph.event_id
      WHERE jn.venue_id = $1 AND jn.event_made`, [mixed])).toBe(64);
    // M: a readable name, never '' and never an address; a long occasion is cut, not refused.
    expect((await eventRow(await eventOf("enquiries", m.blank)))["name"]).toBe("Event");
    expect(await eventRow(await eventOf("enquiries", m.address))).toMatchObject({ name: "Event", client_name: null });
    expect(String((await eventRow(await eventOf("enquiries", m.longType)))["event_type"])).toHaveLength(80);

    // The list: exactly these open questions, and October's two questions copied once; its note
    // of a derived status is not a question, and stays where it was.
    expect(await openReviews(mixed)).toEqual(sorted([
      ["enquiry", c.enquiry, "reaches_many_events"], ["enquiry", g.enquiry, "paths_disagree"],
      ["opportunity", h.second, "second_open_deal"], ["proposal", j.twoLinks, "reaches_many_events"],
      ["proposal", k.disagrees, "paths_disagree"], ["proposal", k.deadRequest, "paths_disagree"],
    ]));
    expect(await copiedReviewCount(mixed)).toBe(2);
    expect(await octoberStatusNotes(mixed)).toEqual({ kept: 1, copied: 0 });
    expect(await openReviews(clean)).toEqual([]);
    // No review row holds a name or an address.
    expect(await reviewDetails(mixed)).not.toEqual(expect.arrayContaining([expect.stringMatching(/@|Gordon|Chamber/)]));
    // Every join is recorded, and nothing crossed venues.
    expect(await joinsWithoutRecord()).toBe(0);
    expect(await crossVenueLinks()).toBe(0);
    // The count (readSpineInvariant) agrees with the join: zero for `clean`; for `mixed`, exactly
    // what its records in doubt give, for a listed record and what waits on it keep no event.
    //   proposals 4: C's (waits on its listed enquiry); J's sent one whose plan reaches two events
    //                (listed); K's two whose deposit request names another event or a deleted one (listed)
    //   open deals 2: C's (waits on its listed enquiry); H's second open deal (listed)
    //   enquiries 2: C's, held in two events, and G's, held in one and planned in another (both listed)
    //   links to closed events 1: K's deposit request in force naming a deleted event (its proposal listed)
    // D, E, L and P are not counted: unworked, turned down, an access request, turned down with a lost deal.
    expect(await readSpineInvariant(drizzle(legacy), clean)).toEqual(allZero);
    expect(await readSpineInvariant(drizzle(legacy), mixed)).toEqual({
      ...allZero, proposalsWithoutEvent: 4, openDealsWithoutEvent: 2, workedEnquiriesWithoutEvent: 2, linksToClosedEvents: 1,
    });

    // Run again: nothing changes.
    const unchanged = await snapshot();
    expect(await runJoin()).toEqual({ joined: 0, events_made: 0, listed: 0 });
    expect(await snapshot()).toEqual(unchanged);

    // A listed record is not touched, even once a path reaches it: one of C's two events is
    // deleted, so its held dates now sit in one; C still waits for a person.
    await q("UPDATE events SET deleted_at = now() WHERE id = $1", [c.second]);
    expect(await runJoin()).toEqual({ joined: 0, events_made: 0, listed: 0 });
    expect(await eventOf("enquiries", c.enquiry)).toBeNull();
    expect(await openReviews(mixed)).toContainEqual(["enquiry", c.enquiry, "reaches_many_events"]);

    // A writer gives a listed record its event: the next run closes its question, joined, by nobody.
    await q("UPDATE enquiries SET event_id = $1 WHERE id = $2", [g.x, g.enquiry]);
    expect(await runJoin()).toEqual({ joined: 0, events_made: 0, listed: 0 });
    expect((await q(`SELECT resolution, resolved_event_id, resolved_by, resolved_at IS NOT NULL AS resolved FROM event_link_reviews
      WHERE subject_id = $1 AND binding_review_id IS NULL`, [g.enquiry])).rows)
      .toEqual([{ resolution: "joined", resolved_event_id: g.x, resolved_by: null, resolved: true }]);

    // A writer gives P's lost deal an event: the next run carries the turned-down enquiry onto it.
    const later = await event(mixedPlace, "Given by a writer");
    await q("UPDATE opportunities SET event_id = $1 WHERE id = $2", [later, p.deal]);
    expect(await runJoin()).toEqual({ joined: 1, events_made: 0, listed: 0 });
    expect(await eventOf("enquiries", p.enquiry)).toBe(later);
    expect(await joinOf("enquiry", p.enquiry)).toEqual(["deal", false]);
  }, 180_000);

  // -- The undo --------------------------------------------------------------

  type Restorable = Record<"enquiries" | "opportunities" | "proposals" | "depositRequests" | "events" | "phases", Row[]>;
  const RECORD_TABLES = ["enquiries", "opportunities", "proposals", "depositRequests"] as const;

  /** Every link, event and phase; read the same way before the links exist (a link then reads null) and after. */
  async function restorable(): Promise<Restorable> {
    const links = async (table: string): Promise<Row[]> =>
      (await q(`SELECT id, to_jsonb(t) ->> 'event_id' AS event_id FROM ${table} t ORDER BY id`)).rows;
    return {
      enquiries: await links("enquiries"),
      opportunities: await links("opportunities"),
      proposals: await links("proposals"),
      depositRequests: await links("proposal_deposit_requests"),
      events: (await q("SELECT id, status, updated_at, deleted_at FROM events ORDER BY id")).rows,
      phases: (await q("SELECT id, event_id FROM event_phases ORDER BY id")).rows,
    };
  }

  /** Each record's event, an event the join made being named by the first record on it, so two runs of the join compare. */
  function shape(s: Restorable, existing: ReadonlySet<string>, leave: string): Array<readonly [string, string | null]> {
    const text = (value: unknown): string => {
      if (typeof value !== "string") throw new Error("Expected an id");
      return value;
    };
    const keyed = RECORD_TABLES.flatMap((table) => s[table].map((row) =>
      [`${table}:${text(row["id"])}`, row["event_id"] === null ? null : text(row["event_id"])] as const));
    const firstOn = new Map<string, string>();
    for (const [key, eventId] of keyed) {
      if (eventId !== null && !existing.has(eventId) && !firstOn.has(eventId)) firstOn.set(eventId, key);
    }
    return keyed.filter(([key]) => key !== `proposals:${leave}`)
      .map(([key, eventId]) => [key, eventId === null || existing.has(eventId) ? eventId : `made, first with ${firstOn.get(eventId) ?? "?"}`]);
  }

  it("undoes its own joins row for row, and leaves what a person changed", async () => {
    if (before === undefined) throw new Error("The database before the spine was not made");
    const mixedPlace = await place("undo mixed"), cleanPlace = await place("undo clean");
    const mixed = mixedPlace.venueId;
    // The cases of the first test.
    await caseA(mixedPlace);
    const b = await caseB(mixedPlace);
    await caseC(mixedPlace);
    await enquiry(mixedPlace, { state: "submitted" });
    await enquiry(mixedPlace, { state: "rejected", replied: true });
    const f = await caseF(mixedPlace);
    await caseG(mixedPlace);
    await caseH(mixedPlace);
    const i = await caseI(mixedPlace), j = await caseJ(mixedPlace);
    await caseK(mixedPlace, true);
    await caseL(mixedPlace);
    await caseM(mixedPlace);
    await caseN(mixedPlace);
    await caseO(mixedPlace);
    await caseP(mixedPlace);
    await caseR(mixedPlace, true);
    await caseR(mixedPlace, false);
    await caseA(cleanPlace);
    await caseB(cleanPlace);
    await caseF(cleanPlace);
    await caseI(cleanPlace);
    await caseK(cleanPlace, false);
    const untouched = await restorable();
    const existing = new Set(untouched.events.map((row) => String(row["id"])));

    await before.migrateToHead();
    const joined = await restorable();
    const listed = await openReviews(mixed);
    const inForce = await count("SELECT count(*)::int AS count FROM event_link_joins WHERE undone_at IS NULL");
    const made = await count("SELECT count(*)::int AS count FROM event_link_joins WHERE undone_at IS NULL AND event_made");
    const iOpenEvent = await eventOf("opportunities", i.open);
    if (iOpenEvent === null) throw new Error("I's open deal was given no event");
    expect(made).toBeGreaterThan(1);

    // A person moves one joined proposal to an event of their own, and links a floor plan to the event
    // the join made for I's open deal.
    const otherEvent = await event(mixedPlace, "Made by a person");
    await q("UPDATE proposals SET event_id = $1 WHERE id = $2", [otherEvent, j.oneLink]);
    await linkPlan(iOpenEvent, await plan(mixedPlace));

    // The undo, in a transaction of the caller's: once it returns, the link rule is back in force there.
    const client = await legacy.connect();
    try {
      await client.query("BEGIN");
      // Left: the proposal a person moved, and the one join to the made event a plan is now linked to.
      expect((await client.query<Row>("SELECT * FROM spine_undo_joins()")).rows[0])
        .toEqual({ emptied: inForce - 2, events_removed: made - 1, left_alone: 2 });
      expect((await client.query<Row>("SELECT current_setting('venviewer.undo_event_links', true) AS setting")).rows[0]?.["setting"])
        .not.toBe("on");
      await client.query("SAVEPOINT emptying");
      await expect(client.query("UPDATE proposals SET event_id = NULL WHERE id = $1", [j.oneLink])).rejects.toThrow(/cannot be removed/);
      await client.query("ROLLBACK TO SAVEPOINT emptying");
      await client.query("COMMIT");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }

    // The two left alone, with their joins in force; I's event kept whole, not orphaned.
    expect(await eventOf("proposals", j.oneLink)).toBe(otherEvent);
    expect(await eventOf("opportunities", i.open)).toBe(iOpenEvent);
    expect(await phaseCount(iOpenEvent)).toBe(8);
    expect([await joinOf("proposal", j.oneLink), await joinOf("opportunity", i.open)]).toEqual([["plan_link", false], ["new_event", true]]);
    expect(await count("SELECT count(*)::int AS count FROM event_link_joins WHERE undone_at IS NULL")).toBe(2);
    // Everything else is as it was before the migration, row for row: every link, every event, every phase.
    const withoutThose = (s: Restorable): Restorable => ({
      ...s,
      proposals: s.proposals.filter((row) => row["id"] !== j.oneLink),
      opportunities: s.opportunities.filter((row) => row["id"] !== i.open),
      events: s.events.filter((row) => row["id"] !== otherEvent && row["id"] !== iOpenEvent),
      phases: s.phases.filter((row) => row["event_id"] !== iOpenEvent),
    });
    expect(withoutThose(await restorable())).toEqual(withoutThose(untouched));
    // The open questions the join wrote are gone; the copies of October's list stay.
    expect(await openReviews(mixed)).toEqual([]);
    expect(await copiedReviewCount(mixed)).toBe(2);

    // The join can be run again afterwards and lands where it did; the two left alone stay where they are.
    expect(await runJoin()).toEqual({ joined: inForce - 2, events_made: made - 1, listed: listed.length });
    expect(shape(await restorable(), existing, j.oneLink)).toEqual(shape(joined, existing, j.oneLink));
    expect(await openReviews(mixed)).toEqual(listed);
    expect([await eventOf("enquiries", b.enquiry), await eventOf("enquiries", f.enquiry)]).toEqual([b.event, f.event]);
  }, 180_000);
});

describe.skipIf(target === undefined)("the spine: the join beside a live writer", () => {
  let spine: SpineDatabase | undefined;
  let pool: Pool;

  beforeAll(async () => {
    spine = await openSpineDatabase("links_join_beside_writer");
    pool = spine.pool;
  }, 180_000);
  afterAll(async () => { await spine?.close(); });

  /** A connection of its own whose lock waits give up after three seconds, so a wait fails rather than hangs. */
  async function connection(): Promise<PoolClient> {
    const client = await pool.connect();
    await client.query("SET lock_timeout = '3s'");
    return client;
  }

  async function replied(enquiryId: string): Promise<void> {
    await pool.query(`UPDATE enquiries SET first_response_at = created_at, first_response_channel = 'email',
      first_response_recorded_at = created_at WHERE id = $1`, [enquiryId]);
  }

  /** Returns as soon as the backend is seen waiting for a lock (the join's one bounded wait lasts 100 ms). */
  async function waitingOnALock(pid: number): Promise<void> {
    for (let tries = 0; tries < 600; tries += 1) {
      const [row] = (await pool.query<{ waiting: boolean }>(
        "SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1", [pid])).rows;
      if (row?.waiting === true) return;
      await new Promise((done) => setTimeout(done, 5));
    }
    throw new Error("The join never waited");
  }

  /** An enquiry with a hold in the event (so the join joins it there first) and an open deal of it. */
  async function heldWithDeal(v: { readonly venueId: string; readonly rooms: { readonly hall: string } }, eventId: string) {
    const enquiryId = await enquiryIn(pool, v.venueId, "under_review");
    await pool.query(`INSERT INTO bookings (venue_id, space_id, event_id, enquiry_id, kind, status, title, starts_at, ends_at)
      VALUES ($1, $2, $3, $4, 'hold', 'active', 'Held date', now() + interval '400 days', now() + interval '400 days 4 hours')`,
    [v.venueId, v.rooms.hall, eventId, enquiryId]);
    return { enquiryId, deal: await dealIn(pool, v.venueId, "new", enquiryId) };
  }

  const reviewsOf = async (subjectId: string): Promise<Row[]> =>
    (await pool.query<Row>("SELECT reason, candidate_event_ids FROM event_link_reviews WHERE subject_id = $1", [subjectId])).rows;
  const linkOf = async (table: LinkedTable, id: string): Promise<unknown> =>
    (await pool.query<Row>(`SELECT event_id FROM ${table} WHERE id = $1`, [id])).rows[0]?.["event_id"];
  const runOn = async (client: PoolClient): Promise<Row | undefined> =>
    (await client.query<Row>("SELECT * FROM spine_join_old_records()")).rows[0];

  it("leaves a row a writer holds to the next run, and does not wait for it", async () => {
    const v = await venueIn(pool, "join beside a writer");
    const free = await enquiryIn(pool, v.venueId, "under_review"), held = await enquiryIn(pool, v.venueId, "under_review");
    await replied(free);
    await replied(held);
    const writer = await pool.connect(), join = await connection();
    try {
      await writer.query("BEGIN");
      await writer.query("SELECT id FROM enquiries WHERE id = $1 FOR NO KEY UPDATE", [held]);
      expect((await join.query("SELECT * FROM spine_join_old_records()")).rows[0]).toEqual({ joined: 1, events_made: 1, listed: 0 });
      expect((await pool.query("SELECT id, event_id IS NOT NULL AS joined FROM enquiries WHERE id = ANY($1) ORDER BY id", [[free, held]])).rows)
        .toEqual([{ id: free, joined: true }, { id: held, joined: false }].sort((x, y) => (x.id < y.id ? -1 : 1)));
      await writer.query("COMMIT");
      expect((await join.query("SELECT * FROM spine_join_old_records()")).rows[0]).toEqual({ joined: 1, events_made: 1, listed: 0 });
      expect((await pool.query("SELECT event_id FROM enquiries WHERE id = $1", [held])).rows[0]?.["event_id"]).not.toBeNull();
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
      join.release();
    }
  }, 60_000);

  it("waits only a moment for a writer's open deal on the same event, holds the event only as a key share, and lists the deal next run", async () => {
    const v = await venueIn(pool, "open deal beside a writer");
    const x = await eventIn(pool, v.venueId, "X");
    const { enquiryId, deal: mine } = await heldWithDeal(v, x);
    const writer = await connection(), join = await connection();
    try {
      await writer.query("BEGIN");
      await writer.query("INSERT INTO opportunities (venue_id, title, stage, event_id) VALUES ($1, 'The writer''s deal', 'qualified', $2)",
        [v.venueId, x]);
      // The join's transaction is kept open, so every lock it took is still held below.
      await join.query("BEGIN");
      const started = Date.now();
      expect(await runOn(join)).toEqual({ joined: 1, events_made: 0, listed: 0 });
      // Its deal update gave up on the uncommitted deal after 100 ms (in each of two rounds), not after
      // the connection's three seconds.
      expect(Date.now() - started).toBeLessThan(2_500);
      // The writer takes its event last, as writers do: the join holds nothing that waits it.
      await writer.query("SELECT id FROM events WHERE id = $1 FOR NO KEY UPDATE NOWAIT", [x]);
      await writer.query("COMMIT");
      await join.query("COMMIT");
    } finally {
      await writer.query("ROLLBACK");
      await join.query("ROLLBACK");
      writer.release();
      join.release();
    }
    expect([await linkOf("enquiries", enquiryId), await linkOf("opportunities", mine), await reviewsOf(mine)]).toEqual([x, null, []]);
    expect((await pool.query<Row>("SELECT * FROM spine_join_old_records()")).rows[0]).toEqual({ joined: 0, events_made: 0, listed: 1 });
    expect(await reviewsOf(mine)).toEqual([{ reason: "second_open_deal", candidate_event_ids: [x] }]);
  }, 60_000);

  it("is never half of a deadlock with a writer that takes the event FOR UPDATE after putting an open deal on it", async () => {
    const v = await venueIn(pool, "event taken for update beside the join");
    const x = await eventIn(pool, v.venueId, "X");
    const { enquiryId, deal: mine } = await heldWithDeal(v, x);
    const writer = await connection(), join = await connection();
    try {
      const pid = (await join.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]?.pid;
      if (pid === undefined) throw new Error("No backend");
      await writer.query("BEGIN");
      await writer.query("INSERT INTO opportunities (venue_id, title, stage, event_id) VALUES ($1, 'The writer''s deal', 'qualified', $2)",
        [v.venueId, x]);
      await join.query("BEGIN");
      const running = runOn(join);
      // Failures are read where these are awaited below, not reported twice.
      running.catch(() => undefined);
      await waitingOnALock(pid);
      // While the join waits for the writer's deal, the writer asks for the event FOR UPDATE, which waits
      // for the join's key share: a ring, until the join's bounded wait gives up.
      const taking = writer.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [x]);
      taking.catch(() => undefined);
      expect(await running).toEqual({ joined: 1, events_made: 0, listed: 0 });
      await join.query("COMMIT");
      expect((await taking).rows).toEqual([{ id: x }]);
      await writer.query("COMMIT");
    } finally {
      await writer.query("ROLLBACK");
      await join.query("ROLLBACK");
      writer.release();
      join.release();
    }
    expect([await linkOf("enquiries", enquiryId), await linkOf("opportunities", mine), await reviewsOf(mine)]).toEqual([x, null, []]);
    expect((await pool.query<Row>("SELECT * FROM spine_join_old_records()")).rows[0]).toEqual({ joined: 0, events_made: 0, listed: 1 });
    expect(await reviewsOf(mine)).toEqual([{ reason: "second_open_deal", candidate_event_ids: [x] }]);
  }, 60_000);

  it("invents nothing for an enquiry whose held dates sit in an event a writer holds, and joins it and its deal there after", async () => {
    const v = await venueIn(pool, "held event beside the join");
    const z = await eventIn(pool, v.venueId, "Z");
    const { enquiryId, deal: mine } = await heldWithDeal(v, z);
    const writer = await connection(), join = await connection();
    try {
      await writer.query("BEGIN");
      await writer.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [z]);
      expect(await runOn(join)).toEqual({ joined: 0, events_made: 0, listed: 0 });
      expect([await linkOf("enquiries", enquiryId), await linkOf("opportunities", mine), await reviewsOf(enquiryId), await reviewsOf(mine)])
        .toEqual([null, null, [], []]);
      await writer.query("COMMIT");
      expect(await runOn(join)).toEqual({ joined: 2, events_made: 0, listed: 0 });
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
      join.release();
    }
    expect([await linkOf("enquiries", enquiryId), await linkOf("opportunities", mine)]).toEqual([z, z]);
  }, 60_000);
});

describe.skipIf(target === undefined)("the spine: the undo beside a live writer", () => {
  let spine: SpineDatabase | undefined;
  let pool: Pool;

  beforeAll(async () => {
    spine = await openSpineDatabase("links_undo_beside_writer");
    pool = spine.pool;
  }, 180_000);
  afterAll(async () => { await spine?.close(); });

  const one = async (client: Pool | PoolClient, text: string, values: readonly unknown[] = []): Promise<Row | undefined> =>
    (await client.query<Row>(text, [...values])).rows[0];
  const undoIsOn = async (client: PoolClient): Promise<unknown> =>
    (await one(client, "SELECT current_setting('venviewer.undo_event_links', true) IS NOT DISTINCT FROM 'on' AS on"))?.["on"];

  it("leaves a record and an event a writer holds to its next run, never waits for them, and leaves the link rule in force even when it fails", async () => {
    const v = await venueIn(pool, "undo beside a writer");
    const x = await eventIn(pool, v.venueId, "X");
    // One enquiry joins X through its held date; one worked enquiry is given an event of its own.
    const held = await enquiryIn(pool, v.venueId, "under_review");
    await pool.query(`INSERT INTO bookings (venue_id, space_id, event_id, enquiry_id, kind, status, title, starts_at, ends_at)
      VALUES ($1, $2, $3, $4, 'hold', 'active', 'Held date', now() + interval '400 days', now() + interval '400 days 4 hours')`,
    [v.venueId, v.rooms.hall, x, held]);
    const worked = await enquiryIn(pool, v.venueId, "under_review");
    await pool.query(`UPDATE enquiries SET first_response_at = created_at, first_response_channel = 'email',
      first_response_recorded_at = created_at WHERE id = $1`, [worked]);
    expect(await one(pool, "SELECT * FROM spine_join_old_records()")).toEqual({ joined: 2, events_made: 1, listed: 0 });
    const made = (await one(pool, "SELECT event_id FROM enquiries WHERE id = $1", [worked]))?.["event_id"];
    const links = async (): Promise<unknown[]> => [
      (await one(pool, "SELECT event_id FROM enquiries WHERE id = $1", [held]))?.["event_id"],
      (await one(pool, "SELECT event_id FROM enquiries WHERE id = $1", [worked]))?.["event_id"],
    ];

    const writer = await pool.connect(), undo = await pool.connect();
    try {
      // A lock wait would fail after three seconds rather than hang.
      await undo.query("SET lock_timeout = '3s'");
      // An undo that fails part-way (here a read-only transaction refuses its first row lock) leaves the rule in force.
      await undo.query("BEGIN READ ONLY");
      await undo.query("SAVEPOINT failing");
      await expect(undo.query("SELECT * FROM spine_undo_joins()")).rejects.toThrow(/read-only transaction/);
      await undo.query("ROLLBACK TO SAVEPOINT failing");
      expect(await undoIsOn(undo)).toBe(false);
      await undo.query("ROLLBACK");

      // The writer holds the first enquiry's row, and holds the made event as a key share, as anything
      // attaching a row to it does until it commits.
      await writer.query("BEGIN");
      await writer.query("SELECT id FROM enquiries WHERE id = $1 FOR NO KEY UPDATE", [held]);
      await writer.query("SELECT id FROM events WHERE id = $1 FOR KEY SHARE", [made]);
      const started = Date.now();
      expect(await one(undo, "SELECT * FROM spine_undo_joins()")).toEqual({ emptied: 0, events_removed: 0, left_alone: 2 });
      expect(Date.now() - started).toBeLessThan(2_500);
      expect(await links()).toEqual([x, made]);
      expect(await one(pool, "SELECT count(*)::int AS count FROM event_link_joins WHERE undone_at IS NULL")).toEqual({ count: 2 });
      await writer.query("COMMIT");

      // Its next run finishes the job.
      expect(await one(undo, "SELECT * FROM spine_undo_joins()")).toEqual({ emptied: 2, events_removed: 1, left_alone: 0 });
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
      undo.release();
    }
    expect(await links()).toEqual([null, null]);
    expect(await one(pool, `SELECT (SELECT count(*)::int FROM events WHERE id = $1) AS events,
      (SELECT count(*)::int FROM event_phases WHERE event_id = $1) AS phases,
      (SELECT count(*)::int FROM event_link_joins WHERE undone_at IS NULL) AS joins`, [made])).toEqual({ events: 0, phases: 0, joins: 0 });
    expect(await one(pool, "SELECT count(*)::int AS count FROM events WHERE id = $1", [x])).toEqual({ count: 1 });
  }, 60_000);
});
