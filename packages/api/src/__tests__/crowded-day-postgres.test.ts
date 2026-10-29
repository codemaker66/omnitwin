import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CalendarResponseSchema,
  crowdedDayOpenRequests,
  type CalendarEntry,
  type CalendarResponse,
  type SlotObservation,
  type VenueRequest,
} from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { calendarRoutes } from "../routes/calendar.js";
import { venueObservationRoutes } from "../routes/observations.js";
import { venueRequestRoutes } from "../routes/requests.js";
import { seedCrowdedDay, type SeededCrowdedDay } from "../test-support/crowded-day-seed.js";

// L9 — the crowded Trades Hall day, written to migrated PostgreSQL and read
// back through the routes every screen uses. The fixture claims to be the
// calendar as GET /calendar answers it, the open requests as the slab lists
// them and the facts as the board reads them; this holds it to that, so tests
// and local demos built on it lean on what the server really says, the one
// tight changeover included.
//
// Never loads .env and never falls back to DATABASE_URL. The target must be an
// explicitly named disposable cluster on this machine.
process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_REQUESTS_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:"
    || parsed.hostname !== "127.0.0.1"
    || parsed.pathname !== "/venviewer_lane9_test"
    || parsed.search !== ""
    || parsed.hash !== "") {
    throw new Error("Crowded-day tests require the explicit disposable database venviewer_lane9_test on 127.0.0.1");
  }
}

