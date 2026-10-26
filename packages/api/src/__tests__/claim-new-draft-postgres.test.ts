import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { claimConfigRoutes } from "../routes/claim-config.js";
import { placedObjectRoutes } from "../routes/placed-objects.js";
import { publicConfigRoutes } from "../routes/public-configs.js";
import { cleanupPreviewConfigurations } from "../services/cleanup.js";

// ---------------------------------------------------------------------------
// A signed-in person's new plan is theirs from the start (release audit,
// batch C, part 1).
//
// /plan creates every new plan through POST /public/configurations, which
// stores it with no owner. A signed-in person's editor then saves through the
// authenticated batch route, which answers only the owner or the venue floor,
// so a client's new plan was refused on every save, and a member of staff's
// saved but stayed ownerless, out of their lists and open to the preview
// sweep. The editor now claims the draft right after creating it, through
// the claim route the sign-in dialog already used. This proves, on the real
// routes and a migrated database, the contract that fix relies on: the
// refusal before the claim, and ownership, saving and safety from the sweep
// after it.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Claim tests require the explicit disposable platform database");
  }
}

interface Person { readonly id: string; readonly role: string; readonly venueId: string | null }

describe.skipIf(target === undefined)("a signed-in person's new plan on the migrated disposable database", () => {
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;
  const venueId = randomUUID();
  const spaceId = randomUUID();
  const chairId = randomUUID();
  const client: Person = { id: randomUUID(), role: "client", venueId: null };
  const staff: Person = { id: randomUUID(), role: "staff", venueId };

  function as(person: Person): { authorization: string } {
    return { authorization: `Bearer ${JSON.stringify({ id: person.id, email: `${person.id}@claim.invalid`, role: person.role, platformRole: "none", venueId: person.venueId })}` };
  }

  /** What /plan does for everyone: a new plan through the public route. */
  async function newDraft(): Promise<{ id: string; revision: number }> {
    const response = await server.inject({ method: "POST", url: "/public/configurations", payload: { spaceId } });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ data: { id: string; revision: number } }>().data;
  }

  function signedInSave(configId: string, revision: number, person: Person): Promise<{ statusCode: number; body: string }> {
    return server.inject({
      method: "POST", url: `/configurations/${configId}/objects/batch`, headers: as(person),
      payload: { expectedRevision: revision, objects: [{
        assetDefinitionId: chairId, positionX: 1, positionY: 0, positionZ: 1,
        rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1, sortOrder: 0,
      }] },
    });
  }

  async function row(configId: string): Promise<typeof schema.configurations.$inferSelect | undefined> {
    const [found] = await db.select().from(schema.configurations).where(eq(schema.configurations.id, configId)).limit(1);
    return found;
  }

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `claim_new_draft_${randomUUID()}`, max: 4 });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY claim venue", slug: venueId, address: "Disposable fixture" });
    await db.insert(schema.spaces).values({ id: spaceId, venueId, name: "Room", slug: "room", widthM: "20", lengthM: "20", heightM: "4",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] });
    await db.insert(schema.users).values([
      { id: client.id, name: "Claim client", email: `${client.id}@claim.invalid`, role: "client" },
      { id: staff.id, name: "Claim staff", email: `${staff.id}@claim.invalid`, role: "staff", venueId },
    ]);
    await db.insert(schema.assetDefinitions).values({ id: chairId, name: "TEST ONLY claim chair", category: "chair", widthM: "0.5", depthM: "0.5", heightM: "0.9" });
    server = Fastify();
    await server.register(publicConfigRoutes, { db, prefix: "/public" });
    await server.register(placedObjectRoutes, { db, prefix: "/configurations/:configId/objects" });
    await server.register(claimConfigRoutes, { db, prefix: "/configurations" });
    await server.ready();
  }, 60000);

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  it("refuses a signed-in client's save to a new plan nobody owns, and accepts it once claimed", async () => {
    const draft = await newDraft();
    expect(await row(draft.id)).toMatchObject({ userId: null, isPublicPreview: true });

    const refused = await signedInSave(draft.id, draft.revision, client);
    expect(refused.statusCode).toBe(403);

    const claim = await server.inject({ method: "POST", url: `/configurations/${draft.id}/claim`, headers: as(client) });
    expect(claim.statusCode, claim.body).toBe(200);
    expect(await row(draft.id)).toMatchObject({ userId: client.id, isPublicPreview: false, visibility: "private" });

    const saved = await signedInSave(draft.id, draft.revision, client);
    expect(saved.statusCode, saved.body).toBe(200);
  });

  it("lets venue staff save an unclaimed plan but leaves it ownerless until claimed", async () => {
    const draft = await newDraft();
    const saved = await signedInSave(draft.id, draft.revision, staff);
    expect(saved.statusCode, saved.body).toBe(200);
    expect((await row(draft.id))?.userId).toBeNull();

    const claim = await server.inject({ method: "POST", url: `/configurations/${draft.id}/claim`, headers: as(staff) });
    expect(claim.statusCode, claim.body).toBe(200);
    expect((await row(draft.id))?.userId).toBe(staff.id);
  });

  it("keeps a claimed plan out of the preview sweep, however long it is left", async () => {
    const draft = await newDraft();
    await server.inject({ method: "POST", url: `/configurations/${draft.id}/claim`, headers: as(client) });
    const longAgo = new Date(Date.now() - 60 * 24 * 3_600_000);
    await db.update(schema.configurations).set({ createdAt: longAgo, updatedAt: longAgo }).where(eq(schema.configurations.id, draft.id));

    await cleanupPreviewConfigurations(db);
    expect(await row(draft.id)).toMatchObject({ userId: client.id });
  });

  it("does not let a second account take a plan that is already claimed", async () => {
    const draft = await newDraft();
    expect((await server.inject({ method: "POST", url: `/configurations/${draft.id}/claim`, headers: as(client) })).statusCode).toBe(200);
    const second = await server.inject({ method: "POST", url: `/configurations/${draft.id}/claim`, headers: as(staff) });
    expect(second.statusCode).toBe(409);
    expect((await row(draft.id))?.userId).toBe(client.id);
  });
});
