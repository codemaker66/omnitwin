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
import { crmRoutes } from "../routes/crm.js";
import { enquiryRoutes } from "../routes/enquiries.js";
import { opportunityRoutes } from "../routes/opportunities.js";
import { quoteRoutes } from "../routes/quotes.js";
import { enquiryEventNaming } from "../services/enquiry-event.js";
import { createEventFor } from "../services/event-binding.js";
import { readSpineInvariant, spineInvariantHolds } from "../services/event-spine-invariant.js";
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
// A deal takes its event in the transaction that makes it (ruling R28): as
// the join's step 2 decides a deal, its enquiry's event; else, when its
// enquiry may become one, the one event the enquiry's records reach, or none
// while they reach several (the deal is still made), or one made for the
// enquiry and the deal together; else, for a draft, a request or no
// enquiry, one of its own. An event has one open deal.
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

/** A deal as the deal routes answer it (the row, whole). */
const DealSchema = z.object({ id: z.uuid(), eventId: z.uuid().nullable(), stage: z.string(), sourceEnquiryId: z.uuid().nullable() });
type Deal = z.infer<typeof DealSchema>;
/** POST /crm/from-enquiry/:id and POST /opportunities answer the deal under data.opportunity. */
const MadeDealSchema = z.object({ data: z.object({ opportunity: DealSchema }) });

