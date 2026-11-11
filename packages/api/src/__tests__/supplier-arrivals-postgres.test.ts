import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupplierArrival } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { supplierArrivalRoutes } from "../routes/supplier-arrivals.js";
import { insertBoundBookings } from "../services/event-binding.js";

// ---------------------------------------------------------------------------
// Supplier arrivals (T-692) on the migrated disposable platform database:
//   - the office adds a supplier to one of its bookings; the floor reads the
//     day's arrivals and marks each one arrived and gone, first tap winning;
//   - the floor cannot plan them, a change from an old copy is refused, and
//     of two changes from one copy exactly one lands;
//   - another venue reads, changes and marks nothing, and its booking cannot
//     be named; an arrival far from its booking is refused.
// Never reads DATABASE_URL or an env file.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Supplier arrival tests require the explicit disposable platform database");
  }
}

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** 18:00 UTC on a day `days` from now. */
function evening(days: number): Date {
  const day = new Date(Date.now() + days * DAY);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 18, 0, 0));
}

describe.skipIf(target === undefined)("supplier arrivals, on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `supplier_arrivals_${randomUUID()}`, max: 6,
      options: "-c statement_timeout=10000 -c lock_timeout=8000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(supplierArrivalRoutes, { db, prefix: "/venues" });
    await server.ready();
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  async function fixture() {
    const venueId = randomUUID(), otherVenueId = randomUUID(), hallId = randomUUID(), otherHallId = randomUUID();
    const people = { admin: randomUUID(), hallkeeper: randomUUID(), porter: randomUUID(), other: randomUUID(), otherAdmin: randomUUID() };
    await db.insert(schema.venues).values([
      { id: venueId, name: "TEST ONLY arrivals", slug: venueId, address: "Disposable fixture", timezone: "Europe/London" },
      { id: otherVenueId, name: "TEST ONLY another venue", slug: otherVenueId, address: "Disposable fixture", timezone: "Europe/London" },
    ]);
    const outline = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
    await db.insert(schema.spaces).values([
      { id: hallId, venueId, name: "Grand Hall", slug: "grand-hall", widthM: "20", lengthM: "20", heightM: "6", floorPlanOutline: outline },
      { id: otherHallId, venueId: otherVenueId, name: "Their hall", slug: "their-hall", widthM: "20", lengthM: "20", heightM: "6", floorPlanOutline: outline },
    ]);
    await db.insert(schema.users).values([
      { id: people.admin, venueId, name: "Elaine", email: `${people.admin}@arrivals.invalid`, role: "admin" },
      { id: people.hallkeeper, venueId, name: "Jamie", email: `${people.hallkeeper}@arrivals.invalid`, role: "hallkeeper" },
      { id: people.porter, venueId, name: "Ngozi", email: `${people.porter}@arrivals.invalid`, role: "hallkeeper" },
      { id: people.other, venueId: otherVenueId, name: "Elsewhere", email: `${people.other}@arrivals.invalid`, role: "hallkeeper" },
      { id: people.otherAdmin, venueId: otherVenueId, name: "Their admin", email: `${people.otherAdmin}@arrivals.invalid`, role: "admin" },
    ]);
    const start = evening(4);
    const [dinner, theirs] = await insertBoundBookings(db, [
      { venueId, spaceId: hallId, kind: "ink", title: "TEST ONLY wedding dinner", eventType: "wedding", createdBy: people.admin,
        startsAt: start, endsAt: new Date(start.getTime() + 6 * HOUR) },
      { venueId: otherVenueId, spaceId: otherHallId, kind: "ink", title: "TEST ONLY their dinner", eventType: "dinner", createdBy: people.otherAdmin,
        startsAt: start, endsAt: new Date(start.getTime() + 6 * HOUR) },
    ]);
    if (dinner === undefined || theirs === undefined) throw new Error("bookings not made");
    return { venueId, otherVenueId, people, start, dinner, theirs };
  }

  type Fixture = Awaited<ReturnType<typeof fixture>>;
  type Who = keyof Fixture["people"];

  function as(f: Fixture, who: Who): { authorization: string } {
    const id = f.people[who];
    const role = who === "admin" || who === "otherAdmin" ? "admin" : "hallkeeper";
    const venueId = who === "other" || who === "otherAdmin" ? f.otherVenueId : f.venueId;
    const name = { admin: "Elaine", hallkeeper: "Jamie", porter: "Ngozi", other: "Elsewhere", otherAdmin: "Their admin" }[who];
    return { authorization: `Bearer ${JSON.stringify({ id, email: `${id}@arrivals.invalid`, name, role, platformRole: "none", venueId })}` };
  }

  async function call(f: Fixture, who: Who, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: Record<string, unknown>) {
    const response = await server.inject({ method, url, headers: as(f, who), ...(payload === undefined ? {} : { payload }) });
    const body = response.body === "" ? {} : response.json<{ data?: unknown; code?: string }>();
    return { status: response.statusCode, data: body.data, code: body.code };
  }

  function arrival(f: Fixture, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      bookingId: f.dinner.id, supplierName: "  Thistle & Fern Flowers ", category: "florist",
      arrivesAt: new Date(f.start.getTime() - 6 * HOUR).toISOString(), leavesBy: new Date(f.start.getTime() - 5 * HOUR).toISOString(),
      entrance: "the Saloon's side door", contact: "Morven", note: "", ...overrides,
    };
  }

  function window(f: Fixture, fromOffset = -DAY, toOffset = DAY): string {
    return `from=${encodeURIComponent(new Date(f.start.getTime() + fromOffset).toISOString())}&to=${encodeURIComponent(new Date(f.start.getTime() + toOffset).toISOString())}`;
  }

  it("lets the office add a supplier, and the floor read the day's arrivals and mark the door", async () => {
    const f = await fixture();
    const made = await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f));
    expect(made.status).toBe(201);
    const saved = made.data as SupplierArrival;
    expect(saved).toMatchObject({ supplierName: "Thistle & Fern Flowers", category: "florist", note: null, revision: 1, arrivedAt: null });

    const read = await call(f, "hallkeeper", "GET", `/venues/${f.venueId}/supplier-arrivals?${window(f)}`);
    expect(read.status).toBe(200);
    expect((read.data as SupplierArrival[]).map((item) => item.id)).toEqual([saved.id]);
    // Outside the window, nothing.
    const later = await call(f, "hallkeeper", "GET", `/venues/${f.venueId}/supplier-arrivals?${window(f, DAY, 2 * DAY)}`);
    expect(later.data).toEqual([]);

    // Two phones at one door: the first tap wins, the second reads it back.
    const first = await call(f, "hallkeeper", "POST", `/venues/${f.venueId}/supplier-arrivals/${saved.id}/arrived`);
    const second = await call(f, "porter", "POST", `/venues/${f.venueId}/supplier-arrivals/${saved.id}/arrived`);
    expect(first.status).toBe(200);
    expect((first.data as SupplierArrival).arrivedByName).toBe("Jamie");
    expect(second.data).toEqual(first.data);
    const gone = await call(f, "porter", "POST", `/venues/${f.venueId}/supplier-arrivals/${saved.id}/left`);
    expect(gone.data).toMatchObject({ arrivedByName: "Jamie", leftByName: "Ngozi", revision: 1 });

    // Leaving without having been marked in marks the arrival too.
    const band = await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f, { supplierName: "The Kelvin Reelers", leavesBy: null }));
    const left = await call(f, "hallkeeper", "POST", `/venues/${f.venueId}/supplier-arrivals/${(band.data as SupplierArrival).id}/left`);
    expect(left.data).toMatchObject({ arrivedByName: "Jamie", leftByName: "Jamie" });
    expect((left.data as SupplierArrival).arrivedAt).toBe((left.data as SupplierArrival).leftAt);
  });

  it("keeps planning to the office, refuses an old copy, and lets one of two changes from one copy land", async () => {
    const f = await fixture();
    expect((await call(f, "hallkeeper", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f))).status).toBe(403);
    const made = (await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f))).data as SupplierArrival;
    expect((await call(f, "hallkeeper", "PATCH", `/venues/${f.venueId}/supplier-arrivals/${made.id}`, { expectedRevision: 1, entrance: "front" })).status).toBe(403);

    const [a, b] = await Promise.all([
      call(f, "admin", "PATCH", `/venues/${f.venueId}/supplier-arrivals/${made.id}`, { expectedRevision: 1, entrance: "the kitchen lift" }),
      call(f, "admin", "PATCH", `/venues/${f.venueId}/supplier-arrivals/${made.id}`, { expectedRevision: 1, entrance: "Glassford Street" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const stale = await call(f, "admin", "PATCH", `/venues/${f.venueId}/supplier-arrivals/${made.id}`, { expectedRevision: 1, contact: "Duncan" });
    expect([stale.status, stale.code]).toEqual([409, "STALE_ARRIVAL"]);

    expect((await call(f, "admin", "DELETE", `/venues/${f.venueId}/supplier-arrivals/${made.id}?expectedRevision=1`)).status).toBe(409);
    expect((await call(f, "admin", "DELETE", `/venues/${f.venueId}/supplier-arrivals/${made.id}?expectedRevision=2`)).status).toBe(204);
    expect((await call(f, "admin", "DELETE", `/venues/${f.venueId}/supplier-arrivals/${made.id}?expectedRevision=2`)).status).toBe(404);
  });

  it("keeps each venue to its own arrivals and bookings, and an arrival near its booking", async () => {
    const f = await fixture();
    const made = (await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f))).data as SupplierArrival;
    expect((await call(f, "other", "GET", `/venues/${f.venueId}/supplier-arrivals?${window(f)}`)).status).toBe(403);
    // Reached through their own venue's path, ours reads as absent.
    expect((await call(f, "other", "POST", `/venues/${f.otherVenueId}/supplier-arrivals/${made.id}/arrived`)).status).toBe(404);
    expect((await call(f, "otherAdmin", "PATCH", `/venues/${f.otherVenueId}/supplier-arrivals/${made.id}`, { expectedRevision: 1, contact: "x" })).status).toBe(404);
    expect((await call(f, "otherAdmin", "PATCH", `/venues/${f.venueId}/supplier-arrivals/${made.id}`, { expectedRevision: 1, contact: "x" })).status).toBe(403);
    // Their booking cannot be named on ours.
    const theirs = await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f, { bookingId: f.theirs.id }));
    expect([theirs.status, theirs.code]).toEqual([404, "BOOKING_NOT_FOUND"]);

    const early = await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f, {
      arrivesAt: new Date(f.start.getTime() - 3 * DAY).toISOString(), leavesBy: null,
    }));
    expect([early.status, early.code]).toEqual([400, "ARRIVAL_OUTSIDE_BOOKING"]);
    const backwards = await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f, {
      leavesBy: new Date(f.start.getTime() - 7 * HOUR).toISOString(),
    }));
    expect([backwards.status, backwards.code]).toEqual([400, "VALIDATION_ERROR"]);
    // A changed time is held to the booking too.
    const moved = await call(f, "admin", "PATCH", `/venues/${f.venueId}/supplier-arrivals/${made.id}`, {
      expectedRevision: 1, arrivesAt: new Date(f.start.getTime() + 7 * HOUR).toISOString(), leavesBy: null,
    });
    expect([moved.status, moved.code]).toEqual([400, "ARRIVAL_OUTSIDE_BOOKING"]);
    // Three days at a time, no more.
    expect((await call(f, "hallkeeper", "GET", `/venues/${f.venueId}/supplier-arrivals?${window(f, -DAY, 2 * DAY)}`)).status).toBe(200);
    expect((await call(f, "hallkeeper", "GET", `/venues/${f.venueId}/supplier-arrivals?${window(f, -DAY, 2 * DAY + HOUR)}`)).status).toBe(400);

    // A booking taken off the Diary takes its arrivals off the board.
    await db.update(schema.bookings).set({ deletedAt: new Date() }).where(eq(schema.bookings.id, f.dinner.id));
    expect((await call(f, "hallkeeper", "GET", `/venues/${f.venueId}/supplier-arrivals?${window(f)}`)).data).toEqual([]);
  });
});
