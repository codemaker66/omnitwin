import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { hallkeeperSheetRoutes } from "../routes/hallkeeper-sheet.js";

// ---------------------------------------------------------------------------
// A setup sheet's ticks against real PostgreSQL (migration 0098).
//
// hallkeeper_progress keyed a tick on the layout alone, so a layout reused
// for a second event opened with the first event's ticks and the Day Board
// could count a room as set that nobody had touched tonight. Which event a
// tick belongs to is a WHERE clause, a unique key and an ON CONFLICT target —
// none of which a mock can prove — so the routes run here against a
// disposable database.
//
// Never reads DATABASE_URL/.env. Opt in with a separately provisioned,
// disposable local database:
//   VENVIEWER_PROGRESS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55431/venviewer_progress_test
// ---------------------------------------------------------------------------

// The routes authenticate with the test-mode bearer.
process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_PROGRESS_TEST_DATABASE_URL"];

function assertTestTarget(raw: string): void {
  const url = new URL(raw);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1"
    || url.pathname !== "/venviewer_progress_test" || url.search !== "" || url.hash !== "") {
    throw new Error("Sheet tick tests require the explicit loopback venviewer_progress_test database");
  }
}

describe("sheet tick PostgreSQL target guard", () => {
  it.each([
    "postgresql://user@production.example/venviewer_progress_test",
    "postgresql://postgres@127.0.0.1/production",
    "postgresql://postgres@127.0.0.1/venviewer_progress_test?host=production.example",
  ])("rejects an unsafe target: %s", (url) => {
    expect(() => { assertTestTarget(url); }).toThrow();
  });
});

interface ProgressBody { readonly data: { readonly eventId: string | null; readonly linkedEvents: number; readonly checked: Record<string, string> } }
interface SummaryBody { readonly data: { readonly total: number; readonly checked: number } }
interface SheetBody { readonly data: { readonly phases: readonly { readonly zones: readonly { readonly rows: readonly { readonly key: string }[] }[] }[] } }

