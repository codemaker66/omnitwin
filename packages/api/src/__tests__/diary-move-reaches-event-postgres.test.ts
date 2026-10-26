import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { eventPhaseRoutes } from "../routes/events.js";
import { transitionBookingCore, updateBookingCore, type MutationActor } from "../services/booking-mutations.js";
import { removeLapsedDietaryNotes } from "../services/dietary-retention.js";
import { defaultEventPhaseRows, insertBoundBookings } from "../services/event-binding.js";
import { assembleSheetDataV2 } from "../services/hallkeeper-sheet-v2-data.js";
import { createSnapshot } from "../services/sheet-snapshot.js";

// ---------------------------------------------------------------------------
// A Diary move reaches its event (release audit events-diary-1, events-diary-3,
// people-privacy-2, tenancy-f-1).
//
// Moving a booking on the Diary used to leave its event behind: the event kept
// its old dates (what clients see, and what allergy-note retention counts
// from), its timed phases kept the old hour and room (the Day Board, the
// sheet's set-up deadline), and an approved sheet kept the hour it was
// submitted with. These prove, on the real cores and a migrated database, that
// the event's dates, its phases on the booking's day and the sheet's times all
// follow the booking, across midnight and the clocks going back on 25 October
// 2026, that a move never leaves the venue, that a phase edit made during a
// move does not undo it, and that retention counts from the new date.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Diary move tests require the explicit disposable platform database");
  }
}

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const at = (iso: string): Date => new Date(iso);

/** The wall-clock time a hallkeeper in Glasgow reads, "16:00". */
function glasgowTime(instant: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);
}

