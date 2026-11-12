import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CalendarResponseSchema,
  ClientEventScheduleSchema,
  ClientHomeSchema,
  EventDayOpsBoardSchema,
  EventPhaseGraphSchema,
  EventSchema,
  LAYOUT_STYLES,
  RoomLayoutTimelineResponseSchema,
  type HallkeeperSheetV2,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { registerErrorNormalizer } from "../middleware/error-normalizer.js";
import { calendarRoutes } from "../routes/calendar.js";
import { clientEventScheduleRoutes } from "../routes/client-event-schedule.js";
import { clientHomeRoutes } from "../routes/client-home.js";
import { eventDayEventRoutes } from "../routes/event-day-ops.js";
import { eventRoutes } from "../routes/events.js";
import { roomLayoutTimelineRoutes } from "../routes/room-layout-timeline.js";
import { compileOpsHandoffPackFromConfiguration } from "../services/ops-compiler.js";

// ---------------------------------------------------------------------------
// An event stored with no name (release-lead ruling of 12 November 2026 on
// #397, part a). Events made before eventNameFor named them can hold "": an
// enquiry with a blank name converted before #350, or an untitled interest-only
// booking made provisional. Every read of an event's name refused it, so one
// such event turned the client's schedule and home, the event's own page (and
// with it the only way to rename it), the venue's whole Diary range once a
// phase was placed, and the room's timeline into a 400, and its handoff pack
// would not compile. Each read now takes the name as stored. The event's own
// record and the client's reads carry it as stored, for the screens to name
// it (eventNameFor); the Diary's rows and the room's timeline, which do not
// carry the event's start, and the handoff pack's document, name it here.
// Writers still refuse an empty or blank name, so staff give it one.
//
// Runs on the disposable platform database only; the platform database is
// shared and never truncated, so every test makes its own venue.
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("The untitled event tests require the explicit disposable platform database");
  }
}

const OUTLINE = [{ x: -10, y: -5 }, { x: 10, y: -5 }, { x: 10, y: 5 }, { x: -10, y: 5 }];
/** Sunday 14 March 2032, Greenwich Mean Time: far from any other fixture's dates. */
const DAY = "2032-03-14";
/** What the event is called while it has no name (eventNameFor). */
const DERIVED = "Wedding, 14 March 2032";

/** Where and when the fixture's wedding is: its venue's zone, its booking and its placed phase. */
interface Placement {
  readonly timeZone: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly phaseStartsAt: string;
  readonly phaseMinutes: number;
}
/** An evening in Glasgow, where the venue's day is the UTC day. */
const GLASGOW_EVENING: Placement = {
  timeZone: "Europe/London", startsAt: `${DAY}T18:00:00.000Z`, endsAt: `${DAY}T23:00:00.000Z`,
  phaseStartsAt: `${DAY}T19:00:00.000Z`, phaseMinutes: 120,
};
/** Half past eleven at night on 14 March in New York (Eastern Daylight Time
 *  from that morning): 03:30 UTC on the 15th, which is the 15th in London. A
 *  read that names it on any clock but the venue's says 15 March (R4). */
const NEW_YORK_LATE: Placement = {
  timeZone: "America/New_York", startsAt: "2032-03-15T03:30:00.000Z", endsAt: "2032-03-15T07:00:00.000Z",
  phaseStartsAt: "2032-03-15T03:40:00.000Z", phaseMinutes: 20,
};

