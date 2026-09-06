import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool as PgPool } from "pg";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { drizzle as nodeDrizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import type { HallkeeperSheetV2 } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { compileOpsHandoffPackFromConfiguration } from "../services/ops-compiler.js";
import { getEventDayOpsBoard } from "../services/event-day-ops.js";
import { createSnapshot, approveSnapshot } from "../services/sheet-snapshot.js";
import { assembleSheetDataV2 } from "../services/hallkeeper-sheet-v2-data.js";

// Never reads DATABASE_URL/.env. Opt in with a separately provisioned, disposable
// local database and the normal local Neon WebSocket bridge (port 54331).
const explicitUrl = process.env["VENVIEWER_OPS_TEST_DATABASE_URL"];
function assertTestTarget(raw: string): void {
  const url = new URL(raw);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1"
    || url.pathname !== "/venviewer_ops_phase_test" || url.search !== "" || url.hash !== "") {
    throw new Error("Ops regressions require the explicit loopback venviewer_ops_phase_test database");
  }
}

describe("Ops PostgreSQL target guard", () => {
  it.each([
    "postgresql://user@production.example/venviewer_ops_phase_test",
    "postgresql://postgres@127.0.0.1/production",
    "postgresql://postgres@127.0.0.1/venviewer_ops_phase_test?host=production.example",
  ])("rejects an unsafe target: %s", (url) => { expect(() => { assertTestTarget(url); }).toThrow(); });
});

