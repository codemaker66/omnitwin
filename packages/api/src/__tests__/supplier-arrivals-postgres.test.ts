import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BOOKING_EXIT_STATES, type SupplierArrival } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { supplierArrivalRoutes } from "../routes/supplier-arrivals.js";
import { transitionBookingCore, updateBookingCore, type MutationActor } from "../services/booking-mutations.js";
import { insertBoundBookings } from "../services/event-binding.js";
import { clearLapsedSupplierContacts } from "../services/supplier-arrival-retention.js";
import { proposeWindowCore } from "../services/window-proposals.js";

// ---------------------------------------------------------------------------
// Supplier arrivals (T-692) on the migrated disposable platform database:
//   - the office adds a supplier to one of its bookings; the floor reads the
//     day's arrivals and marks each one arrived and gone, first tap winning;
//   - the floor cannot plan them, a change from an old copy is refused, and
//     of two changes from one copy exactly one lands; a Save sent again with
//     its key adds once;
//   - another venue reads, changes and marks nothing, and its booking cannot
//     be named, not even by a direct insert; an arrival far from its booking
//     is refused, a collection the morning after is not;
//   - a Diary move or a proposal carries the arrivals not yet marked, across
//     a change of the clocks too, and an add waits for a move or an exit of
//     its booking and is judged against where it left the booking;
//   - a booking off the Diary takes its suppliers off the board, except
//     anyone marked in and not out, who can still be marked gone;
//   - a supplier marked in is not removed until the tap is taken back; a tap
//     belongs to the day; every mark, undo and removal is in the history;
//   - the table holds its own rules, and a year after the booking ends the
//     clean-up clears the contact and note, and only those.
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

interface Called {
  readonly status: number;
  readonly data: unknown;
  readonly code: string | undefined;
  /** The idempotency-replay header, when the answer carried one. */
  readonly replay: string | undefined;
}

/** Whether a promise settles within `ms`: a request waiting on a lock does not. */
function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([
    promise.then(() => true, () => true),
    new Promise<boolean>((done) => { setTimeout(() => { done(false); }, ms); }),
  ]);
}

/** A gate a transaction waits at, so a test decides when it commits. */
function gate(): { readonly entered: Promise<void>; readonly enter: () => void; readonly open: Promise<void>; readonly release: () => void } {
  let enter: () => void = () => undefined;
  let release: () => void = () => undefined;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const open = new Promise<void>((resolve) => { release = resolve; });
  return { entered, enter, open, release };
}

