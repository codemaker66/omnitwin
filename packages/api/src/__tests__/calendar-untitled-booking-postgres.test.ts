import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CalendarResponseSchema, type CalendarResponse } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { bookingRoutes } from "../routes/bookings.js";
import { calendarRoutes } from "../routes/calendar.js";

// ---------------------------------------------------------------------------
// API-9: a booking stored with an empty title (written before #350, from a
// public enquiry's blank name) failed GET /calendar for its venue's whole
// range, because the route validates its response against the shared schema
// and the read model refused "". The Diary then said the range could not be
// read. One such row must leave the rest of the range on screen, stay on it
// itself, and be put right by giving it a title.
//
// Runs on the disposable platform database only; the platform database is
// shared and never truncated, so the test makes its own venue.
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("The untitled booking tests require the explicit disposable platform database");
  }
}

const OUTLINE = [{ x: -10, y: -5 }, { x: 10, y: -5 }, { x: 10, y: 5 }, { x: -10, y: 5 }];
/** Wednesday 17 September 2031: far from any other fixture's dates. */
const FROM = "2031-09-15T00:00:00.000Z";
const TO = "2031-09-22T00:00:00.000Z";

describe.skipIf(target === undefined)("a booking stored with an empty title on the Diary", () => {
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `calendar_untitled_${randomUUID()}`, max: 4,
      options: "-c statement_timeout=30000 -c lock_timeout=20000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name)
      .toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(bookingRoutes, { db, prefix: "/bookings" });
    await server.register(calendarRoutes, { db, prefix: "/calendar" });
    await server.ready();
  });
  afterAll(async () => { await server?.close(); await pool?.end(); });

  async function venueWithRows(): Promise<{ venueId: string; headers: { authorization: string }; untitledId: string; titledId: string }> {
    const venueId = randomUUID();
    await db.insert(schema.venues).values({
      id: venueId, name: "TEST ONLY untitled booking", slug: `calendar-untitled-${venueId}`, address: "Disposable fixture",
    });
    const hall = randomUUID();
    const saloon = randomUUID();
    await db.insert(schema.spaces).values([
      { id: hall, name: "Grand Hall" },
      { id: saloon, name: "Saloon" },
    ].map((room, index) => ({
      id: room.id, venueId, name: room.name, slug: `room-${room.id}`, widthM: "20", lengthM: "10", heightM: "6",
      floorPlanOutline: OUTLINE, sortOrder: index,
    })));
    const userId = randomUUID();
    await db.insert(schema.users).values({
      id: userId, email: `${userId}@calendar-untitled.invalid`, name: "TEST ONLY coordinator", role: "admin", venueId,
    });
    // As a row from before #350 stands: written straight to the table, since
    // every writer now refuses an empty title.
    const untitled = await pool.query<{ id: string }>(
      "INSERT INTO bookings (venue_id, space_id, kind, title, starts_at, ends_at) VALUES ($1, $2, 'prospect', '', $3, $4) RETURNING id",
      [venueId, hall, "2031-09-17T17:00:00.000Z", "2031-09-17T22:00:00.000Z"],
    );
    const titled = await pool.query<{ id: string }>(
      "INSERT INTO bookings (venue_id, space_id, kind, title, starts_at, ends_at) VALUES ($1, $2, 'prospect', 'TEST ONLY Hartley wedding', $3, $4) RETURNING id",
      [venueId, saloon, "2031-09-18T17:00:00.000Z", "2031-09-18T22:00:00.000Z"],
    );
    const untitledId = untitled.rows[0]?.id;
    const titledId = titled.rows[0]?.id;
    if (untitledId === undefined || titledId === undefined) throw new Error("Booking fixtures missing");
    const headers = { authorization: `Bearer ${JSON.stringify({ id: userId, email: `${userId}@calendar-untitled.invalid`, role: "admin", venueId })}` };
    return { venueId, headers, untitledId, titledId };
  }

  async function readRange(venueId: string, headers: { authorization: string }): Promise<CalendarResponse> {
    const res = await server.inject({
      method: "GET",
      url: `/calendar?venueId=${venueId}&from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`,
      headers,
    });
    expect(res.statusCode, res.body).toBe(200);
    return CalendarResponseSchema.parse(res.json<{ data: unknown }>().data);
  }

  it("reads the whole range with the untitled booking on it, and a title given in the Diary puts it right", async () => {
    const v = await venueWithRows();
    const range = await readRange(v.venueId, v.headers);
    const titles = new Map(range.entries.map((entry) => [entry.id, entry.entryType === "booking" ? entry.title : null]));
    expect(titles.get(v.titledId)).toBe("TEST ONLY Hartley wedding");
    expect(titles.get(v.untitledId)).toBe("");

    // Until it has a title it can still be moved, and the move answers with
    // the booking as stored rather than failing after it was written.
    const moved = await server.inject({
      method: "PATCH", url: `/bookings/${v.untitledId}`, headers: v.headers,
      payload: { startsAt: "2031-09-17T18:00:00.000Z", endsAt: "2031-09-17T23:00:00.000Z" },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json<{ data: { title: string; startsAt: string } }>().data).toMatchObject({ title: "", startsAt: "2031-09-17T18:00:00.000Z" });
    // So does a read of the booking itself.
    const opened = await server.inject({ method: "GET", url: `/bookings/${v.untitledId}`, headers: v.headers });
    expect(opened.statusCode, opened.body).toBe(200);

    // The drawer's edit: the title is the repair, and the writer still
    // refuses another empty one.
    const blank = await server.inject({ method: "PATCH", url: `/bookings/${v.untitledId}`, headers: v.headers, payload: { title: "   " } });
    expect(blank.statusCode).toBe(400);
    const named = await server.inject({ method: "PATCH", url: `/bookings/${v.untitledId}`, headers: v.headers, payload: { title: "TEST ONLY Fraser enquiry" } });
    expect(named.statusCode, named.body).toBe(200);
    const after = await readRange(v.venueId, v.headers);
    expect(after.entries.find((entry) => entry.id === v.untitledId)).toMatchObject({ title: "TEST ONLY Fraser enquiry" });
  });
});
