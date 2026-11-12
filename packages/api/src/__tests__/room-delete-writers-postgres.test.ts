import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { bookingRoutes } from "../routes/bookings.js";
import { eventPhaseRoutes, eventRoutes } from "../routes/events.js";
import { spaceRoutes } from "../routes/spaces.js";
import { createBookingCore, transitionBookingCore, updateBookingCore, type MutationActor } from "../services/booking-mutations.js";
import { insertBoundBookings } from "../services/event-binding.js";
import { proposeWindowCore } from "../services/window-proposals.js";

// ---------------------------------------------------------------------------
// A room being deleted and the writes that put things into it, on migrated
// PostgreSQL (admin-venues-3). The delete counts what is still to come under
// the room's row lock; every write that puts a booking or a timed phase into
// a room, moves one there or moves one in time takes the room first. So a
// write that meets a delete in progress waits for it and is refused with
// nothing written, and a write that took the room first is counted and
// refuses the delete. Nothing reaches a deleted room by a later edit either,
// and a phase of an event that has ended holds no room.
//
// Never loads .env and never falls back to DATABASE_URL. The target is the
// explicitly named disposable cluster the request tests use.
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_REQUESTS_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1"
    || parsed.pathname !== "/venviewer_lane9_test" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Room tests require the explicit disposable database venviewer_lane9_test on 127.0.0.1");
  }
}

const OUTLINE = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
const APP = `room_writers_${randomUUID()}`;
const DAY = 86_400_000;
const HOUR = 3_600_000;

