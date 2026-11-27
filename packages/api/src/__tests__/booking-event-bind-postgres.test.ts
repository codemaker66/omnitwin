import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BookingSchema,
  CalendarResponseSchema,
  CreateBookingSchema,
  EVENT_STATUSES,
  deriveEventStatus,
  summariseEventBookings,
  type Booking,
  type BookingKind,
  type BookingLiveness,
  type EventStatus,
  type PlatformRole,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { bookingRoutes } from "../routes/bookings.js";
import { calendarRoutes } from "../routes/calendar.js";
import {
  createBookingCore,
  transitionBookingCore,
  updateBookingCore,
  type MutationActor,
} from "../services/booking-mutations.js";
import { BookingBindError, insertBoundBookings, readBindInvariant } from "../services/event-binding.js";
import { updateEventCore } from "../services/event-mutations.js";
import { resolveTiming } from "../services/hallkeeper-sheet-v2-data.js";

// ---------------------------------------------------------------------------
// The bind (event-spine Phase A, migration 0090) on migrated PostgreSQL.
//
// Every provisional option (hold) and confirmed booking (ink) belongs to an
// event from the moment it is written, and the event's status follows its
// bookings. This file proves that against the real database, through the
// real writers:
//   - the database rule itself: the bookings_bound_to_event CHECK and the
//     RESTRICT foreign keys;
//   - every write path: the Enquiries desk's conversion (POST
//     /bookings/from-enquiry), the Diary's create, edit and transitions, and
//     the direct writer the seed, the importer and fixtures share;
//   - two holds pencilled from one enquiry at the same moment share one
//     event, and racing releases and confirmations leave the right status;
//   - a released competing option leaves no live draft event behind, and its
//     planned phases leave the room on the Diary's calendar;
//   - the proving moment: the time a coordinator sets on the Diary is the
//     time the hallkeeper's sheet reads;
//   - migration 0090 itself, run by the real migrator over a database
//     written before it, in its own disposable database: the backfill, the
//     review list, the derived statuses (checked against deriveEventStatus
//     in @omnitwin/types), the constraints, and a replay that changes nothing.
//
// The platform database is shared with the other platform files and never
// truncated, so every test makes its own venue. The read-only invariant is
// readBindInvariant (services/event-binding.ts), the query an operator runs
// once against production.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("The bind's tests require the explicit disposable platform database");
  }
}

const MIGRATIONS = resolve(import.meta.dirname, "../../drizzle");
const OUTLINE = [{ x: -10, y: -5 }, { x: 10, y: -5 }, { x: 10, y: 5 }, { x: -10, y: 5 }];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Saturday 14 June 2031, midnight UTC: far from any other fixture's dates. */
const SATURDAY = Date.parse("2031-06-14T00:00:00.000Z");

/** An instant on the test Saturday (UTC; Glasgow is an hour ahead in June). */
function at(hhmm: string, dayOffset = 0): string {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return new Date(SATURDAY + dayOffset * DAY + (hours ?? 0) * HOUR + (minutes ?? 0) * 60_000).toISOString();
}

interface Actor extends MutationActor { readonly platformRole: PlatformRole }