describe.skipIf(target === undefined)("a Diary move reaches its event, on the migrated disposable database", () => {
  const applicationName = `diary_move_${randomUUID()}`;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: applicationName, max: 6,
      options: "-c statement_timeout=10000 -c lock_timeout=8000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(eventPhaseRoutes, { db, prefix: "/event-phases" });
    await server.ready();
  }, 60000);

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  /** A venue with two rooms and an admin, and one confirmed booking bound to its own event. */
  async function venueWithInk(startsAt: Date, endsAt: Date) {
    const venueId = randomUUID(), hallId = randomUUID(), saloonId = randomUUID(), adminId = randomUUID();
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY diary move", slug: venueId, address: "Disposable fixture", timezone: "Europe/London" });
    const outline = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
    await db.insert(schema.spaces).values([
      { id: hallId, venueId, name: "Grand Hall", slug: "grand-hall", widthM: "20", lengthM: "20", heightM: "6", floorPlanOutline: outline },
      { id: saloonId, venueId, name: "Saloon", slug: "saloon", widthM: "20", lengthM: "20", heightM: "4", floorPlanOutline: outline },
    ]);
    await db.insert(schema.users).values({ id: adminId, venueId, name: "Diary admin", email: `${adminId}@diary-move.invalid`, role: "admin" });
    const actor: MutationActor = { id: adminId, venueId, role: "admin", platformRole: "none" };
    const [ink] = await insertBoundBookings(db, [{
      venueId, spaceId: hallId, kind: "ink", title: "TEST ONLY wedding dinner", eventType: "wedding",
      createdBy: adminId, startsAt, endsAt,
    }]);
    if (ink?.eventId === null || ink === undefined) throw new Error("The ink was not bound to an event");
    return { venueId, hallId, saloonId, adminId, actor, ink, eventId: ink.eventId };
  }

  /** A timed phase of the event, in a room. */
  async function phase(eventId: string, name: string, spaceId: string | null, startsAt: Date, durationMinutes: number): Promise<string> {
    const [template] = defaultEventPhaseRows(eventId);
    if (template === undefined) throw new Error("No phase template");
    const [row] = await db.insert(schema.eventPhases).values({
      ...template, templateKey: null, name, spaceId, startsAt, durationMinutes, sortOrder: 100,
    }).returning({ id: schema.eventPhases.id });
    if (row === undefined) throw new Error("Phase not written");
    return row.id;
  }

  async function phaseAt(id: string): Promise<{ startsAt: Date | null; spaceId: string | null; notes: string | null }> {
    const [row] = await db.select({ startsAt: schema.eventPhases.startsAt, spaceId: schema.eventPhases.spaceId, notes: schema.eventPhases.notes })
      .from(schema.eventPhases).where(eq(schema.eventPhases.id, id));
    if (row === undefined) throw new Error("Phase missing");
    return row;
  }

  async function eventSpan(eventId: string): Promise<{ startsAt: Date | null; endsAt: Date | null }> {
    const [row] = await db.select({ startsAt: schema.events.startsAt, endsAt: schema.events.endsAt })
      .from(schema.events).where(eq(schema.events.id, eventId));
    if (row === undefined) throw new Error("Event missing");
    return row;
  }

  it("moves the event's dates and its room's phases with the booking, forward and back", async () => {
    const f = await venueWithInk(at("2026-11-07T18:00:00.000Z"), at("2026-11-07T23:00:00.000Z"));
    const setup = await phase(f.eventId, "Setup", f.hallId, at("2026-11-07T15:00:00.000Z"), 120);
    const clearDown = await phase(f.eventId, "Clear-down", f.hallId, at("2026-11-07T22:30:00.000Z"), 30);
    const otherRoom = await phase(f.eventId, "Drinks", f.saloonId, at("2026-11-07T17:00:00.000Z"), 60);
    const earlierDay = await phase(f.eventId, "Delivery", f.hallId, at("2026-11-05T10:00:00.000Z"), 60);

    const forward = await updateBookingCore(db, f.actor, f.ink.id, { startsAt: "2027-06-12T17:00:00.000Z", endsAt: "2027-06-12T22:00:00.000Z" });
    expect(forward.ok).toBe(true);
    expect(await eventSpan(f.eventId)).toEqual({ startsAt: at("2027-06-12T17:00:00.000Z"), endsAt: at("2027-06-12T22:00:00.000Z") });
    const delta = at("2027-06-12T17:00:00.000Z").getTime() - at("2026-11-07T18:00:00.000Z").getTime();
    expect((await phaseAt(setup)).startsAt).toEqual(new Date(at("2026-11-07T15:00:00.000Z").getTime() + delta));
    expect((await phaseAt(clearDown)).startsAt).toEqual(new Date(at("2026-11-07T22:30:00.000Z").getTime() + delta));
    // Another room's phase and another day's are not this booking's.
    expect((await phaseAt(otherRoom)).startsAt).toEqual(at("2026-11-07T17:00:00.000Z"));
    expect((await phaseAt(earlierDay)).startsAt).toEqual(at("2026-11-05T10:00:00.000Z"));

    const back = await updateBookingCore(db, f.actor, f.ink.id, { startsAt: "2026-11-07T18:00:00.000Z", endsAt: "2026-11-07T23:00:00.000Z" });
    expect(back.ok).toBe(true);
    expect(await eventSpan(f.eventId)).toEqual({ startsAt: at("2026-11-07T18:00:00.000Z"), endsAt: at("2026-11-07T23:00:00.000Z") });
    expect((await phaseAt(setup)).startsAt).toEqual(at("2026-11-07T15:00:00.000Z"));
    expect((await phaseAt(clearDown)).startsAt).toEqual(at("2026-11-07T22:30:00.000Z"));
  });

  it("carries the phases across midnight", async () => {
    const f = await venueWithInk(at("2026-11-13T21:00:00.000Z"), at("2026-11-13T23:30:00.000Z"));
    const clearDown = await phase(f.eventId, "Clear-down", f.hallId, at("2026-11-13T23:00:00.000Z"), 30);
    const moved = await updateBookingCore(db, f.actor, f.ink.id, { startsAt: "2026-11-13T23:00:00.000Z", endsAt: "2026-11-14T01:30:00.000Z" });
    expect(moved.ok).toBe(true);
    expect((await phaseAt(clearDown)).startsAt).toEqual(at("2026-11-14T01:00:00.000Z"));
    expect(await eventSpan(f.eventId)).toEqual({ startsAt: at("2026-11-13T23:00:00.000Z"), endsAt: at("2026-11-14T01:30:00.000Z") });
  });

  it("keeps a phase's Glasgow time when the booking moves across the clocks going back on 25 October", async () => {
    // Sat 24 Oct 2026 18:00 BST is 17:00Z; Sun 25 Oct 18:00 GMT is 18:00Z.
    const f = await venueWithInk(at("2026-10-24T17:00:00.000Z"), at("2026-10-24T22:00:00.000Z"));
    const setup = await phase(f.eventId, "Setup", f.hallId, at("2026-10-24T15:00:00.000Z"), 120);
    expect(glasgowTime(at("2026-10-24T15:00:00.000Z"))).toBe("16:00");

    const moved = await updateBookingCore(db, f.actor, f.ink.id, { startsAt: "2026-10-25T18:00:00.000Z", endsAt: "2026-10-25T23:00:00.000Z" });
    expect(moved.ok).toBe(true);
    const shifted = (await phaseAt(setup)).startsAt;
    expect(shifted).toEqual(at("2026-10-25T16:00:00.000Z"));
    if (shifted === null) throw new Error("Phase lost its time");
    expect(glasgowTime(shifted)).toBe("16:00");
  });

  it("takes the room's phases to the room the booking moves to", async () => {
    const f = await venueWithInk(at("2026-11-20T18:00:00.000Z"), at("2026-11-20T23:00:00.000Z"));
    const setup = await phase(f.eventId, "Setup", f.hallId, at("2026-11-20T16:00:00.000Z"), 90);
    const moved = await updateBookingCore(db, f.actor, f.ink.id, { spaceId: f.saloonId });
    expect(moved.ok).toBe(true);
    expect(await phaseAt(setup)).toMatchObject({ spaceId: f.saloonId, startsAt: at("2026-11-20T16:00:00.000Z") });
  });

  it("leaves the phases of the event's other booking in the same room where they are", async () => {
    const f = await venueWithInk(at("2026-12-04T09:00:00.000Z"), at("2026-12-04T18:00:00.000Z"));
    const [saturday] = await insertBoundBookings(db, [{
      venueId: f.venueId, spaceId: f.hallId, eventId: f.eventId, kind: "ink", title: "TEST ONLY conference day two",
      createdBy: f.adminId, startsAt: at("2026-12-05T09:00:00.000Z"), endsAt: at("2026-12-05T18:00:00.000Z"),
    }]);
    if (saturday === undefined) throw new Error("Second day not written");
    const fridaySession = await phase(f.eventId, "Friday keynote", f.hallId, at("2026-12-04T10:00:00.000Z"), 60);
    const saturdaySession = await phase(f.eventId, "Saturday keynote", f.hallId, at("2026-12-05T10:00:00.000Z"), 60);

    const moved = await updateBookingCore(db, f.actor, saturday.id, { startsAt: "2026-12-12T09:00:00.000Z", endsAt: "2026-12-12T18:00:00.000Z" });
    expect(moved.ok).toBe(true);
    expect((await phaseAt(fridaySession)).startsAt).toEqual(at("2026-12-04T10:00:00.000Z"));
    expect((await phaseAt(saturdaySession)).startsAt).toEqual(at("2026-12-12T10:00:00.000Z"));
    expect(await eventSpan(f.eventId)).toEqual({ startsAt: at("2026-12-04T09:00:00.000Z"), endsAt: at("2026-12-12T18:00:00.000Z") });
  });

  it("dates the event by its confirmed booking, and by its option once that goes", async () => {
    const f = await venueWithInk(at("2027-03-06T18:00:00.000Z"), at("2027-03-06T23:00:00.000Z"));
    await insertBoundBookings(db, [{
      venueId: f.venueId, spaceId: f.saloonId, eventId: f.eventId, kind: "hold", title: "TEST ONLY second date",
      createdBy: f.adminId, startsAt: at("2027-04-10T18:00:00.000Z"), endsAt: at("2027-04-10T23:00:00.000Z"),
      rank: 1, ownerUserId: f.adminId, nextAction: "Decide the date",
      decisionAt: at("2027-02-01T10:00:00.000Z"), nextActionDueAt: at("2027-02-01T09:00:00.000Z"),
    }]);
    expect(await eventSpan(f.eventId)).toEqual({ startsAt: at("2027-03-06T18:00:00.000Z"), endsAt: at("2027-03-06T23:00:00.000Z") });

    const cancelled = await transitionBookingCore(db, f.actor, f.ink.id, { toState: "cancelled" });
    expect(cancelled.ok).toBe(true);
    expect(await eventSpan(f.eventId)).toEqual({ startsAt: at("2027-04-10T18:00:00.000Z"), endsAt: at("2027-04-10T23:00:00.000Z") });
  });

  it("refuses a move to another venue's room or event, and leaves the event as it was", async () => {
    const f = await venueWithInk(at("2026-11-27T18:00:00.000Z"), at("2026-11-27T23:00:00.000Z"));
    const other = await venueWithInk(at("2026-11-28T18:00:00.000Z"), at("2026-11-28T23:00:00.000Z"));
    const toRoom = await updateBookingCore(db, f.actor, f.ink.id, { spaceId: other.hallId, startsAt: "2026-12-01T18:00:00.000Z", endsAt: "2026-12-01T23:00:00.000Z" });
    expect(toRoom).toMatchObject({ ok: false, code: "SPACE_VENUE_MISMATCH" });
    const toEvent = await updateBookingCore(db, f.actor, f.ink.id, { eventId: other.eventId });
    expect(toEvent).toMatchObject({ ok: false, code: "EVENT_VENUE_MISMATCH" });
    expect(await eventSpan(f.eventId)).toEqual({ startsAt: at("2026-11-27T18:00:00.000Z"), endsAt: at("2026-11-27T23:00:00.000Z") });
  });

  it("keeps a move's shift when a phase edit lands while the move holds the event", async () => {
    const f = await venueWithInk(at("2026-12-18T18:00:00.000Z"), at("2026-12-18T23:00:00.000Z"));
    const setup = await phase(f.eventId, "Setup", f.hallId, at("2026-12-18T16:00:00.000Z"), 90);
    const blocker = await pool.connect();
    try {
      // What a move does inside its transaction: lock the event, shift the phase.
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM events WHERE id = $1 FOR NO KEY UPDATE", [f.eventId]);
      await blocker.query("UPDATE event_phases SET starts_at = starts_at + interval '2 hours' WHERE id = $1", [setup]);
      const edit = server.inject({
        method: "PATCH", url: `/event-phases/${setup}`,
        headers: { authorization: `Bearer ${JSON.stringify({ id: f.adminId, email: "admin@diary-move.invalid", role: "admin", platformRole: "none", venueId: f.venueId })}` },
        payload: { notes: "Bring the long cloths" },
      });
      await expect.poll(async () => Number((await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
        [applicationName],
      )).rows[0]?.count), { timeout: 5000 }).toBe(1);
      await blocker.query("COMMIT");
      const response = await edit;
      expect(response.statusCode, response.body).toBe(200);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }
    expect(await phaseAt(setup)).toMatchObject({ startsAt: at("2026-12-18T18:00:00.000Z"), notes: "Bring the long cloths" });
  });

  it("counts allergy-note retention from the date the booking moved to", async () => {
    const f = await venueWithInk(at("2026-11-07T18:00:00.000Z"), at("2026-11-07T23:00:00.000Z"));
    const [layout] = await db.insert(schema.configurations).values({
      spaceId: f.hallId, venueId: f.venueId, name: "TEST ONLY wedding layout", layoutStyle: "custom", userId: f.adminId,
      metadata: { instructions: { dietary: { otherAllergies: "TEST ONLY: Table 5, severe peanut allergy" } } },
    }).returning({ id: schema.configurations.id });
    if (layout === undefined) throw new Error("Layout not written");
    await db.insert(schema.eventConfigurationLinks).values({ eventId: f.eventId, configurationId: layout.id, linkType: "source_configuration" });
    const note = async (): Promise<unknown> => {
      const [row] = await db.select({ metadata: schema.configurations.metadata }).from(schema.configurations).where(eq(schema.configurations.id, layout.id));
      return (row?.metadata as { instructions?: { dietary?: { otherAllergies?: unknown } } } | null)?.instructions?.dietary?.otherAllergies;
    };

    // The wedding is postponed to June: a month after the old date the note stays.
    expect((await updateBookingCore(db, f.actor, f.ink.id, { startsAt: "2027-06-12T17:00:00.000Z", endsAt: "2027-06-12T22:00:00.000Z" })).ok).toBe(true);
    await removeLapsedDietaryNotes(db, { now: at("2026-12-08T02:00:00.000Z") });
    expect(await note()).toBe("TEST ONLY: Table 5, severe peanut allergy");

    // And it goes as promised once the new date is more than thirty days past.
    await removeLapsedDietaryNotes(db, { now: new Date(at("2027-06-12T22:00:00.000Z").getTime() + 31 * DAY) });
    expect(await note()).toBeFalsy();
  });

  it("prints an approved sheet's times from the Diary after the booking moves", async () => {
    const f = await venueWithInk(at("2026-11-21T18:00:00.000Z"), at("2026-11-21T23:00:00.000Z"));
    const setup = await phase(f.eventId, "Setup", f.hallId, at("2026-11-21T16:00:00.000Z"), 120);
    const [layout] = await db.insert(schema.configurations).values({
      spaceId: f.hallId, venueId: f.venueId, name: "TEST ONLY approved layout", layoutStyle: "custom", userId: f.adminId,
    }).returning({ id: schema.configurations.id });
    if (layout === undefined) throw new Error("Layout not written");
    await db.insert(schema.eventConfigurationLinks).values({ eventId: f.eventId, configurationId: layout.id, linkType: "source_configuration" });

    // Submitted and approved as the review routes do: freeze, then stamp both rows at one instant.
    const { snapshot } = await createSnapshot(db, { configId: layout.id, createdBy: f.adminId, baseUrl: "https://venviewer.test" });
    const approvedAt = at("2026-11-01T12:00:00.000Z");
    await db.update(schema.configurationSheetSnapshots).set({ approvedAt, approvedBy: f.adminId })
      .where(eq(schema.configurationSheetSnapshots.id, snapshot.id));
    await db.update(schema.configurations).set({ reviewStatus: "approved", approvedAt, approvedBy: f.adminId })
      .where(eq(schema.configurations.id, layout.id));
    const before = await assembleSheetDataV2(db, layout.id, "https://venviewer.test", f.eventId);
    expect(before?.payload.timing).toMatchObject({ eventStart: "2026-11-21T18:00:00.000Z", setupBy: "2026-11-21T16:00:00.000Z" });

    // The office brings the dinner forward three hours after approval.
    expect((await updateBookingCore(db, f.actor, f.ink.id, { startsAt: "2026-11-21T15:00:00.000Z", endsAt: "2026-11-21T20:00:00.000Z" })).ok).toBe(true);
    expect((await phaseAt(setup)).startsAt).toEqual(at("2026-11-21T13:00:00.000Z"));
    const after = await assembleSheetDataV2(db, layout.id, "https://venviewer.test", f.eventId);
    expect(after?.payload.timing).toMatchObject({ eventStart: "2026-11-21T15:00:00.000Z", setupBy: "2026-11-21T13:00:00.000Z" });
    // The approval and the version it names are still the frozen ones.
    expect(after?.issue).toMatchObject({ snapshotId: snapshot.id, version: snapshot.version });
    expect(after?.payload.approval?.version).toBe(snapshot.version);
    const [stored] = await db.select({ payload: schema.configurationSheetSnapshots.payload })
      .from(schema.configurationSheetSnapshots)
      .where(and(eq(schema.configurationSheetSnapshots.id, snapshot.id)));
    expect((stored?.payload as { timing?: { eventStart?: string } } | null)?.timing?.eventStart).toBe("2026-11-21T18:00:00.000Z");
  });
});