describe.skipIf(target === undefined)("a setup sheet's ticks belong to the event the room was set for", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    assertTestTarget(target);
    pool = new Pool({ connectionString: target });
    expect((await pool.query<{ database: string }>("SELECT current_database() AS database")).rows[0]?.database)
      .toBe("venviewer_progress_test");
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    server = Fastify();
    await server.register(hallkeeperSheetRoutes, { db, prefix: "/hallkeeper" });
    await server.ready();
  }, 120000);

  afterAll(async () => { await server?.close(); await pool?.end(); });

  /** One room and one layout of one chair (one sheet row), linked to `eventCount` events. */
  async function layout(eventCount: number) {
    const venueId = randomUUID(); const roomId = randomUUID(); const userId = randomUUID();
    const configId = randomUUID(); const assetId = randomUUID();
    await db.insert(schema.venues).values({ id: venueId, name: "DEMO ONLY venue", slug: venueId, address: "Test only" });
    await db.insert(schema.spaces).values({ id: roomId, venueId, name: "Room", slug: `room-${roomId}`, widthM: "10", lengthM: "10", heightM: "3",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] });
    await db.insert(schema.users).values({ id: userId, venueId, name: "Test hallkeeper", email: `${userId}@demo.invalid`, role: "hallkeeper" });
    await db.insert(schema.configurations).values({ id: configId, venueId, spaceId: roomId, userId: null,
      name: "DEMO ONLY plan", slug: `plan-${configId}`, layoutStyle: "custom" });
    await db.insert(schema.assetDefinitions).values({ id: assetId, name: "Chair", category: "chair", widthM: ".45", depthM: ".45", heightM: ".9", collisionType: "box" });
    await db.insert(schema.placedObjects).values({ configurationId: configId, assetDefinitionId: assetId,
      positionX: "1", positionY: "0", positionZ: "1", coordinateWriteToken: randomUUID() });
    const eventIds: string[] = [];
    for (let index = 0; index < eventCount; index += 1) {
      const eventId = randomUUID();
      await db.insert(schema.events).values({ id: eventId, venueId, createdBy: userId, name: `DEMO ONLY event ${String(index)}` });
      await db.insert(schema.eventConfigurationLinks).values({ eventId, configurationId: configId, linkType: "variant_configuration" });
      eventIds.push(eventId);
    }
    const headers = { authorization: `Bearer ${JSON.stringify({ id: userId, name: "Test hallkeeper", email: `${userId}@demo.invalid`, role: "hallkeeper", venueId })}` };
    const sheet = await server.inject({ method: "GET", url: `/hallkeeper/${configId}/v2`, headers });
    expect(sheet.statusCode, sheet.body).toBe(200);
    const rowKey = sheet.json<SheetBody>().data.phases[0]?.zones[0]?.rows[0]?.key;
    if (rowKey === undefined) throw new Error("The fixture layout must have a sheet row");
    return { configId, userId, eventIds, headers, rowKey };
  }
  type Layout = Awaited<ReturnType<typeof layout>>;

  const query = (eventId: string | null): string => eventId === null ? "" : `?eventId=${eventId}`;

  async function tick(f: Layout, eventId: string | null, checked?: boolean): Promise<void> {
    const response = await server.inject({ method: "PATCH", url: `/hallkeeper/${f.configId}/progress${query(eventId)}`,
      headers: f.headers, payload: checked === undefined ? { rowKey: f.rowKey } : { rowKey: f.rowKey, checked } });
    expect(response.statusCode, response.body).toBe(200);
  }

  async function progress(f: Layout, eventId: string | null): Promise<ProgressBody["data"]> {
    const response = await server.inject({ method: "GET", url: `/hallkeeper/${f.configId}/progress${query(eventId)}`, headers: f.headers });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<ProgressBody>().data;
  }

  async function summary(f: Layout, eventId: string | null): Promise<SummaryBody["data"]> {
    const response = await server.inject({ method: "GET", url: `/hallkeeper/${f.configId}/summary${query(eventId)}`, headers: f.headers });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<SummaryBody>().data;
  }

  async function storedEvents(f: Layout): Promise<(string | null)[]> {
    const rows = await db.select({ eventId: schema.hallkeeperProgress.eventId }).from(schema.hallkeeperProgress)
      .where(eq(schema.hallkeeperProgress.configId, f.configId));
    return rows.map((row) => row.eventId).sort((a, b) => String(a).localeCompare(String(b)));
  }

  it("a reused layout opens tonight with nothing ticked, and last night's ticks stay last night's", async () => {
    const f = await layout(2);
    const [lastNight, tonight] = f.eventIds as [string, string];
    await tick(f, lastNight, true);

    expect(await progress(f, tonight)).toEqual({ configId: f.configId, eventId: tonight, linkedEvents: 2, checked: {} });
    expect(await summary(f, tonight)).toMatchObject({ total: 1, checked: 0 });

    const earlier = await progress(f, lastNight);
    expect(earlier.eventId).toBe(lastNight);
    expect(Object.keys(earlier.checked)).toEqual([f.rowKey]);
    expect(await summary(f, lastNight)).toMatchObject({ total: 1, checked: 1 });
  });

  it("keeps one tick per row per event: a replayed tick stays one, and unticking one event leaves the other", async () => {
    const f = await layout(2);
    const [first, second] = f.eventIds as [string, string];
    await tick(f, first, true);
    await tick(f, first, true);
    await tick(f, second, true);
    expect(await storedEvents(f)).toEqual([first, second].sort());

    await tick(f, second, false);
    expect(await storedEvents(f)).toEqual([first]);
    // The legacy toggle keeps to the event too.
    await tick(f, second);
    expect(await storedEvents(f)).toEqual([first, second].sort());
  });

  it("a sheet opened without an event keeps the layout's only event's ticks", async () => {
    const f = await layout(1);
    const [only] = f.eventIds as [string];
    await tick(f, null, true);

    expect(await storedEvents(f)).toEqual([only]);
    expect(Object.keys((await progress(f, only)).checked)).toEqual([f.rowKey]);
    expect(await summary(f, only)).toMatchObject({ checked: 1 });
  });

  it("never counts older ticks that carry no event towards an event", async () => {
    const f = await layout(1);
    const [only] = f.eventIds as [string];
    await db.insert(schema.hallkeeperProgress).values({ configId: f.configId, eventId: null, rowKey: f.rowKey, checkedBy: f.userId });

    expect(await summary(f, only)).toMatchObject({ total: 1, checked: 0 });
    expect(await progress(f, null)).toEqual({ configId: f.configId, eventId: only, linkedEvents: 1, checked: {} });
  });

  // The Day Board can offer a layout for an event that reaches it only through
  // a frozen phase plan, with no link row: that event's ticks are its own.
  it("keeps ticks for a venue event the layout is not linked to as that event's own", async () => {
    const f = await layout(1);
    const [linked] = f.eventIds as [string];
    const [{ venueId }] = await db.select({ venueId: schema.configurations.venueId }).from(schema.configurations)
      .where(eq(schema.configurations.id, f.configId)) as [{ venueId: string }];
    const frozenOnly = randomUUID();
    await db.insert(schema.events).values({ id: frozenOnly, venueId, createdBy: f.userId, name: "DEMO ONLY frozen-plan event" });

    await tick(f, frozenOnly, true);
    expect(await storedEvents(f)).toEqual([frozenOnly]);
    expect(await summary(f, frozenOnly)).toMatchObject({ checked: 1 });
    expect(await summary(f, linked)).toMatchObject({ checked: 0 });
    expect(await progress(f, frozenOnly)).toMatchObject({ eventId: frozenOnly, linkedEvents: 1 });
  });

  it("ignores another venue's event, keeping to the layout's own", async () => {
    const f = await layout(1);
    const [linked] = f.eventIds as [string];
    const elsewhere = await layout(1);
    const [foreign] = elsewhere.eventIds as [string];

    await tick(f, foreign, true);
    expect(await storedEvents(f)).toEqual([linked]);
    expect(await progress(f, foreign)).toMatchObject({ eventId: linked });
  });

  it("keeps a layout with several events and none named to its own eventless ticks, once per row", async () => {
    const f = await layout(2);
    await tick(f, null, true);
    await tick(f, null, true);
    // An event the layout is not linked to is ignored, as the sheet's own times ignore it.
    await tick(f, randomUUID(), true);
    expect(await storedEvents(f)).toEqual([null]);

    const eventless = await progress(f, null);
    expect(eventless.eventId).toBeNull();
    // The sheet uses this to say these ticks count on no Day Board.
    expect(eventless.linkedEvents).toBe(2);
    expect(Object.keys(eventless.checked)).toEqual([f.rowKey]);
    for (const eventId of f.eventIds) expect(await summary(f, eventId)).toMatchObject({ checked: 0 });
  });

  it("removes an event's ticks with the event", async () => {
    const f = await layout(2);
    const [kept, removed] = f.eventIds as [string, string];
    await tick(f, kept, true);
    await tick(f, removed, true);

    await db.delete(schema.events).where(eq(schema.events.id, removed));
    expect(await storedEvents(f)).toEqual([kept]);
  });
});
