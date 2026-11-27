import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { publicConfigRoutes } from "../routes/public-configs.js";
import { GuestSaveBudget } from "../services/guest-save-budget.js";

// ---------------------------------------------------------------------------
// What an anonymous planner save may store (release audit, public-surface-4).
//
// Anyone can start a plan and save to it with no account. Each accepted save
// replaces the plan's pieces and is also kept whole in its revision log, so
// the route has to bound what one save carries and what one address keeps:
//   - a piece's metadata is at most a note's worth, not an open JSON blob;
//   - a whole save is at most what a plan at the 500-piece cap needs;
//   - an address holds a storage allowance that refills steadily, so a spent
//     address is slowed to that rate rather than shut out.
// Only the real route on a migrated database shows what is and is not stored.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Guest save tests require the explicit disposable platform database");
  }
}

interface Plan { readonly id: string; revision: number }
type Piece = Readonly<Record<string, unknown>>;
interface Answer { readonly statusCode: number; readonly body: string; readonly retryAfter: string | undefined }

const NOON = Date.UTC(2026, 10, 11, 12, 0, 0);

describe.skipIf(target === undefined)("what an anonymous planner save may store, on the migrated disposable database", () => {
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;
  const venueId = randomUUID();
  const spaceId = randomUUID();
  const chairId = randomUUID();

  /** A chair somewhere inside the 20 m square room. */
  function piece(index: number, metadata?: Readonly<Record<string, unknown>>): Piece {
    return {
      assetDefinitionId: chairId, positionX: 1 + (index % 18), positionY: 0, positionZ: 1 + Math.floor(index / 18),
      rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1, sortOrder: index,
      ...(metadata === undefined ? {} : { metadata }),
    };
  }

  async function newPlan(app: FastifyInstance): Promise<Plan> {
    const response = await app.inject({ method: "POST", url: "/public/configurations", payload: { spaceId } });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ data: Plan }>().data;
  }

  /** One autosave, as the planner sends it; a save that lands moves the plan's revision on. */
  async function save(app: FastifyInstance, plan: Plan, pieces: readonly Piece[], remoteAddress?: string): Promise<Answer> {
    const response = await app.inject({
      method: "POST", url: `/public/configurations/${plan.id}/objects/batch`,
      payload: { expectedRevision: plan.revision, objects: pieces },
      ...(remoteAddress === undefined ? {} : { remoteAddress }),
    });
    if (response.statusCode === 200) plan.revision = response.json<{ data: { revision: number } }>().data.revision;
    const retryAfter = response.headers["retry-after"];
    return { statusCode: response.statusCode, body: response.body, retryAfter: typeof retryAfter === "string" ? retryAfter : undefined };
  }

  async function stored(planId: string): Promise<{ revision: number | undefined; pieces: number; revisions: number }> {
    const [plan] = await db.select({ revision: schema.configurations.revision })
      .from(schema.configurations).where(eq(schema.configurations.id, planId)).limit(1);
    const pieces = await db.select({ id: schema.placedObjects.id })
      .from(schema.placedObjects).where(eq(schema.placedObjects.configurationId, planId));
    const revisions = await db.select({ id: schema.configurationLayoutRevisions.id })
      .from(schema.configurationLayoutRevisions).where(eq(schema.configurationLayoutRevisions.configurationId, planId));
    return { revision: plan?.revision, pieces: pieces.length, revisions: revisions.length };
  }

  async function appWith(saveBudget?: GuestSaveBudget): Promise<FastifyInstance> {
    const app = Fastify();
    await app.register(publicConfigRoutes, { db, prefix: "/public", ...(saveBudget === undefined ? {} : { saveBudget }) });
    await app.ready();
    return app;
  }

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `guest_save_limits_${randomUUID()}`, max: 4 });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY guest save venue", slug: venueId, address: "Disposable fixture" });
    await db.insert(schema.spaces).values({ id: spaceId, venueId, name: "Room", slug: "room", widthM: "20", lengthM: "20", heightM: "4",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] });
    await db.insert(schema.assetDefinitions).values({ id: chairId, name: "TEST ONLY guest save chair", category: "chair", widthM: "0.5", depthM: "0.5", heightM: "0.9" });
    server = await appWith();
  }, 60000);

  afterEach(() => { vi.useRealTimers(); });

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  it("saves a piece carrying everything the planner lets a guest write on it", async () => {
    const plan = await newPlan(server);
    // The planner's own caps: a 500-character note, an 80-character label, two dressing names.
    const everything = {
      clothed: true, clothStyle: "white", tableSetting: "dinner",
      chairStyle: "C".repeat(40), centerpiece: "F".repeat(80), groupId: randomUUID(),
      displayLabel: "桌".repeat(80), notes: "椅".repeat(500),
    };
    const answer = await save(server, plan, [piece(0, everything)]);
    expect(answer.statusCode, answer.body).toBe(200);
    expect(await stored(plan.id)).toEqual({ revision: 2, pieces: 1, revisions: 1 });
  });

  it("refuses a piece whose metadata is more than a note's worth, naming the piece, and stores nothing", async () => {
    const plan = await newPlan(server);
    const answer = await save(server, plan, [piece(0, { notes: "short" }), piece(1, { padding: "x".repeat(5000) })]);
    expect(answer.statusCode, answer.body).toBe(400);
    const issues = JSON.parse(answer.body) as { code: string; details: readonly { path: readonly (string | number)[] }[] };
    expect(issues.code).toBe("VALIDATION_ERROR");
    expect(issues.details.map((issue) => issue.path)).toEqual([["objects", 1, "metadata"]]);
    expect(await stored(plan.id)).toEqual({ revision: 1, pieces: 0, revisions: 0 });
  });

  it("refuses a save larger than any plan needs, whole, though each piece is within its own bound", async () => {
    const plan = await newPlan(server);
    // 150 pieces, each with 3.9 KB of metadata: about 600 KB in all.
    const heavy = Array.from({ length: 150 }, (_unused, index) => piece(index, { padding: "x".repeat(3900) }));
    expect(Buffer.byteLength(JSON.stringify({ expectedRevision: 1, objects: heavy }))).toBeGreaterThan(512 * 1024);
    const answer = await save(server, plan, heavy);
    expect(answer.statusCode, answer.body).toBe(413);
    expect(await stored(plan.id)).toEqual({ revision: 1, pieces: 0, revisions: 0 });
  });

  it("slows an address that has spent its storage allowance, says when to come back, and leaves other addresses alone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOON);
    const pieces = [piece(0), piece(1)];
    const saveBytes = Buffer.byteLength(JSON.stringify({ expectedRevision: 1, objects: pieces }));
    // Three saves' worth saved up; one more save's worth every second.
    const app = await appWith(new GuestSaveBudget({ allowanceBytes: saveBytes * 3, refillBytesPerSecond: saveBytes }));
    try {
      const plan = await newPlan(app);
      for (let n = 0; n < 3; n += 1) {
        const landed = await save(app, plan, pieces);
        expect(landed.statusCode, landed.body).toBe(200);
      }
      const refused = await save(app, plan, pieces);
      expect(refused.statusCode, refused.body).toBe(429);
      expect(JSON.parse(refused.body)).toMatchObject({ code: "RATE_LIMITED" });
      expect(refused.retryAfter).toBe("1");
      // Nothing of the refused save was kept.
      expect(await stored(plan.id)).toEqual({ revision: 4, pieces: 2, revisions: 3 });

      // Somebody else, at another address, is not held up by it.
      const neighbour = await newPlan(app);
      const theirs = await save(app, neighbour, pieces, "203.0.113.9");
      expect(theirs.statusCode, theirs.body).toBe(200);

      // Half a second on it is still short; at one second the next save lands.
      vi.setSystemTime(NOON + 500);
      expect((await save(app, plan, pieces)).statusCode).toBe(429);
      vi.setSystemTime(NOON + 1_000);
      const resumed = await save(app, plan, pieces);
      expect(resumed.statusCode, resumed.body).toBe(200);
      expect(await stored(plan.id)).toEqual({ revision: 5, pieces: 2, revisions: 4 });
    } finally {
      await app.close();
    }
  });
});
