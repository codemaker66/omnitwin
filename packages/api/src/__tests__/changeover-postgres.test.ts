import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Changeover } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { hallkeeperSheetRoutes } from "../routes/hallkeeper-sheet.js";

// ---------------------------------------------------------------------------
// What moves at a changeover, on the migrated disposable platform database:
// two layouts of one room read through the real sheet pipeline (placed
// pieces, the catalogue, the room's outline) give what stays, what goes back
// to store, what comes from it and which pieces move; two rooms are refused;
// another venue's floor reads nothing. Never reads DATABASE_URL or an env file.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Changeover tests require the explicit disposable platform database");
  }
}

describe.skipIf(target === undefined)("what moves at a changeover, on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `changeover_${randomUUID()}`, max: 4,
      options: "-c statement_timeout=15000 -c lock_timeout=12000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(hallkeeperSheetRoutes, { db, prefix: "/hallkeeper" });
    await server.ready();
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  async function fixture() {
    const venueId = randomUUID(), otherVenueId = randomUUID(), hall = randomUUID(), saloon = randomUUID();
    const round = randomUUID(), lectern = randomUUID(), table = randomUUID(), seat = randomUUID();
    const hallkeeper = randomUUID(), elsewhere = randomUUID();
    await db.insert(schema.venues).values([
      { id: venueId, name: "TEST ONLY changeover venue", slug: venueId, address: "Disposable fixture" },
      { id: otherVenueId, name: "TEST ONLY other venue", slug: otherVenueId, address: "Disposable fixture" },
    ]);
    const outline = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
    await db.insert(schema.spaces).values([
      { id: hall, venueId, name: "Grand Hall", slug: "grand-hall", widthM: "20", lengthM: "20", heightM: "6", floorPlanOutline: outline },
      { id: saloon, venueId, name: "Saloon", slug: "saloon", widthM: "20", lengthM: "20", heightM: "4", floorPlanOutline: outline },
    ]);
    await db.insert(schema.users).values([
      { id: hallkeeper, venueId, name: "Jamie", email: `${hallkeeper}@changeover.invalid`, role: "hallkeeper" },
      { id: elsewhere, venueId: otherVenueId, name: "Elsewhere", email: `${elsewhere}@changeover.invalid`, role: "hallkeeper" },
    ]);
    await db.insert(schema.assetDefinitions).values([
      { id: round, name: "TEST ONLY stage deck", category: "stage", widthM: "1.2", depthM: "1.2", heightM: "0.75" },
      { id: lectern, name: "TEST ONLY lectern", category: "av", widthM: "0.6", depthM: "0.5", heightM: "1.2" },
      { id: table, name: "TEST ONLY round", category: "table", widthM: "1.8", depthM: "1.8", heightM: "0.75" },
      { id: seat, name: "TEST ONLY chair", category: "chair", widthM: "0.45", depthM: "0.45", heightM: "0.9" },
    ]);
    async function layout(spaceId: string, name: string, pieces: readonly { asset: string; x: number; z: number; group?: string }[]): Promise<string> {
      const configId = randomUUID();
      await db.insert(schema.configurations).values({ id: configId, venueId, spaceId, userId: null, name, slug: configId, layoutStyle: "custom" });
      if (pieces.length > 0) {
        await db.insert(schema.placedObjects).values(pieces.map((piece, index) => ({
          id: randomUUID(), configurationId: configId, assetDefinitionId: piece.asset,
          positionX: String(piece.x), positionY: "0", positionZ: String(piece.z), sortOrder: index, coordinateWriteToken: randomUUID(),
          ...(piece.group === undefined ? {} : { metadata: { groupId: piece.group } }),
        })));
      }
      return configId;
    }
    const wedding = await layout(hall, "TEST ONLY wedding", [
      { asset: round, x: 4, z: 4 }, { asset: round, x: 10, z: 4 }, { asset: round, x: 16, z: 4 },
    ]);
    const conference = await layout(hall, "TEST ONLY conference", [
      { asset: round, x: 4, z: 4 }, { asset: round, x: 10, z: 8 }, { asset: lectern, x: 10, z: 16 },
    ]);
    const tasting = await layout(saloon, "TEST ONLY tasting", [{ asset: round, x: 4, z: 4 }]);
    // Two rounds, each grouped with its chairs as the planner saves a table.
    const seated = (each: number) => [5, 12].flatMap((x) => {
      const group = randomUUID();
      return [{ asset: table, x, z: 10, group }, ...Array.from({ length: each }, (_, c) => ({
        asset: seat, x: x + 1.2 * Math.cos((2 * Math.PI * c) / each), z: 10 + 1.2 * Math.sin((2 * Math.PI * c) / each), group,
      }))];
    });
    const fours = await layout(hall, "TEST ONLY rounds of four", seated(4));
    const threes = await layout(hall, "TEST ONLY rounds of three", seated(3));
    return { venueId, otherVenueId, hallkeeper, elsewhere, wedding, conference, tasting, fours, threes };
  }

  type Fixture = Awaited<ReturnType<typeof fixture>>;

  function ask(f: Fixture, who: "hallkeeper" | "elsewhere", from: string, to: string) {
    const id = who === "hallkeeper" ? f.hallkeeper : f.elsewhere;
    return server.inject({
      method: "GET",
      url: `/hallkeeper/changeover?from=${from}&to=${to}`,
      headers: { authorization: `Bearer ${JSON.stringify({ id, email: `${id}@changeover.invalid`, role: "hallkeeper",
        platformRole: "none", venueId: who === "hallkeeper" ? f.venueId : f.otherVenueId })}` },
    });
  }

  it("says what stays, what goes back to store, what comes from it, and which pieces move", async () => {
    const f = await fixture();
    const response = await ask(f, "hallkeeper", f.wedding, f.conference);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const changeover = response.json<{ data: Changeover }>().data;
    expect(changeover.from).toMatchObject({ configId: f.wedding, name: "TEST ONLY wedding" });
    expect(changeover.to).toMatchObject({ configId: f.conference, name: "TEST ONLY conference" });
    const counts = Object.fromEntries(changeover.items.map((item) => [item.name, [item.before, item.after]]));
    expect(counts).toMatchObject({ "TEST ONLY stage deck": [3, 2], "TEST ONLY lectern": [0, 1] });
    expect(changeover.plan).toMatchObject({
      staysPut: 1,
      moved: [{ name: "TEST ONLY stage deck", count: 1 }],
      fromStore: [{ name: "TEST ONLY lectern", count: 1 }],
      toStore: [{ name: "TEST ONLY stage deck", count: 1 }],
    });
    // Counts and pieces only: none of a sheet's contacts, notes or times.
    expect(Object.keys(changeover).sort()).toEqual(["from", "items", "plan", "to"]);
  });

  it("counts the chairs set at tables, which the sheet folds into each table's row", async () => {
    const f = await fixture();
    const response = await ask(f, "hallkeeper", f.fours, f.threes);
    expect(response.statusCode, response.body).toBe(200);
    const changeover = response.json<{ data: Changeover }>().data;
    expect(Object.fromEntries(changeover.items.map((item) => [item.name, [item.before, item.after]])))
      .toEqual({ "TEST ONLY round": [2, 2], "TEST ONLY chair": [8, 6] });
    expect(changeover.plan).toMatchObject({ toStore: [{ name: "TEST ONLY chair", count: 2 }], fromStore: [] });
  });

  it("refuses two rooms, one layout twice, and another venue's floor", async () => {
    const f = await fixture();
    const rooms = await ask(f, "hallkeeper", f.wedding, f.tasting);
    expect([rooms.statusCode, rooms.json<{ code: string }>().code]).toEqual([409, "NOT_ONE_ROOM"]);
    const same = await ask(f, "hallkeeper", f.wedding, f.wedding);
    expect(same.statusCode).toBe(400);
    const other = await ask(f, "elsewhere", f.wedding, f.conference);
    expect(other.statusCode).toBe(403);
  });
});
