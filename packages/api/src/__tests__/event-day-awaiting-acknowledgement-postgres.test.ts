import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { eventDayEventRoutes } from "../routes/event-day-ops.js";

// ---------------------------------------------------------------------------
// The event-day board's "changes awaiting acknowledgement" (release audit,
// contract-n-1).
//
// A change to an event that the floor must know about (a new guest count, a
// moved time) is recorded as needing a hallkeeper's acknowledgement. The board
// used to find those by reading the newest 25 changes of every kind and
// filtering in the browser. Every task move and every issue is a change too,
// so on a busy set-up the one that mattered fell off that page and the board
// said nothing was waiting.
//
// The board now asks the question it means: which changes to this event ask
// for acknowledgement and have none. Only real rows can show that an old
// change survives any number of newer ones, that one acknowledgement by
// anybody on the floor settles it, and that another venue is refused.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Event-day acknowledgement tests require the explicit disposable platform database");
  }
}

interface Person { readonly id: string; readonly role: "hallkeeper" | "manager"; readonly venueId: string | null }

describe.skipIf(target === undefined)("changes awaiting acknowledgement on the migrated disposable database", () => {
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;
  const venueId = randomUUID();
  const otherVenueId = randomUUID();
  const eventId = randomUUID();
  const siblingEventId = randomUUID();
  const hallkeeper: Person = { id: randomUUID(), role: "hallkeeper", venueId };
  const manager: Person = { id: randomUUID(), role: "manager", venueId };
  const outsider: Person = { id: randomUUID(), role: "hallkeeper", venueId: otherVenueId };
  const SET_UP = Date.UTC(2026, 10, 14, 17, 0, 0);

  function as(person: Person): { authorization: string } {
    return { authorization: `Bearer ${JSON.stringify({ id: person.id, email: `${person.id}@ack.invalid`, role: person.role, platformRole: "none", venueId: person.venueId })}` };
  }

  /** One recorded change to an event, `minutes` after set-up began. */
  async function change(forEvent: string, minutes: number, title: string, needsAcknowledgement: boolean): Promise<string> {
    const [row] = await db.insert(schema.eventPlanChanges).values({
      eventId: forEvent, venueId, actorUserId: manager.id, actorRole: "manager", actorLabel: "TEST ONLY manager",
      sourceKind: needsAcknowledgement ? "event" : "ops_task", sourceId: randomUUID(),
      title, summary: `TEST ONLY ${title}`,
      affectedSurfaces: [needsAcknowledgement ? "guest_count" : "ops_tasks"], audienceRoles: ["hallkeeper"],
      riskLevel: needsAcknowledgement ? "attention" : "info",
      requiresHallkeeperAcknowledgement: needsAcknowledgement,
      createdAt: new Date(SET_UP + minutes * 60_000),
    }).returning({ id: schema.eventPlanChanges.id });
    if (row === undefined) throw new Error("Change fixture not written");
    return row.id;
  }

  async function acknowledge(changeId: string, person: Person): Promise<void> {
    await db.insert(schema.eventPlanChangeAcknowledgements).values({ changeId, eventId, acknowledgedBy: person.id, acknowledgedByRole: person.role });
  }

  async function awaiting(forEvent: string, person: Person): Promise<{ statusCode: number; ids: readonly string[]; cache: unknown }> {
    const response = await server.inject({ method: "GET", url: `/events/${forEvent}/changes-awaiting-acknowledgement`, headers: as(person) });
    const body = response.json<{ data?: readonly { id: string }[] }>();
    return { statusCode: response.statusCode, ids: (body.data ?? []).map((item) => item.id), cache: response.headers["cache-control"] };
  }

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `event_day_awaiting_${randomUUID()}`, max: 4 });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    await db.insert(schema.venues).values([
      { id: venueId, name: "TEST ONLY acknowledgement venue", slug: venueId, address: "Disposable fixture" },
      { id: otherVenueId, name: "TEST ONLY other venue", slug: otherVenueId, address: "Disposable fixture" },
    ]);
    await db.insert(schema.users).values([
      { id: hallkeeper.id, name: "Ack hallkeeper", email: `${hallkeeper.id}@ack.invalid`, role: "hallkeeper", venueId },
      { id: manager.id, name: "Ack manager", email: `${manager.id}@ack.invalid`, role: "manager", venueId },
      { id: outsider.id, name: "Ack outsider", email: `${outsider.id}@ack.invalid`, role: "hallkeeper", venueId: otherVenueId },
    ]);
    await db.insert(schema.events).values([
      { id: eventId, venueId, createdBy: manager.id, name: "TEST ONLY dinner", guestCount: 120,
        startsAt: new Date("2026-11-14T18:00:00Z"), endsAt: new Date("2026-11-14T23:00:00Z") },
      { id: siblingEventId, venueId, createdBy: manager.id, name: "TEST ONLY lunch", guestCount: 40,
        startsAt: new Date("2026-11-15T12:00:00Z"), endsAt: new Date("2026-11-15T15:00:00Z") },
    ]);
    server = Fastify();
    await server.register(eventDayEventRoutes, { db, prefix: "/events" });
    await server.ready();
  }, 60000);

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  it("keeps a change that needs acknowledgement in front of the floor however many changes follow it, until somebody acknowledges it", async () => {
    // 17:00, the guest count goes from 120 to 150.
    const guestCount = await change(eventId, 0, "Guest count changed", true);
    // Set-up: thirty task moves, none of which asks for anything.
    for (let minute = 1; minute <= 30; minute += 1) await change(eventId, minute, "Hallkeeper task updated", false);
    // 17:40, a timing change that the room has already acknowledged.
    const settled = await change(eventId, 40, "Doors moved to 18:30", true);
    await acknowledge(settled, manager);
    // 17:50, another that nobody has.
    const seating = await change(eventId, 50, "Accessible seating added", true);
    // Another event at the same venue has its own.
    const elsewhere = await change(siblingEventId, 10, "Guest count changed", true);

    // Both waiting changes, newest first, and nothing else: the old one is
    // thirty-two changes down and still here.
    const first = await awaiting(eventId, hallkeeper);
    expect(first.statusCode).toBe(200);
    expect(first.ids).toEqual([seating, guestCount]);
    expect(first.cache).toBe("private, no-store");
    expect((await awaiting(siblingEventId, hallkeeper)).ids).toEqual([elsewhere]);

    // One acknowledgement by anybody on the floor settles a change for the room.
    await acknowledge(guestCount, hallkeeper);
    expect((await awaiting(eventId, manager)).ids).toEqual([seating]);
    await acknowledge(seating, manager);
    // The same person acknowledging again changes nothing: one row each is enough.
    await acknowledge(seating, hallkeeper);
    expect((await awaiting(eventId, hallkeeper)).ids).toEqual([]);
  });

  it("answers only the venue's own floor", async () => {
    expect((await awaiting(eventId, outsider)).statusCode).toBe(403);
    expect((await awaiting(randomUUID(), hallkeeper)).statusCode).toBe(404);
    const anonymous = await server.inject({ method: "GET", url: `/events/${eventId}/changes-awaiting-acknowledgement` });
    expect(anonymous.statusCode).toBe(401);
    const malformed = await server.inject({ method: "GET", url: "/events/not-an-id/changes-awaiting-acknowledgement", headers: as(hallkeeper) });
    expect(malformed.statusCode).toBe(400);
  });
});
