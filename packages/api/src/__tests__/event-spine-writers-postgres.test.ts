import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BookingSchema,
  DEFAULT_EVENT_PHASE_TEMPLATE,
  EnquiryEventResultSchema,
  VENUE_ACCESS_ENQUIRY_TYPE,
  type Booking,
  type EnquiryEventResult,
  type EnquiryStatus,
} from "@omnitwin/types";
import { bookingRoutes } from "../routes/bookings.js";
import { enquiryRoutes } from "../routes/enquiries.js";
import { quoteRoutes } from "../routes/quotes.js";
import { enquiryEventNaming } from "../services/enquiry-event.js";
import { createEventFor } from "../services/event-binding.js";
import {
  deal as dealIn,
  enquiry as enquiryIn,
  event as eventIn,
  link,
  openSpineDatabase,
  platformTarget,
  proposal as proposalIn,
  venue as venueIn,
  type SpineActor,
  type SpineDatabase,
  type SpineVenue,
} from "./helpers/event-spine-fixtures.js";

// ---------------------------------------------------------------------------
// The enquiry's own writer (the spine, part two): an enquiry gets its event
// the moment someone first works it (a reply that is not a turn-down, an
// approval, a viewing, a price), or when its team opens it as an event on
// purpose (POST /enquiries/:id/event).
//
// The writer decides as step 1 of the join of old records decides (ruling
// R25), apart from two departures its service header names (an enquiry
// already on the join's list, a link to a deleted event): the enquiry's own
// link to a live event; else the one live
// event its held dates, deals and proposals reach; else the one its floor
// plan reaches; else a new event, for an open enquiry. It never chooses among
// several events and never makes one while something of the enquiry's own
// reaches one: the link stays empty and the join lists the enquiry for a
// person. The join is the outside reference, so the cases that turn on it run
// the act, then the join, and assert both.
//
// The suite runs on a throwaway database of its own (openSpineDatabase); the
// shared platform database is only the door to the cluster.
// ---------------------------------------------------------------------------

const target = platformTarget();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Saturday 9 August 2031, midnight UTC: far from any other fixture's dates. */
const SATURDAY = Date.parse("2031-08-09T00:00:00.000Z");
/** The suite's label, and the application name its pool connects as (openSpineDatabase prefixes "spine_"). */
const LABEL = "writers";
const APPLICATION_NAME = `spine_${LABEL}`;

const SEVERAL_EVENTS = {
  error: "This enquiry's dates, deals, proposals or floor plan already reach more than one event, so a person needs to choose which. It will be on the list of joins to check.",
  code: "ENQUIRY_REACHES_SEVERAL_EVENTS",
};

/** An instant on the test Saturday (UTC). */
function at(hhmm: string, dayOffset = 0): string {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return new Date(SATURDAY + dayOffset * DAY + (hours ?? 0) * HOUR + (minutes ?? 0) * 60_000).toISOString();
}