/** The SQLSTATE a statement fails with, or null when it succeeds. */
async function sqlState(work: Promise<unknown>): Promise<string | null> {
  try {
    await work;
    return null;
  } catch (error) {
    const code = (error as { readonly code?: unknown }).code;
    return typeof code === "string" ? code : "no code";
  }
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

  /** The office's own account, as the Diary's cores take it. */
  function office(f: Fixture): MutationActor {
    return { id: f.people.admin, venueId: f.venueId, role: "admin", platformRole: "none" };
  }

  async function call(
    f: Fixture,
    who: Who,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    payload?: Record<string, unknown>,
    headers: Record<string, string> = {},
  ): Promise<Called> {
    const response = await server.inject({ method, url, headers: { ...as(f, who), ...headers }, ...(payload === undefined ? {} : { payload }) });
    const body = response.body === "" ? {} : response.json<{ data?: unknown; code?: string }>();
    const replay = response.headers["idempotency-replay"];
    return { status: response.statusCode, data: body.data, code: body.code, replay: typeof replay === "string" ? replay : undefined };
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

  /** A day either side of an instant, as the board reads. */
  function around(at: Date): string {
    return `from=${encodeURIComponent(new Date(at.getTime() - DAY).toISOString())}&to=${encodeURIComponent(new Date(at.getTime() + DAY).toISOString())}`;
  }

  function ids(called: Called): readonly string[] {
    return (called.data as SupplierArrival[]).map((item) => item.id);
  }

  async function stored(id: string) {
    const [row] = await db.select().from(schema.bookingSupplierArrivals).where(eq(schema.bookingSupplierArrivals.id, id));
    if (row === undefined) throw new Error("arrival not stored");
    return row;
  }

  /** An arrival row straight into the table, as a seed or a manual fix would write it. */
  function insertRow(columns: Record<string, unknown>) {
    const names = Object.keys(columns);
    return pool.query<{ id: string }>(
      `INSERT INTO booking_supplier_arrivals (${names.join(", ")}) VALUES (${names.map((_, index) => `$${String(index + 1)}`).join(", ")}) RETURNING id`,
      Object.values(columns),
    );
  }

  /** Tonight's supplier for the booking starting in two hours: their door is today's. */
  async function dueTonight(f: Fixture, supplierName = "Thistle & Fern Flowers") {
    const tonight = await fixtureTonight(f);
    const made = await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f, {
      bookingId: tonight.id, supplierName, arrivesAt: new Date(tonight.startsAt.getTime() - HOUR).toISOString(), leavesBy: null,
    }));
    expect(made.status).toBe(201);
    return { tonight, made: made.data as SupplierArrival };
  }

  it("lets the office add a supplier, and the floor read the day's arrivals and mark the door", async () => {
    const f = await fixture();
    const made = await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f));
    expect(made.status).toBe(201);
    const saved = made.data as SupplierArrival;
    expect(saved).toMatchObject({ supplierName: "Thistle & Fern Flowers", category: "florist", note: null, revision: 1, arrivedAt: null });

    const read = await call(f, "hallkeeper", "GET", `/venues/${f.venueId}/supplier-arrivals?${window(f)}`);
    expect(read.status).toBe(200);
    expect(ids(read)).toEqual([saved.id]);
    // Outside the window, nothing.
    const later = await call(f, "hallkeeper", "GET", `/venues/${f.venueId}/supplier-arrivals?${window(f, DAY, 2 * DAY)}`);
    expect(later.data).toEqual([]);

    // At the door tonight, two phones at once: one fact, the same for both.
    const tonight = await fixtureTonight(f);
    const due = (await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f, {
      bookingId: tonight.id, arrivesAt: new Date(tonight.startsAt.getTime() - HOUR).toISOString(), leavesBy: null,
    }))).data as SupplierArrival;
    const [first, second] = await Promise.all([
      call(f, "hallkeeper", "POST", `/venues/${f.venueId}/supplier-arrivals/${due.id}/arrived`),
      call(f, "porter", "POST", `/venues/${f.venueId}/supplier-arrivals/${due.id}/arrived`),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(second.data).toEqual(first.data);
    expect(["Jamie", "Ngozi"]).toContain((first.data as SupplierArrival).arrivedByName);
    const gone = await call(f, "porter", "POST", `/venues/${f.venueId}/supplier-arrivals/${due.id}/left`);
    expect(gone.data).toMatchObject({ arrivedByName: (first.data as SupplierArrival).arrivedByName, leftByName: "Ngozi", revision: 1 });

    // Leaving without having been marked in marks the arrival too.
    const band = await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f, {
      bookingId: tonight.id, supplierName: "The Kelvin Reelers", arrivesAt: new Date(tonight.startsAt.getTime() - HOUR).toISOString(), leavesBy: null,
    }));
    const left = await call(f, "hallkeeper", "POST", `/venues/${f.venueId}/supplier-arrivals/${(band.data as SupplierArrival).id}/left`);
    expect(left.data).toMatchObject({ arrivedByName: "Jamie", leftByName: "Jamie" });
    expect((left.data as SupplierArrival).arrivedAt).toBe((left.data as SupplierArrival).leftAt);
  });

  it("keeps planning to the office, refuses an old copy, and lets one of two changes from one copy land", async () => {
    const f = await fixture();
    expect((await call(f, "hallkeeper", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f))).status).toBe(403);
    // Text PostgreSQL would refuse is refused first, as a 400, not a 500.
    const nul = await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f, { supplierName: "A\u0000B" }));
    expect([nul.status, nul.code]).toEqual([400, "VALIDATION_ERROR"]);
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

  it("adds once however often a Save is sent with its key, and once when it is sent twice at once", async () => {
    const f = await fixture();
    const url = `/venues/${f.venueId}/supplier-arrivals`;
    const key = randomUUID();
    const first = await call(f, "admin", "POST", url, arrival(f), { "idempotency-key": key });
    expect([first.status, first.replay]).toEqual([201, "false"]);
    // The answer was lost; the office presses Save again, having tidied the name.
    const again = await call(f, "admin", "POST", url, arrival(f, { supplierName: "Thistle and Fern" }), { "idempotency-key": key });
    expect([again.status, again.replay]).toEqual([200, "true"]);
    expect(again.data).toEqual(first.data);

    const twice = randomUUID();
    const [one, other] = await Promise.all([
      call(f, "admin", "POST", url, arrival(f, { supplierName: "Clydeside Kitchen Co." }), { "idempotency-key": twice }),
      call(f, "admin", "POST", url, arrival(f, { supplierName: "Clydeside Kitchen Co." }), { "idempotency-key": twice }),
    ]);
    expect([one.status, other.status].sort()).toEqual([200, 201]);
    expect((one.data as SupplierArrival).id).toBe((other.data as SupplierArrival).id);
    const ours = await db.select().from(schema.bookingSupplierArrivals).where(eq(schema.bookingSupplierArrivals.venueId, f.venueId));
    expect(ours).toHaveLength(2);

    // A key names one add: with another booking it is a mistake, not a replay.
    const { tonight } = await dueTonight(f, "The Kelvin Reelers");
    const misused = await call(f, "admin", "POST", url, arrival(f, {
      bookingId: tonight.id, arrivesAt: new Date(tonight.startsAt.getTime() - HOUR).toISOString(), leavesBy: null,
    }), { "idempotency-key": key });
    expect([misused.status, misused.code]).toEqual([409, "IDEMPOTENCY_KEY_REUSED"]);
    // Another venue's keys are its own.
    const theirs = await call(f, "otherAdmin", "POST", `/venues/${f.otherVenueId}/supplier-arrivals`, arrival(f, { bookingId: f.theirs.id }), { "idempotency-key": key });
    expect([theirs.status, theirs.replay]).toEqual([201, "false"]);
    // A key that is not a uuid is refused before anything is written.
    const bad = await call(f, "admin", "POST", url, arrival(f), { "idempotency-key": "save-1" });
    expect([bad.status, bad.code]).toEqual([400, "VALIDATION_ERROR"]);
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
    // Their supplier, due in the same hours as ours, is on their board and not on ours.
    const elsewhere = (await call(f, "otherAdmin", "POST", `/venues/${f.otherVenueId}/supplier-arrivals`, arrival(f, { bookingId: f.theirs.id }))).data as SupplierArrival;
    expect(ids(await call(f, "hallkeeper", "GET", `/venues/${f.venueId}/supplier-arrivals?${window(f)}`))).toEqual([made.id]);
    expect(ids(await call(f, "other", "GET", `/venues/${f.otherVenueId}/supplier-arrivals?${window(f)}`))).toEqual([elsewhere.id]);

    const early = await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f, {
      arrivesAt: new Date(f.start.getTime() - 3 * DAY).toISOString(), leavesBy: null,
    }));
    expect([early.status, early.code]).toEqual([400, "ARRIVAL_OUTSIDE_BOOKING"]);
    const backwards = await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f, {
      leavesBy: new Date(f.start.getTime() - 7 * HOUR).toISOString(),
    }));
    expect([backwards.status, backwards.code]).toEqual([400, "VALIDATION_ERROR"]);
    // A changed time is held to the booking too: a day after it ends at the latest.
    const moved = await call(f, "admin", "PATCH", `/venues/${f.venueId}/supplier-arrivals/${made.id}`, {
      expectedRevision: 1, arrivesAt: new Date(f.start.getTime() + 31 * HOUR).toISOString(), leavesBy: null,
    });
    expect([moved.status, moved.code]).toEqual([400, "ARRIVAL_OUTSIDE_BOOKING"]);
    // Three days at a time, no more.
    expect((await call(f, "hallkeeper", "GET", `/venues/${f.venueId}/supplier-arrivals?${window(f, -DAY, 2 * DAY)}`)).status).toBe(200);
    expect((await call(f, "hallkeeper", "GET", `/venues/${f.venueId}/supplier-arrivals?${window(f, -DAY, 2 * DAY + HOUR)}`)).status).toBe(400);

    // A booking taken off the Diary takes its arrivals off the board.
    await db.update(schema.bookings).set({ deletedAt: new Date() }).where(eq(schema.bookings.id, f.dinner.id));
    expect((await call(f, "hallkeeper", "GET", `/venues/${f.venueId}/supplier-arrivals?${window(f)}`)).data).toEqual([]);
  });

  it("holds an arrival to its own booking's venue in the database itself", async () => {
    const f = await fixture();
    // Not reachable through the API; a seed, a backfill or a future writer could try it.
    expect(await sqlState(insertRow({
      venue_id: f.venueId, booking_id: f.theirs.id, supplier_name: "Misfiled", arrives_at: f.start,
    }))).toBe("23503");
  });

  it.each(BOOKING_EXIT_STATES)("takes a supplier nobody marked in off the board once the booking is %s", async (exit) => {
    const f = await fixture();
    const { tonight, made } = await dueTonight(f);
    const read = (): Promise<Called> => call(f, "hallkeeper", "GET", `/venues/${f.venueId}/supplier-arrivals?${around(tonight.startsAt)}`);
    expect(ids(await read())).toEqual([made.id]);
    await db.update(schema.bookings).set({ status: exit }).where(eq(schema.bookings.id, tonight.id));
    // Nobody comes for it: the floor reads none and marks none.
    expect((await read()).data).toEqual([]);
    for (const step of ["arrived", "left"]) {
      expect((await call(f, "hallkeeper", "POST", `/venues/${f.venueId}/supplier-arrivals/${made.id}/${step}`)).status).toBe(404);
      expect((await call(f, "hallkeeper", "DELETE", `/venues/${f.venueId}/supplier-arrivals/${made.id}/${step}`)).status).toBe(404);
    }
    // The office adds none and changes none.
    const added = await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f, {
      bookingId: tonight.id, arrivesAt: new Date(tonight.startsAt.getTime() - HOUR).toISOString(), leavesBy: null,
    }));
    expect([added.status, added.code]).toEqual([409, "BOOKING_NOT_ACTIVE"]);
    const changed = await call(f, "admin", "PATCH", `/venues/${f.venueId}/supplier-arrivals/${made.id}`, { expectedRevision: 1, entrance: "the front door" });
    expect([changed.status, changed.code]).toEqual([409, "BOOKING_NOT_ACTIVE"]);
    expect((await stored(made.id)).entrance).toBe("the Saloon's side door");
  });

  it("keeps a supplier marked in on the board whatever becomes of the booking, to be marked gone, and that taken back", async () => {
    const f = await fixture();
    const { tonight, made } = await dueTonight(f, "Clyde Staging");
    const url = `/venues/${f.venueId}/supplier-arrivals/${made.id}`;
    const read = async (): Promise<readonly string[]> => ids(await call(f, "hallkeeper", "GET", `/venues/${f.venueId}/supplier-arrivals?${around(tonight.startsAt)}`));
    expect((await call(f, "hallkeeper", "POST", `${url}/arrived`)).status).toBe(200);
    // The event is called off while Clyde Staging is still in the building striking.
    const cancelled = await transitionBookingCore(db, office(f), tonight.id, { toState: "cancelled" });
    expect(cancelled.ok).toBe(true);
    expect(await read()).toEqual([made.id]);
    // A second phone's Arrived reads the first back; the arrival is a fact Gone ends, not one to erase.
    expect((await call(f, "porter", "POST", `${url}/arrived`)).data).toMatchObject({ arrivedByName: "Jamie", leftAt: null });
    expect((await call(f, "porter", "DELETE", `${url}/arrived`)).status).toBe(404);
    // The office changes nothing on a booking off the Diary.
    expect((await call(f, "admin", "PATCH", url, { expectedRevision: 1, entrance: "the front door" })).code).toBe("BOOKING_NOT_ACTIVE");

    const gone = await call(f, "porter", "POST", `${url}/left`);
    expect(gone.status).toBe(200);
    expect(gone.data).toMatchObject({ leftByName: "Ngozi" });
    expect(await read()).toEqual([]);
    // A mistaken Gone: taken back, they are on the board again.
    const undone = await call(f, "porter", "DELETE", `${url}/left`);
    expect(undone.status).toBe(200);
    expect(undone.data).toMatchObject({ leftAt: null, arrivedByName: "Jamie" });
    expect(await read()).toEqual([made.id]);
    // Deleted from the Diary altogether, someone in the building is still named.
    await db.update(schema.bookings).set({ deletedAt: new Date() }).where(eq(schema.bookings.id, tonight.id));
    expect(await read()).toEqual([made.id]);
    expect((await call(f, "hallkeeper", "POST", `${url}/left`)).status).toBe(200);
  });

  it("waits for a Diary move of its booking before adding, and judges the add against where the move left it", async () => {
    const f = await fixture();
    const pending: { add?: Promise<Called> } = {};
    await db.transaction(async (tx) => {
      // The wedding moves to the next Saturday; the move holds the booking until it commits.
      const moved = await updateBookingCore(tx, office(f), f.dinner.id, {
        startsAt: new Date(f.start.getTime() + 7 * DAY).toISOString(), endsAt: new Date(f.start.getTime() + 7 * DAY + 6 * HOUR).toISOString(),
      });
      expect(moved.ok).toBe(true);
      // Meanwhile a colleague saves the florist for the old Saturday.
      pending.add = call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f));
      expect(await settlesWithin(pending.add, 300)).toBe(false);
    });
    if (pending.add === undefined) throw new Error("the add was not sent");
    const added = await pending.add;
    // Judged against the booking where the move left it: a week before it, so refused.
    expect([added.status, added.code]).toEqual([400, "ARRIVAL_OUTSIDE_BOOKING"]);
    expect(await db.select().from(schema.bookingSupplierArrivals).where(eq(schema.bookingSupplierArrivals.bookingId, f.dinner.id))).toEqual([]);
  });

  it("waits for a booking's exit from the Diary before adding, and then adds nothing to it", async () => {
    const f = await fixture();
    const pending: { add?: Promise<Called> } = {};
    await db.transaction(async (tx) => {
      const cancelled = await transitionBookingCore(tx, office(f), f.dinner.id, { toState: "cancelled" });
      expect(cancelled.ok).toBe(true);
      pending.add = call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f));
      expect(await settlesWithin(pending.add, 300)).toBe(false);
    });
    if (pending.add === undefined) throw new Error("the add was not sent");
    const added = await pending.add;
    expect([added.status, added.code]).toEqual([409, "BOOKING_NOT_ACTIVE"]);
  });

  it("lets a collection come the morning after, and keeps a door change to the door", async () => {
    const f = await fixture();
    const vases = await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f, {
      supplierName: "Thistle & Fern Flowers (collection)", arrivesAt: new Date(f.start.getTime() + 16 * HOUR).toISOString(), leavesBy: null,
    }));
    expect(vases.status).toBe(201);
    const late = await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f, {
      arrivesAt: new Date(f.start.getTime() + 31 * HOUR).toISOString(), leavesBy: null,
    }));
    expect([late.status, late.code]).toEqual([400, "ARRIVAL_OUTSIDE_BOOKING"]);
  });

  it("moves the arrivals not yet marked with their booking when the Diary moves it", async () => {
    const f = await fixture();
    const due = (await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f))).data as SupplierArrival;
    const inAlready = (await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f, { supplierName: "Already in" }))).data as SupplierArrival;
    await db.update(schema.bookingSupplierArrivals).set({ arrivedAt: new Date(), arrivedByName: "Jamie" })
      .where(eq(schema.bookingSupplierArrivals.id, inAlready.id));
    const moved = await updateBookingCore(db, office(f), f.dinner.id, {
      startsAt: new Date(f.start.getTime() - DAY).toISOString(), endsAt: new Date(f.start.getTime() - DAY + 6 * HOUR).toISOString(),
    });
    expect(moved.ok).toBe(true);
    const after = await stored(due.id);
    expect(after.arrivesAt.toISOString()).toBe(new Date(Date.parse(due.arrivesAt) - DAY).toISOString());
    expect(after.leavesBy?.toISOString()).toBe(new Date(Date.parse(due.leavesBy ?? "") - DAY).toISOString());
    expect(after.revision).toBe(2);
    expect((await stored(inAlready.id)).arrivesAt.toISOString()).toBe(inAlready.arrivesAt);
    // The day before now reads the moved arrival, and a door change is not re-judged on its times.
    const dayBefore = await call(f, "hallkeeper", "GET", `/venues/${f.venueId}/supplier-arrivals?${window(f, -2 * DAY, 0)}`);
    expect(ids(dayBefore)).toContain(due.id);
    expect((await call(f, "admin", "PATCH", `/venues/${f.venueId}/supplier-arrivals/${due.id}`, { expectedRevision: 2, entrance: "the kitchen lift" })).status).toBe(200);
  });

  it("moves an arrival as far as its booking across the night the clocks go back, keeping its place beside it", async () => {
    const f = await fixture();
    // Saturday 19 October 2030 at 18:00 BST, moved a fortnight to Saturday
    // 2 November 2030 at 18:00 GMT: the clocks go back on the 27th between.
    const before = new Date("2030-10-19T17:00:00.000Z");
    const after = new Date("2030-11-02T18:00:00.000Z");
    const [booking] = await insertBoundBookings(db, [{
      venueId: f.venueId, spaceId: f.dinner.spaceId, kind: "ink", title: "TEST ONLY autumn ball", eventType: "dinner", createdBy: f.people.admin,
      startsAt: before, endsAt: new Date(before.getTime() + 5 * HOUR),
    }]);
    if (booking === undefined) throw new Error("booking not made");
    // The band at 12:00 BST, six hours before the doors.
    const due = (await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f, {
      bookingId: booking.id, arrivesAt: "2030-10-19T11:00:00.000Z", leavesBy: "2030-10-19T12:00:00.000Z",
    }))).data as SupplierArrival;
    const moved = await updateBookingCore(db, office(f), booking.id, {
      startsAt: after.toISOString(), endsAt: new Date(after.getTime() + 5 * HOUR).toISOString(),
    });
    expect(moved.ok).toBe(true);
    const row = await stored(due.id);
    // Still six hours before the doors, and so 12:00 on the venue's clock, now GMT.
    expect(row.arrivesAt.toISOString()).toBe("2030-11-02T12:00:00.000Z");
    expect(row.leavesBy?.toISOString()).toBe("2030-11-02T13:00:00.000Z");
  });

  it("moves the arrivals not yet marked with a proposal its proposer moves", async () => {
    const f = await fixture();
    const eventId = randomUUID();
    await db.insert(schema.events).values({ id: eventId, venueId: f.venueId, name: "TEST ONLY proposed dinner", eventType: "dinner", createdBy: f.people.admin, guestCount: 80 });
    const proposer = { id: f.people.admin, name: "Elaine", role: "admin", venueId: f.venueId, platformRole: "none" as const };
    const start = evening(6);
    const window = (from: Date) => ({ spaceId: f.dinner.spaceId, startsAt: from.toISOString(), endsAt: new Date(from.getTime() + 4 * HOUR).toISOString(), idempotencyKey: randomUUID() });
    const proposed = await proposeWindowCore(db, proposer, eventId, window(start));
    if (!proposed.ok) throw new Error(`proposal refused: ${proposed.code}`);
    const bookingId = proposed.slot.bookingId;
    const due = (await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f, {
      bookingId, arrivesAt: new Date(start.getTime() - 3 * HOUR).toISOString(), leavesBy: new Date(start.getTime() - 2 * HOUR).toISOString(),
    }))).data as SupplierArrival;
    const inAlready = (await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f, {
      bookingId, supplierName: "Already in", arrivesAt: new Date(start.getTime() - 3 * HOUR).toISOString(), leavesBy: null,
    }))).data as SupplierArrival;
    await db.update(schema.bookingSupplierArrivals).set({ arrivedAt: new Date(), arrivedByName: "Jamie" })
      .where(eq(schema.bookingSupplierArrivals.id, inAlready.id));

    const moved = await proposeWindowCore(db, proposer, eventId, window(new Date(start.getTime() + DAY)));
    expect(moved.ok).toBe(true);
    const after = await stored(due.id);
    expect(after.arrivesAt.toISOString()).toBe(new Date(Date.parse(due.arrivesAt) + DAY).toISOString());
    expect(after.leavesBy?.toISOString()).toBe(new Date(Date.parse(due.leavesBy ?? "") + DAY).toISOString());
    expect(after.revision).toBe(2);
    expect((await stored(inAlready.id)).arrivesAt.toISOString()).toBe(inAlready.arrivesAt);
  });

  it("moves a proposal's suppliers from where the hold stands under its lock, when a Diary move lands between the proposal's read and that lock", async () => {
    const f = await fixture();
    const eventId = randomUUID();
    await db.insert(schema.events).values({ id: eventId, venueId: f.venueId, name: "TEST ONLY proposed supper", eventType: "dinner", createdBy: f.people.admin, guestCount: 60 });
    const proposer = { id: f.people.admin, name: "Elaine", role: "admin", venueId: f.venueId, platformRole: "none" as const };
    const start = evening(8);
    const window = (from: Date) => ({ spaceId: f.dinner.spaceId, startsAt: from.toISOString(), endsAt: new Date(from.getTime() + 3 * HOUR).toISOString(), idempotencyKey: randomUUID() });
    const proposed = await proposeWindowCore(db, proposer, eventId, window(start));
    if (!proposed.ok) throw new Error(`proposal refused: ${proposed.code}`);
    const bookingId = proposed.slot.bookingId;
    // The caterer, not yet marked in, three hours before the doors.
    const due = (await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f, {
      bookingId, arrivesAt: new Date(start.getTime() - 3 * HOUR).toISOString(), leavesBy: new Date(start.getTime() - 2 * HOUR).toISOString(),
    }))).data as SupplierArrival;

    // The office drags the hold two hours later in the Diary. Before that
    // commits, the same window is proposed again: the proposal reads the hold
    // where it stood, then waits at the hold's lock until the move commits.
    const held = gate();
    const officeMove = db.transaction(async (tx) => {
      const moved = await updateBookingCore(tx, office(f), bookingId, {
        startsAt: new Date(start.getTime() + 2 * HOUR).toISOString(), endsAt: new Date(start.getTime() + 5 * HOUR).toISOString(),
      });
      held.enter();
      await held.open;
      return moved;
    });
    await held.entered;
    const again = proposeWindowCore(db, proposer, eventId, window(start));
    await expect.poll(async () => Number((await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pg_stat_activity WHERE application_name = current_setting('application_name') AND wait_event_type = 'Lock'",
    )).rows[0]?.count), { timeout: 5000 }).toBe(1);
    held.release();
    const [byOffice, byProposer] = await Promise.all([officeMove, again]);
    expect(byOffice.ok && byProposer.ok).toBe(true);

    // The hold is back at the window proposed, and the caterer with it: three
    // hours before the doors, not five, and moved twice.
    const [hold] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
    expect(hold?.startsAt.toISOString()).toBe(start.toISOString());
    const after = await stored(due.id);
    expect(after.arrivesAt.toISOString()).toBe(due.arrivesAt);
    expect(after.leavesBy?.toISOString()).toBe(due.leavesBy);
    expect(after.revision).toBe(3);
  });

  it("keeps a supplier marked in until the tap is taken back, and holds a tap to the day", async () => {
    const f = await fixture();
    const { tonight, made } = await dueTonight(f);
    await call(f, "hallkeeper", "POST", `/venues/${f.venueId}/supplier-arrivals/${made.id}/arrived`);
    const refused = await call(f, "admin", "DELETE", `/venues/${f.venueId}/supplier-arrivals/${made.id}?expectedRevision=1`);
    expect([refused.status, refused.code]).toEqual([409, "ARRIVAL_MARKED"]);
    // Taken back on the board, it can be removed.
    const undone = await call(f, "hallkeeper", "DELETE", `/venues/${f.venueId}/supplier-arrivals/${made.id}/arrived`);
    expect(undone.data).toMatchObject({ arrivedAt: null, arrivedByName: null });
    expect((await call(f, "admin", "DELETE", `/venues/${f.venueId}/supplier-arrivals/${made.id}?expectedRevision=1`)).status).toBe(204);

    // Four days ahead is not today's door.
    const ahead = (await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f))).data as SupplierArrival;
    const early = await call(f, "hallkeeper", "POST", `/venues/${f.venueId}/supplier-arrivals/${ahead.id}/arrived`);
    expect([early.status, early.code]).toEqual([400, "ARRIVAL_NOT_DUE"]);

    // A booking taken off the Diary takes its door with it.
    await db.update(schema.bookings).set({ deletedAt: new Date() }).where(eq(schema.bookings.id, tonight.id));
    const offDiary = (await db.insert(schema.bookingSupplierArrivals).values({
      venueId: f.venueId, bookingId: tonight.id, supplierName: "Orphan", arrivesAt: new Date(),
    }).returning())[0];
    expect((await call(f, "hallkeeper", "POST", `/venues/${f.venueId}/supplier-arrivals/${offDiary?.id ?? ""}/arrived`)).status).toBe(404);
  });

  it("refuses to mark someone in long after they were due, and still lets someone in be marked gone", async () => {
    const f = await fixture();
    const past = new Date(Math.floor((Date.now() - 3 * DAY) / 60_000) * 60_000);
    const [lastWeek] = await insertBoundBookings(db, [{
      venueId: f.venueId, spaceId: f.dinner.spaceId, kind: "ink", title: "TEST ONLY past dinner", eventType: "dinner", createdBy: f.people.admin,
      startsAt: past, endsAt: new Date(past.getTime() + 4 * HOUR),
    }]);
    if (lastWeek === undefined) throw new Error("booking not made");
    const due = (await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f, {
      bookingId: lastWeek.id, arrivesAt: new Date(past.getTime() - HOUR).toISOString(), leavesBy: new Date(past.getTime() + HOUR).toISOString(),
    }))).data as SupplierArrival;
    // Due three days ago: not marked in as having come today, by Arrived or by Gone.
    for (const step of ["arrived", "left"]) {
      const late = await call(f, "hallkeeper", "POST", `/venues/${f.venueId}/supplier-arrivals/${due.id}/${step}`);
      expect([late.status, late.code]).toEqual([400, "ARRIVAL_PAST"]);
    }
    expect((await stored(due.id)).arrivedAt).toBeNull();
    // Someone marked in then is in the building until the floor says otherwise.
    await db.update(schema.bookingSupplierArrivals).set({ arrivedAt: past, arrivedByName: "Jamie" }).where(eq(schema.bookingSupplierArrivals.id, due.id));
    const gone = await call(f, "porter", "POST", `/venues/${f.venueId}/supplier-arrivals/${due.id}/left`);
    expect(gone.status).toBe(200);
    expect(gone.data).toMatchObject({ arrivedByName: "Jamie", leftByName: "Ngozi" });
  });

  it("takes back a Gone and keeps the arrival, and takes back no arrival already marked gone", async () => {
    const f = await fixture();
    const { made } = await dueTonight(f);
    const url = `/venues/${f.venueId}/supplier-arrivals/${made.id}`;
    await call(f, "hallkeeper", "POST", `${url}/arrived`);
    await call(f, "porter", "POST", `${url}/left`);
    const stale = await call(f, "hallkeeper", "DELETE", `${url}/arrived`);
    expect([stale.status, stale.code]).toEqual([409, "ARRIVAL_GONE"]);
    const back = await call(f, "hallkeeper", "DELETE", `${url}/left`);
    expect(back.data).toMatchObject({ leftAt: null, leftByName: null, arrivedByName: "Jamie" });
    // A tap nobody made is taken back as nothing.
    expect((await call(f, "hallkeeper", "DELETE", `${url}/left`)).data).toEqual(back.data);
    const out = await call(f, "hallkeeper", "DELETE", `${url}/arrived`);
    expect(out.data).toMatchObject({ arrivedAt: null, arrivedByName: null });
    expect((await call(f, "hallkeeper", "DELETE", `${url}/arrived`)).data).toEqual(out.data);
  });

  it("writes the door's history: each mark, mark taken back and removal, and nothing for a tap that read the first back", async () => {
    const f = await fixture();
    const { tonight, made } = await dueTonight(f);
    const url = `/venues/${f.venueId}/supplier-arrivals/${made.id}`;
    await call(f, "hallkeeper", "POST", `${url}/arrived`);
    await call(f, "porter", "POST", `${url}/arrived`);
    await call(f, "hallkeeper", "POST", `${url}/left`);
    await call(f, "porter", "DELETE", `${url}/left`);
    await call(f, "porter", "DELETE", `${url}/left`);
    await call(f, "hallkeeper", "DELETE", `${url}/arrived`);
    const removable = (await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f, {
      bookingId: tonight.id, supplierName: "Govan Hire", arrivesAt: new Date(tonight.startsAt.getTime() - HOUR).toISOString(), leavesBy: null,
    }))).data as SupplierArrival;
    expect((await call(f, "admin", "DELETE", `/venues/${f.venueId}/supplier-arrivals/${removable.id}?expectedRevision=1`)).status).toBe(204);

    const history = await db.select().from(schema.bookingSupplierArrivalEvents)
      .where(eq(schema.bookingSupplierArrivalEvents.bookingId, tonight.id))
      .orderBy(asc(schema.bookingSupplierArrivalEvents.at));
    expect(history.map((row) => [row.action, row.actorName, row.supplierName])).toEqual([
      ["arrived", "Jamie", "Thistle & Fern Flowers"],
      ["left", "Jamie", "Thistle & Fern Flowers"],
      ["left-undone", "Ngozi", "Thistle & Fern Flowers"],
      ["arrived-undone", "Jamie", "Thistle & Fern Flowers"],
      ["removed", null, "Govan Hire"],
    ]);
    // The removal's record outlives the arrival, and keeps the account that removed it.
    const removal = history[4];
    expect([removal?.arrivalId, removal?.actorUserId, removal?.venueId]).toEqual([removable.id, f.people.admin, f.venueId]);
    expect(await db.select().from(schema.bookingSupplierArrivals).where(eq(schema.bookingSupplierArrivals.id, removable.id))).toEqual([]);
    // The database keeps names to the door.
    expect(await sqlState(pool.query(
      "INSERT INTO booking_supplier_arrival_events (venue_id, booking_id, arrival_id, supplier_name, action, actor_name) VALUES ($1, $2, $3, 'x', 'removed', 'Elaine')",
      [f.venueId, tonight.id, removable.id],
    ))).toBe("23514");

    // Gone for someone nobody marked in marks them in too, by the same hand at
    // the same moment, and the history holds that arrival as well as the Gone.
    const band = (await call(f, "admin", "POST", `/venues/${f.venueId}/supplier-arrivals`, arrival(f, {
      bookingId: tonight.id, supplierName: "The Kelvin Reelers", arrivesAt: new Date(tonight.startsAt.getTime() - HOUR).toISOString(), leavesBy: null,
    }))).data as SupplierArrival;
    const gone = (await call(f, "porter", "POST", `/venues/${f.venueId}/supplier-arrivals/${band.id}/left`)).data as SupplierArrival;
    expect(gone).toMatchObject({ arrivedByName: "Ngozi", leftByName: "Ngozi" });
    const bandHistory = await db.select().from(schema.bookingSupplierArrivalEvents)
      .where(eq(schema.bookingSupplierArrivalEvents.arrivalId, band.id))
      .orderBy(asc(schema.bookingSupplierArrivalEvents.at), asc(schema.bookingSupplierArrivalEvents.action));
    expect(bandHistory.map((row) => [row.action, row.actorName, row.actorUserId, row.at.toISOString()])).toEqual([
      ["arrived", "Ngozi", f.people.porter, gone.arrivedAt],
      ["left", "Ngozi", f.people.porter, gone.leftAt],
    ]);
    expect(gone.arrivedAt).toBe(gone.leftAt);
  });

  it("holds its own rules: times in order, gone only after in, no blank words, its booking's suppliers going with it, names kept when an account goes", async () => {
    const f = await fixture();
    const base = { venue_id: f.venueId, booking_id: f.dinner.id, supplier_name: "Seeded", arrives_at: f.start };
    expect(await sqlState(insertRow({ ...base, leaves_by: f.start }))).toBe("23514");
    expect(await sqlState(insertRow({ ...base, left_at: f.start }))).toBe("23514");
    expect(await sqlState(insertRow({ ...base, supplier_name: "   " }))).toBe("23514");
    for (const column of ["category", "entrance", "contact", "note"]) {
      expect(await sqlState(insertRow({ ...base, [column]: " " })), column).toBe("23514");
    }
    const marked = await insertRow({
      ...base, arrived_at: f.start, arrived_by_user_id: f.people.hallkeeper, arrived_by_name: "Jamie",
      left_at: new Date(f.start.getTime() + HOUR), left_by_user_id: f.people.porter, left_by_name: "Ngozi",
    });
    const id = marked.rows[0]?.id ?? "";
    // Clearing the arrival of someone marked gone is refused, whoever writes it.
    expect(await sqlState(pool.query("UPDATE booking_supplier_arrivals SET arrived_at = NULL WHERE id = $1", [id]))).toBe("23514");
    expect(await sqlState(pool.query("UPDATE booking_supplier_arrivals SET contact = '' WHERE id = $1", [id]))).toBe("23514");

    // A booking deleted outright takes its suppliers and their history with it.
    const { tonight, made } = await dueTonight(f);
    await call(f, "hallkeeper", "POST", `/venues/${f.venueId}/supplier-arrivals/${made.id}/arrived`);
    await pool.query("DELETE FROM bookings WHERE id = $1", [tonight.id]);
    expect(await db.select().from(schema.bookingSupplierArrivals).where(eq(schema.bookingSupplierArrivals.bookingId, tonight.id))).toEqual([]);
    expect(await db.select().from(schema.bookingSupplierArrivalEvents).where(eq(schema.bookingSupplierArrivalEvents.bookingId, tonight.id))).toEqual([]);

    const indexes = await pool.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename IN ('booking_supplier_arrivals', 'booking_supplier_arrival_events')",
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual(expect.arrayContaining([
      "booking_supplier_arrivals_venue_arrives_idx",
      "booking_supplier_arrivals_booking_idx",
      "booking_supplier_arrivals_idempotency_idx",
      "booking_supplier_arrival_events_arrival_idx",
      "booking_supplier_arrival_events_booking_idx",
    ]));

    // An account removed outright: its id goes from the door marks, its name
    // stays as the record of who was in the building (Blake, 12 November 2026).
    await pool.query("DELETE FROM users WHERE id = $1", [f.people.hallkeeper]);
    expect(await stored(id)).toMatchObject({ arrivedByUserId: null, arrivedByName: "Jamie", leftByUserId: f.people.porter, leftByName: "Ngozi" });
  });

  it("clears a supplier's contact and note a year after the booking ends, keeps the rest and the door marks, and runs twice without harm", async () => {
    const f = await fixture();
    // Two dinners long past: one ended a year and an hour before the pass, one a few days inside the year.
    const ended = new Date(Math.floor((Date.now() - 800 * DAY) / 60_000) * 60_000);
    const passAt = new Date(ended.getTime() + 365 * DAY + HOUR);
    const [lapsed, kept] = await insertBoundBookings(db, [
      { venueId: f.venueId, spaceId: f.dinner.spaceId, kind: "ink", title: "TEST ONLY long past", eventType: "dinner", createdBy: f.people.admin,
        startsAt: new Date(ended.getTime() - 5 * HOUR), endsAt: ended },
      { venueId: f.venueId, spaceId: f.dinner.spaceId, kind: "ink", title: "TEST ONLY less long past", eventType: "dinner", createdBy: f.people.admin,
        startsAt: new Date(ended.getTime() + 3 * DAY), endsAt: new Date(ended.getTime() + 3 * DAY + 5 * HOUR) },
    ]);
    if (lapsed === undefined || kept === undefined) throw new Error("bookings not made");
    const marks = { arrivedAt: new Date(ended.getTime() - 6 * HOUR), arrivedByName: "Jamie", leftAt: new Date(ended.getTime() - 4 * HOUR), leftByName: "Ngozi" };
    const [old] = await db.insert(schema.bookingSupplierArrivals).values({
      venueId: f.venueId, bookingId: lapsed.id, supplierName: "The Kelvin Reelers", arrivesAt: new Date(ended.getTime() - 6 * HOUR),
      entrance: "the Glassford Street door", contact: "Siobhan 07700 900123", note: "Five players", ...marks,
    }).returning();
    const [recent] = await db.insert(schema.bookingSupplierArrivals).values({
      venueId: f.venueId, bookingId: kept.id, supplierName: "Thistle & Fern Flowers", arrivesAt: new Date(ended.getTime() + 3 * DAY - 6 * HOUR),
      contact: "Morven", note: "Vases back on Monday",
    }).returning();
    if (old === undefined || recent === undefined) throw new Error("arrivals not made");

    // The rehearsal says what would go and changes nothing.
    expect(await clearLapsedSupplierContacts(db, { now: passAt, dryRun: true })).toEqual({ dryRun: true, arrivals: 1 });
    expect(await stored(old.id)).toMatchObject({ contact: "Siobhan 07700 900123", note: "Five players", revision: 1 });

    expect(await clearLapsedSupplierContacts(db, { now: passAt })).toEqual({ dryRun: false, arrivals: 1 });
    expect(await stored(old.id)).toMatchObject({
      contact: null, note: null, revision: 2,
      // The venue's record stays: who, when, which door, and who marked them in and out.
      supplierName: "The Kelvin Reelers", entrance: "the Glassford Street door", arrivesAt: old.arrivesAt, ...marks,
    });
    expect(await stored(recent.id)).toMatchObject({ contact: "Morven", note: "Vases back on Monday", revision: 1 });
    // Again, the same night or the next: nothing more to clear, and nothing changes.
    expect(await clearLapsedSupplierContacts(db, { now: passAt })).toEqual({ dryRun: false, arrivals: 0 });
    expect((await stored(old.id)).revision).toBe(2);
  });

  it("lets a platform administrator read and plan a venue's suppliers", async () => {
    const f = await fixture();
    const id = randomUUID();
    await db.insert(schema.users).values({ id, venueId: null, name: "Platform", email: `${id}@arrivals.invalid`, role: "admin", platformRole: "admin" });
    const headers = { authorization: `Bearer ${JSON.stringify({ id, email: `${id}@arrivals.invalid`, name: "Platform", role: "admin", platformRole: "admin", venueId: null })}` };
    const made = await server.inject({ method: "POST", url: `/venues/${f.venueId}/supplier-arrivals`, headers, payload: arrival(f) });
    expect(made.statusCode).toBe(201);
    const read = await server.inject({ method: "GET", url: `/venues/${f.venueId}/supplier-arrivals?${window(f)}`, headers });
    expect(read.json<{ data: SupplierArrival[] }>().data.map((item) => item.supplierName)).toEqual(["Thistle & Fern Flowers"]);
  });

  it("records a long name at the door rather than refusing the tap, clipped between characters", async () => {
    const f = await fixture();
    const { made } = await dueTonight(f);
    const id = f.people.hallkeeper;
    // The 160th character takes two UTF-16 units: a clip by units would split it.
    const name = `${"J".repeat(159)}\u{1F3BB}${"x".repeat(40)}`;
    // A header carries ASCII: the name's characters go as JSON escapes.
    const token = JSON.stringify({ id, email: `${id}@arrivals.invalid`, name, role: "hallkeeper", platformRole: "none", venueId: f.venueId })
      .replace(/[\u007f-￿]/gu, (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`);
    const response = await server.inject({
      method: "POST", url: `/venues/${f.venueId}/supplier-arrivals/${made.id}/arrived`, headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const recorded = response.json<{ data: SupplierArrival }>().data.arrivedByName ?? "";
    expect(Array.from(recorded)).toHaveLength(160);
    expect(recorded.endsWith("\u{1F3BB}")).toBe(true);
  });

  /** A booking of the fixture's venue starting in two hours, so its door is today's. */
  async function fixtureTonight(f: Fixture) {
    const startsAt = new Date(Math.ceil((Date.now() + 2 * HOUR) / 60_000) * 60_000);
    const [booking] = await insertBoundBookings(db, [{
      venueId: f.venueId, spaceId: f.dinner.spaceId, kind: "ink", title: "TEST ONLY tonight", eventType: "dinner", createdBy: f.people.admin,
      startsAt, endsAt: new Date(startsAt.getTime() + 4 * HOUR),
    }]);
    if (booking === undefined) throw new Error("booking not made");
    return booking;
  }
});
