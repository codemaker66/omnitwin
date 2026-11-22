import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EventAwaitingAcknowledgement } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { eventPlanLifecycleRoutes, notificationRoutes } from "../routes/event-plan-lifecycle.js";
import { updateBookingCore, type MutationActor } from "../services/booking-mutations.js";
import { insertBoundBookings } from "../services/event-binding.js";
import { updateEventCore } from "../services/event-mutations.js";
import { wallRange } from "../services/booking-move-feed.js";
import { proposeWindowCore } from "../services/window-proposals.js";

// ---------------------------------------------------------------------------
// What changed, for the floor, on the migrated disposable platform database:
//   - a booking moved in the Diary goes into its event's change feed, in the
//     venue's clock, for the floor to acknowledge; one already over does not;
//   - moves nobody has acknowledged fold into one change, compared by room id
//     and instant (a September function, a renamed room), and a move back is
//     silent only as a quick Undo nobody has read of;
//   - a move into the past is kept, told to no one, so the move that puts it
//     right is told from the place the floor last knew, never from the slip;
//   - an acknowledgement and a fold of the same move never both land;
//   - the Day Board's one read finds every change to the plan nobody has
//     acknowledged, newest first, an event edit beside the move, each event's
//     own however busy another is; on the board's day, the changes placed on
//     it and those with no place, however busy the event's other days, and
//     says when an event has more than it shows;
//   - a replaced move's bell stays only for those who opened it;
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

/** 18:00 in London on the next 11 September at least three days away: en-GB
 *  writes that month "Sept", four letters where every other month has three. */
