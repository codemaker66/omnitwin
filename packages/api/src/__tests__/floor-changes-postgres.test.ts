import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EventAwaitingAcknowledgement } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { eventPlanLifecycleRoutes } from "../routes/event-plan-lifecycle.js";
import { updateBookingCore, type MutationActor } from "../services/booking-mutations.js";
import { insertBoundBookings } from "../services/event-binding.js";
import { updateEventCore } from "../services/event-mutations.js";
import { wallRange } from "../services/booking-move-feed.js";
import { proposeWindowCore } from "../services/window-proposals.js";

// ---------------------------------------------------------------------------
// What changed, for the floor, on the migrated disposable platform database:
//   - a booking moved in the Diary goes into its event's change feed, in the
//     venue's clock, for the floor to acknowledge; one already over does not;
//   - the Day Board's one read finds every change nobody has acknowledged,
//     newest first, an event edit beside the move;
//   - once anyone on the floor acknowledges them they are in hand for
//     everyone, and the read says who;
//   - another venue's floor reads nothing of them.
// Never reads DATABASE_URL or an env file.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Floor change tests require the explicit disposable platform database");
  }
}

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** 18:00 UTC on a day `days` from now. The words are checked in the venue's
 *  clock (wallRange, tested on its own), so the test holds in summer too. */
function evening(days: number): Date {
  const day = new Date(Date.now() + days * DAY);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 18, 0, 0));
}