function bearer(actor: SpineActor): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify({ ...actor, email: `${actor.id}@event-spine.invalid` })}` };
}

/** The hold quartet every option carries (roadmap N3). */
function hygiene(ownerUserId: string) {
  return {
    decisionAt: at("10:00", -45),
    ownerUserId,
    nextAction: "Call the couple about the date.",
    nextActionDueAt: at("10:00", -52),
  };
}

const DecisionReplySchema = z.object({ data: z.object({ eventId: z.uuid().nullable() }) });

interface EventRowRead {
  readonly id: string;
  readonly name: string;
  readonly client_name: string | null;
  readonly event_type: string | null;
  readonly status: string;
  readonly starts_at: Date | null;
  readonly guest_count: number;
  readonly created_by: string | null;
  readonly fixture_source: string | null;
}

interface OpenQuestion { readonly reason: string; readonly resolved_at: Date | null }

describe.skipIf(target === undefined)("the spine's writers: an enquiry gets its event when someone first works it", () => {
  let spine: SpineDatabase;
  let pool: Pool;
  let server: FastifyInstance;

  beforeAll(async () => {
    spine = await openSpineDatabase(LABEL);
    pool = spine.pool;
    server = Fastify();
    await server.register(enquiryRoutes, { db: spine.db, prefix: "/enquiries" });
    await server.register(bookingRoutes, { db: spine.db, prefix: "/bookings" });
    await server.register(quoteRoutes, { db: spine.db, prefix: "/quotes" });
    await server.ready();
  }, 180_000);
  afterAll(async () => { await server?.close(); await spine?.close(); });

  const venue = (label: string): Promise<SpineVenue> => venueIn(pool, label);
  const datelessEvent = (venueId: string, name: string): Promise<string> => eventIn(pool, venueId, name);

  /** An enquiry of the venue: sent, for a wedding, unless told otherwise. */
  async function enquiry(
    v: SpineVenue,
    facts: { readonly state?: EnquiryStatus; readonly eventType?: string | null; readonly name?: string } = {},
  ): Promise<string> {
    const id = await enquiryIn(pool, v.venueId, facts.state ?? "submitted", facts.eventType === undefined ? "wedding" : facts.eventType);
    if (facts.name !== undefined) await pool.query("UPDATE enquiries SET name = $2 WHERE id = $1", [id, facts.name]);
    return id;
  }

  async function post(actor: SpineActor, url: string, body?: Record<string, unknown>): Promise<LightMyRequestResponse> {
    return server.inject({ method: "POST", url, headers: bearer(actor), ...(body === undefined ? {} : { payload: body }) });
  }

  const reportReply = (v: SpineVenue, enquiryId: string): Promise<LightMyRequestResponse> =>
    post(v.admin, `/enquiries/${enquiryId}/first-response`, { channel: "email" });
  const decide = (v: SpineVenue, enquiryId: string, status: "approved" | "rejected"): Promise<LightMyRequestResponse> =>
    post(v.admin, `/enquiries/${enquiryId}/transition`, { status });
  const openAsEvent = (actor: SpineActor, enquiryId: string): Promise<LightMyRequestResponse> =>
    post(actor, `/enquiries/${enquiryId}/event`);
  const bookViewing = (v: SpineVenue, enquiryId: string, day: number): Promise<LightMyRequestResponse> =>
    post(v.admin, "/bookings/viewings", { enquiryId, spaceId: v.rooms.saloon, startsAt: at("11:00", day), endsAt: at("11:30", day) });
  const priceQuote = (
    v: SpineVenue,
    links: { readonly enquiryId: string; readonly opportunityId?: string; readonly proposalId?: string },
  ): Promise<LightMyRequestResponse> =>
    post(v.admin, "/quotes", {
      venueId: v.venueId, ...links, name: "Fixture quote", currency: "GBP",
      lineItems: [{ description: "Room hire", quantity: 1, unitAmountMinor: 150_000 }],
    });

  async function holdFromEnquiry(v: SpineVenue, enquiryId: string, day = 0): Promise<Booking> {
    const response = await post(v.admin, "/bookings/from-enquiry", {
      enquiryId, spaceId: v.rooms.hall, startsAt: at("18:00", day), endsAt: at("23:00", day), ...hygiene(v.admin.id),
    });
    expect(response.statusCode, response.body).toBe(201);
    return BookingSchema.parse(response.json<{ data: unknown }>().data);
  }

  function opened(response: LightMyRequestResponse): EnquiryEventResult {
    expect(response.statusCode, response.body).toBe(200);
    return EnquiryEventResultSchema.parse(response.json<{ data: unknown }>().data);
  }

  async function enquiryRow(enquiryId: string): Promise<{ readonly event_id: string | null; readonly state: string; readonly first_response_at: Date | null }> {
    const [row] = (await pool.query<{ event_id: string | null; state: string; first_response_at: Date | null }>(
      "SELECT event_id, state, first_response_at FROM enquiries WHERE id = $1", [enquiryId])).rows;
    if (row === undefined) throw new Error("Missing enquiry");
    return row;
  }

  async function enquiryEvent(enquiryId: string): Promise<string | null> {
    return (await enquiryRow(enquiryId)).event_id;
  }

  async function eventRow(id: string | null): Promise<EventRowRead> {
    if (id === null) throw new Error("No event");
    const [row] = (await pool.query<EventRowRead>(`SELECT id, name, client_name, event_type, status, starts_at, guest_count,
      created_by, fixture_source FROM events WHERE id = $1`, [id])).rows;
    if (row === undefined) throw new Error("Missing event");
    return row;
  }

  async function eventCount(venueId: string): Promise<number> {
    const [row] = (await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM events WHERE venue_id = $1", [venueId])).rows;
    return row?.count ?? 0;
  }

  async function phaseCount(eventId: string): Promise<number> {
    const [row] = (await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM event_phases WHERE event_id = $1", [eventId])).rows;
    return row?.count ?? 0;
  }

  async function joinOldRecords(): Promise<void> {
    await pool.query("SELECT * FROM spine_join_old_records()");
  }

  async function questionsOn(enquiryId: string): Promise<OpenQuestion[]> {
    return (await pool.query<OpenQuestion>(
      "SELECT reason, resolved_at FROM event_link_reviews WHERE subject_kind = 'enquiry' AND subject_id = $1 ORDER BY created_at",
      [enquiryId],
    )).rows;
  }

  /** How many joins the join of old records has recorded for the enquiry. */
  async function joinsRecordedFor(enquiryId: string): Promise<number> {
    const [row] = (await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM event_link_joins WHERE subject_kind = 'enquiry' AND subject_id = $1", [enquiryId])).rows;
    return row?.count ?? 0;
  }

  /** An interest-only booking of the enquiry in an event, written straight into the table (as an import would). */
  async function interestIn(v: SpineVenue, enquiryId: string, eventId: string, room: string): Promise<void> {
    await pool.query(`INSERT INTO bookings (venue_id, space_id, kind, title, starts_at, ends_at, event_id, enquiry_id, created_by)
      VALUES ($1, $2, 'prospect', 'Interest only', $3, $4, $5, $6, $7)`,
    [v.venueId, room, at("12:00", 3), at("14:00", 3), eventId, enquiryId, v.admin.id]);
  }

  /** The enquiry's floor plan, linked to each of the events. */
  async function planLinkedTo(v: SpineVenue, enquiryId: string, eventIds: readonly string[]): Promise<void> {
    const [plan] = (await pool.query<{ id: string }>(
      "INSERT INTO configurations (space_id, venue_id, name, layout_style) VALUES ($1, $2, 'Fixture plan', 'dinner-rounds') RETURNING id",
      [v.rooms.hall, v.venueId],
    )).rows;
    if (plan === undefined) throw new Error("Plan fixture missing");
    for (const eventId of eventIds) {
      await pool.query("INSERT INTO event_configuration_links (event_id, configuration_id, link_type) VALUES ($1, $2, 'source_configuration')",
        [eventId, plan.id]);
    }
    await pool.query("UPDATE enquiries SET configuration_id = $1 WHERE id = $2", [plan.id, enquiryId]);
  }

  /** An enquiry with no link whose held dates sit in two live events. */
  async function enquiryInTwoEvents(v: SpineVenue): Promise<string> {
    const enquiryId = await enquiry(v);
    await interestIn(v, enquiryId, await datelessEvent(v.venueId, "One event"), v.rooms.saloon);
    await interestIn(v, enquiryId, await datelessEvent(v.venueId, "Another event"), v.rooms.reception);
    return enquiryId;
  }

  async function blocked(count: number): Promise<void> {
    await expect.poll(async () => Number((await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
      [APPLICATION_NAME],
    )).rows[0]?.count), { timeout: 10_000 }).toBe(count);
  }

  /** Hold the enquiry row in another transaction, as `mode` locks it, while `run` works. */
  async function withLockedEnquiry(
    enquiryId: string,
    mode: "NO KEY UPDATE" | "KEY SHARE",
    run: (client: PoolClient) => Promise<void>,
  ): Promise<void> {
    const client = await pool.connect();
    await client.query("BEGIN");
    try {
      await client.query(`SELECT id FROM enquiries WHERE id = $1 FOR ${mode}`, [enquiryId]);
      await run(client);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Ruling R25: the writer decides as the join decides, never choosing among
  // events. Each case runs the act, then the join.

  it("a reply on an enquiry whose bookings sit in two events is recorded and makes no event; the join lists it", async () => {
    const v = await venue("two events, a reply");
    const enquiryId = await enquiryInTwoEvents(v);
    const before = await eventCount(v.venueId);

    const replied = await reportReply(v, enquiryId);
    expect(replied.statusCode, replied.body).toBe(200);
    expect((await enquiryRow(enquiryId)).first_response_at).not.toBeNull();
    expect(await eventCount(v.venueId)).toBe(before);
    expect(await enquiryEvent(enquiryId)).toBeNull();

    await joinOldRecords();
    expect(await questionsOn(enquiryId)).toEqual([{ reason: "reaches_many_events", resolved_at: null }]);
    expect(await enquiryEvent(enquiryId)).toBeNull();
  });

  it("opening that enquiry as an event is refused and makes nothing; the join lists it", async () => {
    const v = await venue("two events, opened");
    const enquiryId = await enquiryInTwoEvents(v);
    const before = await eventCount(v.venueId);

    const response = await openAsEvent(v.admin, enquiryId);
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json<unknown>()).toEqual(SEVERAL_EVENTS);
    expect(await eventCount(v.venueId)).toBe(before);
    expect(await enquiryEvent(enquiryId)).toBeNull();

    await joinOldRecords();
    expect(await questionsOn(enquiryId)).toEqual([{ reason: "reaches_many_events", resolved_at: null }]);
    expect(await enquiryEvent(enquiryId)).toBeNull();
  });

  it("an approval and a quote on an enquiry whose bookings sit in two events are still recorded, and make no event; the join lists both", async () => {
    const v = await venue("two events, approval and quote");
    const approved = await enquiryInTwoEvents(v);
    await pool.query("UPDATE enquiries SET state = 'under_review' WHERE id = $1", [approved]);
    const priced = await enquiryInTwoEvents(v);
    const before = await eventCount(v.venueId);

    const approval = await decide(v, approved, "approved");
    expect(approval.statusCode, approval.body).toBe(200);
    expect(DecisionReplySchema.parse(approval.json<unknown>()).data.eventId).toBeNull();
    expect(await enquiryRow(approved)).toMatchObject({ state: "approved", event_id: null });

    const quote = await priceQuote(v, { enquiryId: priced });
    expect(quote.statusCode, quote.body).toBe(201);
    const [quoted] = (await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM quotes WHERE enquiry_id = $1", [priced])).rows;
    expect(quoted?.count).toBe(1);
    expect(await enquiryEvent(priced)).toBeNull();
    expect(await eventCount(v.venueId)).toBe(before);

    await joinOldRecords();
    for (const enquiryId of [approved, priced]) {
      expect(await questionsOn(enquiryId)).toEqual([{ reason: "reaches_many_events", resolved_at: null }]);
      expect(await enquiryEvent(enquiryId)).toBeNull();
    }
  });

  it("an enquiry whose one deal sits in an event joins that event and makes none; the join changes nothing for it", async () => {
    const v = await venue("one deal's event");
    const dealsEvent = await datelessEvent(v.venueId, "The deal's event");
    const replied = await enquiry(v);
    await link(pool, "opportunities", await dealIn(pool, v.venueId, "qualified", replied), dealsEvent);
    const twin = await enquiry(v);
    const twinsEvent = await datelessEvent(v.venueId, "The twin's deal's event");
    await link(pool, "opportunities", await dealIn(pool, v.venueId, "qualified", twin), twinsEvent);
    const before = await eventCount(v.venueId);

    // Through a reply.
    const response = await reportReply(v, replied);
    expect(response.statusCode, response.body).toBe(200);
    expect(await enquiryEvent(replied)).toBe(dealsEvent);
    // And opened on purpose: the event it reaches, not made.
    expect(opened(await openAsEvent(v.admin, twin))).toEqual({ enquiryId: twin, eventId: twinsEvent, created: false });
    expect(await eventCount(v.venueId)).toBe(before);

    await joinOldRecords();
    for (const [enquiryId, eventId] of [[replied, dealsEvent], [twin, twinsEvent]] as const) {
      expect(await questionsOn(enquiryId)).toEqual([]);
      expect(await joinsRecordedFor(enquiryId)).toBe(0);
      expect(await enquiryEvent(enquiryId)).toBe(eventId);
    }
    expect(await eventCount(v.venueId)).toBe(before);
  });

  it("a reply on an enquiry whose bookings sit in one event while its floor plan is linked to another makes no event; the join says the paths disagree", async () => {
    const v = await venue("paths disagree");
    const enquiryId = await enquiry(v);
    await interestIn(v, enquiryId, await datelessEvent(v.venueId, "Where the dates are"), v.rooms.saloon);
    await planLinkedTo(v, enquiryId, [await datelessEvent(v.venueId, "Where the plan is")]);
    const before = await eventCount(v.venueId);

    const replied = await reportReply(v, enquiryId);
    expect(replied.statusCode, replied.body).toBe(200);
    expect(await eventCount(v.venueId)).toBe(before);
    expect(await enquiryEvent(enquiryId)).toBeNull();

    await joinOldRecords();
    expect(await questionsOn(enquiryId)).toEqual([{ reason: "paths_disagree", resolved_at: null }]);
    expect(await enquiryEvent(enquiryId)).toBeNull();
  });

  it("an enquiry reached only through its floor plan joins the plan's one event, and through two is refused; the join agrees with both", async () => {
    const v = await venue("plan only");
    const planned = await enquiry(v);
    const plansEvent = await datelessEvent(v.venueId, "The plan's event");
    await planLinkedTo(v, planned, [plansEvent]);
    const twice = await enquiry(v);
    await planLinkedTo(v, twice, [await datelessEvent(v.venueId, "First plan event"), await datelessEvent(v.venueId, "Second plan event")]);
    const before = await eventCount(v.venueId);

    expect(opened(await openAsEvent(v.admin, planned))).toEqual({ enquiryId: planned, eventId: plansEvent, created: false });
    const refused = await openAsEvent(v.admin, twice);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json<unknown>()).toEqual(SEVERAL_EVENTS);
    expect(await eventCount(v.venueId)).toBe(before);

    await joinOldRecords();
    expect(await questionsOn(planned)).toEqual([]);
    expect(await joinsRecordedFor(planned)).toBe(0);
    expect(await enquiryEvent(planned)).toBe(plansEvent);
    expect(await questionsOn(twice)).toEqual([{ reason: "reaches_many_events", resolved_at: null }]);
    expect(await enquiryEvent(twice)).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // The acts that work an enquiry.

  it("a reply reported on an open enquiry makes its event, once", async () => {
    const v = await venue("a reply makes it");
    const enquiryId = await enquiry(v, { name: "Iona Reid" });
    for (const response of [await reportReply(v, enquiryId), await reportReply(v, enquiryId)]) {
      expect(response.statusCode, response.body).toBe(200);
    }
    const eventId = await enquiryEvent(enquiryId);
    expect(await eventRow(eventId)).toMatchObject({
      status: "draft", starts_at: null, guest_count: 0, name: "Iona Reid — Wedding", client_name: "Iona Reid",
      event_type: "wedding", created_by: v.admin.id,
    });
    if (eventId === null) throw new Error("No event");
    expect(await phaseCount(eventId)).toBe(DEFAULT_EVENT_PHASE_TEMPLATE.length);
    expect(await eventCount(v.venueId)).toBe(1);

    await joinOldRecords();
    expect(await questionsOn(enquiryId)).toEqual([]);
    expect(await joinsRecordedFor(enquiryId)).toBe(0);
    expect(await eventCount(v.venueId)).toBe(1);
  });

  it("an approval makes the event; a turn-down makes none", async () => {
    const v = await venue("decisions");
    const approved = await enquiry(v, { state: "under_review" });
    const rejected = await enquiry(v, { state: "under_review" });

    const approval = await decide(v, approved, "approved");
    expect(approval.statusCode, approval.body).toBe(200);
    const eventId = await enquiryEvent(approved);
    expect(eventId).not.toBeNull();
    // The venue's team reads the event the decision filed the enquiry under.
    expect(DecisionReplySchema.parse(approval.json<unknown>()).data.eventId).toBe(eventId);

    const rejection = await decide(v, rejected, "rejected");
    expect(rejection.statusCode, rejection.body).toBe(200);
    expect(await enquiryEvent(rejected)).toBeNull();
    expect(await eventCount(v.venueId)).toBe(1);

    await joinOldRecords();
    expect(await questionsOn(approved)).toEqual([]);
    expect(await questionsOn(rejected)).toEqual([]);
    expect(await enquiryEvent(rejected)).toBeNull();
  });

  it("a reply reported on a turned-down enquiry is recorded and makes none", async () => {
    const v = await venue("turned down");
    const enquiryId = await enquiry(v, { state: "rejected" });
    const replied = await reportReply(v, enquiryId);
    expect(replied.statusCode, replied.body).toBe(200);
    expect((await enquiryRow(enquiryId)).first_response_at).not.toBeNull();
    expect(await enquiryEvent(enquiryId)).toBeNull();
    expect(await eventCount(v.venueId)).toBe(0);
  });

  it("an access request never becomes an event", async () => {
    const v = await venue("access request");
    const enquiryId = await enquiry(v, { eventType: VENUE_ACCESS_ENQUIRY_TYPE });
    const replied = await reportReply(v, enquiryId);
    expect(replied.statusCode, replied.body).toBe(200);
    expect(await enquiryEvent(enquiryId)).toBeNull();
    expect(await eventCount(v.venueId)).toBe(0);
  });

  it("a reply reported as the enquiry is turned down makes no event when the turn-down commits first", async () => {
    const v = await venue("reply against turn-down");
    /** Both requests wait on the enquiry, `first` ahead of `second`, then run in that order. */
    async function inOrder(enquiryId: string, first: () => Promise<LightMyRequestResponse>, second: () => Promise<LightMyRequestResponse>): Promise<void> {
      await withLockedEnquiry(enquiryId, "NO KEY UPDATE", async (client) => {
        const ahead = first();
        await blocked(1);
        const behind = second();
        await blocked(2);
        await client.query("COMMIT");
        for (const response of await Promise.all([ahead, behind])) expect(response.statusCode, response.body).toBe(200);
      });
      expect((await enquiryRow(enquiryId)).state).toBe("rejected");
    }

    // The turn-down commits first: the reply is recorded, and no event is made.
    const turnedDownFirst = await enquiry(v, { state: "under_review" });
    await inOrder(turnedDownFirst, () => decide(v, turnedDownFirst, "rejected"), () => reportReply(v, turnedDownFirst));
    expect((await enquiryRow(turnedDownFirst)).first_response_at).not.toBeNull();
    expect(await enquiryEvent(turnedDownFirst)).toBeNull();

    // The reply commits first: it makes the event, and the turn-down after it leaves the link (never emptied).
    const repliedFirst = await enquiry(v, { state: "under_review" });
    await inOrder(repliedFirst, () => reportReply(v, repliedFirst), () => decide(v, repliedFirst, "rejected"));
    expect(await enquiryEvent(repliedFirst)).not.toBeNull();

    // At the same moment, ten rounds: both always answer, never a 500.
    for (let round = 0; round < 10; round += 1) {
      const enquiryId = await enquiry(v, { state: "under_review" });
      for (const response of await Promise.all([reportReply(v, enquiryId), decide(v, enquiryId, "rejected")])) {
        expect(response.statusCode, response.body).toBe(200);
      }
      expect((await enquiryRow(enquiryId)).state).toBe("rejected");
    }
  }, 60_000);

  it("a reply is recorded while another writer holds a key share on the enquiry", async () => {
    const v = await venue("key share");
    const enquiryId = await enquiry(v);
    // A writer that has inserted a row referencing the enquiry (a viewing,
    // a quote) holds a key share on it until it commits; the reply's lock on
    // the enquiry does not wait for it.
    await withLockedEnquiry(enquiryId, "KEY SHARE", async () => {
      const replied = await reportReply(v, enquiryId);
      expect(replied.statusCode, replied.body).toBe(200);
    });
    expect(await enquiryEvent(enquiryId)).not.toBeNull();
  }, 30_000);

  it("a viewing makes the enquiry's event and has none itself", async () => {
    const v = await venue("a viewing");
    const enquiryId = await enquiry(v);
    const response = await bookViewing(v, enquiryId, 1);
    expect(response.statusCode, response.body).toBe(201);
    const viewing = BookingSchema.parse(response.json<{ data: unknown }>().data);
    expect(viewing.kind).toBe("viewing");
    expect(viewing.eventId).toBeNull();
    expect(await enquiryEvent(enquiryId)).not.toBeNull();
    expect(await eventCount(v.venueId)).toBe(1);

    await joinOldRecords();
    expect(await questionsOn(enquiryId)).toEqual([]);
    expect(await eventCount(v.venueId)).toBe(1);
  });

  it("two viewings booked at once for one enquiry both finish, on one event", async () => {
    const v = await venue("two viewings");
    const enquiryId = await enquiry(v);
    for (const response of await Promise.all([bookViewing(v, enquiryId, 1), bookViewing(v, enquiryId, 2)])) {
      expect(response.statusCode, response.body).toBe(201);
    }
    expect(await enquiryEvent(enquiryId)).not.toBeNull();
    expect(await eventCount(v.venueId)).toBe(1);
  });

  it("a quote priced for an enquiry makes its event, with or without a deal named", async () => {
    const v = await venue("a quote");
    const alone = await enquiry(v);
    const withDeal = await enquiry(v);
    const dealId = await dealIn(pool, v.venueId, "qualified", withDeal);
    for (const response of [await priceQuote(v, { enquiryId: alone }), await priceQuote(v, { enquiryId: withDeal, opportunityId: dealId })]) {
      expect(response.statusCode, response.body).toBe(201);
    }
    const events = [await enquiryEvent(alone), await enquiryEvent(withDeal)];
    expect(events).not.toContain(null);
    expect(new Set(events).size).toBe(2);
    expect(await eventCount(v.venueId)).toBe(2);

    await joinOldRecords();
    expect(await questionsOn(alone)).toEqual([]);
    expect(await questionsOn(withDeal)).toEqual([]);
  });

  it("a quote naming a proposal waits on the proposal before taking its enquiry, so a proposal being sent never deadlocks with it", async () => {
    const v = await venue("quote against a send");
    const enquiryId = await enquiry(v);
    const proposalId = await proposalIn(pool, v.venueId, "draft", { enquiryId });
    const sender = await pool.connect();
    let quoted: Promise<LightMyRequestResponse> | undefined;
    let waiting: readonly { readonly query: string; readonly blockers: readonly number[] }[] = [];
    let senderPid = 0;
    try {
      // As a send does (proposals.ts): the proposal FOR UPDATE, then its enquiry's first reply stamped.
      await sender.query("BEGIN");
      senderPid = (await sender.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]?.pid ?? 0;
      await sender.query("SELECT id FROM proposals WHERE id = $1 FOR UPDATE", [proposalId]);
      quoted = priceQuote(v, { enquiryId, proposalId });
      await blocked(1);
      waiting = (await pool.query<{ query: string; blockers: number[] }>(
        "SELECT query, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
        [APPLICATION_NAME],
      )).rows;
      // The quote has not taken the enquiry, so the send's stamp does not wait on it.
      await sender.query(`UPDATE enquiries SET first_response_at = now(), first_response_by = $2, first_response_channel = 'email',
        first_response_recorded_at = now() WHERE id = $1`, [enquiryId, v.admin.id]);
      await sender.query("COMMIT");
    } catch (error) {
      await sender.query("ROLLBACK");
      // The quote request is never left running into the next case: it is
      // settled here, whatever it answers, before the failure is passed on.
      await quoted?.catch(() => undefined);
      throw error;
    } finally {
      sender.release();
    }
    const response = await quoted;
    // Both finish: the send committed above, and the quote is made, never a 500.
    expect(response?.statusCode, response?.body).toBe(201);
    // What the quote waited on: the proposal's key share, held up by the send alone.
    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.query).toMatch(/from "proposals" .* for key share/u);
    expect(waiting[0]?.blockers).toEqual([senderPid]);
    expect((await enquiryRow(enquiryId)).first_response_at).not.toBeNull();
    expect(await enquiryEvent(enquiryId)).not.toBeNull();
  }, 30_000);

  it("names an enquiry's event as its first hold would be titled", async () => {
    expect(enquiryEventNaming({ name: "Iona Reid", email: "iona@example.test", eventType: "wedding" }))
      .toEqual({ title: "Iona Reid — Wedding", clientName: "Iona Reid" });
    expect(enquiryEventNaming({ name: " ", email: "iona@example.test", eventType: null }))
      .toEqual({ title: "iona@example.test", clientName: null });
    // A hold made through the route carries that title, and its event the same name and client as one a reply makes.
    const v = await venue("named alike");
    const held = await enquiry(v, { name: "Iona Reid" });
    const hold = await holdFromEnquiry(v, held);
    expect(hold.title).toBe("Iona Reid — Wedding");
    const replied = await enquiry(v, { name: "Iona Reid" });
    expect((await reportReply(v, replied)).statusCode).toBe(200);
    const fromHold = await eventRow(hold.eventId);
    const fromReply = await eventRow(await enquiryEvent(replied));
    expect({ name: fromReply.name, client_name: fromReply.client_name }).toEqual({ name: fromHold.name, client_name: fromHold.client_name });
  });

  // The hold route's own naming (POST /bookings/from-enquiry given no title):
  // the hold's title and its new event's client name, pinned as they stand.
  describe("the hold route names a hold made from an enquiry", () => {
    /** A hold made from the enquiry with no title of its own, on its own day: its title and its event's client name. */
    async function holdNaming(v: SpineVenue, enquiryId: string, day: number): Promise<{ readonly title: string; readonly clientName: string | null }> {
      const hold = await holdFromEnquiry(v, enquiryId, day);
      return { title: hold.title, clientName: (await eventRow(hold.eventId)).client_name };
    }
    const emailOf = (enquiryId: string): string => `${enquiryId}@event-spine.invalid`;

    it("after a plain name and its occasion; a padded name is trimmed in the title and kept as stored for the client", async () => {
      const v = await venue("hold naming, plain");
      expect(await holdNaming(v, await enquiry(v, { name: "Iona Reid" }), 10)).toEqual({ title: "Iona Reid — Wedding", clientName: "Iona Reid" });
      expect(await holdNaming(v, await enquiry(v, { name: "  Iona Reid  " }), 11))
        .toEqual({ title: "Iona Reid — Wedding", clientName: "  Iona Reid  " });
    });

    it("after the email, with no client, when the name is an email address or blank", async () => {
      const v = await venue("hold naming, email");
      const ownEmail = await enquiry(v);
      await pool.query("UPDATE enquiries SET name = email WHERE id = $1", [ownEmail]);
      expect(await holdNaming(v, ownEmail, 12)).toEqual({ title: `${emailOf(ownEmail)} — Wedding`, clientName: null });
      const otherAddress = await enquiry(v, { name: "someone.else@example.test" });
      expect(await holdNaming(v, otherAddress, 13)).toEqual({ title: "someone.else@example.test — Wedding", clientName: null });
      const blank = await enquiry(v, { name: "   " });
      expect(await holdNaming(v, blank, 14)).toEqual({ title: `${emailOf(blank)} — Wedding`, clientName: null });
    });

    it("after the name alone when the occasion is blank or none", async () => {
      const v = await venue("hold naming, no occasion");
      expect(await holdNaming(v, await enquiry(v, { name: "Iona Reid", eventType: null }), 15)).toEqual({ title: "Iona Reid", clientName: "Iona Reid" });
      expect(await holdNaming(v, await enquiry(v, { name: "Iona Reid", eventType: "   " }), 16)).toEqual({ title: "Iona Reid", clientName: "Iona Reid" });
    });

    it("cut at a booking title's 200 characters when the name is long, the client keeping the whole name", async () => {
      const v = await venue("hold naming, long");
      const name = `Iona Reid-${"x".repeat(185)}`;
      expect(name).toHaveLength(195);
      expect(await holdNaming(v, await enquiry(v, { name }), 17)).toEqual({ title: `${name} — We`, clientName: name });
    });
  });

  it("opens an enquiry as an event; a second press returns the same one", async () => {
    const v = await venue("opened twice");
    const enquiryId = await enquiry(v);
    const first = opened(await openAsEvent(v.admin, enquiryId));
    const second = opened(await openAsEvent(v.admin, enquiryId));
    expect([first.created, second.created]).toEqual([true, false]);
    expect(second.eventId).toBe(first.eventId);
    expect(await enquiryEvent(enquiryId)).toBe(first.eventId);
    expect(await eventCount(v.venueId)).toBe(1);
  });

  it("refuses a draft, a request, a missing enquiry and another venue's team", async () => {
    const v = await venue("refusals");
    const other = await venue("another venue");
    const draft = await openAsEvent(v.admin, await enquiry(v, { state: "draft" }));
    expect(draft.statusCode, draft.body).toBe(422);
    expect(draft.json<unknown>()).toEqual({ error: "This enquiry has not been sent yet, so it cannot be opened as an event.", code: "ENQUIRY_NOT_SENT" });
    const request = await openAsEvent(v.admin, await enquiry(v, { eventType: VENUE_ACCESS_ENQUIRY_TYPE }));
    expect(request.statusCode, request.body).toBe(422);
    expect(request.json<unknown>()).toEqual({ error: "This request asks to book nothing, so it has no event.", code: "NOT_A_BOOKING_ENQUIRY" });
    expect((await openAsEvent(v.admin, randomUUID())).statusCode).toBe(404);
    const theirs = await enquiry(v);
    expect((await openAsEvent(other.admin, theirs)).statusCode).toBe(403);
    expect(await enquiryEvent(theirs)).toBeNull();
    expect(await eventCount(v.venueId)).toBe(0);
  });

  it("an enquiry named only by an email address gets an event named by its occasion", async () => {
    const v = await venue("named by email");
    const enquiryId = await enquiry(v);
    await pool.query("UPDATE enquiries SET name = email WHERE id = $1", [enquiryId]);
    const result = opened(await openAsEvent(v.admin, enquiryId));
    expect(result.created).toBe(true);
    expect(await eventRow(result.eventId)).toMatchObject({ name: "Wedding", client_name: null });
  });

  it("the first hold on a worked enquiry joins its event", async () => {
    const v = await venue("then a hold");
    const enquiryId = await enquiry(v);
    expect((await reportReply(v, enquiryId)).statusCode).toBe(200);
    const eventId = await enquiryEvent(enquiryId);
    expect(eventId).not.toBeNull();
    const hold = await holdFromEnquiry(v, enquiryId);
    expect(hold.eventId).toBe(eventId);
    expect(await enquiryEvent(enquiryId)).toBe(eventId);
    expect(await eventCount(v.venueId)).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // The join's other cases.

  it("a closed enquiry is never given a new event: its viewing is still booked, and opening it is refused; the join makes none either", async () => {
    const v = await venue("closed");
    const rejected = await enquiry(v, { state: "rejected" });
    const viewing = await bookViewing(v, rejected, 1);
    expect(viewing.statusCode, viewing.body).toBe(201);
    expect(await enquiryEvent(rejected)).toBeNull();
    const withdrawn = await enquiry(v, { state: "withdrawn" });
    const refused = await openAsEvent(v.admin, withdrawn);
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json<unknown>()).toEqual({ error: "This enquiry is closed, so it is not opened as an event.", code: "ENQUIRY_CLOSED" });
    expect(await eventCount(v.venueId)).toBe(0);

    await joinOldRecords();
    expect(await enquiryEvent(rejected)).toBeNull();
    expect(await enquiryEvent(withdrawn)).toBeNull();
    expect(await questionsOn(rejected)).toEqual([]);
    expect(await eventCount(v.venueId)).toBe(0);
  });

  it("a closed enquiry whose deal sits in an event is joined to it, as the join would", async () => {
    const v = await venue("closed, one deal");
    const archived = await enquiry(v, { state: "archived" });
    const dealsEvent = await datelessEvent(v.venueId, "The deal's event");
    await link(pool, "opportunities", await dealIn(pool, v.venueId, "won", archived), dealsEvent);
    expect(opened(await openAsEvent(v.admin, archived))).toEqual({ enquiryId: archived, eventId: dealsEvent, created: false });

    await joinOldRecords();
    expect(await questionsOn(archived)).toEqual([]);
    expect(await joinsRecordedFor(archived)).toBe(0);
  });

  it("an enquiry whose link names a deleted event gets a new one, and the link moves", async () => {
    const v = await venue("deleted link");
    const enquiryId = await enquiry(v);
    const gone = await datelessEvent(v.venueId, "Removed");
    await link(pool, "enquiries", enquiryId, gone);
    await pool.query("UPDATE events SET deleted_at = now() WHERE id = $1", [gone]);
    const result = opened(await openAsEvent(v.admin, enquiryId));
    expect(result.created).toBe(true);
    expect(result.eventId).not.toBe(gone);
    expect(await enquiryEvent(enquiryId)).toBe(result.eventId);
  });

  it("an enquiry on the join's list that reaches one event by the time it is worked joins it; the join then closes its question as joined", async () => {
    const v = await venue("listed, then worked");
    const enquiryId = await enquiry(v);
    const stays = await datelessEvent(v.venueId, "The event that stays");
    const left = await datelessEvent(v.venueId, "The event it leaves");
    await interestIn(v, enquiryId, stays, v.rooms.saloon);
    await interestIn(v, enquiryId, left, v.rooms.reception);
    await joinOldRecords();
    expect(await questionsOn(enquiryId)).toEqual([{ reason: "reaches_many_events", resolved_at: null }]);

    // Its booking in the second event is removed, so one event remains.
    await pool.query("UPDATE bookings SET deleted_at = now() WHERE enquiry_id = $1 AND event_id = $2", [enquiryId, left]);
    const events = await eventCount(v.venueId);

    // Unlike the join, the writer does not skip a listed enquiry: it decides on today's data.
    const replied = await reportReply(v, enquiryId);
    expect(replied.statusCode, replied.body).toBe(200);
    expect(await enquiryEvent(enquiryId)).toBe(stays);
    expect(await eventCount(v.venueId)).toBe(events);

    // The next run closes the question as joined, to that event, by nobody, and changes nothing else.
    await joinOldRecords();
    const questions = (await pool.query<{ reason: string; resolution: string | null; resolved_event_id: string | null; resolved_by: string | null; resolved: boolean }>(
      `SELECT reason, resolution, resolved_event_id, resolved_by, resolved_at IS NOT NULL AS resolved
         FROM event_link_reviews WHERE subject_kind = 'enquiry' AND subject_id = $1`, [enquiryId])).rows;
    expect(questions).toEqual([{ reason: "reaches_many_events", resolution: "joined", resolved_event_id: stays, resolved_by: null, resolved: true }]);
    expect(await joinsRecordedFor(enquiryId)).toBe(0);
    expect(await enquiryEvent(enquiryId)).toBe(stays);
    expect(await eventCount(v.venueId)).toBe(events);
  });

  it("an event made for an enquiry stores its occasion trimmed, a blank one as none, as the join stores it", async () => {
    const v = await venue("occasions");
    const madeWith = async (eventType: string | null): Promise<string | null> => (await eventRow(await createEventFor(spine.db, {
      venueId: v.venueId, title: "", eventType, startsAt: null, endsAt: null, createdBy: null,
    }))).event_type;
    expect(await madeWith("  Dinner dance  ")).toBe("Dinner dance");
    expect(await madeWith(" \t\n ")).toBeNull();
    expect(await madeWith(`  ${"y".repeat(100)}`)).toBe("y".repeat(80));
    // Cut by characters, as the column and the join count them, not by UTF-16 units.
    expect(await madeWith("\u{1F942}".repeat(81))).toBe("\u{1F942}".repeat(80));
    expect(await madeWith(null)).toBeNull();

    // Two enquiries alike, one opened here and one left to the join, store the same occasion and fixture marker.
    const padded = "  Dinner dance 　";
    const here = await enquiry(v, { eventType: padded });
    const byJoin = await enquiry(v, { eventType: padded });
    await pool.query("UPDATE enquiries SET fixture_source = 'spine-writers' WHERE id = ANY($1::uuid[])", [[here, byJoin]]);
    await pool.query(`UPDATE enquiries SET first_response_at = now(), first_response_by = $2, first_response_channel = 'email',
      first_response_recorded_at = now() WHERE id = $1`, [byJoin, v.admin.id]);
    const result = opened(await openAsEvent(v.admin, here));
    await joinOldRecords();
    const madeHere = await eventRow(result.eventId);
    const madeByJoin = await eventRow(await enquiryEvent(byJoin));
    expect(madeHere.id).not.toBe(madeByJoin.id);
    expect({ event_type: madeHere.event_type, fixture_source: madeHere.fixture_source })
      .toEqual({ event_type: madeByJoin.event_type, fixture_source: madeByJoin.fixture_source });
    expect(madeHere.event_type).toBe("Dinner dance");
  });
});
