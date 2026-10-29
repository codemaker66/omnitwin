import { randomInt, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GuestFlowReplayInput, GuestFlowReplayPersistenceResult } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { guestFlowReplayRoutes } from "../routes/guest-flow-replay.js";

// Guest-flow replays on migrated PostgreSQL, through the route. A replay is
// stored once for its exact inputs, and a navmesh once for its room's
// geometry, whichever venue asked; neither may carry one venue's words or ids
// into another venue's answer.
//
// Never loads .env and never falls back to DATABASE_URL. The target must be
// the explicitly named disposable cluster the request tests use.
process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_REQUESTS_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:"
    || parsed.hostname !== "127.0.0.1"
    || parsed.pathname !== "/venviewer_lane9_test"
    || parsed.search !== ""
    || parsed.hash !== "") {
    throw new Error("Guest-flow replay tests require the explicit disposable database venviewer_lane9_test on 127.0.0.1");
  }
}

/** An empty 12 by 8 m room at `at` metres along: stored rows outlive a run, so
 *  each run walks a room no earlier run has. */
function scene(seed: number, at: number): GuestFlowReplayInput {
  const point = (x: number, y: number): { x: number; y: number } => ({ x: at + x, y });
  return {
    scenarioType: "guest_arrival",
    layout: { configurationId: null, snapshotHash: null, placedObjectCount: 0 },
    roomPolygon: [point(0, 0), point(12, 0), point(12, 8), point(0, 8)],
    obstacles: [],
    entrances: [{ id: "entry", label: "Entry", point: point(1, 4), widthM: 1.2 }],
    exits: [{ id: "exit", label: "Exit", point: point(11, 4), widthM: 1.2 }],
    destinations: [{ id: "bar", label: "Bar", point: point(10, 4), weight: 1 }],
    staffLanes: [],
    phase: { phaseId: null, label: "Arrival", durationMinutes: 20 },
    assumptions: [{ key: "arrival_window", label: "Arrival window", value: "20 minutes", source: "test fixture" }],
    agentCount: 12,
    seed,
  };
}

describe.skipIf(target === undefined)("guest-flow replays on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `guest_flow_${randomUUID()}`, max: 4 });
    const name = (await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name;
    expect(name).toBe("venviewer_lane9_test");
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(guestFlowReplayRoutes, { db, prefix: "/guest-flow" });
    await server.ready();
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  /** A venue with a room, an event and one of its staff. */
  async function venue(label: string) {
    const venueId = randomUUID(), roomId = randomUUID(), eventId = randomUUID(), staffId = randomUUID();
    await db.insert(schema.venues).values({ id: venueId, name: `TEST ONLY guest flow ${label}`, slug: venueId, address: "Disposable fixture" });
    await db.insert(schema.spaces).values({ id: roomId, venueId, name: "Grand Hall", slug: `grand-${roomId}`, widthM: "12", lengthM: "8", heightM: "6",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 8 }, { x: 0, y: 8 }] });
    await db.insert(schema.users).values({ id: staffId, venueId, name: `${label} staff`, email: `${staffId}@guest-flow.invalid`, role: "staff" });
    await db.insert(schema.events).values({ id: eventId, venueId, name: `${label} dinner`, createdBy: staffId });
    const token = { id: staffId, name: `${label} staff`, email: `${staffId}@guest-flow.invalid`, role: "staff", venueId };
    return { venueId, eventId, staffId, headers: { authorization: `Bearer ${JSON.stringify(token)}` } };
  }
  type Venue = Awaited<ReturnType<typeof venue>>;

  function ask(who: Venue, name: string, input: GuestFlowReplayInput) {
    return server.inject({ method: "POST", url: "/guest-flow/scenarios", headers: who.headers, payload: { name, eventId: who.eventId, input } });
  }
  function result(response: Awaited<ReturnType<typeof ask>>): GuestFlowReplayPersistenceResult {
    return response.json<{ data: GuestFlowReplayPersistenceResult }>().data;
  }

  it("does not answer one venue's exact inputs with another venue's replay", async () => {
    const ardmore = await venue("Ardmore"), balfron = await venue("Balfron");
    const at = randomInt(1, 1_000_000);
    const first = await ask(ardmore, "Ardmore arrival rehearsal", scene(7, at));
    expect(first.statusCode).toBe(201);
    const second = await ask(balfron, "Balfron arrival", scene(7, at));
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: "REPLAY_INPUTS_TAKEN" });
    for (const word of [ardmore.eventId, ardmore.staffId, "Ardmore"]) expect(second.body).not.toContain(word);
    // Ardmore asking again is answered with its own replay, as before.
    const again = await ask(ardmore, "Ardmore arrival rehearsal", scene(7, at));
    expect(again.statusCode).toBe(200);
    expect(result(again).replay.id).toBe(result(first).replay.id);
  });

  it("shares a room's navmesh between venues without one venue's ids on the other's replay", async () => {
    const ardmore = await venue("Ardmore"), balfron = await venue("Balfron");
    const at = randomInt(1, 1_000_000);
    const theirs = await ask(ardmore, "Ardmore arrival", scene(1, at));
    const ours = await ask(balfron, "Balfron arrival", scene(2, at));
    expect([theirs.statusCode, ours.statusCode]).toEqual([201, 201]);
    const made = result(ours);
    // The same room's geometry, stored once.
    expect(made.navmeshVersion.id).toBe(result(theirs).navmeshVersion.id);
    expect(made.navmeshVersion).toMatchObject({ eventId: null, phaseId: null, configurationId: null, scenarioId: null, createdBy: null });
    for (const word of [ardmore.eventId, ardmore.staffId]) expect(ours.body).not.toContain(word);
    const read = await server.inject({ method: "GET", url: `/guest-flow/replays/${made.replay.id}`, headers: balfron.headers });
    expect(read.statusCode).toBe(200);
    for (const word of [ardmore.eventId, ardmore.staffId]) expect(read.body).not.toContain(word);
    // The scenario that made it still sees where it came from.
    const own = await server.inject({ method: "GET", url: `/guest-flow/replays/${result(theirs).replay.id}`, headers: ardmore.headers });
    expect(result(own).navmeshVersion).toMatchObject({ eventId: ardmore.eventId, createdBy: ardmore.staffId });
  });
});