describe.skipIf(target === undefined)("what changed, for the floor, on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `floor_changes_${randomUUID()}`, max: 6,
      options: "-c statement_timeout=10000 -c lock_timeout=8000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(eventPlanLifecycleRoutes, { db, prefix: "/events" });
    await server.ready();
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  async function venue(startsAt: Date, endsAt: Date) {
    const venueId = randomUUID(), otherVenueId = randomUUID(), hallId = randomUUID(), saloonId = randomUUID();
    const adminId = randomUUID(), hallkeeperId = randomUUID(), otherId = randomUUID();
    await db.insert(schema.venues).values([
      { id: venueId, name: "TEST ONLY floor changes", slug: venueId, address: "Disposable fixture", timezone: "Europe/London" },
      { id: otherVenueId, name: "TEST ONLY another venue", slug: otherVenueId, address: "Disposable fixture", timezone: "Europe/London" },
    ]);
    const outline = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
    await db.insert(schema.spaces).values([
      { id: hallId, venueId, name: "Grand Hall", slug: "grand-hall", widthM: "20", lengthM: "20", heightM: "6", floorPlanOutline: outline },
      { id: saloonId, venueId, name: "Saloon", slug: "saloon", widthM: "20", lengthM: "20", heightM: "4", floorPlanOutline: outline },
    ]);
    await db.insert(schema.users).values([
      { id: adminId, venueId, name: "Elaine", email: `${adminId}@floor.invalid`, role: "admin" },
      { id: hallkeeperId, venueId, name: "Jamie", displayName: "Jamie at the door", email: `${hallkeeperId}@floor.invalid`, role: "hallkeeper" },
      { id: otherId, venueId: otherVenueId, name: "Elsewhere", email: `${otherId}@floor.invalid`, role: "hallkeeper" },
    ]);
    const actor: MutationActor = { id: adminId, venueId, role: "admin", platformRole: "none" };
    const [ink] = await insertBoundBookings(db, [{
      venueId, spaceId: hallId, kind: "ink", title: "TEST ONLY wedding dinner", eventType: "wedding",
      createdBy: adminId, startsAt, endsAt,
    }]);
    if (ink === undefined || ink.eventId === null) throw new Error("The ink was not bound to an event");
    return { venueId, otherVenueId, hallId, saloonId, adminId, hallkeeperId, otherId, actor, ink, eventId: ink.eventId };
  }

  type Fixture = Awaited<ReturnType<typeof venue>>;

  function headers(f: Fixture, who: "hallkeeper" | "other"): { authorization: string } {
    const id = who === "hallkeeper" ? f.hallkeeperId : f.otherId;
    return { authorization: `Bearer ${JSON.stringify({ id, email: `${id}@floor.invalid`, role: "hallkeeper",
      platformRole: "none", venueId: who === "hallkeeper" ? f.venueId : f.otherVenueId })}` };
  }

  async function awaiting(f: Fixture, who: "hallkeeper" | "other", eventIds: readonly string[]): Promise<EventAwaitingAcknowledgement[]> {
    const response = await server.inject({ method: "GET", url: `/events/awaiting-acknowledgement?eventIds=${eventIds.join(",")}`, headers: headers(f, who) });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<{ data: EventAwaitingAcknowledgement[] }>().data;
  }

  function changesOf(eventId: string) {
    return db.select().from(schema.eventPlanChanges).where(eq(schema.eventPlanChanges.eventId, eventId));
  }

  it("puts a Diary move and an event edit before the floor until someone acknowledges them", async () => {
    const start = evening(3);
    const f = await venue(start, new Date(start.getTime() + 5 * HOUR));

    const moved = await updateBookingCore(db, f.actor, f.ink.id, {
      startsAt: new Date(start.getTime() + HOUR).toISOString(), endsAt: new Date(start.getTime() + 6 * HOUR).toISOString(),
    });
    expect(moved.ok).toBe(true);
    const [move] = await changesOf(f.eventId);
    expect(move).toMatchObject({
      title: "Times moved", sourceKind: "event", sourceId: f.ink.id, actorLabel: "Elaine",
      requiresHallkeeperAcknowledgement: true, affectedSurfaces: ["timings"], audienceRoles: ["staff", "hallkeeper"],
    });
    const was = wallRange({ startsAt: start, endsAt: new Date(start.getTime() + 5 * HOUR) }, "Europe/London");
    const now = wallRange({ startsAt: new Date(start.getTime() + HOUR), endsAt: new Date(start.getTime() + 6 * HOUR) }, "Europe/London");
    expect(move?.summary).toBe("Grand Hall: 1 h later.");
    expect([move?.beforeSummary, move?.afterSummary]).toEqual([`Grand Hall, ${was}`, `Grand Hall, ${now}`]);
    const bell = await db.select().from(schema.eventPlanNotifications).where(eq(schema.eventPlanNotifications.changeId, move?.id ?? ""));
    expect(bell.map((row) => row.audienceRole).sort()).toEqual(["hallkeeper", "staff"]);

    const edited = await updateEventCore(db, { ...f.actor, email: `${f.adminId}@floor.invalid` }, f.eventId, { guestCount: 120 });
    expect(edited.ok).toBe(true);

    const [waiting] = await awaiting(f, "hallkeeper", [f.eventId]);
    expect(waiting?.changes.map((change) => change.title)).toEqual(["Event plan updated", "Times moved"]);
    expect(waiting?.changes[0]?.summary).toBe("TEST ONLY wedding dinner: guests 0 to 120.");
    expect(waiting?.lastAcknowledgement).toBeNull();

    for (const change of waiting?.changes ?? []) {
      const ack = await server.inject({ method: "POST", url: `/events/${f.eventId}/change-acknowledgements`,
        headers: headers(f, "hallkeeper"), payload: { changeId: change.id } });
      expect(ack.statusCode, ack.body).toBe(201);
    }
    const [inHand] = await awaiting(f, "hallkeeper", [f.eventId]);
    expect(inHand?.changes).toEqual([]);
    expect(inHand?.lastAcknowledgement?.by).toBe("Jamie at the door");
    expect(inHand?.lastAcknowledgement?.byUserId).toBe(f.hallkeeperId);
  });

  it("tells the floor when the room changes, and nothing for a booking already over", async () => {
    const start = evening(2);
    const f = await venue(start, new Date(start.getTime() + 4 * HOUR));
    const roomed = await updateBookingCore(db, f.actor, f.ink.id, { spaceId: f.saloonId });
    expect(roomed.ok).toBe(true);
    const hours = wallRange({ startsAt: start, endsAt: new Date(start.getTime() + 4 * HOUR) }, "Europe/London");
    expect((await changesOf(f.eventId)).map((change) => [change.title, change.summary, change.afterSummary])).toEqual([
      ["Room changed", "Grand Hall to Saloon.", `Saloon, ${hours}`],
    ]);

    const past = evening(-9);
    const old = await venue(past, new Date(past.getTime() + 4 * HOUR));
    const corrected = await updateBookingCore(db, old.actor, old.ink.id, { endsAt: new Date(past.getTime() + 5 * HOUR).toISOString() });
    expect(corrected.ok).toBe(true);
    expect(await changesOf(old.eventId)).toEqual([]);
  });

  /** What waits for the floor on the event, and what the feed keeps as history. */
  async function feedOf(eventId: string) {
    const rows = await changesOf(eventId);
    const acks = await db.select().from(schema.eventPlanChangeAcknowledgements).where(eq(schema.eventPlanChangeAcknowledgements.eventId, eventId));
    const acked = new Set(acks.map((row) => row.changeId));
    const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return {
      waiting: sorted.filter((row) => row.requiresHallkeeperAcknowledgement && !acked.has(row.id)),
      history: sorted.filter((row) => !row.requiresHallkeeperAcknowledgement),
      acknowledged: sorted.filter((row) => acked.has(row.id)),
    };
  }

  it("folds moves nobody has read into one change from the place the floor knew, and an undone move into none", async () => {
    const start = evening(5);
    const f = await venue(start, new Date(start.getTime() + 5 * HOUR));
    const place = (shiftHours: number) => ({
      startsAt: new Date(start.getTime() + shiftHours * HOUR).toISOString(),
      endsAt: new Date(start.getTime() + (5 + shiftHours) * HOUR).toISOString(),
    });
    const hours = (shiftHours: number): string => wallRange({
      startsAt: new Date(start.getTime() + shiftHours * HOUR), endsAt: new Date(start.getTime() + (5 + shiftHours) * HOUR),
    }, "Europe/London");

    expect((await updateBookingCore(db, f.actor, f.ink.id, place(1))).ok).toBe(true);
    expect((await updateBookingCore(db, f.actor, f.ink.id, place(2))).ok).toBe(true);
    const twice = await feedOf(f.eventId);
    expect(twice.waiting.map((row) => [row.title, row.beforeSummary, row.afterSummary, row.summary])).toEqual([
      ["Times moved", `Grand Hall, ${hours(0)}`, `Grand Hall, ${hours(2)}`, `Grand Hall: now ${hours(2)}.`],
    ]);
    // The first move stays in the feed as history; its bells are gone.
    expect(twice.history.map((row) => [row.summary, row.riskLevel])).toEqual([["Grand Hall: 1 h later.", "info"]]);
    const bells = await db.select().from(schema.eventPlanNotifications).where(eq(schema.eventPlanNotifications.eventId, f.eventId));
    expect(bells.every((bell) => bell.changeId === twice.waiting[0]?.id)).toBe(true);

    // The Diary's Undo, all the way back: nothing for the floor to read.
    expect((await updateBookingCore(db, f.actor, f.ink.id, place(0))).ok).toBe(true);
    const undone = await feedOf(f.eventId);
    expect(undone.waiting).toEqual([]);
    expect(await awaiting(f, "hallkeeper", [f.eventId])).toEqual([{ eventId: f.eventId, changes: [], lastAcknowledgement: null }]);
  });

  it("never folds a new move into one the floor already has", async () => {
    const start = evening(6);
    const f = await venue(start, new Date(start.getTime() + 4 * HOUR));
    await updateBookingCore(db, f.actor, f.ink.id, { startsAt: new Date(start.getTime() + HOUR).toISOString(), endsAt: new Date(start.getTime() + 5 * HOUR).toISOString() });
    const [first] = (await feedOf(f.eventId)).waiting;
    const ack = await server.inject({ method: "POST", url: `/events/${f.eventId}/change-acknowledgements`,
      headers: headers(f, "hallkeeper"), payload: { changeId: first?.id } });
    expect(ack.statusCode, ack.body).toBe(201);
    await updateBookingCore(db, f.actor, f.ink.id, { startsAt: new Date(start.getTime() + 2 * HOUR).toISOString(), endsAt: new Date(start.getTime() + 6 * HOUR).toISOString() });
    const feed = await feedOf(f.eventId);
    expect(feed.acknowledged.map((row) => row.id)).toEqual([first?.id]);
    // Was is the place the floor acknowledged, not the place before it.
    expect(feed.waiting.map((row) => [row.summary, row.beforeSummary])).toEqual([
      ["Grand Hall: 1 h later.", `Grand Hall, ${wallRange({ startsAt: new Date(start.getTime() + HOUR), endsAt: new Date(start.getTime() + 5 * HOUR) }, "Europe/London")}`],
    ]);
  });

  it("tells the floor when a proposed window moves a hold, as a Diary move does", async () => {
    const start = evening(9);
    const f = await venue(start, new Date(start.getTime() + 4 * HOUR));
    const [hold] = await insertBoundBookings(db, [{
      venueId: f.venueId, spaceId: f.hallId, kind: "hold", title: "TEST ONLY proposed supper", createdBy: f.adminId,
      startsAt: new Date(start.getTime() + DAY), endsAt: new Date(start.getTime() + DAY + 3 * HOUR),
      decisionAt: new Date(start.getTime() - DAY), ownerUserId: f.adminId,
    }]);
    if (hold === undefined || hold.eventId === null) throw new Error("The hold was not bound to an event");
    const moved = await proposeWindowCore(db, { id: f.adminId, name: "Elaine", role: "admin", venueId: f.venueId, platformRole: "none" }, hold.eventId, {
      spaceId: f.hallId, startsAt: new Date(start.getTime() + DAY + HOUR).toISOString(),
      endsAt: new Date(start.getTime() + DAY + 4 * HOUR).toISOString(), idempotencyKey: randomUUID(),
    });
    expect(moved.ok).toBe(true);
    expect((await feedOf(hold.eventId)).waiting.map((row) => [row.title, row.summary, row.sourceId])).toEqual([
      ["Times moved", "Grand Hall: 1 h later.", hold.id],
    ]);
  });

  it("shows another venue's floor nothing, and answers a bad list plainly", async () => {
    const start = evening(4);
    const f = await venue(start, new Date(start.getTime() + 4 * HOUR));
    await updateBookingCore(db, f.actor, f.ink.id, { startsAt: new Date(start.getTime() + HOUR).toISOString() });
    expect(await awaiting(f, "other", [f.eventId])).toEqual([]);
    const none = await server.inject({ method: "GET", url: "/events/awaiting-acknowledgement", headers: headers(f, "hallkeeper") });
    expect(none.statusCode).toBe(400);
    const tooMany = Array.from({ length: 101 }, () => randomUUID()).join(",");
    const many = await server.inject({ method: "GET", url: `/events/awaiting-acknowledgement?eventIds=${tooMany}`, headers: headers(f, "hallkeeper") });
    expect(many.statusCode).toBe(400);
  });
});