function septemberEvening(): Date {
  const year = new Date().getUTCFullYear();
  const found = [year, year + 1].map((y) => Date.UTC(y, 8, 11, 17, 0, 0)).find((at) => at - Date.now() > 3 * DAY);
  if (found === undefined) throw new Error("No September ahead");
  return new Date(found);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** A gate a transaction waits at, so a test decides when it commits. */
function gate(): { readonly entered: Promise<void>; readonly enter: () => void; readonly open: Promise<void>; readonly release: () => void } {
  let enter: () => void = () => undefined;
  let release: () => void = () => undefined;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const open = new Promise<void>((resolve) => { release = resolve; });
  return { entered, enter, open, release };
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
    await server.register(notificationRoutes, { db, prefix: "/notifications" });
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

  /** The board's read; `day` is the board's day, as the board sends it. */
  async function awaiting(f: Fixture, who: "hallkeeper" | "other", eventIds: readonly string[], day?: { readonly from: Date; readonly to: Date }): Promise<EventAwaitingAcknowledgement[]> {
    const range = day === undefined ? "" : `&from=${encodeURIComponent(day.from.toISOString())}&to=${encodeURIComponent(day.to.toISOString())}`;
    const response = await server.inject({ method: "GET", url: `/events/awaiting-acknowledgement?eventIds=${eventIds.join(",")}${range}`, headers: headers(f, who) });
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
    // Nothing for the floor: no change waits and no bell rings. The feed keeps
    // the correction as history told to no one, so a later move is still
    // compared with the place the floor last knew.
    expect((await changesOf(old.eventId)).map((change) => [change.requiresHallkeeperAcknowledgement, change.moveTold])).toEqual([[false, false]]);
    expect(await db.select().from(schema.eventPlanNotifications).where(eq(schema.eventPlanNotifications.eventId, old.eventId))).toEqual([]);
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
    expect(await awaiting(f, "hallkeeper", [f.eventId])).toEqual([{ eventId: f.eventId, changes: [], truncated: false, lastAcknowledgement: null }]);
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

  /** The place `shiftHours` after the fixture's start, `length` hours long. */
  function shifted(start: Date, shiftHours: number, length = 5): { startsAt: string; endsAt: string } {
    return {
      startsAt: new Date(start.getTime() + shiftHours * HOUR).toISOString(),
      endsAt: new Date(start.getTime() + (shiftHours + length) * HOUR).toISOString(),
    };
  }

  function hoursOf(start: Date, shiftHours: number, length = 5): string {
    return wallRange({ startsAt: new Date(start.getTime() + shiftHours * HOUR), endsAt: new Date(start.getTime() + (shiftHours + length) * HOUR) }, "Europe/London");
  }

  /** The hallkeeper opens the bell that announced a change. */
  async function readBell(f: Fixture, changeId: string): Promise<string> {
    const [bell] = await db.select().from(schema.eventPlanNotifications).where(and(
      eq(schema.eventPlanNotifications.changeId, changeId), eq(schema.eventPlanNotifications.audienceRole, "hallkeeper")));
    if (bell === undefined) throw new Error("The change rang no hallkeeper bell");
    const read = await server.inject({ method: "PATCH", url: `/notifications/${bell.id}/read`, headers: headers(f, "hallkeeper") });
    expect(read.statusCode, read.body).toBe(200);
    return bell.id;
  }

  async function readsOf(notificationId: string) {
    return db.select().from(schema.eventPlanNotificationReads).where(eq(schema.eventPlanNotificationReads.notificationId, notificationId));
  }

  it("folds a September function's two moves into 'Times moved', though en-GB writes Sept", async () => {
    const start = septemberEvening();
    const f = await venue(start, new Date(start.getTime() + 5 * HOUR));
    expect(hoursOf(start, 0)).toMatch(/ Sept, /u);
    expect((await updateBookingCore(db, f.actor, f.ink.id, shifted(start, 1))).ok).toBe(true);
    expect((await updateBookingCore(db, f.actor, f.ink.id, shifted(start, 2))).ok).toBe(true);
    const { waiting } = await feedOf(f.eventId);
    expect(waiting.map((row) => [row.title, row.affectedSurfaces, row.beforeSummary, row.afterSummary])).toEqual([
      ["Times moved", ["timings"], `Grand Hall, ${hoursOf(start, 0)}`, `Grand Hall, ${hoursOf(start, 2)}`],
    ]);
  });

  it("keeps a room renamed between two moves the same room, and names it as it is called now", async () => {
    const start = evening(7);
    const f = await venue(start, new Date(start.getTime() + 5 * HOUR));
    expect((await updateBookingCore(db, f.actor, f.ink.id, shifted(start, 1))).ok).toBe(true);
    await db.update(schema.spaces).set({ name: "The Grand Hall" }).where(eq(schema.spaces.id, f.hallId));
    expect((await updateBookingCore(db, f.actor, f.ink.id, shifted(start, 2))).ok).toBe(true);
    const { waiting } = await feedOf(f.eventId);
    expect(waiting.map((row) => [row.title, row.affectedSurfaces, row.beforeSummary, row.afterSummary])).toEqual([
      ["Times moved", ["timings"], `The Grand Hall, ${hoursOf(start, 0)}`, `The Grand Hall, ${hoursOf(start, 2)}`],
    ]);
  });

  it("tells the floor a move back once anyone has read of the move away, and keeps their read", async () => {
    const start = evening(8);
    const f = await venue(start, new Date(start.getTime() + 5 * HOUR));
    expect((await updateBookingCore(db, f.actor, f.ink.id, shifted(start, 1))).ok).toBe(true);
    const [away] = (await feedOf(f.eventId)).waiting;
    if (away === undefined) throw new Error("The move away was not recorded");
    const bellId = await readBell(f, away.id);

    expect((await updateBookingCore(db, f.actor, f.ink.id, shifted(start, 0))).ok).toBe(true);
    const feed = await feedOf(f.eventId);
    expect(feed.waiting.map((row) => [row.title, row.affectedSurfaces, row.beforeSummary, row.afterSummary])).toEqual([
      ["Back to the original hours", ["timings"], `Grand Hall, ${hoursOf(start, 1)}`, `Grand Hall, ${hoursOf(start, 0)}`],
    ]);
    // The move away is history now, and the bell the hallkeeper read still says they read it.
    expect(feed.history.map((row) => row.id)).toEqual([away.id]);
    expect((await readsOf(bellId)).map((row) => row.userId)).toEqual([f.hallkeeperId]);
  });

  it("tells the floor a move back after the quiet window, though nobody opened the bell", async () => {
    const start = evening(9);
    const f = await venue(start, new Date(start.getTime() + 5 * HOUR));
    expect((await updateBookingCore(db, f.actor, f.ink.id, shifted(start, 1))).ok).toBe(true);
    // The move away was made at ten; the move back comes at two.
    await db.update(schema.eventPlanChanges).set({ createdAt: sql`${schema.eventPlanChanges.createdAt} - interval '4 hours'` })
      .where(eq(schema.eventPlanChanges.eventId, f.eventId));
    expect((await updateBookingCore(db, f.actor, f.ink.id, shifted(start, 0))).ok).toBe(true);
    expect((await feedOf(f.eventId)).waiting.map((row) => row.title)).toEqual(["Back to the original hours"]);
  });

  it("lets an acknowledgement that took the change first stand, and tells the next move from the acknowledged place", async () => {
    const start = evening(10);
    const f = await venue(start, new Date(start.getTime() + 5 * HOUR));
    expect((await updateBookingCore(db, f.actor, f.ink.id, shifted(start, 1))).ok).toBe(true);
    const [first] = (await feedOf(f.eventId)).waiting;
    if (first === undefined) throw new Error("The first move was not recorded");

    // The floor's Got it holds the change, as the route does, and has not committed yet.
    const floorDesk = await pool.connect();
    let moving: Promise<unknown> = Promise.resolve();
    try {
      await floorDesk.query("BEGIN");
      await floorDesk.query("SELECT id FROM event_plan_changes WHERE id = $1 FOR UPDATE", [first.id]);
      await floorDesk.query(
        "INSERT INTO event_plan_change_acknowledgements (change_id, event_id, acknowledged_by, acknowledged_by_role) VALUES ($1, $2, $3, 'hallkeeper')",
        [first.id, f.eventId, f.hallkeeperId],
      );
      moving = updateBookingCore(db, f.actor, f.ink.id, shifted(start, 2));
      await sleep(400);
      await floorDesk.query("COMMIT");
    } finally {
      floorDesk.release();
    }
    expect(await moving).toMatchObject({ ok: true });

    const feed = await feedOf(f.eventId);
    expect(feed.acknowledged.map((row) => [row.id, row.requiresHallkeeperAcknowledgement])).toEqual([[first.id, true]]);
    expect(feed.waiting.map((row) => [row.beforeSummary, row.afterSummary])).toEqual([
      [`Grand Hall, ${hoursOf(start, 1)}`, `Grand Hall, ${hoursOf(start, 2)}`],
    ]);
  });

  it("answers an acknowledgement that waited for a fold of its change with the newer change, and never acknowledges both", async () => {
    const start = evening(11);
    const f = await venue(start, new Date(start.getTime() + 5 * HOUR));
    expect((await updateBookingCore(db, f.actor, f.ink.id, shifted(start, 1))).ok).toBe(true);
    const [first] = (await feedOf(f.eventId)).waiting;
    if (first === undefined) throw new Error("The first move was not recorded");

    const held = gate();
    const moving = db.transaction(async (tx) => {
      const moved = await updateBookingCore(tx, f.actor, f.ink.id, shifted(start, 2));
      held.enter();
      await held.open;
      return moved;
    });
    await held.entered;
    const acknowledging = server.inject({ method: "POST", url: `/events/${f.eventId}/change-acknowledgements`,
      headers: headers(f, "hallkeeper"), payload: { changeId: first.id } });
    await sleep(400);
    held.release();
    const [moved, ack] = await Promise.all([moving, acknowledging]);
    expect(moved.ok).toBe(true);

    const feed = await feedOf(f.eventId);
    expect(feed.acknowledged).toEqual([]);
    expect(ack.statusCode, ack.body).toBe(409);
    expect(ack.json()).toMatchObject({ code: "CHANGE_SUPERSEDED", details: { supersededBy: feed.waiting[0]?.id } });
  });

  it("answers Got it on a move already folded into a newer one with the newer change's id", async () => {
    const start = evening(12);
    const f = await venue(start, new Date(start.getTime() + 5 * HOUR));
    expect((await updateBookingCore(db, f.actor, f.ink.id, shifted(start, 1))).ok).toBe(true);
    const [first] = (await feedOf(f.eventId)).waiting;
    expect((await updateBookingCore(db, f.actor, f.ink.id, shifted(start, 2))).ok).toBe(true);
    const [newer] = (await feedOf(f.eventId)).waiting;
    const ack = await server.inject({ method: "POST", url: `/events/${f.eventId}/change-acknowledgements`,
      headers: headers(f, "hallkeeper"), payload: { changeId: first?.id } });
    expect(ack.statusCode, ack.body).toBe(409);
    expect(ack.json()).toMatchObject({ code: "CHANGE_SUPERSEDED", details: { supersededBy: newer?.id } });
  });

  it("re-reads a proposal's booking under its lock, so a Diary move made meanwhile is told back, not left standing", async () => {
    const start = evening(13);
    const f = await venue(start, new Date(start.getTime() + 4 * HOUR));
    const day = new Date(start.getTime() + DAY);
    const [proposal] = await insertBoundBookings(db, [{
      venueId: f.venueId, spaceId: f.hallId, kind: "hold", title: "TEST ONLY proposed supper", createdBy: f.adminId,
      startsAt: day, endsAt: new Date(day.getTime() + 3 * HOUR), decisionAt: start, ownerUserId: f.adminId,
      nextAction: "TEST ONLY decide the proposed supper", nextActionDueAt: start,
    }]);
    if (proposal === undefined || proposal.eventId === null) throw new Error("The hold was not bound to an event");
    const eventId = proposal.eventId;
    const proposer = { id: f.adminId, name: "Elaine", role: "admin", venueId: f.venueId, platformRole: "none" as const };
    const window = { spaceId: f.hallId, ...shifted(day, 0, 3) };

    // The office drags the hold to 20:00 in the Diary; before it commits, the same window is proposed again.
    const held = gate();
    const officeMove = db.transaction(async (tx) => {
      const moved = await updateBookingCore(tx, f.actor, proposal.id, shifted(day, 2, 3));
      held.enter();
      await held.open;
      return moved;
    });
    await held.entered;
    const reproposing = proposeWindowCore(db, proposer, eventId, { ...window, idempotencyKey: randomUUID() });
    await sleep(400);
    held.release();
    const [office, again] = await Promise.all([officeMove, reproposing]);
    expect(office.ok && again.ok).toBe(true);

    const [hold] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, proposal.id));
    expect(hold?.startsAt.toISOString()).toBe(window.startsAt);
    // Nothing waits that says the hold stands at 20:00: the drag and the
    // proposal took it there and back within the quiet window.
    expect((await feedOf(eventId)).waiting.map((row) => row.afterSummary)).toEqual([]);
  });

  it("retires a waiting move when a later correction ends in the past, so no change names a place the booking left", async () => {
    const start = new Date(Date.now() - 3 * HOUR);
    const f = await venue(start, new Date(start.getTime() + 4 * HOUR));
    expect((await updateBookingCore(db, f.actor, f.ink.id, { endsAt: new Date(start.getTime() + 5 * HOUR).toISOString() })).ok).toBe(true);
    expect((await feedOf(f.eventId)).waiting.map((row) => row.title)).toEqual(["Times moved"]);
    expect((await updateBookingCore(db, f.actor, f.ink.id, { endsAt: new Date(Date.now() - 30 * 60_000).toISOString() })).ok).toBe(true);
    expect((await feedOf(f.eventId)).waiting).toEqual([]);
  });

  /** A slip that sets a booking under way to have ended ten minutes ago. */
  function slipIntoThePast(): { endsAt: string } {
    return { endsAt: new Date(Date.now() - 10 * 60_000).toISOString() };
  }

  it("keeps the place the floor last knew through a move into the past, so the correction is told from it", async () => {
    // A dinner under way is extended half an hour (waiting), a slip ends it in
    // the past, and the correction puts the extension back. The floor knew
    // the dinner's first hours and never saw the slip.
    const start = new Date(Date.now() - 2 * HOUR);
    const f = await venue(start, new Date(start.getTime() + 5 * HOUR));
    const extended = { endsAt: new Date(start.getTime() + 5.5 * HOUR).toISOString() };
    expect((await updateBookingCore(db, f.actor, f.ink.id, extended)).ok).toBe(true);
    expect((await updateBookingCore(db, f.actor, f.ink.id, slipIntoThePast())).ok).toBe(true);
    expect((await feedOf(f.eventId)).waiting).toEqual([]);
    expect((await updateBookingCore(db, f.actor, f.ink.id, extended)).ok).toBe(true);
    expect((await feedOf(f.eventId)).waiting.map((row) => [row.title, row.beforeSummary, row.afterSummary])).toEqual([
      ["Times moved", `Grand Hall, ${hoursOf(start, 0)}`, `Grand Hall, ${hoursOf(start, 0, 5.5)}`],
    ]);
  });

  it("tells a correction after a slip into the past from the place the floor knew, though nothing was waiting, and nothing when the slip is put straight back", async () => {
    const start = new Date(Date.now() - 2 * HOUR);
    const f = await venue(start, new Date(start.getTime() + 5 * HOUR));
    expect((await updateBookingCore(db, f.actor, f.ink.id, slipIntoThePast())).ok).toBe(true);
    // Put straight back: the floor never saw the slip, so there is nothing to tell.
    expect((await updateBookingCore(db, f.actor, f.ink.id, { endsAt: new Date(start.getTime() + 5 * HOUR).toISOString() })).ok).toBe(true);
    expect((await feedOf(f.eventId)).waiting).toEqual([]);
    expect((await updateBookingCore(db, f.actor, f.ink.id, slipIntoThePast())).ok).toBe(true);
    expect((await updateBookingCore(db, f.actor, f.ink.id, { endsAt: new Date(start.getTime() + 5.5 * HOUR).toISOString() })).ok).toBe(true);
    expect((await feedOf(f.eventId)).waiting.map((row) => [row.title, row.beforeSummary, row.afterSummary])).toEqual([
      ["Times moved", `Grand Hall, ${hoursOf(start, 0)}`, `Grand Hall, ${hoursOf(start, 0, 5.5)}`],
    ]);
  });

  it("tells a move back after a slip into the past from the place the floor was last shown", async () => {
    const start = new Date(Date.now() - 2 * HOUR);
    const f = await venue(start, new Date(start.getTime() + 5 * HOUR));
    expect((await updateBookingCore(db, f.actor, f.ink.id, { endsAt: new Date(start.getTime() + 5.5 * HOUR).toISOString() })).ok).toBe(true);
    const [extension] = (await feedOf(f.eventId)).waiting;
    if (extension === undefined) throw new Error("The extension was not recorded");
    await readBell(f, extension.id);
    expect((await updateBookingCore(db, f.actor, f.ink.id, slipIntoThePast())).ok).toBe(true);
    expect((await updateBookingCore(db, f.actor, f.ink.id, { endsAt: new Date(start.getTime() + 5 * HOUR).toISOString() })).ok).toBe(true);
    expect((await feedOf(f.eventId)).waiting.map((row) => [row.title, row.beforeSummary, row.afterSummary])).toEqual([
      ["Back to the original hours", `Grand Hall, ${hoursOf(start, 0, 5.5)}`, `Grand Hall, ${hoursOf(start, 0)}`],
    ]);
  });

  it("tells the new event when a booking moves to it in the same edit as its hours", async () => {
    const start = evening(14);
    const f = await venue(start, new Date(start.getTime() + 4 * HOUR));
    const [other] = await insertBoundBookings(db, [{
      venueId: f.venueId, spaceId: f.saloonId, kind: "ink", title: "TEST ONLY merged reception", eventType: "wedding",
      createdBy: f.adminId, startsAt: start, endsAt: new Date(start.getTime() + 4 * HOUR),
    }]);
    if (other === undefined || other.eventId === null) throw new Error("The second ink was not bound to an event");
    const moved = await updateBookingCore(db, f.actor, f.ink.id, { eventId: other.eventId, ...shifted(start, 1, 4) });
    expect(moved.ok).toBe(true);
    expect((await feedOf(other.eventId)).waiting.map((row) => [row.title, row.sourceId, row.beforeSummary, row.afterSummary])).toEqual([
      ["Times moved", f.ink.id, `Grand Hall, ${hoursOf(start, 0, 4)}`, `Grand Hall, ${hoursOf(start, 1, 4)}`],
    ]);
  });

  /** A change straight into the feed, as another part of the product records one. */
  function changeRow(f: Fixture, eventId: string, overrides: Partial<typeof schema.eventPlanChanges.$inferInsert> = {}): typeof schema.eventPlanChanges.$inferInsert {
    return {
      eventId, venueId: f.venueId, actorRole: "staff", actorLabel: "Events desk", sourceKind: "event", sourceId: eventId,
      title: "Event plan updated", summary: "TEST ONLY: guests changed.", affectedSurfaces: ["guest_count"],
      audienceRoles: ["staff", "hallkeeper"], riskLevel: "attention", requiresHallkeeperAcknowledgement: true, ...overrides,
    };
  }

  it("reads each event's own waiting changes, however busy another event is", async () => {
    const start = evening(15);
    const f = await venue(start, new Date(start.getTime() + 4 * HOUR));
    const [quiet] = await insertBoundBookings(db, [{
      venueId: f.venueId, spaceId: f.saloonId, kind: "ink", title: "TEST ONLY quiet supper", eventType: "dinner",
      createdBy: f.adminId, startsAt: start, endsAt: new Date(start.getTime() + 3 * HOUR),
    }]);
    if (quiet === undefined || quiet.eventId === null) throw new Error("The second ink was not bound to an event");
    const older = new Date(Date.now() - DAY);
    await db.insert(schema.eventPlanChanges).values(changeRow(f, quiet.eventId, { createdAt: older }));
    await db.insert(schema.eventPlanChanges).values(Array.from({ length: 501 }, (_, index) =>
      changeRow(f, f.eventId, { createdAt: new Date(older.getTime() + (index + 1) * 60_000) })));
    const read = await awaiting(f, "hallkeeper", [f.eventId, quiet.eventId]);
    const byEvent = new Map(read.map((entry) => [entry.eventId, entry.changes.length]));
    expect(byEvent.get(quiet.eventId)).toBe(1);
    expect(byEvent.get(f.eventId)).toBe(50);
  });

  /** A board's day around `at`: from the morning before to the small hours after. */
  function dayOf(at: Date): { readonly from: Date; readonly to: Date } {
    return { from: new Date(at.getTime() - 12 * HOUR), to: new Date(at.getTime() + 10 * HOUR) };
  }

  it("keeps a day's own change within the cap, however busy its event's other days, and a change with no place on every day", async () => {
    // A three-day conference is one event: Thursday's plenary in the Grand
    // Hall, Friday's and Saturday's sessions in the Saloon.
    const thursday = evening(20);
    const f = await venue(thursday, new Date(thursday.getTime() + 3 * HOUR));
    const friday = new Date(thursday.getTime() + DAY);
    const saturday = new Date(thursday.getTime() + 2 * DAY);
    const session = (startsAt: Date, title: string, kind: "ink" | "prospect" = "ink") => ({
      venueId: f.venueId, spaceId: f.saloonId, kind, title, eventType: "wedding", eventId: f.eventId, createdBy: f.adminId,
      startsAt, endsAt: new Date(startsAt.getTime() + 3 * HOUR),
    });
    const [, , prospect] = await insertBoundBookings(db, [
      session(friday, "TEST ONLY day two"),
      session(saturday, "TEST ONLY day three"),
      session(new Date(thursday.getTime() + 30 * DAY), "TEST ONLY a further day, still an enquiry", "prospect"),
    ]);
    if (prospect === undefined) throw new Error("The prospect was not bound to the event");
    const phase = (startsAt: Date, spaceId: string | null, name: string) => ({ eventId: f.eventId, spaceId, name, sortOrder: 50, startsAt, durationMinutes: 60 });
    const [fridaySession, saturdaySession, roomless, stray] = await db.insert(schema.eventPhases).values([
      phase(friday, f.saloonId, "TEST ONLY Friday session"),
      phase(saturday, f.saloonId, "TEST ONLY Saturday session"),
      // Timed with no room: the calendar lists it nowhere.
      phase(thursday, null, "TEST ONLY timed, with no room"),
      // Friday, in a room the event holds no booking in that day: no slot holds it.
      phase(new Date(friday.getTime() + HOUR), f.hallId, "TEST ONLY Friday, in the Grand Hall"),
    ]).returning();
    if (fridaySession === undefined || saturdaySession === undefined || roomless === undefined || stray === undefined) {
      throw new Error("The phases were not made");
    }

    // The office moves Thursday's plenary half an hour later, and moves the
    // enquiry's date, which no board shows.
    expect((await updateBookingCore(db, f.actor, f.ink.id, shifted(thursday, 0.5, 3))).ok).toBe(true);
    expect((await updateBookingCore(db, f.actor, prospect.id, shifted(prospect.startsAt, 1, 3))).ok).toBe(true);
    // Then the When ribbon reworks Friday and Saturday: sixty phase edits, all
    // newer, and last of all the Friday phase in the Grand Hall.
    const later = (minutes: number): Date => new Date(Date.now() + minutes * 60_000);
    await db.insert(schema.eventPlanChanges).values([
      changeRow(f, f.eventId, { sourceId: roomless.id, title: "Event phase updated", createdAt: later(1) }),
      ...Array.from({ length: 60 }, (_, index) => changeRow(f, f.eventId, {
        sourceId: index < 55 ? fridaySession.id : saturdaySession.id, title: "Event phase updated", createdAt: later(10 + index),
      })),
      changeRow(f, f.eventId, { sourceId: stray.id, title: "Event phase updated", createdAt: later(120) }),
    ]);
    const marks = (entry: EventAwaitingAcknowledgement | undefined) => (entry?.changes ?? []).map((change) => [change.sourceId, change.eventWide]);

    // Thursday reads its own move, and what no board places, marked for every slot of the event.
    const [onThursday] = await awaiting(f, "hallkeeper", [f.eventId], dayOf(thursday));
    expect(marks(onThursday)).toEqual([[roomless.id, true], [prospect.id, true], [f.ink.id, false]]);
    expect(onThursday?.truncated).toBe(false);

    // Friday reads its own, newest first, at most 50, and says there were more.
    const [onFriday] = await awaiting(f, "hallkeeper", [f.eventId], dayOf(friday));
    expect(onFriday?.changes).toHaveLength(50);
    expect(marks(onFriday)[0]).toEqual([stray.id, true]);
    expect(new Set(marks(onFriday).slice(1).map(([sourceId, wide]) => `${String(sourceId)}:${String(wide)}`))).toEqual(new Set([`${fridaySession.id}:false`]));
    expect(onFriday?.truncated).toBe(true);

    const [onSaturday] = await awaiting(f, "hallkeeper", [f.eventId], dayOf(saturday));
    expect(marks(onSaturday)).toEqual([
      ...Array.from({ length: 5 }, () => [saturdaySession.id, false]), [roomless.id, true], [prospect.id, true],
    ]);
    expect(onSaturday?.truncated).toBe(false);

    // A read without a day, as a board from before the day was sent: the
    // newest 50 of the event's, and that there were more.
    const [anyDay] = await awaiting(f, "hallkeeper", [f.eventId]);
    expect(anyDay?.changes).toHaveLength(50);
    expect(anyDay?.truncated).toBe(true);
    expect(anyDay?.changes.some((change) => change.sourceId === f.ink.id)).toBe(false);
  });

  it("places a Diary move on the day the floor knew it and on the day it went to", async () => {
    const thursday = evening(26);
    const f = await venue(thursday, new Date(thursday.getTime() + 4 * HOUR));
    expect((await updateBookingCore(db, f.actor, f.ink.id, shifted(thursday, 24, 4))).ok).toBe(true);
    const sourcesOn = async (at: Date) => ((await awaiting(f, "hallkeeper", [f.eventId], dayOf(at)))[0]?.changes ?? [])
      .map((change) => [change.sourceId, change.eventWide]);
    expect(await sourcesOn(thursday)).toEqual([[f.ink.id, false]]);
    expect(await sourcesOn(new Date(thursday.getTime() + DAY))).toEqual([[f.ink.id, false]]);
    expect(await sourcesOn(new Date(thursday.getTime() + 2 * DAY))).toEqual([]);
  });

  it("answers a board's day that is not a day plainly", async () => {
    const start = evening(27);
    const f = await venue(start, new Date(start.getTime() + 4 * HOUR));
    const read = (query: string) => server.inject({ method: "GET", url: `/events/awaiting-acknowledgement?eventIds=${f.eventId}${query}`, headers: headers(f, "hallkeeper") });
    expect((await read(`&from=${encodeURIComponent(start.toISOString())}`)).statusCode).toBe(400);
    expect((await read(`&from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(start.toISOString())}`)).statusCode).toBe(400);
    expect((await read("&from=yesterday&to=today")).statusCode).toBe(400);
  });

  it("keeps a replaced move's bell for those who opened it, and out of everyone else's list and unread count", async () => {
    const start = evening(28);
    const f = await venue(start, new Date(start.getTime() + 5 * HOUR));
    const moragId = randomUUID();
    await db.insert(schema.users).values({ id: moragId, venueId: f.venueId, name: "Morag", email: `${moragId}@floor.invalid`, role: "hallkeeper" });
    const as = (id: string) => ({ authorization: `Bearer ${JSON.stringify({ id, email: `${id}@floor.invalid`, role: "hallkeeper", platformRole: "none", venueId: f.venueId })}` });
    const bellsFor = async (id: string) => {
      const list = await server.inject({ method: "GET", url: "/notifications?status=all", headers: as(id) });
      const count = await server.inject({ method: "GET", url: "/notifications/unread-count", headers: as(id) });
      expect(list.statusCode, list.body).toBe(200);
      expect(count.statusCode, count.body).toBe(200);
      return {
        list: list.json<{ data: { id: string; readAt: string | null }[] }>().data.map((bell) => [bell.id, bell.readAt !== null]),
        unread: count.json<{ data: { unread: number } }>().data.unread,
      };
    };

    expect((await updateBookingCore(db, f.actor, f.ink.id, shifted(start, 1))).ok).toBe(true);
    const [away] = (await feedOf(f.eventId)).waiting;
    if (away === undefined) throw new Error("The move was not recorded");
    const opened = await readBell(f, away.id);
    expect((await updateBookingCore(db, f.actor, f.ink.id, shifted(start, 2))).ok).toBe(true);
    const [now] = (await feedOf(f.eventId)).waiting;
    const [newer] = await db.select().from(schema.eventPlanNotifications).where(and(
      eq(schema.eventPlanNotifications.changeId, now?.id ?? ""), eq(schema.eventPlanNotifications.audienceRole, "hallkeeper")));
    if (newer === undefined) throw new Error("The newer change rang no hallkeeper bell");

    // Jamie keeps the bell he opened, as read, beside the newer one.
    expect(await bellsFor(f.hallkeeperId)).toEqual({ list: [[newer.id, false], [opened, true]], unread: 1 });
    // Morag never opened it: she has the newer bell only, and one to read.
    expect(await bellsFor(moragId)).toEqual({ list: [[newer.id, false]], unread: 1 });
  });

  it("leaves proposal traffic to the event-day board: the Day Board reads changes to the plan", async () => {
    const start = evening(16);
    const f = await venue(start, new Date(start.getTime() + 4 * HOUR));
    const [request] = await db.insert(schema.eventPlanChanges).values(changeRow(f, f.eventId, {
      sourceKind: "proposal", sourceId: randomUUID(), title: "Proposal status changed", summary: "TEST ONLY: changes requested.",
      affectedSurfaces: ["proposal"],
    })).returning();
    await db.insert(schema.eventPlanChangeAcknowledgements).values({
      changeId: request?.id ?? "", eventId: f.eventId, acknowledgedBy: f.hallkeeperId, acknowledgedByRole: "hallkeeper",
    });
    await db.insert(schema.eventPlanChanges).values(changeRow(f, f.eventId, {
      sourceKind: "proposal", sourceId: randomUUID(), title: "Proposal status changed", summary: "TEST ONLY: accepted.", affectedSurfaces: ["proposal"],
    }));
    expect(await awaiting(f, "hallkeeper", [f.eventId])).toEqual([{ eventId: f.eventId, changes: [], truncated: false, lastAcknowledgement: null }]);
  });

  it("names where each move put its booking, as instants, for the board's day", async () => {
    const start = evening(17);
    const f = await venue(start, new Date(start.getTime() + 4 * HOUR));
    expect((await updateBookingCore(db, f.actor, f.ink.id, { spaceId: f.saloonId, ...shifted(start, DAY / HOUR, 4) })).ok).toBe(true);
    const [entry] = await awaiting(f, "hallkeeper", [f.eventId]);
    expect(entry?.changes.map((change) => change.movedTo)).toEqual([{
      spaceId: f.saloonId,
      startsAt: new Date(start.getTime() + DAY).toISOString(),
      endsAt: new Date(start.getTime() + DAY + 4 * HOUR).toISOString(),
    }]);
  });

  it("keeps a move's places whole: a change carries all of them or none, each place forward in time", async () => {
    const start = evening(18);
    const f = await venue(start, new Date(start.getTime() + 4 * HOUR));
    const insert = (columns: string, values: readonly unknown[]) => pool.query(
      `INSERT INTO event_plan_changes (event_id, venue_id, actor_role, actor_label, source_kind, source_id, title, summary,
        affected_surfaces, audience_roles${columns}) VALUES ($1, $2, 'staff', 'Events desk', 'event', $3, 'Times moved', 'TEST ONLY.',
        '["timings"]', '["staff"]'${values.map((_, index) => `, $${String(index + 4)}`).join("")})`,
      [f.eventId, f.venueId, f.ink.id, ...values]);
    const rejected = { code: "23514", constraint: "event_plan_changes_booking_move_places" };
    await expect(insert(", move_chain_id", [randomUUID()])).rejects.toMatchObject(rejected);
    const place = [f.hallId, start.toISOString(), new Date(start.getTime() + HOUR).toISOString()];
    const seven = ", move_known_space_id, move_known_starts_at, move_known_ends_at, move_to_space_id, move_to_starts_at, move_to_ends_at, move_chain_id";
    const all = `${seven}, move_told`;
    // Whether the floor was told belongs with the places: never one without the other.
    await expect(insert(seven, [...place, ...place, randomUUID()])).rejects.toMatchObject(rejected);
    await expect(insert(", move_told", [true])).rejects.toMatchObject(rejected);
    await expect(insert(all, [...place, f.hallId, place[2], place[1], randomUUID(), true])).rejects.toMatchObject(rejected);
    await expect(insert(all, [...place, ...place, randomUUID(), true])).resolves.toMatchObject({ rowCount: 1 });
    await expect(insert(all, [...place, ...place, randomUUID(), false])).resolves.toMatchObject({ rowCount: 1 });
  });

  it("answers a bell opened while a quick Undo takes it away as gone, not as a fault", async () => {
    const start = evening(19);
    const f = await venue(start, new Date(start.getTime() + 5 * HOUR));
    expect((await updateBookingCore(db, f.actor, f.ink.id, shifted(start, 1))).ok).toBe(true);
    const [away] = (await feedOf(f.eventId)).waiting;
    const [bell] = await db.select().from(schema.eventPlanNotifications).where(and(
      inArray(schema.eventPlanNotifications.changeId, [away?.id ?? ""]), eq(schema.eventPlanNotifications.audienceRole, "hallkeeper")));
    const held = gate();
    const undo = db.transaction(async (tx) => {
      const moved = await updateBookingCore(tx, f.actor, f.ink.id, shifted(start, 0));
      held.enter();
      await held.open;
      return moved;
    });
    await held.entered;
    const opening = server.inject({ method: "PATCH", url: `/notifications/${bell?.id ?? ""}/read`, headers: headers(f, "hallkeeper") });
    await sleep(400);
    held.release();
    const [undone, opened] = await Promise.all([undo, opening]);
    expect(undone.ok).toBe(true);
    expect(opened.statusCode, opened.body).toBe(404);
  });
});
