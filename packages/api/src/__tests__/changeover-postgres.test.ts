import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Changeover } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { hallkeeperSheetRoutes } from "../routes/hallkeeper-sheet.js";
import { approveSnapshot, createSnapshot } from "../services/sheet-snapshot.js";

// ---------------------------------------------------------------------------
// What moves at a changeover, on the migrated disposable platform database:
// two layouts of one room read through the real sheet pipeline (placed
// pieces, the catalogue, the room's outline) give what stays, what goes back
// to store, what comes from it and which pieces move; an approved layout is
// read as it was frozen, and a damaged approval or a removed layout is a
// lasting refusal that names the layout; two rooms are refused; another
// venue's floor, or a client asking about another client's layout, reads
// nothing. Never reads DATABASE_URL or an env file.
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
    const hallkeeper = randomUUID(), elsewhere = randomUUID(), clientA = randomUUID(), clientB = randomUUID();
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
      { id: clientA, name: "Client A", email: `${clientA}@changeover.invalid`, role: "client" },
      { id: clientB, name: "Client B", email: `${clientB}@changeover.invalid`, role: "client" },
    ]);
    await db.insert(schema.assetDefinitions).values([
      { id: round, name: "TEST ONLY stage deck", category: "stage", widthM: "1.2", depthM: "1.2", heightM: "0.75" },
      { id: lectern, name: "TEST ONLY lectern", category: "av", widthM: "0.6", depthM: "0.5", heightM: "1.2" },
      { id: table, name: "TEST ONLY round", category: "table", widthM: "1.8", depthM: "1.8", heightM: "0.75" },
      { id: seat, name: "TEST ONLY chair", category: "chair", widthM: "0.45", depthM: "0.45", heightM: "0.9" },
    ]);
    async function layout(spaceId: string, name: string, pieces: readonly { asset: string; x: number; z: number; group?: string }[], owner: string | null = null): Promise<string> {
      const configId = randomUUID();
      await db.insert(schema.configurations).values({ id: configId, venueId, spaceId, userId: owner, name, slug: configId, layoutStyle: "custom" });
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
    // Two clients' own layouts of the same room.
    const ownedA = await layout(hall, "TEST ONLY client A's layout", [{ asset: round, x: 4, z: 4 }], clientA);
    const ownedB = await layout(hall, "TEST ONLY client B's layout", [{ asset: round, x: 10, z: 4 }], clientB);
    return {
      venueId, otherVenueId, hallkeeper, elsewhere, clientA, clientB, hall, round, lectern, layout,
      wedding, conference, tasting, fours, threes, ownedA, ownedB,
    };
  }

  type Fixture = Awaited<ReturnType<typeof fixture>>;
  type Asker = "hallkeeper" | "elsewhere" | "clientA";

  function ask(f: Fixture, who: Asker, from: string, to: string) {
    const person = {
      hallkeeper: { id: f.hallkeeper, role: "hallkeeper", venueId: f.venueId },
      elsewhere: { id: f.elsewhere, role: "hallkeeper", venueId: f.otherVenueId },
      clientA: { id: f.clientA, role: "client", venueId: null },
    }[who];
    return server.inject({
      method: "GET",
      url: `/hallkeeper/changeover?from=${from}&to=${to}`,
      headers: { authorization: `Bearer ${JSON.stringify({ ...person, email: `${person.id}@changeover.invalid`, platformRole: "none" })}` },
    });
  }

  /** Submitted and approved as the review routes do: frozen with its plan, then stamped. */
  async function approve(f: Fixture, configId: string): Promise<string> {
    const { snapshot } = await createSnapshot(db, { configId, createdBy: f.hallkeeper, baseUrl: "https://venviewer.test" });
    await approveSnapshot(db, snapshot.id, f.hallkeeper);
    return snapshot.id;
  }

  const configIdsOf = (body: string): unknown => (JSON.parse(body) as { details?: { configIds?: unknown } }).details?.configIds;

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
    expect(Object.keys(changeover).sort()).toEqual(["from", "items", "plan", "to", "tooManyPieces", "zonesCompared"]);
    expect([changeover.zonesCompared, changeover.tooManyPieces]).toEqual([true, false]);
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

  it("refuses two rooms and another venue's floor", async () => {
    const f = await fixture();
    const rooms = await ask(f, "hallkeeper", f.wedding, f.tasting);
    expect([rooms.statusCode, rooms.json<{ code: string }>().code]).toEqual([409, "NOT_ONE_ROOM"]);
    const other = await ask(f, "elsewhere", f.wedding, f.conference);
    expect(other.statusCode).toBe(403);
  });

  it("refuses a client asking from their own layout about another client's in the same room", async () => {
    const f = await fixture();
    const own = await ask(f, "clientA", f.ownedA, f.ownedA);
    expect(own.statusCode, own.body).toBe(200);
    for (const [from, to] of [[f.ownedA, f.ownedB], [f.ownedB, f.ownedA]] as const) {
      const theirs = await ask(f, "clientA", from, to);
      expect([theirs.statusCode, configIdsOf(theirs.body)]).toEqual([403, [f.ownedB]]);
      // Nothing of the other client's layout comes back: not its name, not its pieces.
      expect(theirs.body).not.toContain("client B");
      expect(theirs.body).not.toContain("TEST ONLY stage deck");
    }
  });

  it("reads an approved layout as it was frozen against a live one, and pairs its pieces", async () => {
    const f = await fixture();
    await approve(f, f.conference);
    // A live edit after approval is not what the floor sets: the deck at
    // (10, 8) is dragged onto the wedding's spot at (16, 4).
    const pieces = await db.select({ id: schema.placedObjects.id, z: schema.placedObjects.positionZ })
      .from(schema.placedObjects).where(eq(schema.placedObjects.configurationId, f.conference));
    const dragged = pieces.find((piece) => Number(piece.z) === 8);
    if (dragged === undefined) throw new Error("No deck at z 8");
    await db.update(schema.placedObjects).set({ positionX: "16", positionZ: "4", coordinateWriteToken: randomUUID() })
      .where(eq(schema.placedObjects.id, dragged.id));
    const response = await ask(f, "hallkeeper", f.wedding, f.conference);
    expect(response.statusCode, response.body).toBe(200);
    const changeover = response.json<{ data: Changeover }>().data;
    expect(changeover.to).toMatchObject({ configId: f.conference, hasPlan: true });
    // Read live, the dragged deck would stand on the wedding's: two staying put, none moving.
    expect(changeover.plan).toMatchObject({
      staysPut: 1,
      moved: [{ name: "TEST ONLY stage deck", count: 1 }],
      fromStore: [{ name: "TEST ONLY lectern", count: 1 }],
      toStore: [{ name: "TEST ONLY stage deck", count: 1 }],
    });
  });

  it("names the layout when its approved sheet cannot be read, and when it was removed", async () => {
    const f = await fixture();
    const snapshotId = await approve(f, f.conference);
    await pool.query("UPDATE configuration_sheet_snapshots SET payload = '{\"damaged\": true}'::jsonb WHERE id = $1", [snapshotId]);
    const damaged = await ask(f, "hallkeeper", f.wedding, f.conference);
    expect([damaged.statusCode, damaged.json<{ code: string }>().code, configIdsOf(damaged.body)])
      .toEqual([503, "APPROVED_SNAPSHOT_UNAVAILABLE", [f.conference]]);
    expect(damaged.headers["cache-control"]).toBe("private, no-store");
    await db.update(schema.configurations).set({ deletedAt: new Date() }).where(eq(schema.configurations.id, f.conference));
    const removed = await ask(f, "hallkeeper", f.wedding, f.conference);
    expect([removed.statusCode, removed.json<{ code: string }>().code, configIdsOf(removed.body)])
      .toEqual([404, "NOT_FOUND", [f.conference]]);
  });

  it("reads a layout the next booking keeps against itself: the furniture stays, the dressing is cleared and laid", async () => {
    const f = await fixture();
    const dressed = randomUUID();
    await db.insert(schema.assetDefinitions).values({ id: dressed, name: "TEST ONLY dressed round", category: "table", widthM: "1.8", depthM: "1.8", heightM: "0.75" });
    await db.insert(schema.assetAccessories).values({ parentAssetId: dressed, name: "TEST ONLY cloth", category: "decor", quantityPerParent: 1, phase: "dress", afterDepth: 0 });
    const kept = await f.layout(f.hall, "TEST ONLY kept layout", [{ asset: dressed, x: 5, z: 5 }, { asset: dressed, x: 12, z: 5 }]);
    const response = await ask(f, "hallkeeper", kept, kept);
    expect(response.statusCode, response.body).toBe(200);
    const changeover = response.json<{ data: Changeover }>().data;
    expect(changeover.items.map((item) => [item.name, item.isAccessory, item.before, item.after])).toEqual([
      ["TEST ONLY dressed round", false, 2, 2],
      ["TEST ONLY cloth", true, 2, 2],
    ]);
    expect(changeover.plan).toMatchObject({ staysPut: 2, moved: [], fromStore: [], toStore: [] });
  });
});
