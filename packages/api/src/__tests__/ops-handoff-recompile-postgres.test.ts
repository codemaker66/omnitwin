import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { opsHandoffRoutes } from "../routes/ops-handoff.js";
import { getEventDayOpsBoard, loadEventForOpsBoard, updateOpsTaskStatus } from "../services/event-day-ops.js";
import { approveSnapshot, createSnapshot } from "../services/sheet-snapshot.js";
import { latestEventHandoff, planChangedAfter } from "../services/supplier-passes.js";

// ---------------------------------------------------------------------------
// Compiling an event's handoff pack again (T-695 audit api-eventday-sheet-2).
//
// The Event Day board reads the event's newest pack and its tasks; a supplier
// pass says "plan changed" when a pack newer than the one it was made from
// exists. A second compile of the same approved plan for the same event made
// a new pack every time: every task the floor had marked done read "To do"
// again, and every supplier was told the plan had changed when it had not.
// Two compiles at once could also collide on the pack's version number.
//
// Proved through the real route and services on the migrated disposable
// platform database, because the guarantee is a row lock and what PostgreSQL
// keeps. Opt-in only; never reads DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const url = new URL(target);
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55477"
    || url.pathname !== "/venviewer_platform_test" || url.search || url.hash) {
    throw new Error("Handoff recompile tests require the explicitly owned disposable platform database");
  }
}

const OUTLINE = [{ x: -6, y: -4 }, { x: 6, y: -4 }, { x: 6, y: 4 }, { x: -6, y: 4 }];

interface PackBody { readonly data: { readonly pack: { readonly id: string; readonly compiledAt: string }; readonly roomFlipPlans: readonly unknown[] } }

