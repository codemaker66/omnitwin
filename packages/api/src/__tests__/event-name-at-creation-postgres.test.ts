import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BookingSchema, type Booking } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { bookingRoutes } from "../routes/bookings.js";
import { insertBoundBookings } from "../services/event-binding.js";

// ---------------------------------------------------------------------------
// An event always has a name a person can read (release-lead ruling of 12
// November 2026 on #397, part c). Every event made for a booking is named in
// createEventFor (services/event-binding.ts): the booking's title, or, when a
// booking has no usable title, its occasion and the venue's own day of its
// start ("Wedding, 13 June 2032"). Before, the event took the title as it
// stood, so a booking stored without one (written before #350) made an event
// named "", and every read of that event's name refused it: the client's
// schedule and home, the Diary range and the room's timeline.
//
// Proved through the writers that make events: a Diary transition of an
// untitled interest-only booking, the enquiry conversion for an enquiry stored
// with a blank name (whose event must never be named after the enquiry's
// email), and the direct writer the seed and importers share.
//
// Runs on the disposable platform database only; the platform database is
// shared and never truncated, so every test makes its own venue.
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("The event-name tests require the explicit disposable platform database");
  }
}

const OUTLINE = [{ x: -10, y: -5 }, { x: 10, y: -5 }, { x: 10, y: 5 }, { x: -10, y: 5 }];