describe.skipIf(explicitUrl === undefined)("persisted event phases in Ops", () => {
  let pool: Pool;
  let migrationPool: PgPool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => {
    if (explicitUrl === undefined) throw new Error("Explicit test URL required");
    assertTestTarget(explicitUrl);
    migrationPool = new PgPool({ connectionString: explicitUrl });
    const target = await migrationPool.query<{ database: string; host: string }>(
      "SELECT current_database() AS database, host(inet_server_addr()) AS host",
    );
    expect(target.rows).toEqual([{ database: "venviewer_ops_phase_test", host: "127.0.0.1" }]);
    await migrate(nodeDrizzle(migrationPool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    neonConfig.wsProxy = (host) => `${host}:54331/v1`;
    neonConfig.useSecureWebSocket = false;
    neonConfig.pipelineTLS = false;
    neonConfig.pipelineConnect = false;
    pool = new Pool({ connectionString: explicitUrl });
    db = drizzle(pool, { schema });
  }, 120000);
  afterAll(async () => { await pool?.end(); await migrationPool?.end(); });

  it.each([true, false])("compiles and reopens a real phase with room assigned=%s", async (assigned) => {
    const venueId = randomUUID(); const roomId = randomUUID(); const userId = randomUUID();
    const configId = randomUUID(); const eventId = randomUUID(); const phaseId = randomUUID();
    const snapshotId = randomUUID(); const variantId = randomUUID();
    const now = new Date("2026-09-07T15:00:00.000Z");
    await db.insert(schema.venues).values({ id: venueId, name: "DEMO ONLY venue", slug: venueId, address: "Local test" });
    await db.insert(schema.spaces).values({ id: roomId, venueId, name: "Test room", slug: "test-room", widthM: "10", lengthM: "10", heightM: "3", floorPlanOutline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] });
    await db.insert(schema.users).values({ id: userId, venueId, email: `${userId}@demo.invalid`, name: "Test reviewer", role: "admin" });
    await db.insert(schema.configurations).values({ id: configId, venueId, spaceId: roomId, userId, name: "DEMO ONLY plan", layoutStyle: "custom", slug: "test-plan", reviewStatus: "approved" });
    const [event] = await db.insert(schema.events).values({ id: eventId, venueId, createdBy: userId, name: "DEMO ONLY event", startsAt: now }).returning();
    if (event === undefined) throw new Error("Event fixture was not persisted");
    await db.insert(schema.eventPhases).values({ id: phaseId, eventId, spaceId: assigned ? roomId : null, name: "Dinner", templateKey: "dinner", sortOrder: 0, startsAt: now, durationMinutes: 60 });
    await db.insert(schema.layoutVariants).values({ id: variantId, eventId, configurationId: configId, name: "Local binding" });
    await db.insert(schema.eventConfigurationLinks).values({ eventId, configurationId: configId, layoutVariantId: variantId, linkType: "variant_configuration" });
    const payload: HallkeeperSheetV2 = {
      config: { id: configId, name: "DEMO ONLY plan", guestCount: 0, layoutStyle: "custom" },
      venue: { name: "DEMO ONLY venue", address: "Local test", logoUrl: null, timezone: "Europe/London" },
      space: { name: "Test room", widthM: 10, lengthM: 10, heightM: 3 },
      timing: null, instructions: null, phases: [], totals: { entries: [], totalRows: 0, totalItems: 0 },
      diagramUrl: null, webViewUrl: "https://example.invalid/local-test", generatedAt: now.toISOString(),
      approval: { version: 1, approvedAt: now.toISOString(), approverName: "Test reviewer" },
    };
    await db.insert(schema.configurationSheetSnapshots).values({ id: snapshotId, configurationId: configId, version: 1, payload, sourceHash: "a".repeat(64), createdBy: userId, approvedBy: userId, approvedAt: now });
    const legacySheet = await assembleSheetDataV2(db, configId, "http://localhost:3009");
    expect(legacySheet?.payload.floorPlan).toBeUndefined();
    // Exercise both independent DB serializers, not an already-parsed graph fixture.
    const before = await getEventDayOpsBoard(db, event);
    expect(before.phases).toMatchObject([{ id: phaseId, spaceId: assigned ? roomId : null }]);
    const pack = await compileOpsHandoffPackFromConfiguration(db, { configId, eventId, actorUserId: userId, clientNotes: "DEMO ONLY" });
    const stored = await db.select().from(schema.handoffPacks).where(eq(schema.handoffPacks.id, pack.pack.id));
    expect(stored).toMatchObject([{ eventId, configId, snapshotId }]);
    const reopened = await getEventDayOpsBoard(db, event);
    expect(reopened.sourceStatus).toBe("ready");
    expect(reopened.handoffPack?.pack.id).toBe(pack.pack.id);
    expect(reopened.phases).toMatchObject([{ id: phaseId, spaceId: assigned ? roomId : null }]);
  });

  it("persists every footprint, versions geometry changes, and serves frozen geometry after approval", async () => {
    const venueId = randomUUID(); const roomId = randomUUID(); const userId = randomUUID(); const configId = randomUUID();
    const tableAssetId = randomUUID(); const chairAssetId = randomUUID(); const tableId = randomUUID(); const chairId = randomUUID(); const looseChairId = randomUUID();
    const outline = [{ x: -5, y: -3 }, { x: 5, y: -3 }, { x: 4, y: 3 }, { x: -5, y: 3 }];
    await db.insert(schema.venues).values({ id: venueId, name: "DEMO ONLY snapshot venue", slug: venueId, address: "Local test" });
    await db.insert(schema.spaces).values({ id: roomId, venueId, name: "Measured room", slug: "room", widthM: "10", lengthM: "6", heightM: "3", floorPlanOutline: outline });
    await db.insert(schema.users).values({ id: userId, venueId, email: `${userId}@demo.invalid`, name: "Local reviewer", role: "admin" });
    await db.insert(schema.configurations).values({ id: configId, venueId, spaceId: roomId, userId, name: "DEMO ONLY frozen plan", layoutStyle: "custom", slug: "plan" });
    await db.insert(schema.assetDefinitions).values([
      { id: tableAssetId, name: "Measured table", category: "table", widthM: "1.8", depthM: "1.8", heightM: "0.76", collisionType: "cylinder" },
      { id: chairAssetId, name: "Measured chair", category: "chair", widthM: "0.45", depthM: "0.45", heightM: "0.9", collisionType: "box" },
    ]);
    await db.insert(schema.placedObjects).values([
      { id: tableId, configurationId: configId, assetDefinitionId: tableAssetId, positionX: "1", positionY: "0", positionZ: "2", metadata: { groupId: tableId } },
      { id: chairId, configurationId: configId, assetDefinitionId: chairAssetId, positionX: "1", positionY: "0", positionZ: "0.8", rotationY: "1.57080", metadata: { groupId: tableId } },
      { id: looseChairId, configurationId: configId, assetDefinitionId: chairAssetId, positionX: "-2", positionY: "0", positionZ: "-1", scale: "1.2" },
    ].map((object) => ({ ...object, coordinateSpace: "real_m_v1" as const, coordinateWriteToken: randomUUID() })));
    const input = { configId, createdBy: userId, baseUrl: "http://localhost:3009" };
    const first = await createSnapshot(db, input);
    expect(first.snapshot.payload.floorPlan?.outline).toEqual(outline.map((point) => ({ x: point.x, z: point.y })));
    expect(first.snapshot.payload.floorPlan?.objects).toHaveLength(3);
    expect(first.snapshot.payload.floorPlan?.objects.find((object) => object.objectId === chairId)).toMatchObject({ x: 1, z: 0.8, rotationY: 1.5708, widthM: 0.45, scale: 1 });
    expect((await createSnapshot(db, input)).created).toBe(false);
    await db.update(schema.assetDefinitions).set({ widthM: "0.5" }).where(eq(schema.assetDefinitions.id, chairAssetId));
    const second = await createSnapshot(db, input);
    expect(second.snapshot.version).toBe(2);
    expect(second.snapshot.sourceHash).not.toBe(first.snapshot.sourceHash);
    await db.update(schema.placedObjects).set({ scale: "1.5", coordinateWriteToken: randomUUID() }).where(eq(schema.placedObjects.id, looseChairId));
    const third = await createSnapshot(db, input);
    expect(third.snapshot.version).toBe(3);
    await approveSnapshot(db, third.snapshot.id, userId);
    // Simulate post-approval live drift at the owning DB boundary; it must not leak.
    await db.update(schema.spaces).set({ floorPlanOutline: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }).where(eq(schema.spaces.id, roomId));
    await db.update(schema.assetDefinitions).set({ widthM: "9" }).where(eq(schema.assetDefinitions.id, chairAssetId));
    await db.update(schema.placedObjects).set({ positionX: "50", coordinateWriteToken: randomUUID() }).where(eq(schema.placedObjects.id, chairId));
    const reopened = await assembleSheetDataV2(db, configId, "http://localhost:3009");
    expect(reopened?.payload.floorPlan).toEqual(third.snapshot.payload.floorPlan);
    const [persisted] = await db.select().from(schema.configurationSheetSnapshots).where(eq(schema.configurationSheetSnapshots.id, third.snapshot.id));
    expect((persisted?.payload as HallkeeperSheetV2).floorPlan).toEqual(third.snapshot.payload.floorPlan);
  });
});