function bearer(actor: Actor): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify({ ...actor, email: `${actor.id}@event-bind.invalid` })}` };
}

/** The hold quartet every option carries (roadmap N3). */
function hygiene(ownerUserId: string) {
  return {
    decisionAt: at("10:00", -45),
    ownerUserId,
    nextAction: "Call the couple about the date.",
    nextActionDueAt: at("10:00", -52),
  };
}

describe.skipIf(target === undefined)("the bind: every hold and ink belongs to its event", () => {
  const applicationName = `event_bind_${randomUUID()}`;
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: applicationName, max: 8,
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

  async function venue(label: string) {
    const venueId = randomUUID();
    await db.insert(schema.venues).values({
      id: venueId, name: `TEST ONLY ${label}`, slug: `event-bind-${venueId}`, address: "Disposable fixture",
    });
    const rooms = { hall: randomUUID(), saloon: randomUUID(), reception: randomUUID() };
    await db.insert(schema.spaces).values([
      { id: rooms.hall, name: "Grand Hall" },
      { id: rooms.saloon, name: "Saloon" },
      { id: rooms.reception, name: "Reception Room" },
    ].map((room, index) => ({
      id: room.id, venueId, name: room.name, slug: `room-${room.id}`, widthM: "20", lengthM: "10", heightM: "6",
      floorPlanOutline: OUTLINE, sortOrder: index,
    })));
    const adminId = randomUUID();
    await db.insert(schema.users).values({
      id: adminId, email: `${adminId}@event-bind.invalid`, name: "Fixture coordinator", role: "admin", venueId,
    });
    const admin: Actor = { id: adminId, role: "admin", venueId, platformRole: "none" };
    const enquiry = async (name: string): Promise<string> => {
      const [row] = await db.insert(schema.enquiries).values({
        venueId, spaceId: rooms.hall, state: "under_review", name,
        email: `${randomUUID()}@event-bind.invalid`, preferredDate: "2031-06-14",
      }).returning({ id: schema.enquiries.id });
      if (row === undefined) throw new Error("Enquiry fixture missing");
      return row.id;
    };
    return { venueId, rooms, admin, enquiry };
  }

  async function holdFromEnquiry(actor: Actor, body: Record<string, unknown>): Promise<Booking> {
    const response = await server.inject({ method: "POST", url: "/bookings/from-enquiry", headers: bearer(actor), payload: body });
    expect(response.statusCode, response.body).toBe(201);
    return BookingSchema.parse(response.json<{ data: unknown }>().data);
  }

  async function eventRow(id: string | null) {
    if (id === null) throw new Error("The booking has no event");
    const [row] = await db.select().from(schema.events).where(eq(schema.events.id, id));
    if (row === undefined) throw new Error("Missing event");
    return row;
  }

  async function venueEvents(venueId: string) {
    return db.select().from(schema.events).where(eq(schema.events.venueId, venueId)).orderBy(asc(schema.events.createdAt));
  }

  async function venueBookingCount(venueId: string): Promise<number> {
    return (await db.select({ id: schema.bookings.id }).from(schema.bookings).where(eq(schema.bookings.venueId, venueId))).length;
  }

  async function blocked(count: number): Promise<void> {
    await expect.poll(async () => Number((await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
      [applicationName],
    )).rows[0]?.count), { timeout: 10_000 }).toBe(count);
  }

  /** Hold one row locked in another transaction while `run` starts work that
   *  must wait for it; `run` commits to let that work through. FOR UPDATE
   *  also stops a booking's foreign-key check (FOR KEY SHARE) on the row;
   *  FOR NO KEY UPDATE lets that check through and stops only the writers'
   *  own event lock, so their bookings are written before either locks. */
  async function withLockedRow(
    table: "enquiries" | "events",
    id: string,
    run: (client: PoolClient) => Promise<void>,
    mode: "UPDATE" | "NO KEY UPDATE" = "UPDATE",
  ): Promise<void> {
    const client = await pool.connect();
    await client.query("BEGIN");
    try {
      await client.query(`SELECT id FROM ${table} WHERE id = $1 FOR ${mode}`, [id]);
      await run(client);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const officeActor = (actor: Actor) => ({ ...actor, email: `${actor.id}@event-bind.invalid` });

  it("refuses a provisional or confirmed booking with no event, and lets interest and house blocks stand alone", async () => {
    const v = await venue("the rule");
    for (const kind of ["hold", "ink"] as const) {
      await expect(pool.query(
        "INSERT INTO bookings (venue_id, space_id, kind, title, starts_at, ends_at) VALUES ($1, $2, $3, 'No event', $4, $5)",
        [v.venueId, v.rooms.hall, kind, at("18:00"), at("22:00")],
      )).rejects.toMatchObject({ code: "23514", constraint: "bookings_bound_to_event" });
    }
    for (const kind of ["prospect", "internal_block"] as const) {
      await pool.query(
        "INSERT INTO bookings (venue_id, space_id, kind, title, starts_at, ends_at) VALUES ($1, $2, $3, 'Stands alone', $4, $5)",
        [v.venueId, v.rooms.saloon, kind, at("09:00"), at("10:00")],
      );
    }
    expect(await readBindInvariant(db, v.venueId)).toEqual({ unboundBookings: 0, contradictingEvents: 0 });
    // Across the whole shared database, not only this venue: the CHECK holds.
    expect((await readBindInvariant(db)).unboundBookings).toBe(0);
  });

  it("will not let an event row be removed out from under its bookings", async () => {
    const v = await venue("restrict");
    const [held] = await insertBoundBookings(db, [{
      venueId: v.venueId, spaceId: v.rooms.hall, kind: "ink", title: "Chamber dinner", createdBy: v.admin.id,
      startsAt: new Date(at("18:00")), endsAt: new Date(at("23:00")),
    }]);
    if (held === undefined || held.eventId === null) throw new Error("The direct writer did not bind the booking");
    await expect(pool.query("DELETE FROM events WHERE id = $1", [held.eventId]))
      .rejects.toMatchObject({ code: "23503" });
    expect((await eventRow(held.eventId)).deletedAt).toBeNull();
    const [still] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, held.id));
    expect(still?.eventId).toBe(held.eventId);
    const constraints = await pool.query<{ conname: string; confdeltype: string }>(
      `SELECT conname, confdeltype FROM pg_constraint
       WHERE conrelid = 'bookings'::regclass AND contype = 'f' AND confrelid = 'events'::regclass ORDER BY conname`,
    );
    expect(constraints.rows).toEqual([
      { conname: "bookings_event_id_fkey", confdeltype: "r" },
      { conname: "bookings_event_venue_fk", confdeltype: "r" },
    ]);
  });

  it("binds a direct batch as the API would: one enquiry's rows share one event, and a wrong venue refuses the whole batch", async () => {
    const v = await venue("direct batch");
    const other = await venue("direct batch elsewhere");
    const enquiryId = await v.enquiry("Baird");
    const rows = await insertBoundBookings(db, [
      { venueId: v.venueId, spaceId: v.rooms.saloon, kind: "hold", title: "Baird ceremony", enquiryId, createdBy: v.admin.id,
        startsAt: new Date(at("13:00")), endsAt: new Date(at("15:00")), fixtureSource: "seed-diary" },
      { venueId: v.venueId, spaceId: v.rooms.hall, kind: "ink", title: "Baird dinner", enquiryId, createdBy: v.admin.id,
        startsAt: new Date(at("17:00")), endsAt: new Date(at("23:00")), fixtureSource: "seed-diary" },
      { venueId: v.venueId, spaceId: v.rooms.reception, kind: "prospect", title: "Interest only", createdBy: v.admin.id,
        startsAt: new Date(at("09:00")), endsAt: new Date(at("10:00")) },
    ]);
    expect(rows.map((row) => row.title)).toEqual(["Baird ceremony", "Baird dinner", "Interest only"]);
    expect(rows[1]?.eventId).toBe(rows[0]?.eventId);
    expect(rows[2]?.eventId).toBeNull();
    expect(await eventRow(rows[0]?.eventId ?? null)).toMatchObject({
      venueId: v.venueId, name: "Baird ceremony", status: "confirmed", fixtureSource: "seed-diary",
    });

    const [elsewhere] = await insertBoundBookings(db, [{
      venueId: other.venueId, spaceId: other.rooms.hall, kind: "ink", title: "Elsewhere", createdBy: other.admin.id,
      startsAt: new Date(at("18:00")), endsAt: new Date(at("23:00")),
    }]);
    const eventsBefore = (await venueEvents(v.venueId)).length;
    const bookingsBefore = await venueBookingCount(v.venueId);
    await expect(insertBoundBookings(db, [
      { venueId: v.venueId, spaceId: v.rooms.hall, kind: "hold", title: "Would be first", createdBy: v.admin.id,
        startsAt: new Date(at("10:00", 3)), endsAt: new Date(at("12:00", 3)) },
      { venueId: v.venueId, spaceId: v.rooms.hall, kind: "ink", title: "Names another venue's event", eventId: elsewhere?.eventId ?? null,
        createdBy: v.admin.id, startsAt: new Date(at("18:00", 3)), endsAt: new Date(at("23:00", 3)) },
    ])).rejects.toThrow(BookingBindError);
    expect(await venueEvents(v.venueId)).toHaveLength(eventsBefore);
    expect(await venueBookingCount(v.venueId)).toBe(bookingsBefore);
  });

  it("writes an enquiry's first hold with its event, and the second room of the same wedding joins that event", async () => {
    const v = await venue("multi-room");
    const enquiryId = await v.enquiry("Gordon & Hay");
    const ceremony = await holdFromEnquiry(v.admin, {
      enquiryId, spaceId: v.rooms.saloon, title: "Gordon–Hay wedding ceremony", eventType: "wedding",
      startsAt: at("13:00"), endsAt: at("15:00"), rank: 1, ...hygiene(v.admin.id),
    });
    const event = await eventRow(ceremony.eventId);
    expect(event).toMatchObject({
      venueId: v.venueId, name: "Gordon–Hay wedding ceremony", eventType: "wedding", status: "draft",
      clientName: "Gordon & Hay", guestCount: 0, createdBy: v.admin.id, deletedAt: null, fixtureSource: null,
      startsAt: new Date(at("13:00")), endsAt: new Date(at("15:00")),
    });
    // The house's default phases, as POST /events gives a new event: no room,
    // no time, nothing checked yet.
    const phases = await db.select().from(schema.eventPhases).where(eq(schema.eventPhases.eventId, event.id))
      .orderBy(asc(schema.eventPhases.sortOrder));
    expect(phases.map((phase) => phase.name)).toEqual([
      "Arrival", "Ceremony", "Room Flip", "Dinner", "Speeches", "Bar Queue", "Dancing", "Breakdown",
    ]);
    expect(phases.every((phase) => phase.spaceId === null && phase.startsAt === null && phase.densityStatus === "not_checked")).toBe(true);

    const dinner = await holdFromEnquiry(v.admin, {
      enquiryId, spaceId: v.rooms.hall, title: "Gordon–Hay wedding dinner",
      startsAt: at("17:00"), endsAt: at("23:30"), rank: 1, ...hygiene(v.admin.id),
    });
    expect(dinner.eventId).toBe(ceremony.eventId);
    expect(await venueEvents(v.venueId)).toHaveLength(1);
    expect(await readBindInvariant(db, v.venueId)).toEqual({ unboundBookings: 0, contradictingEvents: 0 });
  });

  it("gives two holds pencilled at the same moment from one enquiry one event, never two", async () => {
    const v = await venue("same moment");
    const enquiryId = await v.enquiry("Lennox");
    await withLockedRow("enquiries", enquiryId, async (client) => {
      const both = Promise.all([
        holdFromEnquiry(v.admin, { enquiryId, spaceId: v.rooms.saloon, startsAt: at("12:00"), endsAt: at("15:00"), ...hygiene(v.admin.id) }),
        holdFromEnquiry(v.admin, { enquiryId, spaceId: v.rooms.hall, startsAt: at("17:00"), endsAt: at("23:00"), ...hygiene(v.admin.id) }),
      ]);
      // Both conversions wait on the enquiry, inside their own transactions.
      await blocked(2);
      await client.query("COMMIT");
      const [first, second] = await both;
      expect(first.eventId).not.toBeNull();
      expect(second.eventId).toBe(first.eventId);
    });
    expect(await venueEvents(v.venueId)).toHaveLength(1);
  });

  it("refuses a hold from another venue's enquiry and writes no event", async () => {
    const v = await venue("enquiry venue");
    const other = await venue("enquiry elsewhere");
    const foreignEnquiry = await other.enquiry("Elsewhere");
    const response = await server.inject({
      method: "POST", url: "/bookings/from-enquiry", headers: bearer(v.admin),
      payload: { enquiryId: foreignEnquiry, spaceId: v.rooms.hall, startsAt: at("18:00"), endsAt: at("22:00"), ...hygiene(v.admin.id) },
    });
    expect(response.statusCode).toBe(403);
    expect(await venueEvents(v.venueId)).toHaveLength(0);
    expect(await venueEvents(other.venueId)).toHaveLength(0);
  });

  it("binds every Diary write, refuses another venue's event, and leaves no event behind when a write fails", async () => {
    const v = await venue("diary");
    const other = await venue("diary elsewhere");
    const made = await createBookingCore(db, v.admin, CreateBookingSchema.parse({
      venueId: v.venueId, spaceId: v.rooms.hall, kind: "ink", title: "Merchants' dinner", eventType: "dinner",
      startsAt: at("18:00"), endsAt: at("23:00"),
    }));
    if (!made.ok) throw new Error(`Create refused: ${made.code}`);
    const confirmed = await eventRow(made.booking.eventId);
    expect(confirmed).toMatchObject({ venueId: v.venueId, name: "Merchants' dinner", status: "confirmed" });

    const [elsewhere] = await insertBoundBookings(db, [{
      venueId: other.venueId, spaceId: other.rooms.hall, kind: "ink", title: "Not this venue's", createdBy: other.admin.id,
      startsAt: new Date(at("18:00")), endsAt: new Date(at("23:00")),
    }]);
    if (elsewhere === undefined || elsewhere.eventId === null) throw new Error("Fixture not bound");
    const eventsBefore = (await venueEvents(v.venueId)).length;
    const bookingsBefore = await venueBookingCount(v.venueId);

    expect(await createBookingCore(db, v.admin, CreateBookingSchema.parse({
      venueId: v.venueId, spaceId: v.rooms.saloon, kind: "hold", title: "Wrong event", eventId: elsewhere.eventId,
      startsAt: at("18:00"), endsAt: at("23:00"), ...hygiene(v.admin.id),
    }))).toMatchObject({ ok: false, status: 400, code: "EVENT_VENUE_MISMATCH" });
    // The slot is taken: the refusal takes the event made for it with it.
    expect(await createBookingCore(db, v.admin, CreateBookingSchema.parse({
      venueId: v.venueId, spaceId: v.rooms.hall, kind: "ink", title: "Clash", startsAt: at("20:00"), endsAt: at("23:30"),
    }))).toMatchObject({ ok: false, status: 409, code: "INK_SLOT_TAKEN" });
    expect(await venueEvents(v.venueId)).toHaveLength(eventsBefore);
    expect(await venueBookingCount(v.venueId)).toBe(bookingsBefore);

    // A confirmed booking may move to another event of its venue, never to none.
    expect(await updateBookingCore(db, v.admin, made.booking.id, { eventId: null }))
      .toMatchObject({ ok: false, status: 400, code: "EVENT_REQUIRED" });
    expect(await updateBookingCore(db, v.admin, made.booking.id, { eventId: elsewhere.eventId }))
      .toMatchObject({ ok: false, status: 400, code: "EVENT_VENUE_MISMATCH" });

    // Interest only stands alone until it is held, then takes its event in
    // the same transition.
    const interest = await createBookingCore(db, v.admin, CreateBookingSchema.parse({
      venueId: v.venueId, spaceId: v.rooms.reception, kind: "prospect", title: "Burns supper enquiry",
      startsAt: at("18:00", 7), endsAt: at("23:00", 7),
    }));
    if (!interest.ok) throw new Error(`Create refused: ${interest.code}`);
    expect(interest.booking.eventId).toBeNull();
    const held = await transitionBookingCore(db, v.admin, interest.booking.id, { toState: "hold", hold: { rank: 1, ...hygiene(v.admin.id) } });
    if (!held.ok) throw new Error(`Transition refused: ${held.code}`);
    const burns = await eventRow(held.booking.eventId);
    expect(burns).toMatchObject({ venueId: v.venueId, name: "Burns supper enquiry", status: "draft" });

    // Moved to another event of its venue: both events follow their bookings.
    expect(await updateBookingCore(db, v.admin, held.booking.id, { eventId: confirmed.id })).toMatchObject({ ok: true });
    expect((await eventRow(confirmed.id)).status).toBe("confirmed");
    expect((await eventRow(burns.id)).status).toBe("draft");
    expect(await readBindInvariant(db, v.venueId)).toEqual({ unboundBookings: 0, contradictingEvents: 0 });
  });

  it("closes a released competing option's event as lost, takes its plan off the room, and confirms the date that was inked", async () => {
    const v = await venue("ladder");
    const macleod = await holdFromEnquiry(v.admin, {
      enquiryId: await v.enquiry("MacLeod"), spaceId: v.rooms.hall, title: "MacLeod wedding",
      startsAt: at("12:00"), endsAt: at("23:30"), rank: 1, ...hygiene(v.admin.id),
    });
    const fraser = await holdFromEnquiry(v.admin, {
      enquiryId: await v.enquiry("Fraser"), spaceId: v.rooms.hall, title: "Fraser wedding",
      startsAt: at("12:00"), endsAt: at("23:30"), rank: 2, ...hygiene(v.admin.id),
    });
    expect(fraser.eventId).not.toBe(macleod.eventId);
    // Both couples' dinners were planned into the Grand Hall.
    for (const booking of [macleod, fraser]) {
      await pool.query(
        "UPDATE event_phases SET space_id = $1, starts_at = $2 WHERE event_id = $3 AND template_key = 'dinner'",
        [v.rooms.hall, at("18:00"), booking.eventId],
      );
    }
    const phaseEvents = async (): Promise<(string | null)[]> => {
      const response: LightMyRequestResponse = await server.inject({
        method: "GET", headers: bearer(v.admin),
        url: `/calendar?venueId=${v.venueId}&from=${encodeURIComponent(at("00:00"))}&to=${encodeURIComponent(at("00:00", 1))}`,
      });
      expect(response.statusCode, response.body).toBe(200);
      const calendar = CalendarResponseSchema.parse(response.json<{ data: unknown }>().data);
      return calendar.entries.flatMap((entry) => entry.entryType === "phase" ? [entry.eventId] : []).sort();
    };
    expect(await phaseEvents()).toEqual([macleod.eventId, fraser.eventId].sort());

    const released = await transitionBookingCore(db, v.admin, fraser.id, { toState: "released", note: "The couple chose another venue." });
    expect(released).toMatchObject({ ok: true });
    expect((await eventRow(fraser.eventId)).status).toBe("lost");
    // The lost wedding's dinner no longer paints or conflicts in the Grand Hall.
    expect(await phaseEvents()).toEqual([macleod.eventId]);

    const inked = await transitionBookingCore(db, v.admin, macleod.id, { toState: "ink" });
    expect(inked).toMatchObject({ ok: true });
    expect((await eventRow(macleod.eventId)).status).toBe("confirmed");

    // No live draft event: nothing in the pipeline without a live booking.
    const dead = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM events e
       WHERE e.venue_id = $1 AND e.deleted_at IS NULL AND e.status IN ('draft', 'proposed')
         AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.event_id = e.id AND b.status = 'active' AND b.deleted_at IS NULL)`,
      [v.venueId],
    );
    expect(dead.rows[0]?.count).toBe("0");
    expect(await readBindInvariant(db, v.venueId)).toEqual({ unboundBookings: 0, contradictingEvents: 0 });
  });

  it.each([
    { label: "a release racing a confirmation", second: "ink", expected: "confirmed" },
    { label: "two options released at once", second: "released", expected: "lost" },
  ] as const)("$label leaves the event $expected", async ({ second, expected }) => {
    const v = await venue(`race ${expected}`);
    const enquiryId = await v.enquiry("Mair");
    const saloon = await holdFromEnquiry(v.admin, { enquiryId, spaceId: v.rooms.saloon, startsAt: at("12:00"), endsAt: at("15:00"), ...hygiene(v.admin.id) });
    const hall = await holdFromEnquiry(v.admin, { enquiryId, spaceId: v.rooms.hall, startsAt: at("17:00"), endsAt: at("23:00"), ...hygiene(v.admin.id) });
    expect(hall.eventId).toBe(saloon.eventId);
    const eventId = saloon.eventId;
    if (eventId === null) throw new Error("Unbound fixture");
    await withLockedRow("events", eventId, async (client) => {
      const both = Promise.all([
        transitionBookingCore(db, v.admin, saloon.id, { toState: "released" }),
        transitionBookingCore(db, v.admin, hall.id, { toState: second }),
      ]);
      // Each has written its booking and waits for the event, so neither
      // could see the other's change when it began.
      await blocked(2);
      await client.query("COMMIT");
      expect((await both).map((result) => result.ok)).toEqual([true, true]);
    });
    expect((await eventRow(eventId)).status).toBe(expected);
    expect(await readBindInvariant(db, v.venueId)).toEqual({ unboundBookings: 0, contradictingEvents: 0 });
  });

  it("lets two coordinators add rooms to one event at the same moment, and neither write fails", async () => {
    const v = await venue("two writers, one event");
    const dinner = await createBookingCore(db, v.admin, CreateBookingSchema.parse({
      venueId: v.venueId, spaceId: v.rooms.hall, kind: "ink", title: "Incorporation dinner",
      startsAt: at("18:00"), endsAt: at("23:00"),
    }));
    if (!dinner.ok || dinner.booking.eventId === null) throw new Error("Fixture not bound");
    const eventId = dinner.booking.eventId;
    await withLockedRow("events", eventId, async (client) => {
      const both = Promise.all([
        createBookingCore(db, v.admin, CreateBookingSchema.parse({
          venueId: v.venueId, spaceId: v.rooms.saloon, kind: "hold", title: "Incorporation drinks", eventId,
          startsAt: at("17:00"), endsAt: at("18:00"), rank: 1, ...hygiene(v.admin.id),
        })),
        createBookingCore(db, v.admin, CreateBookingSchema.parse({
          venueId: v.venueId, spaceId: v.rooms.reception, kind: "ink", title: "Incorporation cloakroom", eventId,
          startsAt: at("17:00"), endsAt: at("23:30"),
        })),
      ]);
      // Both bookings are written and both writers wait for the event.
      await blocked(2);
      await client.query("COMMIT");
      expect((await both).map((result) => result.ok)).toEqual([true, true]);
    }, "NO KEY UPDATE");
    expect((await db.select().from(schema.bookings).where(eq(schema.bookings.eventId, eventId)))).toHaveLength(3);
    expect((await eventRow(eventId)).status).toBe("confirmed");
    expect(await readBindInvariant(db, v.venueId)).toEqual({ unboundBookings: 0, contradictingEvents: 0 });
  });

  it("moves two bookings between two events in opposite directions at once, and both events follow", async () => {
    const v = await venue("crossed moves");
    const option = async (title: string, spaceId: string): Promise<{ id: string; eventId: string }> => {
      const made = await createBookingCore(db, v.admin, CreateBookingSchema.parse({
        venueId: v.venueId, spaceId, kind: "hold", title, startsAt: at("18:00", 30), endsAt: at("22:00", 30),
        rank: 1, ...hygiene(v.admin.id),
      }));
      if (!made.ok || made.booking.eventId === null) throw new Error("Fixture not bound");
      return { id: made.booking.id, eventId: made.booking.eventId };
    };
    const bell = await option("Bell dinner", v.rooms.hall);
    const moir = await option("Moir dinner", v.rooms.saloon);
    // Both syncs lock the lower event id first; hold it so both moves are
    // written before either sync runs.
    const [first] = [bell.eventId, moir.eventId].sort();
    if (first === undefined) throw new Error("No events");
    await withLockedRow("events", first, async (client) => {
      const both = Promise.all([
        updateBookingCore(db, v.admin, bell.id, { eventId: moir.eventId }),
        updateBookingCore(db, v.admin, moir.id, { eventId: bell.eventId }),
      ]);
      await blocked(2);
      await client.query("COMMIT");
      expect((await both).map((result) => result.ok)).toEqual([true, true]);
    }, "NO KEY UPDATE");
    const [bellNow] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, bell.id));
    const [moirNow] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, moir.id));
    expect([bellNow?.eventId, moirNow?.eventId]).toEqual([moir.eventId, bell.eventId]);
    expect((await eventRow(bell.eventId)).status).toBe("draft");
    expect((await eventRow(moir.eventId)).status).toBe("draft");
    expect(await readBindInvariant(db, v.venueId)).toEqual({ unboundBookings: 0, contradictingEvents: 0 });
  });

  it("refuses an event status the Diary would contradict, and keeps a step the Diary allows", async () => {
    const v = await venue("event status");
    const hold = await holdFromEnquiry(v.admin, {
      enquiryId: await v.enquiry("Kerr"), spaceId: v.rooms.hall, startsAt: at("18:00"), endsAt: at("23:00"), ...hygiene(v.admin.id),
    });
    const event = await eventRow(hold.eventId);
    expect(await updateEventCore(db, officeActor(v.admin), event.id, { status: "confirmed" }))
      .toMatchObject({ ok: false, status: 409, code: "EVENT_STATUS_FOLLOWS_DIARY" });
    expect((await eventRow(event.id)).status).toBe("draft");
    expect(await updateEventCore(db, officeActor(v.admin), event.id, { status: "proposed" })).toMatchObject({ ok: true });
    expect((await eventRow(event.id)).status).toBe("proposed");
    expect(await transitionBookingCore(db, v.admin, hold.id, { toState: "ink" })).toMatchObject({ ok: true });
    expect((await eventRow(event.id)).status).toBe("confirmed");
  });

  it("prints the time the coordinator set on the Diary on the hallkeeper's sheet", async () => {
    const v = await venue("one time");
    const hold = await holdFromEnquiry(v.admin, {
      enquiryId: await v.enquiry("Robertson"), spaceId: v.rooms.hall, title: "Robertson wedding",
      startsAt: at("17:00"), endsAt: at("23:30"), ...hygiene(v.admin.id),
    });
    const eventId = hold.eventId;
    if (eventId === null) throw new Error("Unbound hold");
    // The plan the drawer opens is this event's: a layout for the Grand Hall.
    const configurationId = randomUUID(), variantId = randomUUID();
    await db.insert(schema.configurations).values({
      id: configurationId, venueId: v.venueId, spaceId: v.rooms.hall, userId: v.admin.id,
      name: "Robertson dinner", layoutStyle: "custom", slug: `plan-${configurationId}`,
    });
    await db.insert(schema.layoutVariants).values({ id: variantId, eventId, configurationId, name: "Dinner" });
    await db.insert(schema.eventConfigurationLinks).values({
      eventId, configurationId, layoutVariantId: variantId, linkType: "variant_configuration",
    });
    // The coordinator sets the load-in once, on the Diary, then confirms.
    expect(await updateBookingCore(db, v.admin, hold.id, { startsAt: at("15:30") })).toMatchObject({ ok: true });
    expect(await transitionBookingCore(db, v.admin, hold.id, { toState: "ink" })).toMatchObject({ ok: true });
    const config = { id: configurationId, spaceId: v.rooms.hall, venueId: v.venueId };
    expect((await resolveTiming(db, config, eventId))?.eventStart).toBe(at("15:30"));
    // Opened without the event in hand, the sheet finds the same booking.
    expect((await resolveTiming(db, config))?.eventStart).toBe(at("15:30"));
  });

  // -------------------------------------------------------------------------
  // Migration 0090 over a database written before it.
  // -------------------------------------------------------------------------

  const JournalSchema = z.object({ entries: z.array(z.object({ tag: z.string() }).passthrough()) }).passthrough();

  /** The migrations folder as it stood before 0090: every file up to and
   *  including `lastTag`, and a journal that ends there. */
  async function migrationsThrough(lastTag: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "venviewer-bind-0090-"));
    await mkdir(join(directory, "meta"));
    const journal = JournalSchema.parse(JSON.parse(await readFile(join(MIGRATIONS, "meta/_journal.json"), "utf8")));
    const last = journal.entries.findIndex((entry) => entry.tag === lastTag);
    if (last < 0) throw new Error(`No migration ${lastTag}`);
    const kept = journal.entries.slice(0, last + 1);
    for (const entry of kept) await copyFile(join(MIGRATIONS, `${entry.tag}.sql`), join(directory, `${entry.tag}.sql`));
    await writeFile(join(directory, "meta/_journal.json"), JSON.stringify({ ...journal, entries: kept }));
    return directory;
  }

  interface LegacyBooking {
    readonly kind: BookingKind;
    readonly title: string;
    readonly status?: BookingLiveness;
    readonly eventId?: string;
    readonly enquiryId?: string;
    readonly spaceId?: string;
    readonly startsAt?: string;
    readonly endsAt?: string;
    readonly deletedAt?: string;
    readonly fixture?: string;
    readonly createdAt?: string;
  }

  interface MixRow { readonly kind: BookingKind; readonly status?: BookingLiveness; readonly deleted?: boolean }

  it("binds every booking written before it, lists what needs a person, derives every status, and changes nothing when run again", async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    const name = `venviewer_bind_0090_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const legacyUrl = new URL(target);
    legacyUrl.pathname = `/${name}`;
    const before0090 = await migrationsThrough("0089_pricing_rule_windows");
    await pool.query(`CREATE DATABASE "${name}"`);
    const legacy = new Pool({ connectionString: legacyUrl.toString(), max: 2, application_name: `${applicationName}_0090` });
    try {
      await migrate(drizzle(legacy), { migrationsFolder: before0090 });
      const q = async (text: string, values: unknown[] = []) => legacy.query(text, values);
      const one = async (text: string, values: unknown[] = []): Promise<Record<string, unknown>> => {
        const row = (await q(text, values)).rows[0] as Record<string, unknown> | undefined;
        if (row === undefined) throw new Error(`No row for ${text}`);
        return row;
      };

      const venueId = randomUUID(), userId = randomUUID();
      const hall = randomUUID(), saloon = randomUUID(), reception = randomUUID();
      await q("INSERT INTO venues (id, name, slug, address) VALUES ($1, 'Legacy Hall', 'legacy-hall', '1 Test Street')", [venueId]);
      for (const [id, room, order] of [[hall, "Grand Hall", 0], [saloon, "Saloon", 1], [reception, "Reception Room", 2]] as const) {
        await q(`INSERT INTO spaces (id, venue_id, name, slug, width_m, length_m, height_m, floor_plan_outline, sort_order)
          VALUES ($1, $2, $3, $4, 20, 10, 6, '[]'::jsonb, $5)`, [id, venueId, room, `room-${id}`, order]);
      }
      await q("INSERT INTO users (id, email, name, role, venue_id) VALUES ($1, 'office@legacy.invalid', 'Legacy office', 'admin', $2)", [userId, venueId]);
      const enquiry = async (label: string): Promise<string> => {
        const id = randomUUID();
        await q("INSERT INTO enquiries (id, venue_id, space_id, state, name, email) VALUES ($1, $2, $3, 'under_review', $4, $5)",
          [id, venueId, hall, label, `${id}@legacy.invalid`]);
        return id;
      };
      const event = async (label: string, status: EventStatus): Promise<string> => {
        const id = randomUUID();
        await q("INSERT INTO events (id, venue_id, name, status, created_by) VALUES ($1, $2, $3, $4, $5)", [id, venueId, label, status, userId]);
        return id;
      };
      let nextDay = 10;
      const writtenAt = (minutes: number): string => new Date(Date.parse("2026-01-01T09:00:00.000Z") + minutes * 60_000).toISOString();
      const booking = async (input: LegacyBooking): Promise<string> => {
        const id = randomUUID();
        const day = nextDay;
        nextDay += 1;
        await q(`INSERT INTO bookings (id, venue_id, space_id, event_id, enquiry_id, kind, status, title, starts_at, ends_at,
            created_by, created_at, deleted_at, fixture_source)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`, [
          id, venueId, input.spaceId ?? hall, input.eventId ?? null, input.enquiryId ?? null, input.kind, input.status ?? "active",
          input.title, input.startsAt ?? at("18:00", day), input.endsAt ?? at("22:00", day), userId,
          input.createdAt ?? writtenAt(day), input.deletedAt ?? null, input.fixture ?? null,
        ]);
        return id;
      };

      // A. One enquiry, two rooms, no event yet: one event, from its first written.
      const gordon = await enquiry("Gordon & Hay");
      const gordonCeremony = await booking({ kind: "hold", title: "Gordon–Hay ceremony", enquiryId: gordon, spaceId: saloon,
        startsAt: at("13:00", 1), endsAt: at("15:00", 1), createdAt: writtenAt(1) });
      const gordonDinner = await booking({ kind: "hold", title: "Gordon–Hay dinner", enquiryId: gordon, spaceId: hall,
        startsAt: at("17:00", 1), endsAt: at("23:00", 1), createdAt: writtenAt(2) });
      // B. An enquiry whose confirmed booking was already linked by hand.
      const lennox = await enquiry("Lennox");
      const lennoxEvent = await event("Lennox dinner", "confirmed");
      await booking({ kind: "ink", title: "Lennox dinner", enquiryId: lennox, eventId: lennoxEvent });
      const lennoxSecondRoom = await booking({ kind: "hold", title: "Lennox drinks", enquiryId: lennox, spaceId: saloon });
      // C. An enquiry already split across two events: joins the live one, and is listed.
      const mair = await enquiry("Mair");
      const mairOld = await event("Mair, first date", "cancelled");
      const mairLive = await event("Mair, second date", "draft");
      await booking({ kind: "ink", status: "cancelled", title: "Mair first date", enquiryId: mair, eventId: mairOld, createdAt: writtenAt(1) });
      await booking({ kind: "hold", title: "Mair second date", enquiryId: mair, eventId: mairLive, createdAt: writtenAt(3) });
      const mairUnbound = await booking({ kind: "hold", title: "Mair drinks", enquiryId: mair, spaceId: saloon });
      // D–G. No enquiry: each booking its own event, with the status it earns.
      const chamber = await booking({ kind: "ink", title: "Chamber dinner" });
      const burns = await booking({ kind: "hold", status: "released", title: "Burns supper" });
      const charity = await booking({ kind: "ink", status: "cancelled", title: "Charity ball" });
      const deletedAt = "2026-03-01T12:00:00.000Z";
      const deleted = await booking({ kind: "hold", title: "Deleted pencil", deletedAt });
      // H. Interest only and a house block stay free of events.
      const interest = await booking({ kind: "prospect", title: "Interest only" });
      const block = await booking({ kind: "internal_block", title: "Floor polish" });
      // I. A status someone set that the Diary contradicts: corrected, and listed.
      const keyed = await event("Keyed by hand", "ready_for_ops");
      await booking({ kind: "hold", title: "Keyed by hand", eventId: keyed });
      // J. The same title near the same time in another event: listed, never
      // merged. Day 400, clear of the days the other bookings count through.
      const society = await event("Society dinner", "confirmed");
      await booking({ kind: "ink", title: "Society dinner", eventId: society, spaceId: hall, startsAt: at("18:00", 400), endsAt: at("23:00", 400) });
      const societyAgain = await booking({ kind: "ink", title: " society dinner", spaceId: saloon, startsAt: at("19:00", 400), endsAt: at("23:00", 400) });
      const seeded = await booking({ kind: "ink", title: "Society dinner", spaceId: reception, startsAt: at("19:00", 400), endsAt: at("23:00", 400), fixture: "seed-diary" });

      // K. Every status an event could have had, under every mix of bookings.
      const mixes: readonly { readonly label: string; readonly rows: readonly MixRow[] }[] = [
        { label: "live ink", rows: [{ kind: "ink" }] },
        { label: "live hold", rows: [{ kind: "hold" }] },
        { label: "live interest", rows: [{ kind: "prospect" }] },
        { label: "released hold", rows: [{ kind: "hold", status: "released" }] },
        { label: "cancelled ink", rows: [{ kind: "ink", status: "cancelled" }] },
        { label: "cancelled ink, live hold", rows: [{ kind: "ink", status: "cancelled" }, { kind: "hold" }] },
        { label: "released and lapsed holds", rows: [{ kind: "hold", status: "released" }, { kind: "hold", status: "expired" }] },
        { label: "house block", rows: [{ kind: "internal_block" }] },
        { label: "deleted ink", rows: [{ kind: "ink", deleted: true }] },
        { label: "lost hold, live interest", rows: [{ kind: "hold", status: "lost" }, { kind: "prospect" }] },
      ];
      const priors = EVENT_STATUSES.filter((status) => status !== "lost");
      const matrix: { id: string; prior: EventStatus; rows: readonly MixRow[] }[] = [];
      for (const prior of priors) {
        for (const mix of mixes) {
          const id = await event(`${prior} with ${mix.label}`, prior);
          for (const row of mix.rows) {
            await booking({ kind: row.kind, status: row.status, title: mix.label, eventId: id, ...(row.deleted === true ? { deletedAt } : {}) });
          }
          matrix.push({ id, prior, rows: mix.rows });
        }
      }
      const eventsBefore = Number((await one("SELECT count(*)::int AS count FROM events"))["count"]);

      // The real migrator applies 0090 alone, as production's pre-deploy step will.
      await migrate(drizzle(legacy), { migrationsFolder: MIGRATIONS });
      const journal = JournalSchema.parse(JSON.parse(await readFile(join(MIGRATIONS, "meta/_journal.json"), "utf8")));
      expect((await one("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations"))["count"]).toBe(journal.entries.length);

      const eventOf = async (bookingId: string): Promise<string | null> => {
        const value = (await one("SELECT event_id FROM bookings WHERE id = $1", [bookingId]))["event_id"];
        return typeof value === "string" ? value : null;
      };
      const eventById = async (id: string | null): Promise<Record<string, unknown>> => one("SELECT * FROM events WHERE id = $1", [id]);

      // Nothing left without an event, nothing contradicting its bookings.
      expect(await readBindInvariant(drizzle(legacy), venueId)).toEqual({ unboundBookings: 0, contradictingEvents: 0 });
      // A: one new event for the enquiry's two rooms, made from its first booking.
      expect(await eventOf(gordonDinner)).toBe(await eventOf(gordonCeremony));
      expect(await eventById(await eventOf(gordonCeremony))).toMatchObject({
        name: "Gordon–Hay ceremony", status: "draft", client_name: "Gordon & Hay", venue_id: venueId, guest_count: 0, deleted_at: null,
      });
      expect((await one("SELECT count(*)::int AS count FROM event_phases WHERE event_id = $1", [await eventOf(gordonCeremony)]))["count"]).toBe(8);
      // B and C: joined the enquiry's event; C, split already, is listed below.
      expect(await eventOf(lennoxSecondRoom)).toBe(lennoxEvent);
      expect(await eventOf(mairUnbound)).toBe(mairLive);
      // D–G.
      expect((await eventById(await eventOf(chamber)))["status"]).toBe("confirmed");
      expect((await eventById(await eventOf(burns)))["status"]).toBe("lost");
      expect((await eventById(await eventOf(charity)))["status"]).toBe("cancelled");
      expect(await eventById(await eventOf(deleted))).toMatchObject({ status: "draft", deleted_at: new Date(deletedAt) });
      // H.
      expect(await eventOf(interest)).toBeNull();
      expect(await eventOf(block)).toBeNull();
      // I.
      expect((await eventById(keyed))["status"]).toBe("draft");
      // J: a new event each, the seed's marked as the seed's.
      expect(await eventOf(societyAgain)).not.toBe(society);
      expect((await eventById(await eventOf(seeded)))["fixture_source"]).toBe("seed-diary");
      // Seven events made (A, D, E, F, G and J's two); nothing removed.
      expect((await one("SELECT count(*)::int AS count FROM events"))["count"]).toBe(eventsBefore + 7);

      // K: the SQL table and deriveEventStatus agree on every mix and prior status.
      const changed = new Map<string, EventStatus>();
      for (const entry of matrix) {
        const stored = (await eventById(entry.id))["status"];
        const expected = deriveEventStatus(entry.prior, summariseEventBookings(entry.rows.map((row) => ({
          kind: row.kind, status: row.status ?? "active", deletedAt: row.deleted === true ? deletedAt : null,
        }))));
        expect(stored, `${entry.prior}: ${entry.rows.map((row) => `${row.kind}/${row.status ?? "active"}`).join(", ")}`).toBe(expected);
        if (expected !== entry.prior) changed.set(entry.id, entry.prior);
      }
      expect(changed.size).toBeGreaterThan(0);

      // The review list: exactly what needs a person, with what was there before.
      const reviews = (await q(
        "SELECT event_id, booking_id, reason, previous_status, detail FROM event_binding_reviews WHERE venue_id = $1", [venueId],
      )).rows as { event_id: string; booking_id: string | null; reason: string; previous_status: string | null; detail: string }[];
      const derived = reviews.filter((row) => row.reason === "event_status_derived");
      expect(new Map(derived.map((row) => [row.event_id, row.previous_status])))
        .toEqual(new Map<string, string>([...changed, [keyed, "ready_for_ops"]]));
      expect(reviews.filter((row) => row.reason === "enquiry_events_differ"))
        .toEqual([expect.objectContaining({ event_id: mairLive, booking_id: mairUnbound })]);
      const sameEvent = reviews.filter((row) => row.reason === "possibly_same_event");
      expect(sameEvent).toEqual([expect.objectContaining({ booking_id: societyAgain })]);
      expect(sameEvent[0]?.detail).toContain("Society dinner");
      expect(reviews).toHaveLength(derived.length + 2);

      // The rule and the foreign keys are in place, and 'lost' is a status.
      expect((await q(`SELECT conname, contype, confdeltype, convalidated FROM pg_constraint
        WHERE conrelid = 'bookings'::regclass AND conname IN ('bookings_bound_to_event', 'bookings_event_id_fkey', 'bookings_event_venue_fk')
        ORDER BY conname`)).rows).toEqual([
        { conname: "bookings_bound_to_event", contype: "c", confdeltype: " ", convalidated: true },
        { conname: "bookings_event_id_fkey", contype: "f", confdeltype: "r", convalidated: true },
        { conname: "bookings_event_venue_fk", contype: "f", confdeltype: "r", convalidated: true },
      ]);

      // Run again, statement by statement in one transaction: nothing changes.
      const snapshot = async () => ({
        events: (await q("SELECT id, status, deleted_at FROM events ORDER BY id")).rows,
        phases: (await q("SELECT count(*)::int AS count FROM event_phases")).rows,
        reviews: (await q("SELECT count(*)::int AS count FROM event_binding_reviews")).rows,
        bookings: (await q("SELECT id, event_id FROM bookings ORDER BY id")).rows,
      });
      const once = await snapshot();
      const statements = (await readFile(join(MIGRATIONS, "0090_booking_event_bind.sql"), "utf8")).split("--> statement-breakpoint");
      const client = await legacy.connect();
      try {
        await client.query("BEGIN");
        for (const statement of statements) await client.query(statement);
        await client.query("COMMIT");
      } finally {
        client.release();
      }
      expect(await snapshot()).toEqual(once);
    } finally {
      // Ending a pool does not wait for its connections to close, so the
      // forced drop can cut one still closing, and its "terminating
      // connection" (57P01) reaches the pool, which throws an error nothing
      // listens for. Expected here; nothing else is.
      legacy.on("error", (error: Error & { readonly code?: string }) => { if (error.code !== "57P01") throw error; });
      await legacy.end();
      await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await rm(before0090, { recursive: true, force: true });
    }
  }, 300_000);
});
