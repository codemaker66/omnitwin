import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openSpineDatabaseBefore, platformTarget, type SpineDatabaseBefore } from "./helpers/event-spine-fixtures.js";

// ---------------------------------------------------------------------------
// The spine's join of old records (spine_join_old_records, in migration
// *_event_spine_links), run by the real migrator over a database written
// before it. A proposal, deal or enquiry that has no event joins the one event
// a path reaches: its enquiry's held dates, its floor plan's link, its deal or
// enquiry, its deposit request. One that paths place in more than one event,
// or two paths in different events, goes on the list of joins to check. One
// that must have an event and that no path reaches gets an event of its own.
// Nothing is matched by name, email, title or date. Run again, it changes
// nothing.
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
//     linked to one event; to two; to none
//  K  an accepted proposal whose deposit request in force names Z while its deal's event is W;
//     and one whose deposit request names no event (a withdrawn one of it names Z)
//  L  an access request (event_type 'venue-access') with a reply; a pricing request whose type is
//     padded with spaces, with a reply
//  M  an enquiry named only by an email address, worked; one whose name is blank; and one whose
//     event_type is 100 characters long
//  N  three event_binding_reviews rows, one of each reason, whose detail text holds a booking's title
//
// The suite runs on a throwaway database of its own (openSpineDatabaseBefore);
// the shared platform database is only the door to the cluster.
// ---------------------------------------------------------------------------

const target = platformTarget();

type Row = Record<string, unknown>;
type LinkedTable = "enquiries" | "opportunities" | "proposals";
type Question = readonly [kind: string, subjectId: string, reason: string];

interface Place { readonly venueId: string; readonly room: string }

describe.skipIf(target === undefined)("the spine: the join of old records", () => {
  let before: SpineDatabaseBefore | undefined;
  let legacy: Pool;

  beforeAll(async () => {
    before = await openSpineDatabaseBefore("links_migration");
    legacy = before.pool;
  }, 180_000);
  afterAll(async () => { await before?.close(); });

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
    return { enquiry: enquiryId, deal: dealId, proposal: await proposal(p, { status: "sent", dealId, enquiryId }) };
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
    return { enquiry: enquiryId };
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
    };
  }

  async function caseK(p: Place, withDisagreement: boolean) {
    const w = await event(p, "W"), z = await event(p, "Z");
    const enquiryId = await enquiry(p);
    await hold(p, enquiryId, w);
    const dealId = await deal(p, { stage: "won", enquiryId });
    let disagrees: string | null = null;
    if (withDisagreement) {
      disagrees = await proposal(p, { status: "accepted", dealId });
      await depositRequest(p, disagrees, z);
    }
    const agrees = await proposal(p, { status: "accepted", dealId });
    const emptyRequest = await depositRequest(p, agrees, null);
    await depositRequest(p, agrees, z, true);
    return { disagrees, agrees, emptyRequest };
  }

  async function caseL(p: Place) {
    return {
      enquiry: await enquiry(p, { eventType: "venue-access", replied: true }),
      padded: await enquiry(p, { eventType: " venue-enquiry ", replied: true }),
    };
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
    await caseA(cleanPlace);
    await caseB(cleanPlace);
    await caseF(cleanPlace);
    await caseI(cleanPlace);
    await caseK(cleanPlace, false);
    if (k.disagrees === null) throw new Error("Case K in `mixed` has its disagreement");

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
    // D, E, L: nothing.
    for (const enquiryId of [d.enquiry, e.enquiry, l.enquiry, l.padded]) expect(await eventOf("enquiries", enquiryId)).toBeNull();
    // H: the older open deal joins, the lost one joins as history, the newer open one is listed.
    expect(await eventOf("opportunities", h.first)).toBe(await eventOf("enquiries", h.enquiry));
    expect(await eventOf("opportunities", h.lost)).toBe(await eventOf("enquiries", h.enquiry));
    expect(await eventOf("opportunities", h.second)).toBeNull();
    // I: an event of its own for the open one, named by the deal; none for the lost one.
    expect((await eventRow(await eventOf("opportunities", i.open)))["name"]).toBe("Chamber dinner");
    expect(await eventOf("opportunities", i.lost)).toBeNull();
    // J.
    expect(await eventOf("proposals", j.draft)).toBeNull();
    expect(await eventOf("proposals", j.oneLink)).toBe(j.event);
    expect(await eventOf("proposals", j.twoLinks)).toBeNull();
    expect(await eventOf("proposals", j.noLink)).not.toBeNull();
    // K: the disagreement is listed; the empty deposit request takes its proposal's event.
    expect(await eventOf("proposals", k.disagrees)).toBeNull();
    expect(await depositEvent(k.emptyRequest)).toBe(await eventOf("proposals", k.agrees));
    // M: a readable name, never '' and never an address; a long occasion is cut, not refused.
    expect((await eventRow(await eventOf("enquiries", m.blank)))["name"]).toBe("Event");
    expect(await eventRow(await eventOf("enquiries", m.address))).toMatchObject({ name: "Event", client_name: null });
    expect(String((await eventRow(await eventOf("enquiries", m.longType)))["event_type"])).toHaveLength(80);

    // The list: exactly these open questions, and the three copied from 0090 once.
    expect(await openReviews(mixed)).toEqual(sorted([
      ["enquiry", c.enquiry, "reaches_many_events"], ["enquiry", g.enquiry, "paths_disagree"],
      ["opportunity", h.second, "second_open_deal"], ["proposal", j.twoLinks, "reaches_many_events"],
      ["proposal", k.disagrees, "paths_disagree"],
    ]));
    expect(await copiedReviewCount(mixed)).toBe(3);
    expect(await openReviews(clean)).toEqual([]);
    // No review row holds a name or an address.
    expect(await reviewDetails(mixed)).not.toEqual(expect.arrayContaining([expect.stringMatching(/@|Gordon|Chamber/)]));
    // Every join is recorded, and nothing crossed venues.
    expect(await joinsWithoutRecord()).toBe(0);
    expect(await crossVenueLinks()).toBe(0);
    // The count (readSpineInvariant) reads zero for `clean`, and for `mixed` what its five listed records give: added with the count.

    // Run again: nothing changes.
    const unchanged = await snapshot();
    expect((await q("SELECT * FROM spine_join_old_records()")).rows[0]).toEqual({ joined: 0, events_made: 0, listed: 0 });
    expect(await snapshot()).toEqual(unchanged);
  }, 180_000);
});