const OPEN_DEAL_REFUSAL = "This event already has an open deal. Close that one first, or make this deal without the enquiry.";
const REOPEN_REFUSAL = "This deal's event already has another open deal. Close that one first.";

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
    await server.register(crmRoutes, { db: spine.db, prefix: "/crm" });
    await server.register(opportunityRoutes, { db: spine.db, prefix: "/opportunities" });
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

  async function questionsOn(subjectId: string, kind: "enquiry" | "opportunity" = "enquiry"): Promise<OpenQuestion[]> {
    return (await pool.query<OpenQuestion>(
      "SELECT reason, resolved_at FROM event_link_reviews WHERE subject_kind = $2 AND subject_id = $1 ORDER BY created_at",
      [subjectId, kind],
    )).rows;
  }

  /** How many joins the join of old records has recorded for the enquiry (or the deal). */
  async function joinsRecordedFor(subjectId: string, kind: "enquiry" | "opportunity" = "enquiry"): Promise<number> {
    const [row] = (await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM event_link_joins WHERE subject_kind = $2 AND subject_id = $1", [subjectId, kind])).rows;
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

  // ---------------------------------------------------------------------------
  // A deal takes its event when it is made (ruling R28): POST /crm/from-enquiry
  // and POST /opportunities decide as the join's step 2 decides a deal, and the
  // edit (PATCH /opportunities/:id) gives a newly named enquiry the deal's event.

  describe("a deal takes its event when it is made", () => {
    const fromEnquiry = (v: SpineVenue, enquiryId: string): Promise<LightMyRequestResponse> =>
      post(v.admin, `/crm/from-enquiry/${enquiryId}`);
    const createDeal = (
      v: SpineVenue,
      body: { readonly title: string; readonly sourceEnquiryId?: string; readonly eventType?: string },
    ): Promise<LightMyRequestResponse> => post(v.admin, "/opportunities", { venueId: v.venueId, ...body });
    const patchDeal = (headers: { authorization: string }, dealId: string, body: Record<string, unknown>): Promise<LightMyRequestResponse> =>
      server.inject({ method: "PATCH", url: `/opportunities/${dealId}`, headers, payload: body });

    /** The venue's coordinator, as a platform admin (who may move a deal to any stage). */
    function platformAdmin(actor: SpineActor): { authorization: string } {
      return { authorization: `Bearer ${JSON.stringify({ ...actor, platformRole: "admin", email: `${actor.id}@event-spine.invalid` })}` };
    }

    /** The deal a create answered, which must be 201. */
    function made(response: LightMyRequestResponse): Deal {
      expect(response.statusCode, response.body).toBe(201);
      return MadeDealSchema.parse(response.json<unknown>()).data.opportunity;
    }

    async function dealRow(dealId: string): Promise<{ readonly event_id: string | null; readonly stage: string }> {
      const [row] = (await pool.query<{ event_id: string | null; stage: string }>(
        "SELECT event_id, stage FROM opportunities WHERE id = $1", [dealId])).rows;
      if (row === undefined) throw new Error("Missing deal");
      return row;
    }

    async function dealEvent(dealId: string): Promise<string | null> {
      return (await dealRow(dealId)).event_id;
    }

    async function dealsOf(enquiryId: string): Promise<number> {
      const [row] = (await pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM opportunities WHERE source_enquiry_id = $1", [enquiryId])).rows;
      return row?.count ?? 0;
    }

    function known(eventId: string | null): string {
      if (eventId === null) throw new Error("No event");
      return eventId;
    }

    /** The join of old records records nothing for these, and lists none of them. */
    async function joinLeavesAlone(records: readonly (readonly [string, "enquiry" | "opportunity"])[]): Promise<void> {
      for (const [id, kind] of records) {
        expect(await questionsOn(id, kind), `${kind} ${id}`).toEqual([]);
        expect(await joinsRecordedFor(id, kind), `${kind} ${id}`).toBe(0);
      }
    }

    // Ruling R28 first: the writer decides as the join's step 2.

    it("a deal made from an enquiry whose bookings sit in two events is still made, with no event, and makes none; the join lists the enquiry and the deal waits", async () => {
      const v = await venue("deal, two events");
      const enquiryId = await enquiryInTwoEvents(v);
      const before = await eventCount(v.venueId);

      const deal = made(await fromEnquiry(v, enquiryId));
      expect(deal.eventId).toBeNull();
      expect(await dealEvent(deal.id)).toBeNull();
      expect(await enquiryEvent(enquiryId)).toBeNull();
      expect(await eventCount(v.venueId)).toBe(before);

      await joinOldRecords();
      expect(await questionsOn(enquiryId)).toEqual([{ reason: "reaches_many_events", resolved_at: null }]);
      await joinLeavesAlone([[deal.id, "opportunity"]]);
      expect(await dealEvent(deal.id)).toBeNull();
      expect(await enquiryEvent(enquiryId)).toBeNull();
      expect(await eventCount(v.venueId)).toBe(before);
    });

    it("a deal made from an enquiry whose one booking sits in an event takes that event with its enquiry, and makes none; the join changes nothing", async () => {
      const v = await venue("deal, one reached event");
      const enquiryId = await enquiry(v);
      const reached = await datelessEvent(v.venueId, "Where the dates are");
      await interestIn(v, enquiryId, reached, v.rooms.saloon);
      const before = await eventCount(v.venueId);

      const deal = made(await fromEnquiry(v, enquiryId));
      expect(deal.eventId).toBe(reached);
      expect(await enquiryEvent(enquiryId)).toBe(reached);
      expect(await eventCount(v.venueId)).toBe(before);

      await joinOldRecords();
      await joinLeavesAlone([[enquiryId, "enquiry"], [deal.id, "opportunity"]]);
      expect(await dealEvent(deal.id)).toBe(reached);
      expect(await enquiryEvent(enquiryId)).toBe(reached);
      expect(await eventCount(v.venueId)).toBe(before);
    });

    it("a deal made from a closed enquiry that reaches no event gets one event with its enquiry, as the join's step 2 makes it; the join changes nothing", async () => {
      const v = await venue("deal, closed enquiry");
      const rejected = await enquiry(v, { state: "rejected" });
      const withdrawn = await enquiry(v, { state: "withdrawn" });
      // Neither route refuses a closed enquiry: the press on it, and a deal that names it.
      const pressed = made(await fromEnquiry(v, rejected));
      const named = made(await createDeal(v, { title: "Second thoughts", sourceEnquiryId: withdrawn }));

      for (const [deal, enquiryId] of [[pressed, rejected], [named, withdrawn]] as const) {
        const eventId = known(deal.eventId);
        expect(await enquiryEvent(enquiryId)).toBe(eventId);
        // Made for the enquiry, so named as an enquiry's event is named.
        expect(await eventRow(eventId)).toMatchObject({
          name: "Fixture enquirer — Wedding", client_name: "Fixture enquirer", event_type: "wedding",
          status: "draft", starts_at: null, guest_count: 0, created_by: v.admin.id,
        });
        expect(await phaseCount(eventId)).toBe(DEFAULT_EVENT_PHASE_TEMPLATE.length);
      }
      expect(await eventCount(v.venueId)).toBe(2);

      await joinOldRecords();
      await joinLeavesAlone([[rejected, "enquiry"], [pressed.id, "opportunity"], [withdrawn, "enquiry"], [named.id, "opportunity"]]);
      expect(await enquiryEvent(rejected)).toBe(pressed.eventId);
      expect(await enquiryEvent(withdrawn)).toBe(named.eventId);
      expect(await eventCount(v.venueId)).toBe(2);
    });

    it("a deal made from a draft enquiry, or from a request that books nothing, has an event of its own and the enquiry none; the join changes nothing", async () => {
      const v = await venue("deal, draft and request");
      const draft = await enquiry(v, { state: "draft" });
      const request = await enquiry(v, { eventType: VENUE_ACCESS_ENQUIRY_TYPE });

      const fromDraft = made(await fromEnquiry(v, draft));
      const fromRequest = made(await createDeal(v, { title: "Access visit", sourceEnquiryId: request }));
      // Named by the deal, its client the enquiry's and its occasion the deal's, else the enquiry's, as the join makes one.
      expect(await eventRow(fromDraft.eventId)).toMatchObject({ name: "Wedding — Fixture enquirer", client_name: "Fixture enquirer", event_type: "wedding" });
      expect(await eventRow(fromRequest.eventId)).toMatchObject({ name: "Access visit", client_name: "Fixture enquirer", event_type: VENUE_ACCESS_ENQUIRY_TYPE });
      expect(await enquiryEvent(draft)).toBeNull();
      expect(await enquiryEvent(request)).toBeNull();
      expect(await eventCount(v.venueId)).toBe(2);

      await joinOldRecords();
      await joinLeavesAlone([[draft, "enquiry"], [fromDraft.id, "opportunity"], [request, "enquiry"], [fromRequest.id, "opportunity"]]);
      expect(await enquiryEvent(draft)).toBeNull();
      expect(await enquiryEvent(request)).toBeNull();
      expect(await dealEvent(fromDraft.id)).toBe(fromDraft.eventId);
      expect(await dealEvent(fromRequest.id)).toBe(fromRequest.eventId);
      expect(await eventCount(v.venueId)).toBe(2);
    });

    it("a deal made from an enquiry whose link names a deleted event has an event of its own, as the join gives it; the enquiry's link stays", async () => {
      const v = await venue("deal, deleted link");
      const enquiryId = await enquiry(v);
      const gone = await datelessEvent(v.venueId, "Removed");
      await link(pool, "enquiries", enquiryId, gone);
      await pool.query("UPDATE events SET deleted_at = now() WHERE id = $1", [gone]);

      const deal = made(await createDeal(v, { title: "After the removal", sourceEnquiryId: enquiryId }));
      expect(deal.eventId).not.toBeNull();
      expect(deal.eventId).not.toBe(gone);
      expect(await eventRow(deal.eventId)).toMatchObject({ name: "After the removal", client_name: "Fixture enquirer", event_type: "wedding" });
      expect(await enquiryEvent(enquiryId)).toBe(gone);

      await joinOldRecords();
      await joinLeavesAlone([[enquiryId, "enquiry"], [deal.id, "opportunity"]]);
      expect(await enquiryEvent(enquiryId)).toBe(gone);
      expect(await dealEvent(deal.id)).toBe(deal.eventId);
    });

    // The brief's cases.

    it("a deal made from an enquiry takes the enquiry's event; from an enquiry with none, one event for both", async () => {
      const v = await venue("deal, the enquiry's event");
      const openedEnquiry = await enquiry(v);
      const itsEvent = opened(await openAsEvent(v.admin, openedEnquiry)).eventId;
      const fresh = await enquiry(v);

      const onOpened = made(await fromEnquiry(v, openedEnquiry));
      expect(onOpened.eventId).toBe(itsEvent);
      expect(await enquiryEvent(openedEnquiry)).toBe(itsEvent);
      const onFresh = made(await fromEnquiry(v, fresh));
      expect(onFresh.eventId).not.toBeNull();
      expect(onFresh.eventId).not.toBe(itsEvent);
      expect(await enquiryEvent(fresh)).toBe(onFresh.eventId);
      expect(await eventCount(v.venueId)).toBe(2);
      const counts = await readSpineInvariant(spine.db, v.venueId);
      expect(spineInvariantHolds(counts), JSON.stringify(counts)).toBe(true);
    });

    it("a deal with no enquiry gets an event of its own, named by the deal", async () => {
      const v = await venue("deal, no enquiry");
      const deal = made(await createDeal(v, { title: "Burns supper for the Gillies", eventType: "Burns supper" }));
      const eventId = known(deal.eventId);
      expect(await eventRow(eventId)).toMatchObject({
        name: "Burns supper for the Gillies", client_name: null, event_type: "Burns supper",
        status: "draft", starts_at: null, guest_count: 0, created_by: v.admin.id,
      });
      expect(await phaseCount(eventId)).toBe(DEFAULT_EVENT_PHASE_TEMPLATE.length);
      expect(await eventCount(v.venueId)).toBe(1);

      await joinOldRecords();
      await joinLeavesAlone([[deal.id, "opportunity"]]);
      expect(await eventCount(v.venueId)).toBe(1);
    });

    it("a second open deal on the same event is refused, names the first, and writes nothing", async () => {
      const v = await venue("second open deal");
      const enquiryId = await enquiry(v);
      const first = made(await fromEnquiry(v, enquiryId));
      const again = await createDeal(v, { title: "Second", sourceEnquiryId: enquiryId });
      expect(again.statusCode, again.body).toBe(409);
      expect(again.json<unknown>()).toEqual({ error: OPEN_DEAL_REFUSAL, code: "EVENT_HAS_OPEN_DEAL", dealId: first.id });
      expect(await dealsOf(enquiryId)).toBe(1);
      expect(await eventCount(v.venueId)).toBe(1);
    });

    it("Create opportunity on an enquiry whose booking sits in an event with another enquiry's open deal is refused naming it, and keeps nothing it wrote", async () => {
      const v = await venue("crm press refused");
      const shared = await datelessEvent(v.venueId, "The shared event");
      const theirs = await enquiry(v);
      await link(pool, "enquiries", theirs, shared);
      const openDeal = await dealIn(pool, v.venueId, "qualified", theirs);
      await link(pool, "opportunities", openDeal, shared);
      const pressed = await enquiry(v);
      await interestIn(v, pressed, shared, v.rooms.saloon);
      /** What the press writes before it reaches the deal's event (a person with their email point, a household and its membership), and after. */
      const written = async (): Promise<Record<string, number>> => (await pool.query<Record<string, number>>(
        `SELECT (SELECT count(*)::int FROM contacts WHERE venue_id = $1) AS people,
                (SELECT count(*)::int FROM contact_points WHERE venue_id = $1) AS points,
                (SELECT count(*)::int FROM client_accounts WHERE venue_id = $1) AS organisations,
                (SELECT count(*)::int FROM account_memberships WHERE venue_id = $1) AS memberships,
                (SELECT count(*)::int FROM opportunities WHERE venue_id = $1) AS deals,
                (SELECT count(*)::int FROM events WHERE venue_id = $1) AS events`, [v.venueId])).rows[0] ?? {};
      const before = await written();

      const refused = await fromEnquiry(v, pressed);
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json<unknown>()).toEqual({ error: OPEN_DEAL_REFUSAL, code: "EVENT_HAS_OPEN_DEAL", dealId: openDeal });
      // The whole press rolled back: no deal, event, link, person or household of its own is left.
      expect(await written()).toEqual(before);
      const [left] = (await pool.query<{ event_id: string | null; contact_id: string | null }>(
        "SELECT event_id, contact_id FROM enquiries WHERE id = $1", [pressed])).rows;
      expect(left).toEqual({ event_id: null, contact_id: null });
      expect(await dealsOf(pressed)).toBe(0);
    });

    it("a lost deal does not stand in the way of a new one, on the same event; a platform admin reopening the lost one beside it is refused plainly", async () => {
      const v = await venue("lost, then a new deal");
      const enquiryId = await enquiry(v);
      const lost = made(await fromEnquiry(v, enquiryId));
      const closed = await patchDeal(bearer(v.admin), lost.id, { stage: "lost", note: "Chose another date" });
      expect(closed.statusCode, closed.body).toBe(200);

      const next = made(await createDeal(v, { title: "Second try", sourceEnquiryId: enquiryId }));
      expect(next.eventId).toBe(lost.eventId);
      expect(await eventCount(v.venueId)).toBe(1);

      // A platform admin may move a deal to any stage, but not open a second deal on an event.
      const reopened = await patchDeal(platformAdmin(v.admin), lost.id, { stage: "new" });
      expect(reopened.statusCode, reopened.body).toBe(409);
      expect(reopened.json<unknown>()).toEqual({ error: REOPEN_REFUSAL, code: "EVENT_HAS_OPEN_DEAL", dealId: next.id });
      expect(await dealRow(lost.id)).toEqual({ event_id: lost.eventId, stage: "lost" });
    });

    it("changing a deal's enquiry leaves its event where it was; the new enquiry takes it when it had none, keeps its own when it had one, and the count holds", async () => {
      const v = await venue("deal changes enquiry");
      const asCoordinator = bearer(v.admin);

      // An enquiry with no event takes the deal's.
      const deal = made(await createDeal(v, { title: "Ceilidh" }));
      const bare = await enquiry(v);
      const moved = await patchDeal(asCoordinator, deal.id, { sourceEnquiryId: bare });
      expect(moved.statusCode, moved.body).toBe(200);
      expect(await dealEvent(deal.id)).toBe(deal.eventId);
      expect(await enquiryEvent(bare)).toBe(deal.eventId);

      // One that already has its event keeps it; the deal keeps its own.
      const other = made(await createDeal(v, { title: "Dinner" }));
      const owned = await enquiry(v);
      const ownEvent = opened(await openAsEvent(v.admin, owned)).eventId;
      const named = await patchDeal(asCoordinator, other.id, { sourceEnquiryId: owned });
      expect(named.statusCode, named.body).toBe(200);
      expect(await dealEvent(other.id)).toBe(other.eventId);
      expect(await enquiryEvent(owned)).toBe(ownEvent);

      // A draft never takes one.
      const third = made(await createDeal(v, { title: "Supper" }));
      const draft = await enquiry(v, { state: "draft" });
      expect((await patchDeal(asCoordinator, third.id, { sourceEnquiryId: draft })).statusCode).toBe(200);
      expect(await enquiryEvent(draft)).toBeNull();
      expect(await dealEvent(third.id)).toBe(third.eventId);

      const counts = await readSpineInvariant(spine.db, v.venueId);
      expect(spineInvariantHolds(counts), JSON.stringify(counts)).toBe(true);
      await joinOldRecords();
      await joinLeavesAlone([[bare, "enquiry"], [owned, "enquiry"], [draft, "enquiry"],
        [deal.id, "opportunity"], [other.id, "opportunity"], [third.id, "opportunity"]]);
    });

    it("changing a deal's enquiry to one whose own records reach another event leaves that enquiry's link empty for the join's list", async () => {
      const v = await venue("deal names a reached enquiry");
      const deal = made(await createDeal(v, { title: "Ceilidh" }));
      const elsewhere = await enquiry(v);
      await interestIn(v, elsewhere, await datelessEvent(v.venueId, "Where its dates are"), v.rooms.saloon);

      const moved = await patchDeal(bearer(v.admin), deal.id, { sourceEnquiryId: elsewhere });
      expect(moved.statusCode, moved.body).toBe(200);
      expect(await dealEvent(deal.id)).toBe(deal.eventId);
      expect(await enquiryEvent(elsewhere)).toBeNull();

      await joinOldRecords();
      expect(await questionsOn(elsewhere)).toEqual([{ reason: "reaches_many_events", resolved_at: null }]);
      expect(await enquiryEvent(elsewhere)).toBeNull();
      expect(await dealEvent(deal.id)).toBe(deal.eventId);
    });

    it("an edit naming an enquiry takes the enquiry before it writes the deal", async () => {
      const v = await venue("edit lock order");
      const deal = made(await createDeal(v, { title: "Ceilidh" }));
      const enquiryId = await enquiry(v);
      let moving: Promise<LightMyRequestResponse> | undefined;
      let waiting: readonly { readonly query: string }[] = [];
      try {
        await withLockedEnquiry(enquiryId, "NO KEY UPDATE", async (client) => {
          moving = patchDeal(bearer(v.admin), deal.id, { sourceEnquiryId: enquiryId });
          await blocked(1);
          waiting = (await pool.query<{ query: string }>(
            "SELECT query FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'", [APPLICATION_NAME])).rows;
          // The deal row is not held while the edit waits for the enquiry.
          await client.query("SELECT id FROM opportunities WHERE id = $1 FOR UPDATE NOWAIT", [deal.id]);
          await client.query("COMMIT");
        });
      } finally {
        // Every request started is settled before the case ends, on every path.
        await Promise.allSettled([moving]);
      }
      expect(waiting).toHaveLength(1);
      expect(waiting[0]?.query).toMatch(/from "enquiries" .* for no key update/u);
      const response = await moving;
      expect(response?.statusCode, response?.body).toBe(200);
      expect(await enquiryEvent(enquiryId)).toBe(deal.eventId);
    }, 30_000);

    it("two deals pressed at once for one enquiry: one is made, the other is refused naming it, never a 500", async () => {
      const v = await venue("two deals at once");
      const enquiryId = await enquiry(v);
      let first: Promise<LightMyRequestResponse> | undefined;
      let second: Promise<LightMyRequestResponse> | undefined;
      try {
        // Both wait on the enquiry, the first ahead of the second, then run in that order.
        await withLockedEnquiry(enquiryId, "NO KEY UPDATE", async (client) => {
          first = createDeal(v, { title: "First press", sourceEnquiryId: enquiryId });
          await blocked(1);
          second = createDeal(v, { title: "Second press", sourceEnquiryId: enquiryId });
          await blocked(2);
          await client.query("COMMIT");
        });
      } finally {
        await Promise.allSettled([first, second]);
      }
      if (first === undefined || second === undefined) throw new Error("A press never started");
      const winner = made(await first);
      const refused = await second;
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json<unknown>()).toEqual({ error: OPEN_DEAL_REFUSAL, code: "EVENT_HAS_OPEN_DEAL", dealId: winner.id });
      expect(await dealsOf(enquiryId)).toBe(1);
      expect(await enquiryEvent(enquiryId)).toBe(winner.eventId);
      expect(await eventCount(v.venueId)).toBe(1);

      // At the same moment, five rounds: one made, the other refused naming it, never a 500.
      for (let round = 0; round < 5; round += 1) {
        const pressedOn = await enquiry(v);
        const answers = await Promise.all([
          createDeal(v, { title: "One press", sourceEnquiryId: pressedOn }),
          createDeal(v, { title: "The other press", sourceEnquiryId: pressedOn }),
        ]);
        expect(answers.map((answer) => answer.statusCode).sort(), answers.map((answer) => answer.body).join("\n")).toEqual([201, 409]);
        const [kept] = answers.filter((answer) => answer.statusCode === 201).map(made);
        const [turnedAway] = answers.filter((answer) => answer.statusCode === 409);
        expect(turnedAway?.json<unknown>()).toEqual({ error: OPEN_DEAL_REFUSAL, code: "EVENT_HAS_OPEN_DEAL", dealId: kept?.id });
        expect(await dealsOf(pressedOn)).toBe(1);
      }
    }, 60_000);

    it("a deal whose event is given an open deal by another writer while it is made is refused naming that deal, never a 500", async () => {
      const v = await venue("open deal at the same moment");
      const enquiryId = await enquiry(v);
      const eventId = opened(await openAsEvent(v.admin, enquiryId)).eventId;
      const writer = await pool.connect();
      let pressed: Promise<LightMyRequestResponse> | undefined;
      let theirs: string | undefined;
      let waiting: readonly { readonly query: string }[] = [];
      try {
        await writer.query("BEGIN");
        theirs = (await writer.query<{ id: string }>(
          "INSERT INTO opportunities (venue_id, title, stage, event_id) VALUES ($1, 'Another writer''s deal', 'new', $2) RETURNING id",
          [v.venueId, eventId])).rows[0]?.id;
        pressed = createDeal(v, { title: "This press", sourceEnquiryId: enquiryId });
        // It sees no open deal on the event, and waits at its insert on the one-open-deal index.
        await blocked(1);
        waiting = (await pool.query<{ query: string }>(
          "SELECT query FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'", [APPLICATION_NAME])).rows;
        await writer.query("COMMIT");
      } catch (error) {
        await writer.query("ROLLBACK");
        await pressed?.catch(() => undefined);
        throw error;
      } finally {
        writer.release();
      }
      const response = await pressed;
      expect(theirs).toEqual(expect.any(String));
      expect(waiting).toHaveLength(1);
      expect(waiting[0]?.query).toMatch(/^insert into "opportunities"/iu);
      expect(response?.statusCode, response?.body).toBe(409);
      expect(response?.json<unknown>()).toEqual({ error: OPEN_DEAL_REFUSAL, code: "EVENT_HAS_OPEN_DEAL", dealId: theirs });
      expect(await dealsOf(enquiryId)).toBe(0);
    }, 30_000);
  });
});
