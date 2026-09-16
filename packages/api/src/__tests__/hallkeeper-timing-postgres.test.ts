import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool as PgPool } from "pg";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { drizzle as nodeDrizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as schema from "../db/schema.js";
import { resolveTiming } from "../services/hallkeeper-sheet-v2-data.js";

// ---------------------------------------------------------------------------
// resolveTiming against real PostgreSQL.
//
// The arithmetic has unit tests; the SQL predicate that decides WHICH booking
// the sheet reads had none at any level, and it is the part that can put the
// wrong evening on a hallkeeper's sheet. Mocks cannot prove a WHERE clause:
// the event scoping, the prospect exclusion and the room/venue scoping are
// all predicates, so they are exercised here against a disposable database.
//
// Never reads DATABASE_URL/.env. Opt in with a separately provisioned,
// disposable local database and the normal local Neon WebSocket bridge
// (port 54331):
//   VENVIEWER_TIMING_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1/venviewer_timing_test
// ---------------------------------------------------------------------------

const explicitUrl = process.env["VENVIEWER_TIMING_TEST_DATABASE_URL"];

function assertTestTarget(raw: string): void {
  const url = new URL(raw);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1"
    || url.pathname !== "/venviewer_timing_test" || url.search !== "" || url.hash !== "") {
    throw new Error("Timing regressions require the explicit loopback venviewer_timing_test database");
  }
}

describe("Timing PostgreSQL target guard", () => {
  it.each([
    "postgresql://user@production.example/venviewer_timing_test",
    "postgresql://postgres@127.0.0.1/production",
    "postgresql://postgres@127.0.0.1/venviewer_timing_test?host=production.example",
  ])("rejects an unsafe target: %s", (url) => {
    expect(() => { assertTestTarget(url); }).toThrow();
  });
});

