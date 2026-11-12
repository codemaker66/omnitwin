import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClientEventScheduleSchema, LAYOUT_STYLES, RoomDaySchema } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { registerErrorNormalizer } from "../middleware/error-normalizer.js";
import { clientEventScheduleRoutes } from "../routes/client-event-schedule.js";
import { roomDayRoutes } from "../routes/room-day.js";

// ---------------------------------------------------------------------------
// The follow-up to API-9 (#382) outside the Diary: a booking stored with an
// empty title (written before #350, from a public enquiry's blank name) and
// bound to an event. Its client's schedule validates itself against the
// shared schema before answering, so one such slot turned the whole schedule
// into a 400 "Invalid request." for the client and for the venue's staff
// alike; the room's day answered, but the web's own parse of it refused the
// client's own span, so the When ribbon said the day could not be reached.
// Both reads must carry the title as stored, and leave the rest in place.
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
    throw new Error("The untitled schedule tests require the explicit disposable platform database");
  }
}

const OUTLINE = [{ x: -10, y: -5 }, { x: 10, y: -5 }, { x: 10, y: 5 }, { x: -10, y: 5 }];
/** Wednesday 15 October 2031, British Summer Time: far from any other fixture's dates. */
const DAY = "2031-10-15";

describe.skipIf(target === undefined)("a booking stored with an empty title on the client's schedule and the room's day", () => {
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `schedule_untitled_${randomUUID()}`, max: 4,
      options: "-c statement_timeout=30000 -c lock_timeout=20000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name)
      .toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    // As the app answers: a thrown ZodError becomes its 400 envelope.
    registerErrorNormalizer(server);
    await server.register(clientEventScheduleRoutes, { db, prefix: "/events" });
    await server.register(roomDayRoutes, { db, prefix: "/events" });
    await server.ready();
  });
  afterAll(async () => { await server?.close(); await pool?.end(); });

  interface Fixture {
    readonly eventId: string;
    readonly roomId: string;
    readonly untitledId: string;
    readonly titledId: string;
    readonly client: { authorization: string };
    readonly office: { authorization: string };
  }

  function bearer(id: string, role: string, venueId: string | null): { authorization: string } {
    return { authorization: `Bearer ${JSON.stringify({ id, email: `${id}@schedule-untitled.invalid`, name: `TEST ONLY ${role}`, role, venueId, platformRole: "none" })}` };
  }

  async function fixture(): Promise<Fixture> {
    const venueId = randomUUID();
    await db.insert(schema.venues).values({
      id: venueId, name: "TEST ONLY untitled schedule", slug: `schedule-untitled-${venueId}`, address: "Disposable fixture", timezone: "Europe/London",
    });
    const roomId = randomUUID();
    await db.insert(schema.spaces).values({
      id: roomId, venueId, name: "Grand Hall", slug: `room-${roomId}`, widthM: "20", lengthM: "10", heightM: "6", floorPlanOutline: OUTLINE,
    });
    const adminId = randomUUID();
    const clientId = randomUUID();
    await db.insert(schema.users).values([
      { id: adminId, email: `${adminId}@schedule-untitled.invalid`, name: "TEST ONLY admin", role: "admin", venueId },
      { id: clientId, email: `${clientId}@schedule-untitled.invalid`, name: "TEST ONLY client", role: "client", venueId: null },
    ]);
    const eventId = randomUUID();
    const otherEventId = randomUUID();
    await db.insert(schema.events).values([
      { id: eventId, venueId, name: "TEST ONLY Fraser dinner", createdBy: adminId, guestCount: 80 },
      { id: otherEventId, venueId, name: "TEST ONLY Private lunch", createdBy: adminId, guestCount: 40 },
    ]);
    const configurationId = randomUUID();
    await db.insert(schema.configurations).values({
      id: configurationId, venueId, spaceId: roomId, userId: clientId, name: "TEST ONLY client plan", layoutStyle: LAYOUT_STYLES[0],
    });
    await db.insert(schema.eventConfigurationLinks).values({ eventId, configurationId, linkType: "source_configuration" });
    // As a row from before #350 stands: written straight to the table, since
    // every writer now refuses an empty title.
    const insert = (event: string, title: string, startsAt: string, endsAt: string) => pool.query<{ id: string }>(
      "INSERT INTO bookings (venue_id, space_id, event_id, kind, title, starts_at, ends_at) VALUES ($1, $2, $3, 'ink', $4, $5, $6) RETURNING id",
      [venueId, roomId, event, title, startsAt, endsAt],
    );
    const untitled = await insert(eventId, "", `${DAY}T17:00:00.000Z`, `${DAY}T22:00:00.000Z`);
    const titled = await insert(eventId, "TEST ONLY Fraser dinner, second night", "2031-10-16T17:00:00.000Z", "2031-10-16T22:00:00.000Z");
    await insert(otherEventId, "TEST ONLY Private lunch", `${DAY}T09:00:00.000Z`, `${DAY}T13:00:00.000Z`);
    const untitledId = untitled.rows[0]?.id;
    const titledId = titled.rows[0]?.id;
    if (untitledId === undefined || titledId === undefined) throw new Error("Booking fixtures missing");
    return { eventId, roomId, untitledId, titledId, client: bearer(clientId, "client", null), office: bearer(adminId, "admin", venueId) };
  }

  it("reads the client's schedule with the untitled slot beside the rest, for the client and for the venue's office", async () => {
    const f = await fixture();
    for (const headers of [f.client, f.office]) {
      const res = await server.inject({ method: "GET", url: `/events/${f.eventId}/client-schedule`, headers });
      expect(res.statusCode, res.body).toBe(200);
      const schedule = ClientEventScheduleSchema.parse(res.json<{ data: unknown }>().data);
      expect(schedule.slots.map((slot) => [slot.bookingId, slot.title])).toEqual([
        [f.untitledId, ""],
        [f.titledId, "TEST ONLY Fraser dinner, second night"],
      ]);
    }
  });

  it("reads the room's day with the client's untitled booking as their own span, and everyone else's still anonymous", async () => {
    const f = await fixture();
    const res = await server.inject({
      method: "GET", url: `/events/${f.eventId}/room-day?spaceId=${f.roomId}&day=${DAY}`, headers: f.client,
    });
    expect(res.statusCode, res.body).toBe(200);
    // The web reads the day through this same schema (api/when-window.ts).
    const day = RoomDaySchema.parse(res.json<{ data: unknown }>().data);
    expect(day.spans).toEqual([
      { kind: "busy", startsAt: `${DAY}T09:00:00.000Z`, endsAt: `${DAY}T13:00:00.000Z` },
      { kind: "yours", bookingId: f.untitledId, title: "", startsAt: `${DAY}T17:00:00.000Z`, endsAt: `${DAY}T22:00:00.000Z` },
    ]);
    expect(res.body).not.toContain("Private lunch");
  });
});