describe.skipIf(target === undefined)("compiling an event's handoff pack again, on disposable PostgreSQL", () => {
  let pool: Pool;
  let observer: Pool;
  let db: Database;
  let server: FastifyInstance;
  const applicationName = `ops-recompile-${randomUUID()}`;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit target required");
    pool = new Pool({ connectionString: target, application_name: applicationName, max: 6 });
    observer = new Pool({ connectionString: target, application_name: `${applicationName}-observer`, max: 1 });
    expect((await observer.query<{ database: string }>("SELECT current_database() AS database")).rows[0]?.database)
      .toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(opsHandoffRoutes, { db, prefix: "/ops" });
    await server.ready();
  });
  afterAll(async () => { await server?.close(); await pool?.end(); await observer?.end(); });

  /** Catering, access and special notes, as the planner stores them on a layout. */
  const INSTRUCTIONS = {
    specialInstructions: "TEST ONLY keep the top table clear.", dayOfContact: null, phaseDeadlines: [],
    accessNotes: "TEST ONLY deliveries by the service entrance.", accessibility: null,
    dietary: { vegetarian: 4, vegan: 2, glutenFree: 1, nutFree: 1, halal: 0, kosher: 0, otherAllergies: "TEST ONLY nut allergy at table 1." },
    doorSchedule: null,
  };

  /** One approved layout in the room, a round table with two chairs, linked to the event. */
  async function layout(input: { venueId: string; roomId: string; userId: string; eventId: string; headers: { authorization: string }; notes?: boolean }) {
    const configId = randomUUID(); const tableAssetId = randomUUID(); const chairAssetId = randomUUID(); const tableId = randomUUID();
    await db.insert(schema.configurations).values({ id: configId, venueId: input.venueId, spaceId: input.roomId, userId: input.userId,
      name: "TEST ONLY dinner", layoutStyle: "custom", slug: `dinner-${configId}`, ...(input.notes === true ? { metadata: { instructions: INSTRUCTIONS } } : {}) });
    await db.insert(schema.assetDefinitions).values([
      { id: tableAssetId, name: "TEST ONLY round table", category: "table", widthM: "1.8", depthM: "1.8", heightM: "0.76", collisionType: "cylinder" },
      { id: chairAssetId, name: "TEST ONLY chair", category: "chair", widthM: "0.45", depthM: "0.45", heightM: "0.9", collisionType: "box" },
    ]);
    await db.insert(schema.placedObjects).values([
      { id: tableId, configurationId: configId, assetDefinitionId: tableAssetId, positionX: "1", positionY: "0", positionZ: "1", metadata: { groupId: tableId } },
      { configurationId: configId, assetDefinitionId: chairAssetId, positionX: "1", positionY: "0", positionZ: "0", metadata: { groupId: tableId } },
      { configurationId: configId, assetDefinitionId: chairAssetId, positionX: "1", positionY: "0", positionZ: "2", metadata: { groupId: tableId } },
    ].map((object) => ({ ...object, coordinateSpace: "real_m_v1" as const, coordinateWriteToken: randomUUID() })));
    await db.insert(schema.eventConfigurationLinks).values({ eventId: input.eventId, configurationId: configId, linkType: "source_configuration" });
    const created = await createSnapshot(db, { configId, createdBy: input.userId, baseUrl: "http://localhost:3009" });
    await approveSnapshot(db, created.snapshot.id, input.userId);
    const compile = () => server.inject({ method: "POST", url: `/ops/handoff-packs/from-configuration/${configId}`, headers: input.headers, payload: { eventId: input.eventId } });
    return { configId, tableId, compile };
  }

  /** A venue's event with one approved layout; with `roomFlip`, a running order that turns the room round. */
  async function fixture(options: { notes?: boolean; roomFlip?: boolean } = {}) {
    const venueId = randomUUID(); const roomId = randomUUID(); const userId = randomUUID(); const eventId = randomUUID();
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY recompile venue", slug: `recompile-${venueId}`, address: "Disposable fixture" });
    await db.insert(schema.spaces).values({ id: roomId, venueId, name: "TEST ONLY hall", slug: `hall-${roomId}`, widthM: "12", lengthM: "8", heightM: "6", floorPlanOutline: OUTLINE });
    await db.insert(schema.users).values({ id: userId, venueId, email: `${userId}@recompile.invalid`, name: "TEST ONLY manager", role: "admin" });
    await db.insert(schema.events).values({ id: eventId, venueId, createdBy: userId, name: "TEST ONLY dinner", startsAt: new Date("2026-12-04T18:00:00.000Z") });
    if (options.roomFlip === true) {
      await db.insert(schema.eventPhases).values([
        { eventId, spaceId: roomId, name: "Ceremony", sortOrder: 0, durationMinutes: 60 },
        { eventId, spaceId: roomId, name: "Room flip", templateKey: "room-flip", sortOrder: 1, durationMinutes: 45 },
        { eventId, spaceId: roomId, name: "Dinner", sortOrder: 2, durationMinutes: 180 },
      ]);
    }
    const headers = { authorization: `Bearer ${JSON.stringify({ id: userId, email: `${userId}@recompile.invalid`, role: "admin", platformRole: "none", venueId })}` };
    const first = await layout({ venueId, roomId, userId, eventId, headers, notes: options.notes === true });
    return { venueId, eventId, userId, roomId, headers, ...first };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;

  async function board(f: Fixture) {
    const event = await loadEventForOpsBoard(db, f.eventId);
    if (event === null) throw new Error("Event fixture missing");
    return getEventDayOpsBoard(db, event);
  }

  async function packsOf(configId: string): Promise<readonly { id: string }[]> {
    return db.select({ id: schema.handoffPacks.id }).from(schema.handoffPacks).where(eq(schema.handoffPacks.configId, configId));
  }

  it("returns the event's pack again for the same approved plan, and the floor keeps what it has done", async () => {
    const f = await fixture();
    const first = await f.compile();
    expect(first.statusCode, first.body).toBe(201);
    const firstPack = first.json<PackBody>().data.pack;

    // The floor marks one set-up task done on the Event Day board.
    const [setupTask] = await db.select({ id: schema.opsTasks.id }).from(schema.opsTasks)
      .where(and(eq(schema.opsTasks.handoffPackId, firstPack.id), eq(schema.opsTasks.kind, "setup")))
      .limit(1);
    if (setupTask === undefined) throw new Error("The pack has no set-up task");
    await updateOpsTaskStatus(db, { opsTaskId: setupTask.id, status: "done", actorUserId: f.userId });

    // A manager opens the layout to read the BEO and compiles again.
    const second = await f.compile();
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json<PackBody>().data.pack.id).toBe(firstPack.id);
    expect(await packsOf(f.configId)).toHaveLength(1);

    const event = await loadEventForOpsBoard(db, f.eventId);
    if (event === null) throw new Error("Event fixture missing");
    const board = await getEventDayOpsBoard(db, event);
    expect(board.handoffPack?.pack.id).toBe(firstPack.id);
    expect(board.setupProgress.doneTasks).toBe(1);

    // A supplier pass made from the first pack is not told the plan changed.
    const latest = await latestEventHandoff(db, f.eventId, f.venueId);
    expect(planChangedAfter(new Date(firstPack.compiledAt), latest)).toBeNull();
  });

  it("makes one pack from two compiles at the same moment", async () => {
    const f = await fixture();
    const [snapshot] = await db.select({ id: schema.configurationSheetSnapshots.id }).from(schema.configurationSheetSnapshots)
      .where(eq(schema.configurationSheetSnapshots.configurationId, f.configId));
    if (snapshot === undefined) throw new Error("Snapshot fixture missing");
    // Hold the approved snapshot's row so both compiles are in flight at once
    // and must queue behind each other, rather than happening to run in turn.
    const blocker = await observer.connect();
    let compiles: Promise<Awaited<ReturnType<typeof f.compile>>>[] = [];
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM configuration_sheet_snapshots WHERE id = $1 FOR UPDATE", [snapshot.id]);
      compiles = [f.compile(), f.compile()];
      await expect.poll(async () => {
        await blocker.query("SELECT pg_stat_clear_snapshot()");
        const waiting = await blocker.query<{ waiting: number }>(
          "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
          [applicationName],
        );
        return waiting.rows[0]?.waiting;
        // Well inside the case's own 10 s, so a lock that is never taken
        // reports here rather than as a bare test timeout (review T5).
      }, { timeout: 5000 }).toBe(2);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    const responses = await Promise.all(compiles);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 201]);
    const ids = new Set(responses.map((response) => response.json<PackBody>().data.pack.id));
    expect(ids.size).toBe(1);
    expect(await packsOf(f.configId)).toHaveLength(1);
  });

  it("makes a new pack from a newly approved plan, and its suppliers are told the plan changed", async () => {
    const f = await fixture();
    const first = await f.compile();
    expect(first.statusCode, first.body).toBe(201);
    const firstPack = first.json<PackBody>().data.pack;

    await db.update(schema.placedObjects).set({ positionX: "2", coordinateWriteToken: randomUUID() })
      .where(eq(schema.placedObjects.id, f.tableId));
    const changed = await createSnapshot(db, { configId: f.configId, createdBy: f.userId, baseUrl: "http://localhost:3009" });
    expect(changed.created).toBe(true);
    await approveSnapshot(db, changed.snapshot.id, f.userId);

    const second = await f.compile();
    expect(second.statusCode, second.body).toBe(201);
    expect(second.json<PackBody>().data.pack.id).not.toBe(firstPack.id);
    expect(await packsOf(f.configId)).toHaveLength(2);
    const latest = await latestEventHandoff(db, f.eventId, f.venueId);
    expect(planChangedAfter(new Date(firstPack.compiledAt), latest)).not.toBeNull();
  });

  it("makes a new pack when the event's own plan changed, though the layout did not", async () => {
    const f = await fixture();
    const first = await f.compile();
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json<PackBody>().data.roomFlipPlans).toHaveLength(0);

    // A room flip added to the event's running order belongs in the pack.
    await db.insert(schema.eventPhases).values([
      { eventId: f.eventId, spaceId: f.roomId, name: "Ceremony", sortOrder: 0, durationMinutes: 60 },
      { eventId: f.eventId, spaceId: f.roomId, name: "Room flip", templateKey: "room-flip", sortOrder: 1, durationMinutes: 45 },
      { eventId: f.eventId, spaceId: f.roomId, name: "Dinner", sortOrder: 2, durationMinutes: 180 },
    ]);
    const second = await f.compile();
    expect(second.statusCode, second.body).toBe(201);
    expect(second.json<PackBody>().data.pack.id).not.toBe(first.json<PackBody>().data.pack.id);
    expect(second.json<PackBody>().data.roomFlipPlans).toHaveLength(1);
    // And once that pack stands, compiling again returns it (review T6).
    const third = await f.compile();
    expect(third.statusCode, third.body).toBe(200);
    expect(third.json<PackBody>().data.pack.id).toBe(second.json<PackBody>().data.pack.id);
  });

  // Review H1: the board and the supplier passes read the EVENT's newest pack
  // across its layouts. Recompiling a layout whose pack another layout's has
  // since displaced must make it the event's pack again, as it did before #400.
  it("makes a layout's pack the event's again after another layout was compiled for the event", async () => {
    const f = await fixture();
    const other = await layout({ venueId: f.venueId, roomId: f.roomId, userId: f.userId, eventId: f.eventId, headers: f.headers });
    const firstA = await f.compile();
    expect(firstA.statusCode, firstA.body).toBe(201);
    const firstB = await other.compile();
    expect(firstB.statusCode, firstB.body).toBe(201);
    const packB = firstB.json<PackBody>().data.pack;
    expect((await board(f)).handoffPack?.pack.id).toBe(packB.id);

    const againA = await f.compile();
    expect(againA.statusCode, againA.body).toBe(201);
    const packA = againA.json<PackBody>().data.pack;
    expect(packA.id).not.toBe(firstA.json<PackBody>().data.pack.id);
    expect((await board(f)).handoffPack?.pack.id).toBe(packA.id);
    // The passes built from B's pack are told the plan changed.
    expect(planChangedAfter(new Date(packB.compiledAt), await latestEventHandoff(db, f.eventId, f.venueId))).not.toBeNull();

    // Now that A's pack stands for the event, compiling A again returns it.
    const onceMore = await f.compile();
    expect(onceMore.statusCode, onceMore.body).toBe(200);
    expect(onceMore.json<PackBody>().data.pack.id).toBe(packA.id);
  });

  // Review H7: the equal-content path with room flips and supplier notes in the pack.
  it("returns the pack again for an event with a room flip and catering and access notes, keeping a finished room flip", async () => {
    const f = await fixture({ notes: true, roomFlip: true });
    const first = await f.compile();
    expect(first.statusCode, first.body).toBe(201);
    const firstPack = first.json<PackBody>().data.pack;
    expect(first.json<PackBody>().data.roomFlipPlans).toHaveLength(1);
    const kinds = await db.select({ id: schema.opsTasks.id, kind: schema.opsTasks.kind, title: schema.opsTasks.title }).from(schema.opsTasks)
      .where(eq(schema.opsTasks.handoffPackId, firstPack.id));
    expect(kinds.map((task) => task.title)).toEqual(expect.arrayContaining(["Catering notes", "Load-in access notes"]));
    const flip = kinds.find((task) => task.kind === "room_flip");
    if (flip === undefined) throw new Error("The pack has no room-flip task");
    await updateOpsTaskStatus(db, { opsTaskId: flip.id, status: "done", actorUserId: f.userId });

    const second = await f.compile();
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json<PackBody>().data.pack.id).toBe(firstPack.id);
    expect((await board(f)).setupProgress.doneTasks).toBe(1);
  });

  // Review H7: the event's status is a line of the stored BEO, so a recompile
  // after it changes never returns a pack that names the old one.
  it("does not return a pack whose BEO names the event's earlier status", async () => {
    const f = await fixture();
    const first = await f.compile();
    expect(first.statusCode, first.body).toBe(201);
    await db.update(schema.events).set({ status: "confirmed" }).where(eq(schema.events.id, f.eventId));
    const second = await f.compile();
    expect(second.statusCode, second.body).toBe(201);
    expect(second.json<{ data: { beoDocument: { body: string } } }>().data.beoDocument.body).toContain("(confirmed)");
  });

  // Review H8: a stored pack the current schema no longer reads (here a BEO
  // carrying a phrase SafeOpsTextSchema now refuses) cannot be what this
  // compile would write; the recompile makes a fresh pack instead of failing.
  it("makes a fresh pack when the event's stored pack no longer reads, rather than failing every recompile", async () => {
    const f = await fixture();
    const first = await f.compile();
    expect(first.statusCode, first.body).toBe(201);
    const firstPack = first.json<PackBody>().data.pack;
    await pool.query("UPDATE beo_documents SET body = body || ' Certified safe.' WHERE handoff_pack_id = $1", [firstPack.id]);

    const second = await f.compile();
    expect(second.statusCode, second.body).toBe(201);
    expect(second.json<PackBody>().data.pack.id).not.toBe(firstPack.id);
    expect((await board(f)).handoffPack?.pack.id).toBe(second.json<PackBody>().data.pack.id);
  });
});