describe.skipIf(target === undefined)("the crowded day on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;
  let seeded: SeededCrowdedDay;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({
      connectionString: target,
      application_name: `l9_crowded_day_${randomUUID()}`,
      max: 8,
      options: "-c statement_timeout=20000 -c lock_timeout=8000",
    });
    const name = (await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name;
    expect(name).toBe("venviewer_lane9_test");
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    db = drizzle(pool, { schema });
    seeded = await seedCrowdedDay(db);
    server = Fastify();
    await server.register(calendarRoutes, { db, prefix: "/calendar" });
    await server.register(venueRequestRoutes, { db, prefix: "/venues" });
    await server.register(venueObservationRoutes, { db, prefix: "/venues" });
    await server.ready();
  }, 300_000);

  afterAll(async () => {
    await server.close();
    await pool.end();
  });

  /** The bearer authenticate would resolve for a fixture person: their row as written. */
  async function as(name: string): Promise<{ authorization: string }> {
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, seeded.personId(name))).limit(1);
    if (row === undefined) throw new Error(`No written person ${name}`);
    return { authorization: `Bearer ${JSON.stringify({ id: row.id, email: row.email, name: row.name, role: row.role, venueId: row.venueId })}` };
  }

  /** A fixture id as written; the fixture's own when it was never remapped. */
  function written(fixtureId: string): string {
    return seeded.ids.get(fixtureId) ?? fixtureId;
  }

  /** The fixture's calendar, under the ids it was written with. */
  function expectedCalendar(): CalendarResponse {
    const calendar = seeded.day.calendar;
    const entries = calendar.entries.map((entry): CalendarEntry => entry.entryType === "booking"
      ? { ...entry, id: written(entry.id), spaceId: written(entry.spaceId), eventId: entry.eventId === null ? null : written(entry.eventId) }
      : { ...entry, id: written(entry.id), spaceId: written(entry.spaceId), eventId: written(entry.eventId) });
    return {
      ...calendar,
      venueId: seeded.venueId,
      rooms: calendar.rooms.map((room) => ({ ...room, id: written(room.id) })),
      entries,
      conflicts: {
        ...calendar.conflicts,
        conflicts: calendar.conflicts.conflicts.map((conflict) => {
          const pair: [string, string] = [written(conflict.entryIds[0]), written(conflict.entryIds[1])];
          return { ...conflict, id: `insufficient_turnaround:${pair[0]}:${pair[1]}`, spaceId: written(conflict.spaceId), entryIds: pair };
        }),
      },
      turnaroundRules: (calendar.turnaroundRules ?? []).map((rule) => ({
        ...rule, spaceId: rule.spaceId === null ? null : written(rule.spaceId),
      })),
    };
  }

  async function readCalendar(): Promise<CalendarResponse> {
    const { from, to } = seeded.day.calendar.range;
    const res = await server.inject({
      method: "GET",
      url: `/calendar?venueId=${seeded.venueId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      headers: await as("Elaine"),
    });
    expect(res.statusCode).toBe(200);
    return CalendarResponseSchema.parse(res.json<{ data: unknown }>().data);
  }

  it("reads back through GET /calendar as the fixture says: rooms, functions, setups, rules and the one tight changeover", async () => {
    const calendar = await readCalendar();
    const expected = expectedCalendar();
    expect(calendar.rooms).toEqual(expected.rooms);
    // The read model's own fields beside the fixture's: owner names and the
    // like are the server's to fill, so the fixture's fields are what is held.
    const byId = new Map(calendar.entries.map((entry) => [entry.id, entry]));
    expect(calendar.entries).toHaveLength(expected.entries.length);
    for (const entry of expected.entries) expect(byId.get(entry.id), entry.id).toMatchObject(entry);
    expect(calendar.conflicts).toEqual(expected.conflicts);
    expect(new Set(calendar.turnaroundRules?.map((rule) => JSON.stringify(rule))))
      .toEqual(new Set(expected.turnaroundRules?.map((rule) => JSON.stringify(rule))));
  });

  it("lists the day's sixteen open requests as the slab reads them, in their states, with their owners", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/venues/${seeded.venueId}/requests?status=open&limit=200`,
      headers: await as("Elaine"),
    });
    expect(res.statusCode).toBe(200);
    const listed = res.json<{ data: VenueRequest[] }>().data;
    const open = crowdedDayOpenRequests(seeded.day);
    expect(listed).toHaveLength(open.length);
    const byId = new Map(listed.map((request) => [request.id, request]));
    for (const request of open) {
      const row = byId.get(written(request.id));
      expect(row, request.detail ?? request.id).toMatchObject({
        bookingId: request.bookingId === null ? null : written(request.bookingId),
        roomName: request.roomName,
        kind: request.kind,
        quantity: request.quantity,
        urgency: request.urgency,
        state: request.state,
        ownerName: request.ownerName,
        handoverToName: request.handoverToName,
        requestedByName: request.requestedByName,
        createdAt: request.createdAt,
      });
    }
  });

  it("keeps each request's story at the day's own times, in order", async () => {
    const handedOver = seeded.day.requests.find((request) => request.state === "handed-over");
    if (handedOver === undefined) throw new Error("The day has a handover in flight");
    const steps = await db.select().from(schema.requestStatusHistory)
      .where(eq(schema.requestStatusHistory.requestId, written(handedOver.id)))
      .orderBy(schema.requestStatusHistory.at);
    expect(steps.map((step) => step.toState)).toEqual(["sent", "accepted", "handed-over"]);
    expect(steps.map((step) => step.at.toISOString())).toEqual([handedOver.createdAt, handedOver.acceptedAt, handedOver.handedOverAt]);
  });

  it("reads back the facts seen in the rooms through the board's own read", async () => {
    const { from, to } = seeded.day.calendar.range;
    const res = await server.inject({
      method: "GET",
      url: `/venues/${seeded.venueId}/observations?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      headers: await as("Graham"),
    });
    expect(res.statusCode).toBe(200);
    const facts = res.json<{ data: SlotObservation[] }>().data;
    expect(facts).toHaveLength(seeded.day.observations.length);
    const seen = new Set(facts.map((fact) => `${fact.bookingId}|${fact.kind}|${fact.observedAt}|${fact.actorName}`));
    for (const fact of seeded.day.observations) {
      expect(seen.has(`${written(fact.bookingId)}|${fact.kind}|${fact.observedAt}|${fact.actorName}`), fact.id).toBe(true);
    }
  });

  it("writes the day again beside the first without a collision, and keeps the two venues apart", async () => {
    const second = await seedCrowdedDay(db);
    expect(second.venueId).not.toBe(seeded.venueId);
    const firstRequests = await db.select({ id: schema.requests.id }).from(schema.requests).where(eq(schema.requests.venueId, seeded.venueId));
    const secondRequests = await db.select({ id: schema.requests.id }).from(schema.requests).where(eq(schema.requests.venueId, second.venueId));
    expect(firstRequests).toHaveLength(seeded.day.requests.length);
    expect(secondRequests).toHaveLength(second.day.requests.length);
    // Another venue's hallkeeper reads nothing of the first.
    const [stranger] = await db.select().from(schema.users).where(eq(schema.users.id, second.personId("Elaine"))).limit(1);
    if (stranger === undefined) throw new Error("The second day has its Elaine");
    const res = await server.inject({
      method: "GET",
      url: `/venues/${seeded.venueId}/requests?status=open`,
      headers: { authorization: `Bearer ${JSON.stringify({ id: stranger.id, email: stranger.email, name: stranger.name, role: stranger.role, venueId: stranger.venueId })}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