describe.skipIf(target === undefined)("a room being deleted and the writes that put things into it", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: APP, max: 8, options: "-c statement_timeout=10000" });
    const name = (await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name;
    expect(name).toBe("venviewer_lane9_test");
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(spaceRoutes, { db, prefix: "/venues/:venueId/spaces" });
    await server.register(bookingRoutes, { db, prefix: "/bookings" });
    await server.register(eventRoutes, { db, prefix: "/events" });
    await server.register(eventPhaseRoutes, { db, prefix: "/event-phases" });
    await server.ready();
  }, 120_000);

  afterAll(async () => {
    if (server !== undefined) await server.close();
    if (pool !== undefined) await pool.end();
  });

  async function fixture() {
    const venueId = randomUUID();
    const adminId = randomUUID();
    const hall = randomUUID();
    const library = randomUUID();
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY room writers", slug: venueId, address: "Disposable fixture" });
    await db.insert(schema.users).values({ id: adminId, venueId, name: "The administrator", email: `${adminId}@room-writers.invalid`, role: "admin" });
    await db.insert(schema.spaces).values([
      { id: hall, venueId, name: "Grand Hall", slug: "grand-hall", widthM: "21", lengthM: "10", heightM: "7", floorPlanOutline: OUTLINE, sortOrder: 0 },
      { id: library, venueId, name: "Library", slug: "library", widthM: "10", lengthM: "8", heightM: "4", floorPlanOutline: OUTLINE, sortOrder: 1 },
    ]);
    const admin: MutationActor = { id: adminId, role: "admin", venueId, platformRole: "none" };
    const headers = { authorization: `Bearer ${JSON.stringify({ id: adminId, email: `${adminId}@room-writers.invalid`, name: "The administrator", role: "admin", venueId, platformRole: "none" })}` };
    return { venueId, adminId, hall, library, admin, headers };
  }

  const ahead = (days: number) => new Date(Date.now() + days * DAY);
  const remove = (venueId: string, room: string, headers: Record<string, string>) =>
    server.inject({ method: "DELETE", url: `/venues/${venueId}/spaces/${room}`, headers });

  async function waitForLockWaits(count: number, except: number): Promise<void> {
    for (let tries = 0; tries < 300; tries += 1) {
      const { rows } = await pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock' AND pid <> $2",
        [APP, except],
      );
      if ((rows[0]?.n ?? 0) >= count) return;
      await new Promise((done) => setTimeout(done, 10));
    }
    throw new Error(`expected ${String(count)} session(s) waiting on a lock`);
  }

  async function pid(client: PoolClient): Promise<number> {
    const { rows } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const found = rows[0]?.pid;
    if (found === undefined) throw new Error("expected a backend pid");
    return found;
  }

  /** The room's delete as the route makes it, held open: the room locked and
   *  marked deleted, not yet committed. The write runs meanwhile; once it is
   *  seen waiting, the delete commits and the write's answer is returned. */
  async function againstDeletingRoom<T>(room: string, write: () => Promise<T>): Promise<T> {
    const deleting = await pool.connect();
    try {
      await deleting.query("BEGIN");
      await deleting.query("SELECT id FROM spaces WHERE id = $1 FOR UPDATE", [room]);
      await deleting.query("UPDATE spaces SET deleted_at = now(), updated_at = now() WHERE id = $1", [room]);
      const pending = write().then((value) => ({ value }), (error: unknown) => ({ error }));
      await waitForLockWaits(1, await pid(deleting));
      await deleting.query("COMMIT");
      const settled = await pending;
      if ("error" in settled) throw settled.error;
      return settled.value;
    } finally {
      await deleting.query("ROLLBACK").catch(() => undefined);
      deleting.release();
    }
  }

  async function roomRows(room: string) {
    const booked = await db.select().from(schema.bookings).where(eq(schema.bookings.spaceId, room));
    const phased = await db.select().from(schema.eventPhases).where(eq(schema.eventPhases.spaceId, room));
    return { booked, phased };
  }

  it("refuses a booking made while its room is being deleted, and writes nothing, its event included", async () => {
    const f = await fixture();
    const starts = ahead(30);
    const made = await againstDeletingRoom(f.hall, () => createBookingCore(db, f.admin, {
      venueId: f.venueId, spaceId: f.hall, kind: "ink", title: "The Smith wedding",
      startsAt: starts.toISOString(), endsAt: new Date(starts.getTime() + 6 * HOUR).toISOString(),
    }));
    expect(made).toMatchObject({ ok: false, status: 400, code: "SPACE_VENUE_MISMATCH" });
    expect(await roomRows(f.hall)).toEqual({ booked: [], phased: [] });
    expect(await db.select().from(schema.events).where(eq(schema.events.venueId, f.venueId))).toEqual([]);
  });

  it("counts a booking that took the room first, so the delete waits for it and refuses", async () => {
    const f = await fixture();
    // The booking pauses after taking the room: its new event waits on the
    // venue row, which the delete never touches.
    const venueHolder = await pool.connect();
    try {
      await venueHolder.query("BEGIN");
      await venueHolder.query("SELECT id FROM venues WHERE id = $1 FOR UPDATE", [f.venueId]);
      const starts = ahead(30);
      const making = createBookingCore(db, f.admin, {
        venueId: f.venueId, spaceId: f.hall, kind: "ink", title: "The Smith wedding",
        startsAt: starts.toISOString(), endsAt: new Date(starts.getTime() + 6 * HOUR).toISOString(),
      });
      const holderPid = await pid(venueHolder);
      await waitForLockWaits(1, holderPid);
      const deleting = remove(f.venueId, f.hall, f.headers);
      await waitForLockWaits(2, holderPid);
      await venueHolder.query("COMMIT");
      expect((await making).ok).toBe(true);
      const refused = await deleting;
      expect(refused.statusCode, refused.body).toBe(409);
      expect((JSON.parse(refused.body) as { details: unknown }).details).toEqual({ bookings: 1, phases: 0 });
    } finally {
      await venueHolder.query("ROLLBACK").catch(() => undefined);
      venueHolder.release();
    }
    const [room] = await db.select().from(schema.spaces).where(eq(schema.spaces.id, f.hall));
    expect(room?.deletedAt).toBeNull();
  });

  it("refuses a booking moved into a room being deleted, or moved in time within it, and leaves it as it was", async () => {
    const f = await fixture();
    const past = new Date(Date.now() - 10 * DAY);
    const [inHall, inLibrary] = await insertBoundBookings(db, [
      { venueId: f.venueId, spaceId: f.hall, kind: "internal_block", title: "Maintenance", createdBy: f.adminId, startsAt: past, endsAt: new Date(past.getTime() + HOUR) },
      { venueId: f.venueId, spaceId: f.library, kind: "internal_block", title: "Deep clean", createdBy: f.adminId, startsAt: ahead(20), endsAt: new Date(ahead(20).getTime() + HOUR) },
    ]);
    if (inHall === undefined || inLibrary === undefined) throw new Error("expected the bookings");
    const future = ahead(20);
    const retimed = await againstDeletingRoom(f.hall, () => updateBookingCore(db, f.admin, inHall.id, {
      startsAt: future.toISOString(), endsAt: new Date(future.getTime() + HOUR).toISOString(),
    }));
    expect(retimed).toMatchObject({ ok: false, status: 409, code: "ROOM_DELETED" });
    const [kept] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, inHall.id));
    expect(kept?.startsAt.getTime()).toBe(past.getTime());

    const g = await fixture();
    const [elsewhere] = await insertBoundBookings(db, [
      { venueId: g.venueId, spaceId: g.library, kind: "internal_block", title: "Deep clean", createdBy: g.adminId, startsAt: ahead(20), endsAt: new Date(ahead(20).getTime() + HOUR) },
    ]);
    if (elsewhere === undefined) throw new Error("expected the booking");
    const moved = await againstDeletingRoom(g.hall, () => updateBookingCore(db, g.admin, elsewhere.id, { spaceId: g.hall }));
    expect(moved).toMatchObject({ ok: false, status: 400, code: "SPACE_VENUE_MISMATCH" });
    const [stayed] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, elsewhere.id));
    expect(stayed?.spaceId).toBe(g.library);
  });

  it("puts nothing still to come into a deleted room by a later edit: no change of times, no booking put back", async () => {
    const f = await fixture();
    const past = new Date(Date.now() - 10 * DAY);
    const [old, called] = await insertBoundBookings(db, [
      { venueId: f.venueId, spaceId: f.hall, kind: "internal_block", title: "Maintenance", createdBy: f.adminId, startsAt: past, endsAt: new Date(past.getTime() + HOUR) },
      { venueId: f.venueId, spaceId: f.hall, kind: "ink", title: "The Jones party", createdBy: f.adminId, startsAt: ahead(40), endsAt: new Date(ahead(40).getTime() + 5 * HOUR) },
    ]);
    if (old === undefined || called === undefined) throw new Error("expected the bookings");
    // The party is called off, so the hall has nothing to come and is deleted.
    expect((await transitionBookingCore(db, f.admin, called.id, { toState: "cancelled" })).ok).toBe(true);
    expect((await remove(f.venueId, f.hall, f.headers)).statusCode).toBe(204);

    const future = ahead(20);
    const retimed = await updateBookingCore(db, f.admin, old.id, {
      startsAt: future.toISOString(), endsAt: new Date(future.getTime() + HOUR).toISOString(),
    });
    expect(retimed).toMatchObject({
      ok: false, status: 409, code: "ROOM_DELETED",
      error: "This booking's room has been deleted. Bring the room back from Admin first, or move the booking to another room.",
    });
    const putBack = await transitionBookingCore(db, f.admin, called.id, { toState: "ink" });
    expect(putBack).toMatchObject({ ok: false, status: 409, code: "ROOM_DELETED" });
    const [still] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, called.id));
    expect(still?.status).toBe("cancelled");

    // A note on a booking there is not a placement, and is kept.
    expect((await updateBookingCore(db, f.admin, old.id, { notes: "Boiler serviced." })).ok).toBe(true);
    // Moved to a live room, it may be put on the Diary again.
    expect((await updateBookingCore(db, f.admin, old.id, {
      spaceId: f.library, startsAt: future.toISOString(), endsAt: new Date(future.getTime() + HOUR).toISOString(),
    })).ok).toBe(true);
  });

  type Fixture = Awaited<ReturnType<typeof fixture>>;
  type Answer = { readonly status: number; readonly code: string };
  const starts = ahead(25);
  const ends = new Date(starts.getTime() + 3 * HOUR);

  async function withEnquiry(f: Fixture): Promise<string> {
    const [row] = await db.insert(schema.enquiries).values({
      venueId: f.venueId, spaceId: f.hall, state: "under_review", name: "Ailsa Henderson",
      email: `${randomUUID()}@room-writers.invalid`, preferredDate: "2027-05-14",
    }).returning({ id: schema.enquiries.id });
    if (row === undefined) throw new Error("expected the enquiry");
    return row.id;
  }

  async function withEvent(f: Fixture): Promise<string> {
    const [row] = await db.insert(schema.events).values({ venueId: f.venueId, name: "Spring fair", createdBy: f.adminId }).returning({ id: schema.events.id });
    if (row === undefined) throw new Error("expected the event");
    return row.id;
  }

  const answered = (res: { statusCode: number; body: string }): Answer =>
    ({ status: res.statusCode, code: (JSON.parse(res.body) as { code?: string }).code ?? "none" });

  // Each prepares its write for a fresh venue, and returns the write itself.
  const WRITES: readonly { readonly name: string; readonly refused: Answer; readonly prepare: (f: Fixture) => Promise<() => Promise<Answer>> }[] = [
    {
      name: "an enquiry's hold",
      refused: { status: 400, code: "SPACE_VENUE_MISMATCH" },
      prepare: async (f) => {
        const enquiryId = await withEnquiry(f);
        return async () => answered(await server.inject({ method: "POST", url: "/bookings/from-enquiry", headers: f.headers, payload: {
          enquiryId, startsAt: starts.toISOString(), endsAt: ends.toISOString(), decisionAt: ahead(5).toISOString(),
          ownerUserId: f.adminId, nextAction: "Call Ailsa back", nextActionDueAt: ahead(2).toISOString(),
        } }));
      },
    },
    {
      name: "a viewing",
      refused: { status: 400, code: "SPACE_VENUE_MISMATCH" },
      prepare: async (f) => {
        const enquiryId = await withEnquiry(f);
        return async () => answered(await server.inject({ method: "POST", url: "/bookings/viewings", headers: f.headers, payload: {
          enquiryId, startsAt: starts.toISOString(), endsAt: new Date(starts.getTime() + HOUR).toISOString(),
        } }));
      },
    },
    {
      name: "a proposed time",
      refused: { status: 400, code: "SPACE_VENUE_MISMATCH" },
      prepare: async (f) => {
        const eventId = await withEvent(f);
        return async () => {
          const res = await proposeWindowCore(db, { id: f.adminId, name: "The administrator", role: "admin", venueId: f.venueId, platformRole: "none" }, eventId, {
            spaceId: f.hall, startsAt: starts.toISOString(), endsAt: ends.toISOString(), idempotencyKey: randomUUID(),
          });
          return { status: res.status, code: res.ok ? "none" : res.code };
        };
      },
    },
    {
      name: "a new event phase",
      refused: { status: 422, code: "EVENT_PHASE_SPACE_MISMATCH" },
      prepare: async (f) => {
        const eventId = await withEvent(f);
        return async () => answered(await server.inject({ method: "POST", url: `/events/${eventId}/phases`, headers: f.headers, payload: {
          name: "Drinks reception", spaceId: f.hall, startsAt: starts.toISOString(), durationMinutes: 60,
        } }));
      },
    },
    {
      name: "an event phase moved into the room",
      refused: { status: 422, code: "EVENT_PHASE_SPACE_MISMATCH" },
      prepare: async (f) => {
        const eventId = await withEvent(f);
        const [phase] = await db.insert(schema.eventPhases).values({
          eventId, spaceId: null, name: "Drinks reception", sortOrder: 0, startsAt: starts, durationMinutes: 60,
        }).returning({ id: schema.eventPhases.id });
        if (phase === undefined) throw new Error("expected the phase");
        return async () => answered(await server.inject({ method: "PATCH", url: `/event-phases/${phase.id}`, headers: f.headers, payload: { spaceId: f.hall } }));
      },
    },
  ];

  it.each(WRITES)("refuses $name meant for a room being deleted, and writes nothing there", async ({ refused, prepare }) => {
    const f = await fixture();
    const write = await prepare(f);
    expect(await againstDeletingRoom(f.hall, write)).toEqual(refused);
    expect(await roomRows(f.hall)).toEqual({ booked: [], phased: [] });
  });

  it("lets a phase of an event that has ended free the room: the Diary shows nothing there to move", async () => {
    const f = await fixture();
    const starts = ahead(40);
    const [hold] = await insertBoundBookings(db, [{
      venueId: f.venueId, spaceId: f.hall, kind: "hold", title: "The Jones party", createdBy: f.adminId,
      startsAt: starts, endsAt: new Date(starts.getTime() + 5 * HOUR),
      decisionAt: ahead(7), ownerUserId: f.adminId, nextAction: "Call back", nextActionDueAt: ahead(1),
    }]);
    if (hold?.eventId === null || hold?.eventId === undefined) throw new Error("expected the hold's event");
    const [phase] = await db.select().from(schema.eventPhases).where(eq(schema.eventPhases.eventId, hold.eventId)).limit(1);
    await db.update(schema.eventPhases).set({ spaceId: f.hall, startsAt: starts, durationMinutes: 60 }).where(eq(schema.eventPhases.id, phase?.id ?? ""));
    // While the event is to come, its phase holds the hall.
    const held = await remove(f.venueId, f.hall, f.headers);
    expect(held.statusCode).toBe(409);
    expect((JSON.parse(held.body) as { details: unknown }).details).toEqual({ bookings: 1, phases: 1 });

    // The client says no: the hold is released, and its event is lost.
    expect((await transitionBookingCore(db, f.admin, hold.id, { toState: "released" })).ok).toBe(true);
    const [event] = await db.select().from(schema.events).where(eq(schema.events.id, hold.eventId));
    expect(event?.status).toBe("lost");
    expect((await remove(f.venueId, f.hall, f.headers)).statusCode).toBe(204);
  });
});