describe.skipIf(target === undefined)("an event made for a booking is named so a person can read it", () => {
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `event_name_${randomUUID()}`, max: 4,
      options: "-c statement_timeout=30000 -c lock_timeout=20000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name)
      .toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(bookingRoutes, { db, prefix: "/bookings" });
    await server.ready();
  });
  afterAll(async () => { await server?.close(); await pool?.end(); });

  async function venue(label: string) {
    const venueId = randomUUID();
    await db.insert(schema.venues).values({
      id: venueId, name: `TEST ONLY ${label}`, slug: `event-name-${venueId}`, address: "Disposable fixture", timezone: "Europe/London",
    });
    const rooms = [randomUUID(), randomUUID(), randomUUID(), randomUUID()] as const;
    await db.insert(schema.spaces).values(rooms.map((id, index) => ({
      id, venueId, name: `Room ${String(index + 1)}`, slug: `room-${id}`, widthM: "20", lengthM: "10", heightM: "6",
      floorPlanOutline: OUTLINE, sortOrder: index,
    })));
    const adminId = randomUUID();
    await db.insert(schema.users).values({
      id: adminId, email: `${adminId}@event-name.invalid`, name: "TEST ONLY coordinator", role: "admin", venueId,
    });
    const headers = {
      authorization: `Bearer ${JSON.stringify({ id: adminId, email: `${adminId}@event-name.invalid`, role: "admin", venueId, platformRole: "none" })}`,
    };
    return { venueId, rooms, adminId, headers };
  }

  /** The hold quartet every option carries (roadmap N3). */
  function hygiene(ownerUserId: string) {
    return {
      decisionAt: "2032-05-01T10:00:00.000Z",
      ownerUserId,
      nextAction: "TEST ONLY call the client about the date.",
      nextActionDueAt: "2032-04-24T10:00:00.000Z",
    };
  }

  async function eventName(eventId: string | null): Promise<string> {
    if (eventId === null) throw new Error("The booking has no event");
    const [row] = await db.select({ name: schema.events.name }).from(schema.events).where(eq(schema.events.id, eventId));
    if (row === undefined) throw new Error("Missing event");
    return row.name;
  }

  it("names the event of an untitled interest-only booking made provisional by its occasion and the venue's own day", async () => {
    const v = await venue("transition");
    // As rows from before #350 stand: written straight to the table, since
    // every writer now refuses an empty or blank title.
    const prospect = async (room: string, title: string, eventType: string | null, startsAt: string, endsAt: string) => {
      const inserted = await pool.query<{ id: string }>(
        "INSERT INTO bookings (venue_id, space_id, kind, title, event_type, starts_at, ends_at) VALUES ($1, $2, 'prospect', $3, $4, $5, $6) RETURNING id",
        [v.venueId, room, title, eventType, startsAt, endsAt],
      );
      const id = inserted.rows[0]?.id;
      if (id === undefined) throw new Error("Prospect fixture missing");
      return id;
    };
    const cases = [
      // 23:30 UTC on Saturday 12 June is half past midnight on the 13th in
      // Glasgow (British Summer Time): the venue's day, not the server's.
      { id: await prospect(v.rooms[0], "", "wedding", "2032-06-12T23:30:00.000Z", "2032-06-13T02:00:00.000Z"), name: "Wedding, 13 June 2032" },
      { id: await prospect(v.rooms[1], "   ", null, "2032-06-19T18:00:00.000Z", "2032-06-19T23:00:00.000Z"), name: "Event, 19 June 2032" },
      // The bare shape an enquiry with a blank name gave a title before #350.
      { id: await prospect(v.rooms[2], " — Drinks reception", "reception", "2032-06-26T17:00:00.000Z", "2032-06-26T20:00:00.000Z"),
        name: "Drinks reception, 26 June 2032" },
      // A booking with a title names its event by it, as before.
      { id: await prospect(v.rooms[3], "  TEST ONLY Merchants' dinner  ", "dinner", "2032-06-26T18:00:00.000Z", "2032-06-26T23:00:00.000Z"),
        name: "TEST ONLY Merchants' dinner" },
    ];
    for (const { id, name } of cases) {
      const response = await server.inject({
        method: "POST", url: `/bookings/${id}/transition`, headers: v.headers,
        payload: { toState: "hold", hold: { rank: 1, ...hygiene(v.adminId) } },
      });
      expect(response.statusCode, response.body).toBe(200);
      const held: Booking = BookingSchema.parse(response.json<{ data: unknown }>().data);
      expect(held.kind).toBe("hold");
      expect(await eventName(held.eventId), name).toBe(name);
    }
  });

  it("names the event of an enquiry stored with a blank name by its occasion and day, never by the enquiry's email", async () => {
    const v = await venue("enquiry");
    const email = `${randomUUID()}@event-name.invalid`;
    // GuestEnquirySchema now refuses a blank name; older rows can hold "".
    const [enquiry] = await db.insert(schema.enquiries).values({
      venueId: v.venueId, spaceId: v.rooms[0], state: "under_review", name: "", email, eventType: "wedding", preferredDate: "2032-07-03",
    }).returning({ id: schema.enquiries.id });
    if (enquiry === undefined) throw new Error("Enquiry fixture missing");
    const response = await server.inject({
      method: "POST", url: "/bookings/from-enquiry", headers: v.headers,
      payload: { enquiryId: enquiry.id, spaceId: v.rooms[0], startsAt: "2032-07-03T16:00:00.000Z", endsAt: "2032-07-03T23:00:00.000Z", ...hygiene(v.adminId) },
    });
    expect(response.statusCode, response.body).toBe(201);
    const hold = BookingSchema.parse(response.json<{ data: unknown }>().data);
    // The hold keeps the title staff work from (#350): who asked, and for what.
    expect(hold.title).toBe(`${email} — Wedding`);
    const name = await eventName(hold.eventId);
    expect(name).toBe("Wedding, 3 July 2032");
    expect(name).not.toContain("@");
  });

  // What the public route stores today for a guest who gives no name: the
  // enquiry is filed under its email (routes/public-enquiries.ts, name =
  // email), so the hold's title begins with the address and the name is not
  // blank. An event is never named by it.
  it("names the event of an enquiry filed under its email by its occasion and day, and a named enquiry's event by the hold's title", async () => {
    const v = await venue("filed under email");
    const email = `${randomUUID()}@event-name.invalid`;
    const [filed, named] = await db.insert(schema.enquiries).values([
      { venueId: v.venueId, spaceId: v.rooms[0], state: "under_review", name: email, email, eventType: "wedding", preferredDate: "2032-08-07" },
      { venueId: v.venueId, spaceId: v.rooms[1], state: "under_review", name: "TEST ONLY Ailsa Grant", email: `${randomUUID()}@event-name.invalid`, eventType: "wedding", preferredDate: "2032-08-14" },
    ]).returning({ id: schema.enquiries.id });
    if (filed === undefined || named === undefined) throw new Error("Enquiry fixtures missing");
    const convert = async (enquiryId: string, spaceId: string | undefined, day: string): Promise<Booking> => {
      const response = await server.inject({
        method: "POST", url: "/bookings/from-enquiry", headers: v.headers,
        payload: { enquiryId, spaceId, startsAt: `${day}T16:00:00.000Z`, endsAt: `${day}T23:00:00.000Z`, ...hygiene(v.adminId) },
      });
      expect(response.statusCode, response.body).toBe(201);
      return BookingSchema.parse(response.json<{ data: unknown }>().data);
    };

    const hold = await convert(filed.id, v.rooms[0], "2032-08-07");
    // The hold keeps the title staff work from (#350): who asked, and for what.
    expect(hold.title).toBe(`${email} — Wedding`);
    const name = await eventName(hold.eventId);
    expect(name).toBe("Wedding, 7 August 2032");
    expect(name).not.toContain("@");

    // A guest who gave a name: the event takes the hold's title, as before.
    const theirs = await convert(named.id, v.rooms[1], "2032-08-14");
    expect(await eventName(theirs.eventId)).toBe("TEST ONLY Ailsa Grant — Wedding");
  });

  it("names the event of an untitled row from the seed or an importer the same way", async () => {
    const v = await venue("direct writer");
    const rows = await insertBoundBookings(db, [
      { venueId: v.venueId, spaceId: v.rooms[0], kind: "ink", title: "", eventType: "dinner", createdBy: v.adminId,
        startsAt: new Date("2032-12-11T18:00:00.000Z"), endsAt: new Date("2032-12-11T23:00:00.000Z") },
      { venueId: v.venueId, spaceId: v.rooms[1], kind: "hold", title: " — Wedding", eventType: "wedding", createdBy: v.adminId,
        startsAt: new Date("2032-12-18T13:00:00.000Z"), endsAt: new Date("2032-12-18T23:00:00.000Z"), rank: 1,
        decisionAt: new Date("2032-11-01T10:00:00.000Z"), ownerUserId: v.adminId,
        nextAction: "TEST ONLY call the couple.", nextActionDueAt: new Date("2032-10-25T10:00:00.000Z") },
    ]);
    expect(await Promise.all(rows.map((row) => eventName(row.eventId)))).toEqual([
      "Dinner, 11 December 2032",
      "Wedding, 18 December 2032",
    ]);
    // The bookings themselves keep what they were given.
    expect(rows.map((row) => row.title)).toEqual(["", " — Wedding"]);
  });
});
