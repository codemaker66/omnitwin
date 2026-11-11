import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { hallkeeperSheetRoutes } from "../routes/hallkeeper-sheet.js";

// ---------------------------------------------------------------------------
// A layout the Day Board offers through a frozen phase plan (T-695 audit
// api-eventday-sheet-6).
//
// Staff can freeze a layout onto an event's phase without linking it to the
// event (routes/phase-layout-snapshots.ts writes no link row), and the Day
// Board offers that layout for the event (web lib/event-linked-layouts.ts).
// The sheet's ticks took that event, but its times did not: "Date not set"
// on the sheet and "Ready by not set" on the board, though the event's
// booking holds the room. And because ticks took ANY live event of the venue,
// a stale ?eventId= filed them under an event the layout does not serve.
// One set of events the layout serves now decides both.
//
// Through the routes the Day Board reads, on the migrated disposable platform
// database. Opt-in only; never reads DATABASE_URL or .env.
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const url = new URL(target);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55477"
    || url.pathname !== "/venviewer_platform_test" || url.search || url.hash) {
    throw new Error("Phase plan sheet tests require the explicitly owned disposable platform database");
  }
}

const OUTLINE = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
const SATURDAY_DINNER = "2026-12-05T17:00:00.000Z";
const STRANGER_EVENING = "2026-12-05T21:30:00.000Z";

interface SummaryBody { readonly data: { readonly eventStart: string | null; readonly total: number; readonly checked: number } }
interface SheetBody { readonly data: { readonly phases: readonly { readonly zones: readonly { readonly rows: readonly { readonly key: string }[] }[] }[] } }

