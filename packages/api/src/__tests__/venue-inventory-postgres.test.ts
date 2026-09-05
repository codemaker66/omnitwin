import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, inArray, sql } from "drizzle-orm";
import { VenueInventoryHistoryResponseSchema, VenueInventoryListResponseSchema, VenueInventoryWriteResponseSchema,
  type VenueInventoryWriteInput } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import type { Database } from "../db/client.js";
import { venueInventoryRoutes } from "../routes/venue-inventory.js";

// Opt-in only: a real disposable LOCAL PostgreSQL database behind the repo's
// Neon websocket bridge. Normal unit tests never touch a database.
const databaseUrl = process.env["VENVIEWER_INVENTORY_TEST_DATABASE_URL"];
const venueId = randomUUID();
const otherVenueId = randomUUID();
const adminId = randomUUID();
const secondAdminId = randomUUID();
const assetIds: string[] = [];
let assetId: string;
let pool: Pool;
let db: Database;
let server: FastifyInstance;
let initialized = false;

function headers(userId: string = adminId) {
  return { authorization: `Bearer ${JSON.stringify({ id: userId, name: "Inventory test administrator",
    email: `${userId}@example.test`, role: "admin", platformRole: "none", venueId })}` };
}
function input(change: Partial<VenueInventoryWriteInput> = {}): VenueInventoryWriteInput {
  return { commandId: randomUUID(), expectedRevision: null, ownedQuantity: 200, damagedQuantity: 20,
    unavailableQuantity: 0, hires: [], storageLocation: "East store", status: "active", reason: "Physical count", ...change };
}
function write(payload: VenueInventoryWriteInput, id = assetId, userId: string = adminId) {
  return server.inject({ method: "POST", url: `/venues/${venueId}/inventory/${id}/adjustments`, headers: headers(userId), payload });
}
async function addAsset(): Promise<string> {
  const id = randomUUID();
  assetIds.push(id);
  await db.insert(schema.assetDefinitions).values({ id, name: `Inventory fixture ${id}`, category: "chair", widthM: "0.5", depthM: "0.5", heightM: "0.9" });
  return id;
}