describe.skipIf(explicitUrl === undefined)("resolveTiming reads the right booking", () => {
  let pool: Pool;
  let migrationPool: PgPool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    if (explicitUrl === undefined) throw new Error("Explicit test URL required");
    assertTestTarget(explicitUrl);
    migrationPool = new PgPool({ connectionString: explicitUrl });
    const target = await migrationPool.query<{ database: string; host: string }>(
      "SELECT current_database() AS database, host(inet_server_addr()) AS host",
    );
    expect(target.rows).toEqual([{ database: "venviewer_timing_test", host: "127.0.0.1" }]);
    await migrate(nodeDrizzle(migrationPool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    neonConfig.wsProxy = (host) => `${host}:54331/v1`;
    neonConfig.useSecureWebSocket = false;
    neonConfig.pipelineTLS = false;
    neonConfig.pipelineConnect = false;
    pool = new Pool({ connectionString: explicitUrl });
    db = drizzle(pool, { schema });
  }, 120000);

  afterAll(async () => { await pool?.end(); await migrationPool?.end(); });

  /** One venue, one room, one configuration, linked to `eventCount` events. */
  async function seed(eventCount = 1): Promise<{
    venueId: string; roomId: string; configId: string; eventIds: string[];
  }> {
    const venueId = randomUUID(); const roomId = randomUUID();
    const userId = randomUUID(); const configId = randomUUID();
    await db.insert(schema.venues).values({ id: venueId, name: "DEMO ONLY venue", slug: venueId, address: "Local test" });
    await db.insert(schema.spaces).values({
      id: roomId, venueId, name: "Test room", slug: `room-${roomId}`,
      widthM: "10", lengthM: "10", heightM: "3",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
    });
    await db.insert(schema.users).values({ id: userId, venueId, email: `${userId}@demo.invalid`, name: "Test keeper", role: "admin" });
    await db.insert(schema.configurations).values({
      id: configId, venueId, spaceId: roomId, userId,
      name: "DEMO ONLY plan", layoutStyle: "custom", slug: `plan-${configId}`,
    });
    const eventIds: string[] = [];
    for (let index = 0; index < eventCount; index += 1) {
      const eventId = randomUUID();
      const variantId = randomUUID();
      await db.insert(schema.events).values({
        id: eventId, venueId, createdBy: userId, name: `DEMO ONLY event ${String(index)}`,
        startsAt: new Date("2026-09-19T12:00:00.000Z"),
      });
      await db.insert(schema.layoutVariants).values({ id: variantId, eventId, configurationId: configId, name: "Local binding" });
      await db.insert(schema.eventConfigurationLinks).values({ eventId, configurationId: configId, layoutVariantId: variantId, linkType: "variant_configuration" });
      eventIds.push(eventId);
    }
    return { venueId, roomId, configId, eventIds };
  }

  /** Four hours, so two live bookings in one room do not overlap and trip
   *  `bookings_ink_no_overlap` — the half-open exclusion constraint on active
   *  ink, which a fixed end time quietly violated. Caught by running this file
   *  against a real cluster; no mock carries that constraint. */
  const BOOKING_HOURS = 4;

  async function addBooking(input: {
    venueId: string; roomId: string; eventId: string; startsAt: string;
    kind?: "ink" | "hold" | "prospect" | "internal_block";
    status?: "active" | "released"; eventType?: string | null;
  }): Promise<void> {
    const startsAt = new Date(input.startsAt);
    await db.insert(schema.bookings).values({
      id: randomUUID(), venueId: input.venueId, spaceId: input.roomId, eventId: input.eventId,
      kind: input.kind ?? "ink", status: input.status ?? "active",
      title: "DEMO ONLY booking", eventType: input.eventType ?? null,
      startsAt, endsAt: new Date(startsAt.getTime() + BOOKING_HOURS * 60 * 60_000),
    });
  }

  it("scopes to the event the corridor carried, not the earliest linked event", async () => {
    // The defect this pins: a layout reused across two events printed the
    // EARLIER event's hour whatever slot the hallkeeper tapped.
    const { venueId, roomId, configId, eventIds } = await seed(2);
    const [first, second] = eventIds;
    if (first === undefined || second === undefined) throw new Error("fixture");
    await addBooking({ venueId, roomId, eventId: first, startsAt: "2026-09-19T08:00:00.000Z" });
    await addBooking({ venueId, roomId, eventId: second, startsAt: "2026-09-19T16:00:00.000Z" });

    const scoped = await resolveTiming(db, { id: configId, spaceId: roomId, venueId }, second);
    expect(scoped?.eventStart).toBe("2026-09-19T16:00:00.000Z");

    // Without an event the union still applies — and takes the earliest.
    const unscoped = await resolveTiming(db, { id: configId, spaceId: roomId, venueId }, null);
    expect(unscoped?.eventStart).toBe("2026-09-19T08:00:00.000Z");
  });

  it("ignores a prospect booking even when it is earlier", async () => {
    const { venueId, roomId, configId, eventIds } = await seed();
    const [eventId] = eventIds;
    if (eventId === undefined) throw new Error("fixture");
    await addBooking({ venueId, roomId, eventId, startsAt: "2026-09-19T06:00:00.000Z", kind: "prospect" });
    await addBooking({ venueId, roomId, eventId, startsAt: "2026-09-19T09:00:00.000Z" });

    const timing = await resolveTiming(db, { id: configId, spaceId: roomId, venueId }, eventId);
    expect(timing?.eventStart).toBe("2026-09-19T09:00:00.000Z");
  });

  it("ignores a released booking", async () => {
    const { venueId, roomId, configId, eventIds } = await seed();
    const [eventId] = eventIds;
    if (eventId === undefined) throw new Error("fixture");
    await addBooking({ venueId, roomId, eventId, startsAt: "2026-09-19T06:00:00.000Z", status: "released" });
    await addBooking({ venueId, roomId, eventId, startsAt: "2026-09-19T09:00:00.000Z" });

    const timing = await resolveTiming(db, { id: configId, spaceId: roomId, venueId }, eventId);
    expect(timing?.eventStart).toBe("2026-09-19T09:00:00.000Z");
  });

  it("ignores a booking of the same event in a different room", async () => {
    const { venueId, roomId, configId, eventIds } = await seed();
    const [eventId] = eventIds;
    if (eventId === undefined) throw new Error("fixture");
    const otherRoomId = randomUUID();
    await db.insert(schema.spaces).values({
      id: otherRoomId, venueId, name: "Other room", slug: `room-${otherRoomId}`,
      widthM: "8", lengthM: "8", heightM: "3",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 }],
    });
    await addBooking({ venueId, roomId: otherRoomId, eventId, startsAt: "2026-09-19T06:00:00.000Z" });
    await addBooking({ venueId, roomId, eventId, startsAt: "2026-09-19T09:00:00.000Z" });

    const timing = await resolveTiming(db, { id: configId, spaceId: roomId, venueId }, eventId);
    expect(timing?.eventStart).toBe("2026-09-19T09:00:00.000Z");
  });

  it("returns null when no live booking holds the room", async () => {
    const { venueId, roomId, configId, eventIds } = await seed();
    const [eventId] = eventIds;
    if (eventId === undefined) throw new Error("fixture");
    await addBooking({ venueId, roomId, eventId, startsAt: "2026-09-19T09:00:00.000Z", kind: "prospect" });

    expect(await resolveTiming(db, { id: configId, spaceId: roomId, venueId }, eventId)).toBeNull();
  });

  it("derives setupBy from the venue's turnaround rule, and says so honestly when there is none", async () => {
    const { venueId, roomId, configId, eventIds } = await seed();
    const [eventId] = eventIds;
    if (eventId === undefined) throw new Error("fixture");
    await addBooking({ venueId, roomId, eventId, startsAt: "2026-09-19T09:00:00.000Z", eventType: "wedding" });

    // No rule recorded: the honest absence, never a constant.
    const without = await resolveTiming(db, { id: configId, spaceId: roomId, venueId }, eventId);
    expect(without?.eventStart).toBe("2026-09-19T09:00:00.000Z");
    expect(without?.setupBy).toBeNull();
    expect(without?.bufferMinutes).toBeNull();

    // A room-and-type rule is more specific than a house rule, and wins.
    await db.insert(schema.turnaroundRules).values([
      { venueId, spaceId: null, eventType: null, name: "House default", minutes: 60 },
      { venueId, spaceId: roomId, eventType: "wedding", name: "Grand Hall wedding", minutes: 150 },
    ]);
    const derived = await resolveTiming(db, { id: configId, spaceId: roomId, venueId }, eventId);
    expect(derived?.setupBy).toBe("2026-09-19T06:30:00.000Z");
    expect(derived?.bufferMinutes).toBe(150);
  });

  it("does not let another day's phase become this sheet's set-up deadline", async () => {
    const { venueId, roomId, configId, eventIds } = await seed();
    const [eventId] = eventIds;
    if (eventId === undefined) throw new Error("fixture");
    await addBooking({ venueId, roomId, eventId, startsAt: "2026-09-19T09:00:00.000Z" });
    await db.insert(schema.turnaroundRules).values({ venueId, spaceId: null, eventType: null, name: "House default", minutes: 90 });
    // A phase four days earlier — a multi-day event's first day. Unbounded,
    // this became "set up by" and reported thousands of minutes of buffer.
    await db.insert(schema.eventPhases).values({
      id: randomUUID(), eventId, spaceId: roomId, name: "Load in", templateKey: null,
      sortOrder: 0, startsAt: new Date("2026-09-15T08:00:00.000Z"), durationMinutes: 60,
    });

    const timing = await resolveTiming(db, { id: configId, spaceId: roomId, venueId }, eventId);
    expect(timing?.setupBy).toBe("2026-09-19T07:30:00.000Z");
    expect(timing?.bufferMinutes).toBe(90);
  });
});