describe.skipIf(target === undefined)("an event stored with no name is read everywhere its name is read", () => {
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `untitled_event_${randomUUID()}`, max: 4,
      options: "-c statement_timeout=30000 -c lock_timeout=20000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name)
      .toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    // As the app answers: a thrown ZodError becomes its 400 envelope.
    registerErrorNormalizer(server);
    await server.register(eventRoutes, { db, prefix: "/events" });
    await server.register(clientEventScheduleRoutes, { db, prefix: "/events" });
    await server.register(eventDayEventRoutes, { db, prefix: "/events" });
    await server.register(clientHomeRoutes, { db, prefix: "/client-home" });
    await server.register(calendarRoutes, { db, prefix: "/calendar" });
    await server.register(roomLayoutTimelineRoutes, { db, prefix: "/calendar" });
    await server.ready();
  });
  afterAll(async () => { await server?.close(); await pool?.end(); });

  function bearer(id: string, role: string, venueId: string | null): { authorization: string } {
    return { authorization: `Bearer ${JSON.stringify({ id, email: `${id}@untitled-event.invalid`, name: `TEST ONLY ${role}`, role, venueId, platformRole: "none" })}` };
  }

  /** A venue whose wedding on DAY is stored under `eventName` ("" unless said). */
  async function fixture(eventName = "", place: Placement = GLASGOW_EVENING) {
    const venueId = randomUUID();
    await db.insert(schema.venues).values({
      id: venueId, name: "TEST ONLY untitled event", slug: `untitled-event-${venueId}`, address: "Disposable fixture", timezone: place.timeZone,
    });
    const roomId = randomUUID();
    await db.insert(schema.spaces).values({
      id: roomId, venueId, name: "Grand Hall", slug: `room-${roomId}`, widthM: "20", lengthM: "10", heightM: "6", floorPlanOutline: OUTLINE,
    });
    const adminId = randomUUID();
    const clientId = randomUUID();
    await db.insert(schema.users).values([
      { id: adminId, email: `${adminId}@untitled-event.invalid`, name: "TEST ONLY admin", role: "admin", venueId },
      { id: clientId, email: `${clientId}@untitled-event.invalid`, name: "TEST ONLY client", role: "client", venueId: null },
    ]);
    const eventId = randomUUID();
    const namedId = randomUUID();
    // As an event made before eventNameFor stands: written straight to the
    // table, since every event writer refuses an empty name.
    await db.insert(schema.events).values([
      { id: eventId, venueId, name: eventName, eventType: "wedding", status: "confirmed", createdBy: adminId, guestCount: 80,
        startsAt: new Date(place.startsAt), endsAt: new Date(place.endsAt) },
      { id: namedId, venueId, name: "TEST ONLY Spring lunch", eventType: "dinner", status: "confirmed", createdBy: adminId, guestCount: 40,
        startsAt: new Date("2032-03-20T12:00:00.000Z"), endsAt: new Date("2032-03-20T15:00:00.000Z") },
    ]);
    await pool.query(
      "INSERT INTO bookings (venue_id, space_id, event_id, kind, title, event_type, starts_at, ends_at) VALUES ($1, $2, $3, 'ink', '', 'wedding', $4, $5)",
      [venueId, roomId, eventId, place.startsAt, place.endsAt],
    );
    // A placed, timed phase: what puts the event on the Diary's lanes and the room's timeline.
    await db.insert(schema.eventPhases).values({
      eventId, spaceId: roomId, name: "Dinner", templateKey: "dinner", sortOrder: 0,
      startsAt: new Date(place.phaseStartsAt), durationMinutes: place.phaseMinutes,
    });
    // The client's own plans, one linked to each event.
    const clientPlans = [randomUUID(), randomUUID()] as const;
    await db.insert(schema.configurations).values(clientPlans.map((id, index) => ({
      id, venueId, spaceId: roomId, userId: clientId, name: `TEST ONLY client plan ${String(index + 1)}`, layoutStyle: LAYOUT_STYLES[0],
    })));
    await db.insert(schema.eventConfigurationLinks).values([
      { eventId, configurationId: clientPlans[0], linkType: "source_configuration" },
      { eventId: namedId, configurationId: clientPlans[1], linkType: "source_configuration" },
    ]);
    return {
      venueId, roomId, adminId, eventId, namedId,
      client: bearer(clientId, "client", null), office: bearer(adminId, "admin", venueId),
    };
  }

  async function get(url: string, headers: { authorization: string }): Promise<unknown> {
    const response = await server.inject({ method: "GET", url, headers });
    expect(response.statusCode, `${url}: ${response.body}`).toBe(200);
    return response.json<{ data: unknown }>().data;
  }

  it("serves the event's own record, the page staff rename it from, with the name as stored", async () => {
    const f = await fixture();
    expect(EventSchema.parse(await get(`/events/${f.eventId}`, f.office)).name).toBe("");
  });

  it("serves the event's phase graph, which the planner's event bar and the When ribbon read", async () => {
    const f = await fixture();
    expect(EventPhaseGraphSchema.parse(await get(`/events/${f.eventId}/phase-graph?snapshotPayloads=omit`, f.office)).event.name).toBe("");
  });

  it("serves the event-day board", async () => {
    const f = await fixture();
    expect(EventDayOpsBoardSchema.parse(await get(`/events/${f.eventId}/ops-board`, f.office)).event.name).toBe("");
  });

  it("serves the client's schedule to the client and to the venue's office", async () => {
    const f = await fixture();
    for (const headers of [f.client, f.office]) {
      const schedule = ClientEventScheduleSchema.parse(await get(`/events/${f.eventId}/client-schedule`, headers));
      expect(schedule.event).toMatchObject({ id: f.eventId, name: "", eventType: "wedding", startsAt: `${DAY}T18:00:00.000Z` });
    }
  });

  it("serves the client's home with every event in it", async () => {
    const f = await fixture();
    const home = ClientHomeSchema.parse(await get("/client-home", f.client));
    expect(home.events.map((event) => [event.id, event.name])).toEqual([
      [f.eventId, ""],
      [f.namedId, "TEST ONLY Spring lunch"],
    ]);
  });

  it("keeps the venue's Diary range readable, naming the event by its occasion and day", async () => {
    const f = await fixture();
    const calendar = CalendarResponseSchema.parse(await get(
      `/calendar?venueId=${f.venueId}&from=${DAY}T00:00:00.000Z&to=2032-03-15T00:00:00.000Z`, f.office,
    ));
    expect(calendar.entries.map((entry) => [entry.entryType, entry.entryType === "booking" ? entry.title : entry.name, entry.eventName]))
      .toEqual([
        ["booking", "", DERIVED],
        ["phase", "Dinner", DERIVED],
      ]);
  });

  it("keeps the room's timeline readable, naming the event by its occasion and day", async () => {
    const f = await fixture();
    const timeline = RoomLayoutTimelineResponseSchema.parse(await get(
      `/calendar/layout-timeline?venueId=${f.venueId}&spaceId=${f.roomId}&scope=day&anchorDate=${DAY}`, f.office,
    ));
    expect(timeline.frames.map((frame) => [frame.eventId, frame.eventName, frame.phaseName])).toEqual([[f.eventId, DERIVED, "Dinner"]]);
  });

  /** The handoff pack's document for the fixture's event, compiled from an approved office plan. */
  async function compiledBeoBody(f: Awaited<ReturnType<typeof fixture>>): Promise<string | undefined> {
    const configId = randomUUID();
    const variantId = randomUUID();
    const approvedAt = new Date("2032-03-01T10:00:00.000Z");
    await db.insert(schema.configurations).values({
      id: configId, venueId: f.venueId, spaceId: f.roomId, userId: f.adminId, name: "TEST ONLY office plan", layoutStyle: LAYOUT_STYLES[0],
      reviewStatus: "approved", approvedAt, approvedBy: f.adminId,
    });
    await db.insert(schema.layoutVariants).values({ id: variantId, eventId: f.eventId, configurationId: configId, name: "TEST ONLY binding" });
    await db.insert(schema.eventConfigurationLinks).values({
      eventId: f.eventId, configurationId: configId, layoutVariantId: variantId, linkType: "variant_configuration",
    });
    const payload: HallkeeperSheetV2 = {
      config: { id: configId, name: "TEST ONLY office plan", guestCount: 0, layoutStyle: "custom" },
      venue: { name: "TEST ONLY untitled event", address: "Disposable fixture", logoUrl: null, timezone: "Europe/London" },
      space: { name: "Grand Hall", widthM: 20, lengthM: 10, heightM: 6 },
      timing: null, instructions: null, phases: [], totals: { entries: [], totalRows: 0, totalItems: 0 },
      diagramUrl: null, webViewUrl: "https://example.invalid/untitled-event", generatedAt: approvedAt.toISOString(),
      approval: { version: 1, approvedAt: approvedAt.toISOString(), approverName: "TEST ONLY reviewer" },
    };
    await db.insert(schema.configurationSheetSnapshots).values({
      configurationId: configId, version: 1, payload, sourceHash: "c".repeat(64), createdBy: f.adminId, approvedBy: f.adminId, approvedAt,
    });
    await compileOpsHandoffPackFromConfiguration(db, { configId, eventId: f.eventId, actorUserId: f.adminId, clientNotes: null });
    const board = EventDayOpsBoardSchema.parse(await get(`/events/${f.eventId}/ops-board`, f.office));
    return board.handoffPack?.beoDocument.body;
  }

  it("compiles the event's handoff pack, whose document names the event by its occasion and day", async () => {
    const f = await fixture();
    expect(await compiledBeoBody(f)).toContain(`Event: ${DERIVED} (confirmed).`);
  });

  // A guest who gave no name is filed under their email, and an event made
  // for them before #407 is stored as "<email> — Wedding" (N4, R7). With no
  // migration, every read that names it shows its occasion and day instead.
  it("names an event stored under its client's email by its occasion and day on the Diary, the room's timeline and the handoff pack", async () => {
    const email = `${randomUUID()}@untitled-event.invalid`;
    const f = await fixture(`${email} — Wedding`);
    const calendar = CalendarResponseSchema.parse(await get(
      `/calendar?venueId=${f.venueId}&from=${DAY}T00:00:00.000Z&to=2032-03-15T00:00:00.000Z`, f.office,
    ));
    expect(calendar.entries.map((entry) => entry.eventName)).toEqual([DERIVED, DERIVED]);
    const timeline = RoomLayoutTimelineResponseSchema.parse(await get(
      `/calendar/layout-timeline?venueId=${f.venueId}&spaceId=${f.roomId}&scope=day&anchorDate=${DAY}`, f.office,
    ));
    expect(timeline.frames.map((frame) => frame.eventName)).toEqual([DERIVED]);
    const body = await compiledBeoBody(f);
    expect(body).toContain(`Event: ${DERIVED} (confirmed).`);
    expect(body).not.toContain(email);
  });

  // The day in the name is the venue's own (R4): each read takes its venue's
  // zone, not the house's or the server's. NEW_YORK_LATE is the 14th only there.
  describe("at a venue in New York, late on the 14th by its own clock", () => {
    it("names the event on the Diary by the venue's day", async () => {
      const f = await fixture("", NEW_YORK_LATE);
      const calendar = CalendarResponseSchema.parse(await get(
        `/calendar?venueId=${f.venueId}&from=${DAY}T00:00:00.000Z&to=2032-03-16T00:00:00.000Z`, f.office,
      ));
      expect(calendar.entries.map((entry) => [entry.entryType, entry.eventName])).toEqual([["booking", DERIVED], ["phase", DERIVED]]);
    });

    it("names it on the room's timeline by the venue's day", async () => {
      const f = await fixture("", NEW_YORK_LATE);
      const timeline = RoomLayoutTimelineResponseSchema.parse(await get(
        `/calendar/layout-timeline?venueId=${f.venueId}&spaceId=${f.roomId}&scope=day&anchorDate=${DAY}`, f.office,
      ));
      expect(timeline.frames.map((frame) => [frame.eventId, frame.eventName])).toEqual([[f.eventId, DERIVED]]);
    });

    it("names it in the handoff pack's document by the venue's day", async () => {
      const f = await fixture("", NEW_YORK_LATE);
      expect(await compiledBeoBody(f)).toContain(`Event: ${DERIVED} (confirmed).`);
    });
  });

  it("lets staff give the event a name, and still refuses an empty or blank one", async () => {
    const f = await fixture();
    const patch = (payload: Record<string, unknown>) => server.inject({ method: "PATCH", url: `/events/${f.eventId}`, headers: f.office, payload });
    for (const name of ["", "   "]) {
      const refused = await patch({ name });
      expect(refused.statusCode, JSON.stringify(name)).toBe(400);
      expect(refused.json<{ code: string }>().code).toBe("VALIDATION_ERROR");
    }
    const counted = await patch({ guestCount: 90 });
    expect(counted.statusCode, counted.body).toBe(200);
    expect(EventSchema.parse(counted.json<{ data: unknown }>().data)).toMatchObject({ name: "", guestCount: 90 });
    const named = await patch({ name: "TEST ONLY Fraser wedding" });
    expect(named.statusCode, named.body).toBe(200);
    const [stored] = await db.select({ name: schema.events.name }).from(schema.events).where(eq(schema.events.id, f.eventId));
    expect(stored?.name).toBe("TEST ONLY Fraser wedding");
  });
});
