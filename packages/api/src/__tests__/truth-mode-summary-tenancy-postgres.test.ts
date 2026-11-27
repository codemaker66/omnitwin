import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { evidenceItemRoutes, truthModeRoutes } from "../routes/evidence-runtime.js";

// ---------------------------------------------------------------------------
// The Truth Mode summary keeps to its venue (audit contract-n-3, tenancy-a-6,
// timeline-inventory-4).
//
// GET /truth-mode/summary counts a target's evidence, checks, assumptions,
// open review gates and stale events. Every row it counts belongs to one
// layout (configuration), and a layout's ids are printed on hallkeeper sheets.
// The summary therefore answers only who the sibling routes in
// routes/evidence-runtime.ts answer: the layout's owner and its venue's floor.
// A layout or a layout snapshot is refused exactly as /evidence/items refuses
// it (403 for another venue's, 404 for an id nobody has); a target that is not
// one layout (a route, a runtime asset) counts only the caller's layouts.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Truth Mode tenancy tests require the explicit disposable platform database");
  }
}

interface Person {
  readonly id: string;
  readonly role: string;
  readonly venueId: string | null;
  readonly platformRole: "none" | "admin";
}

interface SummaryCounts {
  readonly evidenceItems: number;
  readonly checkResults: number;
  readonly assumptions: number;
  readonly reviewGates: number;
  readonly staleEvents: number;
}

