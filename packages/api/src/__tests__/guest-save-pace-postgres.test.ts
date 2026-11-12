import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../db/schema.js";

// ---------------------------------------------------------------------------
// How often an anonymous planner may save (release audit, public-claims-2).
//
// A guest's planner saves itself three seconds after every change. The save
// route allowed sixty saves an hour per address, so an engaged guest, or two
// people on one home or venue connection, ran out within minutes: every later
// save failed for the rest of the hour and "Send to Events Team" would not
// open. The request limit has to fit the planner's own pace and recover in a
// minute; what an address may store is bounded separately, in bytes
// (guest-save-limits-postgres.test.ts).
//
// This drives the whole app, with its real rate limiter, on the migrated
// database: only that shows what the limiter does to saves that land.
//
// Opt-in, disposable PostgreSQL only. The server it builds is pointed at the
// validated URL in-process; .env is never consulted.
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Guest save tests require the explicit disposable platform database");
  }
}

interface Plan { readonly id: string; revision: number }

const NOON = Date.UTC(2026, 10, 11, 12, 0, 0);
const MINUTE_MS = 60_000;

describe.skipIf(target === undefined)("how often an anonymous planner may save, through the whole app", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const venueId = randomUUID();
  const spaceId = randomUUID();
  const chairId = randomUUID();

  async function newPlan(): Promise<Plan> {
    const response = await server.inject({ method: "POST", url: "/public/configurations", payload: { spaceId } });
    expect(response.statusCode, response.body.slice(0, 300)).toBe(201);
    return response.json<{ data: Plan }>().data;
  }

  /** One autosave: the plan's one chair, nudged. Returns the status, and moves the revision on when it lands. */
  async function save(plan: Plan, nudge: number): Promise<{ statusCode: number; code: string | undefined }> {
    const response = await server.inject({
      method: "POST", url: `/public/configurations/${plan.id}/objects/batch`,
      payload: { expectedRevision: plan.revision, objects: [{
        assetDefinitionId: chairId, positionX: 1 + (nudge % 180) / 10, positionY: 0, positionZ: 5,
        rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1, sortOrder: 0,
      }] },
    });
    const body = response.json<{ code?: string; data?: { revision: number } }>();
    if (response.statusCode === 200 && body.data !== undefined) plan.revision = body.data.revision;
    return { statusCode: response.statusCode, code: body.code };
  }

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `guest_save_pace_${randomUUID()}`, max: 2 });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    const db = drizzle(pool, { schema });
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY guest pace venue", slug: venueId, address: "Disposable fixture" });
    await db.insert(schema.spaces).values({ id: spaceId, venueId, name: "Room", slug: "room", widthM: "20", lengthM: "20", heightM: "4",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] });
    await db.insert(schema.assetDefinitions).values({ id: chairId, name: "TEST ONLY guest pace chair", category: "chair", widthM: "0.5", depthM: "0.5", heightM: "0.9" });

    process.env["DATABASE_URL"] = target;
    process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";
    const { buildServer } = await import("../index.js");
    server = await buildServer();
  }, 180_000);

  afterEach(() => { vi.useRealTimers(); });

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  it("never refuses two guests behind one address who each save every six seconds for ten minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOON);
    const plans = [await newPlan(), await newPlan()];
    const statuses: number[] = [];
    for (let tick = 0; tick < 100; tick += 1) {
      vi.setSystemTime(NOON + tick * 6_000);
      for (const plan of plans) statuses.push((await save(plan, tick)).statusCode);
    }
    expect({ saves: statuses.length, refused: statuses.filter((status) => status !== 200).length })
      .toEqual({ saves: 200, refused: 0 });
    // Every one of them landed: each plan is a hundred revisions on.
    expect(plans.map((plan) => plan.revision)).toEqual([101, 101]);
  }, 120_000);

  it("still refuses a flood from one address, and lets it save again a minute later, not an hour later", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const later = NOON + 120 * MINUTE_MS;
    vi.setSystemTime(later);
    const plan = await newPlan();
    const burst: number[] = [];
    for (let n = 0; n < 60; n += 1) burst.push((await save(plan, n)).statusCode);
    expect(burst.filter((status) => status !== 200)).toEqual([]);

    // Faster than any planner saves: the next one in the same minute is refused.
    expect(await save(plan, 60)).toEqual({ statusCode: 429, code: "RATE_LIMITED" });
    expect(plan.revision).toBe(61);

    vi.setSystemTime(later + MINUTE_MS + 1_000);
    expect((await save(plan, 61)).statusCode).toBe(200);
  }, 120_000);
});