describe.skipIf(target === undefined)("a layout reached through a frozen phase plan, on disposable PostgreSQL", () => {
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit target required");
    pool = new Pool({ connectionString: target, application_name: `phase-plan-sheet-${randomUUID()}` });
    expect((await pool.query<{ database: string }>("SELECT current_database() AS database")).rows[0]?.database)
      .toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(hallkeeperSheetRoutes, { db, prefix: "/hallkeeper" });
    await server.ready();
  });
  afterAll(async () => { await server?.close(); await pool?.end(); });

  /** A room, a one-chair layout linked to no event, and Saturday's dinner
   *  booked in the room, whose Dinner phase has the layout frozen onto it. */
  async function frozenOntoSaturday() {
    const venueId = randomUUID(); const roomId = randomUUID(); const userId = randomUUID();
    const configId = randomUUID(); const assetId = randomUUID(); const saturday = randomUUID(); const phaseId = randomUUID();
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY phase plan venue", slug: `phase-plan-${venueId}`, address: "Disposable fixture" });
    await db.insert(schema.spaces).values({ id: roomId, venueId, name: "TEST ONLY hall", slug: `hall-${roomId}`, widthM: "10", lengthM: "10", heightM: "3", floorPlanOutline: OUTLINE });
    await db.insert(schema.users).values({ id: userId, venueId, name: "TEST ONLY hallkeeper", email: `${userId}@phase-plan.invalid`, role: "hallkeeper" });
    await db.insert(schema.configurations).values({ id: configId, venueId, spaceId: roomId, userId: null, name: "TEST ONLY dinner layout", slug: `plan-${configId}`, layoutStyle: "custom" });
    await db.insert(schema.assetDefinitions).values({ id: assetId, name: "TEST ONLY chair", category: "chair", widthM: ".45", depthM: ".45", heightM: ".9", collisionType: "box" });
    await db.insert(schema.placedObjects).values({ configurationId: configId, assetDefinitionId: assetId, positionX: "1", positionY: "0", positionZ: "1", coordinateWriteToken: randomUUID() });
    await db.insert(schema.events).values({ id: saturday, venueId, createdBy: userId, name: "TEST ONLY Saturday dinner" });
    await db.insert(schema.bookings).values({ venueId, spaceId: roomId, eventId: saturday, kind: "ink", status: "active", title: "TEST ONLY Saturday dinner",
      startsAt: new Date(SATURDAY_DINNER), endsAt: new Date(Date.parse(SATURDAY_DINNER) + 4 * 3_600_000) });
    await db.insert(schema.eventPhases).values({ id: phaseId, eventId: saturday, spaceId: roomId, name: "Dinner", sortOrder: 0, durationMinutes: 240 });
    const frozenAt = new Date("2026-11-20T10:00:00.000Z");
    await db.insert(schema.phaseLayoutSnapshots).values({ eventPhaseId: phaseId, configurationId: configId, status: "frozen", frozenBy: userId, createdAt: frozenAt, frozenAt });
    const headers = { authorization: `Bearer ${JSON.stringify({ id: userId, name: "TEST ONLY hallkeeper", email: `${userId}@phase-plan.invalid`, role: "hallkeeper", venueId })}` };
    const sheet = await server.inject({ method: "GET", url: `/hallkeeper/${configId}/v2`, headers });
    expect(sheet.statusCode, sheet.body).toBe(200);
    const rowKey = sheet.json<SheetBody>().data.phases[0]?.zones[0]?.rows[0]?.key;
    if (rowKey === undefined) throw new Error("The fixture layout must have a sheet row");
    return { venueId, roomId, userId, configId, saturday, phaseId, headers, rowKey };
  }
  type Fixture = Awaited<ReturnType<typeof frozenOntoSaturday>>;

  async function summary(f: Fixture, eventId: string): Promise<SummaryBody["data"]> {
    const response = await server.inject({ method: "GET", url: `/hallkeeper/${f.configId}/summary?eventId=${eventId}`, headers: f.headers });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<SummaryBody>().data;
  }

  async function tick(f: Fixture, eventId: string): Promise<void> {
    const response = await server.inject({ method: "PATCH", url: `/hallkeeper/${f.configId}/progress?eventId=${eventId}`,
      headers: f.headers, payload: { rowKey: f.rowKey, checked: true } });
    expect(response.statusCode, response.body).toBe(200);
  }

  async function storedEvents(f: Fixture): Promise<(string | null)[]> {
    const rows = await db.select({ eventId: schema.hallkeeperProgress.eventId }).from(schema.hallkeeperProgress)
      .where(eq(schema.hallkeeperProgress.configId, f.configId));
    return rows.map((row) => row.eventId);
  }

  it("reads that event's hour, and keeps its ticks as its own", async () => {
    const f = await frozenOntoSaturday();
    expect((await summary(f, f.saturday)).eventStart).toBe(SATURDAY_DINNER);
    await tick(f, f.saturday);
    expect(await storedEvents(f)).toEqual([f.saturday]);
    expect(await summary(f, f.saturday)).toMatchObject({ eventStart: SATURDAY_DINNER, checked: 1 });
  });

  it("gives an event of the venue the layout does not serve neither its ticks nor its times", async () => {
    // A stale bookmark or a hand-edited ?eventId=: another client's evening in
    // the same room, which this layout was never set for.
    const f = await frozenOntoSaturday();
    const stranger = randomUUID();
    await db.insert(schema.events).values({ id: stranger, venueId: f.venueId, createdBy: f.userId, name: "TEST ONLY stranger" });
    await db.insert(schema.bookings).values({ venueId: f.venueId, spaceId: f.roomId, eventId: stranger, kind: "ink", status: "active", title: "TEST ONLY stranger",
      startsAt: new Date(STRANGER_EVENING), endsAt: new Date(Date.parse(STRANGER_EVENING) + 2 * 3_600_000) });

    await tick(f, stranger);
    expect(await storedEvents(f)).toEqual([f.saturday]);
    expect(await summary(f, stranger)).toMatchObject({ eventStart: SATURDAY_DINNER, checked: 1 });
  });

  it("stops serving the event once the phase's latest frozen plan is another layout, or the phase is in another room", async () => {
    const f = await frozenOntoSaturday();
    const otherConfig = randomUUID();
    await db.insert(schema.configurations).values({ id: otherConfig, venueId: f.venueId, spaceId: f.roomId, userId: null, name: "TEST ONLY other layout", slug: `plan-${otherConfig}`, layoutStyle: "custom" });
    const refrozenAt = new Date("2026-11-21T10:00:00.000Z");
    await db.insert(schema.phaseLayoutSnapshots).values({ eventPhaseId: f.phaseId, configurationId: otherConfig, status: "frozen", frozenBy: f.userId, createdAt: refrozenAt, frozenAt: refrozenAt });
    expect((await summary(f, f.saturday)).eventStart).toBeNull();
    await tick(f, f.saturday);
    expect(await storedEvents(f)).toEqual([null]);

    // A phase in another room never makes this room's layout that event's.
    const elsewhere = await frozenOntoSaturday();
    const otherRoom = randomUUID();
    await db.insert(schema.spaces).values({ id: otherRoom, venueId: elsewhere.venueId, name: "TEST ONLY saloon", slug: `saloon-${otherRoom}`, widthM: "8", lengthM: "8", heightM: "3", floorPlanOutline: OUTLINE });
    await db.update(schema.eventPhases).set({ spaceId: otherRoom }).where(eq(schema.eventPhases.id, elsewhere.phaseId));
    expect((await summary(elsewhere, elsewhere.saturday)).eventStart).toBeNull();
  });
});