describe.skipIf(target === undefined)("the Truth Mode summary on the migrated disposable database", () => {
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;
  const venueA = randomUUID();
  const venueB = randomUUID();
  const spaceA = randomUUID();
  const spaceB = randomUUID();
  const configA = randomUUID();
  const configB = randomUUID();
  const snapshotA = randomUUID();
  const snapshotB = randomUUID();
  // A runtime asset both venues' layouts link to, as a shared package id would be.
  const sharedAsset = `test-only-asset-${randomUUID()}`;
  const staffA: Person = { id: randomUUID(), role: "staff", venueId: venueA, platformRole: "none" };
  const staffB: Person = { id: randomUUID(), role: "staff", venueId: venueB, platformRole: "none" };
  const ownerA: Person = { id: randomUUID(), role: "client", venueId: null, platformRole: "none" };
  const stranger: Person = { id: randomUUID(), role: "client", venueId: null, platformRole: "none" };
  const platformAdmin: Person = { id: randomUUID(), role: "admin", venueId: null, platformRole: "admin" };

  function as(person: Person): { authorization: string } {
    return { authorization: `Bearer ${JSON.stringify({ id: person.id, email: `${person.id}@truth.invalid`,
      role: person.role, platformRole: person.platformRole, venueId: person.venueId })}` };
  }

  async function summary(targetType: string, targetId: string, person: Person | null): Promise<{
    readonly statusCode: number;
    readonly body: string;
    readonly code: string | undefined;
    readonly counts: SummaryCounts | undefined;
  }> {
    const query = new URLSearchParams({ targetType, targetId });
    const response = await server.inject({
      method: "GET",
      url: `/truth-mode/summary?${query.toString()}`,
      ...(person === null ? {} : { headers: as(person) }),
    });
    const json = response.json<{ code?: string; data?: { counts: SummaryCounts } }>();
    return { statusCode: response.statusCode, body: response.body, code: json.code, counts: json.data?.counts };
  }

  /** What the sibling /evidence/items route answers the same person for the same layout. */
  async function siblingStatus(configId: string, person: Person): Promise<number> {
    const response = await server.inject({ method: "GET", url: `/evidence/items?configId=${configId}`, headers: as(person) });
    return response.statusCode;
  }

  /** The rows an evidence pack writes for one layout, keyed as the generator keys them. */
  async function evidenceFor(configId: string, snapshotId: string): Promise<void> {
    const item = { sourceType: "system_generated", sourceLabel: "TEST ONLY evidence", confidence: "low", wording: "TEST ONLY" };
    await db.insert(schema.evidenceItems).values([
      { ...item, configId, targetType: "configuration", targetId: configId, itemType: "capacity_result", status: "partial", staleState: "review_due" },
      { ...item, configId, targetType: "layout_snapshot", targetId: snapshotId, itemType: "layout_snapshot", status: "current", staleState: "current" },
      { ...item, configId, targetType: "route", targetId: configId, itemType: "route_clearance_result", status: "not_checked", staleState: "unknown" },
      { ...item, configId, targetType: "runtime_asset", targetId: sharedAsset, itemType: "runtime_asset_status", status: "missing", staleState: "unknown" },
    ]);
    await db.insert(schema.reviewGates).values({
      configId, targetType: "configuration", targetId: configId, gateType: "human_review_required",
      status: "open", title: "TEST ONLY gate", description: "TEST ONLY", requiredRole: "venue_staff",
    });
  }

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `truth_mode_tenancy_${randomUUID()}`, max: 4 });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    await db.insert(schema.venues).values([
      { id: venueA, name: "TEST ONLY truth venue A", slug: venueA, address: "Disposable fixture" },
      { id: venueB, name: "TEST ONLY truth venue B", slug: venueB, address: "Disposable fixture" },
    ]);
    const outline = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
    await db.insert(schema.spaces).values([
      { id: spaceA, venueId: venueA, name: "Room", slug: "room", widthM: "20", lengthM: "20", heightM: "4", floorPlanOutline: outline },
      { id: spaceB, venueId: venueB, name: "Room", slug: "room", widthM: "20", lengthM: "20", heightM: "4", floorPlanOutline: outline },
    ]);
    await db.insert(schema.users).values([staffA, staffB, ownerA, stranger, platformAdmin].map((person) => ({
      id: person.id, name: "TEST ONLY person", email: `${person.id}@truth.invalid`,
      role: person.role, venueId: person.venueId, platformRole: person.platformRole,
    })));
    await db.insert(schema.configurations).values([
      { id: configA, spaceId: spaceA, venueId: venueA, userId: ownerA.id, name: "TEST ONLY layout A", layoutStyle: "dinner-rounds" },
      { id: configB, spaceId: spaceB, venueId: venueB, userId: null, name: "TEST ONLY layout B", layoutStyle: "dinner-rounds" },
    ]);
    await db.insert(schema.configurationSheetSnapshots).values([
      { id: snapshotA, configurationId: configA, version: 1, payload: {}, sourceHash: "a".repeat(64) },
      { id: snapshotB, configurationId: configB, version: 1, payload: {}, sourceHash: "b".repeat(64) },
    ]);
    await evidenceFor(configA, snapshotA);
    await evidenceFor(configB, snapshotB);
    server = Fastify();
    await server.register(truthModeRoutes, { db, prefix: "/truth-mode" });
    await server.register(evidenceItemRoutes, { db, prefix: "/evidence" });
    await server.ready();
  }, 60000);

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  it("gives a layout's summary to its venue's floor and to its owner", async () => {
    const byStaff = await summary("configuration", configA, staffA);
    expect(byStaff.statusCode, byStaff.body).toBe(200);
    expect(byStaff.counts).toMatchObject({ evidenceItems: 1, reviewGates: 1 });
    const byOwner = await summary("configuration", configA, ownerA);
    expect(byOwner.statusCode, byOwner.body).toBe(200);
    expect(byOwner.counts).toMatchObject({ evidenceItems: 1, reviewGates: 1 });
    const snapshot = await summary("layout_snapshot", snapshotA, staffA);
    expect(snapshot.statusCode, snapshot.body).toBe(200);
    expect(snapshot.counts).toMatchObject({ evidenceItems: 1 });
  });

  it("refuses another venue's layout and snapshot as the sibling routes do", async () => {
    const otherVenue = await summary("configuration", configB, staffA);
    expect(otherVenue.statusCode, otherVenue.body).toBe(403);
    expect(otherVenue.code).toBe("FORBIDDEN");
    expect(otherVenue.counts).toBeUndefined();
    expect(otherVenue.statusCode).toBe(await siblingStatus(configB, staffA));

    const notTheirs = await summary("configuration", configA, stranger);
    expect(notTheirs.statusCode, notTheirs.body).toBe(403);
    expect(notTheirs.statusCode).toBe(await siblingStatus(configA, stranger));

    const otherSnapshot = await summary("layout_snapshot", snapshotB, staffA);
    expect(otherSnapshot.statusCode, otherSnapshot.body).toBe(403);
    expect(otherSnapshot.counts).toBeUndefined();
  });

  it("answers an id nobody has as not found, as the sibling routes do", async () => {
    const nobody = randomUUID();
    const missing = await summary("configuration", nobody, staffA);
    expect(missing.statusCode, missing.body).toBe(404);
    expect(missing.code).toBe("NOT_FOUND");
    expect(missing.statusCode).toBe(await siblingStatus(nobody, staffA));
    const missingSnapshot = await summary("layout_snapshot", randomUUID(), staffA);
    expect(missingSnapshot.statusCode, missingSnapshot.body).toBe(404);
    // A layout id that is not an id at all is a bad query, not a database error.
    const malformed = await summary("configuration", "not-a-layout-id", staffA);
    expect(malformed.statusCode, malformed.body).toBe(400);
  });

  it("counts only the caller's own layouts on a target that is not one layout", async () => {
    // The generator keys a layout's route evidence by the layout's id.
    const otherRoute = await summary("route", configB, staffA);
    expect(otherRoute.statusCode, otherRoute.body).toBe(200);
    expect(otherRoute.counts).toEqual({ evidenceItems: 0, checkResults: 0, assumptions: 0, reviewGates: 0, staleEvents: 0 });
    const ownRoute = await summary("route", configA, staffA);
    expect(ownRoute.counts).toMatchObject({ evidenceItems: 1, reviewGates: 1 });

    expect((await summary("runtime_asset", sharedAsset, staffA)).counts).toMatchObject({ evidenceItems: 1, reviewGates: 1 });
    expect((await summary("runtime_asset", sharedAsset, staffB)).counts).toMatchObject({ evidenceItems: 1, reviewGates: 1 });
    expect((await summary("runtime_asset", sharedAsset, ownerA)).counts).toMatchObject({ evidenceItems: 1, reviewGates: 1 });
    expect((await summary("runtime_asset", sharedAsset, stranger)).counts).toMatchObject({ evidenceItems: 0, reviewGates: 0 });
    expect((await summary("runtime_asset", sharedAsset, platformAdmin)).counts).toMatchObject({ evidenceItems: 2, reviewGates: 2 });
  });

  it("lets a platform admin read any venue's layout, and nobody signed out", async () => {
    const admin = await summary("configuration", configB, platformAdmin);
    expect(admin.statusCode, admin.body).toBe(200);
    expect(admin.counts).toMatchObject({ evidenceItems: 1, reviewGates: 1 });
    const signedOut = await summary("configuration", configA, null);
    expect(signedOut.statusCode).toBe(401);
    expect(signedOut.counts).toBeUndefined();
  });
});
