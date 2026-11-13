import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { BOOKING_EXIT_STATES, BookingSchema, type Booking, type PlatformRole } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { bookingRoutes } from "../routes/bookings.js";
import { insertBoundBookings } from "../services/event-binding.js";

// ---------------------------------------------------------------------------
// GET /bookings?enquiryId= on the migrated platform database (T-635): where an
// enquiry stands in the Diary. Proves the read through the real route against
// real PostgreSQL — the session wall, the exact query, the enquiry's venue as
// the Diary's read gate, and the rows: only this enquiry's live bookings
// (active, not deleted) in rooms the Diary still shows, soonest first.
//
// The database is shared with the other platform files and never truncated,
// so every test makes its own venues, people and enquiries.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Enquiry booking tests require the explicit disposable platform database");
  }
}

const OUTLINE = [{ x: -10, y: -5 }, { x: 10, y: -5 }, { x: 10, y: 5 }, { x: -10, y: 5 }];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The asked-for day: Friday 14 May 2027, noon in Glasgow. */
const DAY_ONE = Date.parse("2027-05-14T11:00:00.000Z");

interface Actor { readonly id: string; readonly role: string; readonly venueId: string | null; readonly platformRole: PlatformRole }

function bearer(actor: Actor): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify({ ...actor, email: `${actor.id}@enquiry-bookings.invalid` })}` };
}

const BookingListSchema = z.array(BookingSchema);

describe.skipIf(target === undefined)("GET /bookings?enquiryId= through the real route and PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `enquiry_bookings_${randomUUID()}` });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(bookingRoutes, { db, prefix: "/bookings" });
    await server.ready();
  });
  afterAll(async () => { await server?.close(); await pool?.end(); });

  async function venue(label: string) {
    const venueId = randomUUID();
    await db.insert(schema.venues).values({
      id: venueId, name: `TEST ONLY ${label}`, slug: `enquiry-bookings-${venueId}`, address: "Disposable fixture",
    });
    const rooms = [randomUUID(), randomUUID()] as const;
    await db.insert(schema.spaces).values(rooms.map((id, index) => ({
      id, venueId, name: `Room ${String(index)}`, slug: `room-${id}`, widthM: "20", lengthM: "10", heightM: "6",
      floorPlanOutline: OUTLINE, sortOrder: index,
    })));
    const actor = async (role: string, platformRole: PlatformRole = "none", venueScope: string | null = venueId): Promise<Actor> => {
      const id = randomUUID();
      await db.insert(schema.users).values({
        id, email: `${id}@enquiry-bookings.invalid`, name: "Fixture", role, platformRole, venueId: venueScope,
      });
      return { id, role, venueId: venueScope, platformRole };
    };
    const enquiry = async (userId: string | null = null): Promise<string> => {
      const [row] = await db.insert(schema.enquiries).values({
        venueId, spaceId: rooms[0], userId, state: "under_review", name: `Enquiry ${label}`,
        email: `${randomUUID()}@enquiry-bookings.invalid`, preferredDate: "2027-05-14",
      }).returning({ id: schema.enquiries.id });
      if (row === undefined) throw new Error("Enquiry fixture missing");
      return row.id;
    };
    return { venueId, rooms, actor, enquiry };
  }

  /** A provisional hold on the asked-for day unless told otherwise. */
  function booking(venueId: string, spaceId: string, title: string,
    extra: Partial<typeof schema.bookings.$inferInsert> = {}): typeof schema.bookings.$inferInsert {
    return {
      venueId, spaceId, kind: "hold", title, rank: 1, startsAt: new Date(DAY_ONE), endsAt: new Date(DAY_ONE + 12 * HOUR),
      decisionAt: new Date(DAY_ONE - 60 * DAY), nextAction: "Call the client.", nextActionDueAt: new Date(DAY_ONE - 70 * DAY),
      ...extra,
    };
  }

  function read(url: string, actor?: Actor): Promise<LightMyRequestResponse> {
    return server.inject({ method: "GET", url, ...(actor === undefined ? {} : { headers: bearer(actor) }) });
  }

  function listOf(response: LightMyRequestResponse): Booking[] {
    return BookingListSchema.parse(response.json<{ data: unknown }>().data);
  }

  it("asks for a session before it reads anything", async () => {
    const enquiryId = randomUUID();
    for (const [url, headers] of [
      [`/bookings?enquiryId=${enquiryId}`, {}],
      ["/bookings", {}],
      ["/bookings?enquiryId=not-a-uuid", {}],
      [`/bookings?enquiryId=${enquiryId}`, { authorization: "Basic not-a-session" }],
    ] as const) {
      const response = await server.inject({ method: "GET", url, headers });
      expect(response.statusCode, url).toBe(401);
      expect(response.json()).toEqual({ error: "Authentication required", code: "UNAUTHORIZED" });
    }
  });

  it("reads exactly one enquiry: a missing, malformed, repeated or unknown parameter is a 400", async () => {
    const v = await venue("validation");
    const staff = await v.actor("staff");
    const enquiryId = await v.enquiry();
    const neighbour = await v.enquiry();
    await insertBoundBookings(db, [booking(v.venueId, v.rooms[0], "Held", { enquiryId })]);
    for (const query of [
      "",
      "?enquiryId=",
      "?enquiryId=not-a-uuid",
      `?enquiryId=${enquiryId.toUpperCase().replaceAll("-", "")}`,
      `?enquiryId=${enquiryId}&enquiryId=${enquiryId}`,
      `?enquiryId=${enquiryId}&enquiryId=${neighbour}`,
      `?enquiryId=${enquiryId}&venueId=${v.venueId}`,
      `?enquiryid=${enquiryId}`,
    ]) {
      const response = await read(`/bookings${query}`, staff);
      expect(response.statusCode, query).toBe(400);
      expect(response.json<{ error: string; code: string; details: unknown[] }>()).toMatchObject({
        error: "Validation failed", code: "VALIDATION_ERROR", details: expect.any(Array),
      });
    }
    // The same caller, asking properly, is answered.
    const answered = await read(`/bookings?enquiryId=${enquiryId}`, staff);
    expect(answered.statusCode, answered.body).toBe(200);
    expect(listOf(answered).map((row) => row.title)).toEqual(["Held"]);
  });

  it("does not know an enquiry that does not exist", async () => {
    const v = await venue("unknown");
    for (const actor of [await v.actor("staff"), await v.actor("admin", "admin", null)]) {
      const response = await read(`/bookings?enquiryId=${randomUUID()}`, actor);
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json()).toEqual({ error: "Enquiry not found", code: "ENQUIRY_NOT_FOUND" });
    }
  });

  it("refuses whoever does not read the enquiry's Diary, the enquiry's own client included", async () => {
    const v = await venue("refusals");
    const elsewhere = await venue("refusals elsewhere");
    const client = await v.actor("client");
    const enquiryId = await v.enquiry(client.id);
    await insertBoundBookings(db, [booking(v.venueId, v.rooms[0], "Held for the client", { enquiryId })]);
    const refused = [
      await elsewhere.actor("staff"),
      await elsewhere.actor("admin"),
      await elsewhere.actor("hallkeeper"),
      await elsewhere.actor("sales"),
      await elsewhere.actor("staff", "operator"),
      await v.actor("staff", "none", null),
      client,
      await v.actor("planner"),
      await v.actor("caterer"),
    ];
    for (const actor of refused) {
      const response = await read(`/bookings?enquiryId=${enquiryId}`, actor);
      const who = `${actor.role} (${actor.platformRole}) at ${actor.venueId === v.venueId ? "the venue" : "another venue or none"}`;
      expect(response.statusCode, who).toBe(403);
      expect(response.json(), who).toEqual({ error: "Forbidden", code: "FORBIDDEN" });
    }
  });

  it("answers every Diary reader at the venue, and a platform admin from anywhere", async () => {
    const v = await venue("readers");
    const elsewhere = await venue("readers elsewhere");
    const enquiryId = await v.enquiry();
    const [held] = await insertBoundBookings(db, [booking(v.venueId, v.rooms[1], "Held", { enquiryId })]);
    const readers = [
      ...await Promise.all((["admin", "manager", "staff", "hallkeeper", "sales"] as const).map((role) => v.actor(role))),
      await elsewhere.actor("staff", "admin"),
      await elsewhere.actor("admin", "admin", null),
    ];
    for (const reader of readers) {
      const response = await read(`/bookings?enquiryId=${enquiryId}`, reader);
      expect(response.statusCode, `${reader.role} (${reader.platformRole}): ${response.body}`).toBe(200);
      expect(listOf(response).map((row) => row.id)).toEqual([held?.id]);
    }
  });

  it("lists only the enquiry's own live bookings in rooms the Diary shows, by start and then id", async () => {
    const v = await venue("own bookings");
    const other = await venue("own bookings elsewhere");
    const staff = await v.actor("staff");
    const enquiryId = await v.enquiry();
    const neighbour = await v.enquiry();
    const [room0, room1] = v.rooms;
    const goneRoom = randomUUID();
    await db.insert(schema.spaces).values({
      id: goneRoom, venueId: v.venueId, name: "Room gone", slug: `room-${goneRoom}`, widthM: "20", lengthM: "10", heightM: "6",
      floorPlanOutline: OUTLINE, sortOrder: 2,
    });
    // Two bookings start together; the one with the lower id comes first,
    // whichever was written first.
    const [lowId, highId] = [randomUUID(), randomUUID()].sort();
    // A cross-venue link no writer makes any more: its event is the other
    // venue's, named outright, because an enquiry joins only its own venue.
    const [elsewhereEvent] = await db.insert(schema.events).values({ venueId: other.venueId, name: "Another venue's event" })
      .returning({ id: schema.events.id });
    const rows = await insertBoundBookings(db, [
      booking(v.venueId, room1, "Confirmed, the day after", {
        enquiryId, kind: "ink", rank: null, startsAt: new Date(DAY_ONE + DAY), endsAt: new Date(DAY_ONE + DAY + 6 * HOUR),
      }),
      booking(v.venueId, room1, "2nd option, high id", { id: highId, enquiryId, rank: 2 }),
      booking(v.venueId, room0, "1st option, low id", { id: lowId, enquiryId }),
      // None of these is this enquiry's live booking in a room the Diary shows.
      booking(v.venueId, room0, "Another enquiry's hold", { enquiryId: neighbour }),
      booking(v.venueId, room0, "Held for no enquiry", { enquiryId: null }),
      ...BOOKING_EXIT_STATES.map((status) => booking(v.venueId, room0, `Exited: ${status}`, { enquiryId, status })),
      booking(v.venueId, room0, "Deleted", { enquiryId, deletedAt: new Date() }),
      booking(v.venueId, goneRoom, "In a room since deleted", { enquiryId }),
      booking(other.venueId, other.rooms[0], "Another venue's, linked to this enquiry", { enquiryId, eventId: elsewhereEvent?.id }),
    ]);
    await db.update(schema.spaces).set({ deletedAt: new Date() }).where(eq(schema.spaces.id, goneRoom));
    const idOf = (title: string): string | undefined => rows.find((row) => row.title === title)?.id;

    const response = await read(`/bookings?enquiryId=${enquiryId}`, staff);
    expect(response.statusCode, response.body).toBe(200);
    expect(Object.keys(response.json<Record<string, unknown>>())).toEqual(["data"]);
    const list = listOf(response);
    expect(list.map((row) => row.id)).toEqual([lowId, highId, idOf("Confirmed, the day after")]);
    expect(list.map((row) => row.title)).toEqual(["1st option, low id", "2nd option, high id", "Confirmed, the day after"]);
    // Each is a whole Booking: the Diary's state, its room and its enquiry.
    expect(list.map((row) => [row.state, row.rank, row.spaceId])).toEqual([["hold", 1, room0], ["hold", 2, room1], ["ink", null, room1]]);
    for (const row of list) {
      expect(row).toMatchObject({ enquiryId, venueId: v.venueId, status: "active" });
    }
    expect(list[0]).toMatchObject({
      startsAt: new Date(DAY_ONE).toISOString(), endsAt: new Date(DAY_ONE + 12 * HOUR).toISOString(),
      decisionAt: new Date(DAY_ONE - 60 * DAY).toISOString(), nextAction: "Call the client.",
    });

    // The neighbour sees only its own.
    const theirs = await read(`/bookings?enquiryId=${neighbour}`, staff);
    expect(listOf(theirs).map((row) => row.title)).toEqual(["Another enquiry's hold"]);
  });

  it("answers an empty list for an enquiry that holds nothing live", async () => {
    const v = await venue("nothing held");
    const staff = await v.actor("staff");
    const never = await v.enquiry();
    const lapsed = await v.enquiry();
    await insertBoundBookings(db, [
      booking(v.venueId, v.rooms[0], "Released", { enquiryId: lapsed, status: "released" }),
      booking(v.venueId, v.rooms[0], "Deleted", { enquiryId: lapsed, deletedAt: new Date() }),
    ]);
    for (const enquiryId of [never, lapsed]) {
      const response = await read(`/bookings?enquiryId=${enquiryId}`, staff);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({ data: [] });
    }
  });
});