describe.skipIf(databaseUrl === undefined)("venue inventory real PostgreSQL transactions", () => {
  beforeAll(async () => {
    if (databaseUrl === undefined) throw new Error("Local database URL required");
    const url = new URL(databaseUrl);
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.startsWith("/venviewer_inventory_")) {
      throw new Error("Inventory integration tests require a dedicated local venviewer_inventory_ database");
    }
    neonConfig.wsProxy = (host) => `${host}:54331/v1`;
    neonConfig.useSecureWebSocket = false;
    neonConfig.pipelineTLS = false;
    neonConfig.pipelineConnect = false;
    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle(pool, { schema });
    server = Fastify({ logger: false });
    await server.register(venueInventoryRoutes, { db, prefix: "/venues" });
    await db.insert(schema.venues).values([
      { id: venueId, name: "Inventory transaction fixture", slug: `inventory-${venueId}`, address: "Local fixture" },
      { id: otherVenueId, name: "Other inventory fixture", slug: `inventory-${otherVenueId}`, address: "Local fixture" },
    ]);
    await db.insert(schema.users).values([adminId, secondAdminId].map((id) => ({ id,
      email: `${id}@example.test`, name: "Inventory administrator", role: "admin", venueId })));
    initialized = true;
  }, 30000);

  beforeEach(async () => { assetId = await addAsset(); });
  afterAll(async () => {
    if (initialized) {
      await db.delete(schema.venueInventoryReceipts).where(eq(schema.venueInventoryReceipts.venueId, venueId));
      await db.delete(schema.venueInventoryStock).where(eq(schema.venueInventoryStock.venueId, venueId));
      await db.delete(schema.users).where(inArray(schema.users.id, [adminId, secondAdminId]));
      if (assetIds.length > 0) await db.delete(schema.assetDefinitions).where(inArray(schema.assetDefinitions.id, assetIds));
      await db.delete(schema.venues).where(inArray(schema.venues.id, [venueId, otherVenueId]));
    }
    if (server !== undefined) await server.close();
    if (pool !== undefined) await pool.end();
  });

  it("lists unrecorded stock as null, creates stock and returns server-owned audit history", async () => {
    const before = VenueInventoryListResponseSchema.parse((await server.inject({ method: "GET",
      url: `/venues/${venueId}/inventory`, headers: headers() })).json());
    expect(before.data.items.find((item) => item.catalogue.id === assetId)?.stock).toBeNull();
    expect(before.data.availability.status).toBe("unavailable");
    const response = await write(input());
    expect(response.statusCode).toBe(200);
    const result = VenueInventoryWriteResponseSchema.parse(response.json()).data;
    expect(result.stock).toMatchObject({ revision: 1, ownedQuantity: 200, damagedQuantity: 20 });
    expect(result.receipt).toMatchObject({ kind: "created", actorUserId: adminId, actorRole: "admin", before: null });
    const history = VenueInventoryHistoryResponseSchema.parse((await server.inject({ method: "GET",
      url: `/venues/${venueId}/inventory/${assetId}/history`, headers: headers() })).json());
    expect(history.total).toBe(1);
    expect(history.data[0]).toEqual(result.receipt);
  });

  it("preserves normalized idempotency and never rolls back newer stock on replay", async () => {
    const initial = input({ hires: [{ id: randomUUID(), quantity: 4, startsAt: "2026-10-01T10:00:00+01:00", endsAt: "2026-10-01T18:00:00+01:00" },
      { id: randomUUID(), quantity: 3, startsAt: "2026-10-01T10:00:00+01:00", endsAt: "2026-10-01T18:00:00+01:00" }] });
    const first = VenueInventoryWriteResponseSchema.parse((await write(initial)).json()).data;
    const updated = VenueInventoryWriteResponseSchema.parse((await write(input({ expectedRevision: 1, ownedQuantity: 180 }))).json()).data;
    expect(updated.stock.revision).toBe(2);
    const normalizedRetry = { ...initial, hires: [...initial.hires].reverse().map((hire) => ({ ...hire,
      startsAt: new Date(hire.startsAt).toISOString(), endsAt: new Date(hire.endsAt).toISOString() })) };
    const repeated = VenueInventoryWriteResponseSchema.parse((await write(normalizedRetry)).json()).data;
    expect(repeated.replayed).toBe(true);
    expect(repeated.receipt).toEqual(first.receipt);
    expect(repeated.stock).toEqual(updated.stock);
  });

  it("rejects stale revisions with current stock and keeps the attempted edit out of history", async () => {
    await write(input());
    const response = await write(input({ expectedRevision: 0, ownedQuantity: 250 }));
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "INVENTORY_REVISION_CONFLICT", details: { currentStock: { revision: 1, ownedQuantity: 200 } } });
    const rows = await db.select().from(schema.venueInventoryReceipts).where(eq(schema.venueInventoryReceipts.assetDefinitionId, assetId));
    expect(rows).toHaveLength(1);
  });

  it("treats UUID letter case as one database identity across writes and retries", async () => {
    const payload = input({ commandId: randomUUID().toUpperCase() });
    const firstResponse = await write(payload, assetId.toUpperCase());
    expect(firstResponse.statusCode).toBe(200);
    const first = VenueInventoryWriteResponseSchema.parse(firstResponse.json()).data;
    const sameCaseRetry = await write(payload, assetId.toUpperCase());
    expect(sameCaseRetry.statusCode).toBe(200);
    const canonicalRetry = await write({ ...payload, commandId: payload.commandId.toLowerCase() }, assetId.toLowerCase());
    expect(canonicalRetry.statusCode).toBe(200);
    const repeated = VenueInventoryWriteResponseSchema.parse(canonicalRetry.json()).data;
    expect(repeated.receipt).toEqual(first.receipt);
    expect(repeated.replayed).toBe(true);
    expect(repeated.stock.assetDefinitionId).toBe(assetId.toLowerCase());
    const upperAuthority = await server.inject({ method: "POST",
      url: `/venues/${venueId.toUpperCase()}/inventory/${assetId.toUpperCase()}/adjustments`,
      headers: headers(adminId.toUpperCase()), payload });
    expect(upperAuthority.statusCode).toBe(200);
    const update = await write(input({ expectedRevision: 1, ownedQuantity: 210 }), assetId.toUpperCase());
    expect(update.statusCode).toBe(200);
  });

  it("serializes simultaneous updates: one writes and the other observes a conflict", async () => {
    await write(input());
    const results = await Promise.all([write(input({ expectedRevision: 1, ownedQuantity: 180 })), write(input({ expectedRevision: 1, ownedQuantity: 220 }))]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    const [stock] = await db.select().from(schema.venueInventoryStock).where(eq(schema.venueInventoryStock.assetDefinitionId, assetId));
    expect(stock?.revision).toBe(2);
    expect([180, 220]).toContain(stock?.ownedQuantity);
  });

  it("serializes concurrent initial records and returns one stable receipt for duplicate delivery", async () => {
    const payload = input();
    const results = await Promise.all([write(payload), write(payload)]);
    expect(results.map((result) => result.statusCode)).toEqual([200, 200]);
    const data = results.map((result) => VenueInventoryWriteResponseSchema.parse(result.json()).data);
    expect(data.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(data[0]?.receipt).toEqual(data[1]?.receipt);
  });

  it("rejects duplicate identities with changed payload, actor or catalogue item", async () => {
    const payload = input();
    await write(payload);
    const otherAsset = await addAsset();
    for (const response of [await write({ ...payload, ownedQuantity: 201 }),
      await write(payload, assetId, secondAdminId), await write(payload, otherAsset)]) {
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "INVENTORY_IDEMPOTENCY_CONFLICT" });
    }
    expect(await db.select().from(schema.venueInventoryStock).where(eq(schema.venueInventoryStock.assetDefinitionId, otherAsset))).toHaveLength(0);
  });

  it("rolls back the stock update if the receipt insert fails", async () => {
    await write(input());
    // A real PostgreSQL trigger injects a receipt-storage failure after the
    // stock UPDATE, proving the transaction rather than mocking its methods.
    await db.execute(sql`CREATE FUNCTION inventory_test_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'inventory fixture receipt storage failure'; END $$`);
    await db.execute(sql`CREATE TRIGGER inventory_test_receipt_failure BEFORE INSERT ON venue_inventory_receipts FOR EACH ROW EXECUTE FUNCTION inventory_test_receipt_failure()`);
    try {
      const response = await write(input({ expectedRevision: 1, ownedQuantity: 250 }));
      expect(response.statusCode).toBe(500);
      const [stock] = await db.select().from(schema.venueInventoryStock).where(eq(schema.venueInventoryStock.assetDefinitionId, assetId));
      expect(stock?.revision).toBe(1);
      expect(stock?.ownedQuantity).toBe(200);
      expect(await db.select().from(schema.venueInventoryReceipts).where(eq(schema.venueInventoryReceipts.assetDefinitionId, assetId))).toHaveLength(1);
    } finally {
      await db.execute(sql`DROP TRIGGER inventory_test_receipt_failure ON venue_inventory_receipts`);
      await db.execute(sql`DROP FUNCTION inventory_test_receipt_failure()`);
    }
  });

  it("enforces stock constraints even for SQL writes bypassing the service", async () => {
    await write(input());
    for (const values of [{ ownedQuantity: -1 }, { damagedQuantity: 201 }, { revision: 0 }, { status: "unknown" }]) {
      await expect(db.update(schema.venueInventoryStock).set(values).where(and(eq(schema.venueInventoryStock.venueId, venueId),
        eq(schema.venueInventoryStock.assetDefinitionId, assetId)))).rejects.toThrow();
    }
  });
});
