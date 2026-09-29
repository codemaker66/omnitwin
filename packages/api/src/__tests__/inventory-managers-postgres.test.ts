import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  InventoryAssessmentResponseSchema, InventoryRemedyApproveResponseSchema, InventoryRemedyPrepareResponseSchema,
  InventoryRemedyResponseSchema, InventoryReservationHistoryResponseSchema, InventoryReservationMutationResponseSchema,
  VenueInventoryHistoryResponseSchema, VenueInventoryWriteResponseSchema,
  type InventoryAssessment, type InventoryReservationApprovalInput, type InventoryReservationRelease, type InventoryReservationSource,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { venueInventoryRoutes } from "../routes/venue-inventory.js";
import { inventoryReservationsRoutes } from "../routes/inventory-reservations.js";
import { stockActor } from "../scripts/import-venue-stock.js";
import { seedInventoryReservationsFixture, type InventoryReservationsFixture } from "../test-support/inventory-reservations-fixture.js";

// ---------------------------------------------------------------------------
// A venue's managers keep its inventory with its administrators (Blake, 29
// September 2026), through the real routes on real PostgreSQL: each decision
// and each count records who made it and in which role, a revocation records
// the one who revoked, and a request keeps who prepared it beside who approved
// it. The unit tests pin what each record says; these pin what is stored.
//
// Like the reservation suite, this needs a disposable local database reached
// through the Neon WebSocket bridge (infra/dev-db/neon-ws-bridge.mjs). CI does
// not run it.
// ---------------------------------------------------------------------------

const databaseUrl = process.env["VENVIEWER_INVENTORY_TEST_DATABASE_URL"];
let pool: Pool;
let db: Database;
let server: FastifyInstance;
let fixture: InventoryReservationsFixture;

function headers(userId: string, role: string) {
  return { authorization: `Bearer ${JSON.stringify({ id: userId, name: "Inventory keeper", email: `${userId}@inventory.local.test`, role,
    platformRole: "none", venueId: fixture.venueId })}` };
}
const path = (suffix: string): string => `/venues/${fixture.venueId}/inventory/${suffix}`;
const post = (suffix: string, payload: Record<string, unknown>, userId: string, role: string) =>
  server.inject({ method: "POST", url: path(suffix), headers: headers(userId, role), payload });

async function assessment(): Promise<InventoryAssessment> {
  const query = new URLSearchParams({ from: fixture.window.startsAt, to: fixture.window.endsAt });
  const response = await server.inject({ method: "GET", url: path(`assessment?${query.toString()}`), headers: headers(fixture.adminId, "manager") });
  expect(response.statusCode, response.body.slice(0, 800)).toBe(200);
  return InventoryAssessmentResponseSchema.parse(response.json()).data;
}
function decision(current: InventoryAssessment, source: InventoryReservationSource): InventoryReservationApprovalInput {
  return { commandId: randomUUID(), eventId: source.eventId, spaceId: source.spaceId, window: current.window,
    expectedSourceDigest: source.sourceDigest, expectedAssessmentDigest: current.assessmentDigest, reason: "Reviewed with the events team",
    occupiedWindowConfirmed: true };
}
function firstRoom(current: InventoryAssessment): InventoryReservationSource {
  const source = current.sources.find((candidate) => candidate.eventId === fixture.rooms[0]?.eventId);
  if (source === undefined) throw new Error("The first room's source is missing");
  return source;
}

describe.skipIf(databaseUrl === undefined)("managers keep the inventory, on real PostgreSQL", () => {
  beforeAll(async () => {
    if (databaseUrl === undefined) throw new Error("Local fixture database URL required");
    const url = new URL(databaseUrl);
    if (url.hostname !== "127.0.0.1" || url.port !== "54329" || !url.pathname.startsWith("/venviewer_inventory_")) {
      throw new Error("Inventory manager tests require a disposable local venviewer_inventory_ database on port 54329");
    }
    neonConfig.wsProxy = (host) => `${host}:54331/v1`;
    neonConfig.useSecureWebSocket = false; neonConfig.pipelineTLS = false; neonConfig.pipelineConnect = false;
    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle(pool, { schema });
    server = Fastify({ logger: false });
    await server.register(venueInventoryRoutes, { db, prefix: "/venues" });
    await server.register(inventoryReservationsRoutes, { db, prefix: "/venues" });
  }, 30_000);
  beforeEach(async () => { fixture = await db.transaction((tx) => seedInventoryReservationsFixture(tx)); }, 30_000);
  afterAll(async () => {
    // Frozen evidence is immutable; fixtures stay in this disposable database.
    if (server !== undefined) await server.close();
    if (pool !== undefined) await pool.end();
  });

  it("records a manager's approval and an administrator's revocation, each in their role", async () => {
    const current = await assessment();
    const approval = decision(current, firstRoom(current));
    const approved = await post("reservations/approve", approval, fixture.adminId, "manager");
    expect(approved.statusCode, approved.body.slice(0, 800)).toBe(200);
    const release = InventoryReservationMutationResponseSchema.parse(approved.json()).data.release;
    expect(release).toMatchObject({ action: "approved", actorUserId: fixture.adminId, actorRole: "manager" });
    // Replayed by the same person in another role, the record stands as made.
    const replayed = await post("reservations/approve", approval, fixture.adminId, "admin");
    expect(replayed.statusCode).toBe(200);
    expect(InventoryReservationMutationResponseSchema.parse(replayed.json()).data).toMatchObject({ replayed: true, release });

    const after = await assessment();
    const { occupiedWindowConfirmed: _confirmed, ...revocation } = decision(after, firstRoom(after));
    const revoked = await post("reservations/revoke", revocation, fixture.secondAdminId, "admin");
    expect(revoked.statusCode, revoked.body.slice(0, 800)).toBe(200);
    const revoke = InventoryReservationMutationResponseSchema.parse(revoked.json()).data.release;
    expect(revoke).toMatchObject({ action: "revoked", actorUserId: fixture.secondAdminId, actorRole: "admin", supersedesReleaseId: release.id,
      revision: 2 });
    // Everything else is carried from the approval.
    const carried = ({ id: _id, action: _action, revision: _revision, supersedesReleaseId: _supersedes, actorUserId: _actor, actorRole: _role,
      recordedAt: _at, reason: _reason, ...rest }: InventoryReservationRelease) => rest;
    expect(carried(revoke)).toEqual(carried(release));

    const history = await server.inject({ method: "GET", url: path(`reservations/${release.eventId}/${release.spaceId}/history`),
      headers: headers(fixture.secondAdminId, "manager") });
    expect(InventoryReservationHistoryResponseSchema.parse(history.json()).data.map((record) => [record.action, record.actorRole, record.actorUserId]))
      .toEqual([["revoked", "admin", fixture.secondAdminId], ["approved", "manager", fixture.adminId]]);
    const [stored] = await db.select({ actor: schema.inventoryReservationReleases.actorUserId }).from(schema.inventoryReservationReleases)
      .where(eq(schema.inventoryReservationReleases.id, revoke.id));
    expect(stored?.actor).toBe(fixture.secondAdminId);
  });

  it("records a manager revoking an approval made before roles were kept", async () => {
    const current = await assessment();
    const approved = await post("reservations/approve", decision(current, firstRoom(current)), fixture.adminId, "admin");
    const release = InventoryReservationMutationResponseSchema.parse(approved.json()).data.release;
    // An approval from before: no role, appended as the next revision.
    const { actorRole: _role, ...earlier } = { ...release, id: randomUUID(), revision: 2, supersedesReleaseId: release.id };
    await db.insert(schema.inventoryReservationReleases).values({ id: earlier.id, venueId: earlier.venueId, eventId: earlier.eventId,
      spaceId: earlier.spaceId, revision: 2, actorUserId: earlier.actorUserId, recordedAt: new Date(earlier.recordedAt), payload: earlier });
    const after = await assessment();
    expect(firstRoom(after).approvedRelease?.actorRole).toBeUndefined();
    const { occupiedWindowConfirmed: _confirmed, ...revocation } = decision(after, firstRoom(after));
    const revoked = await post("reservations/revoke", revocation, fixture.secondAdminId, "manager");
    expect(revoked.statusCode, revoked.body.slice(0, 800)).toBe(200);
    expect(InventoryReservationMutationResponseSchema.parse(revoked.json()).data.release)
      .toMatchObject({ action: "revoked", actorUserId: fixture.secondAdminId, actorRole: "manager", revision: 3, supersedesReleaseId: earlier.id });
  });

  it("keeps a request's preparer and role beside its approver and theirs", async () => {
    for (const room of fixture.rooms) {
      const current = await assessment();
      const source = current.sources.find((candidate) => candidate.eventId === room.eventId);
      if (source === undefined) throw new Error("A room's source is missing");
      expect((await post("reservations/approve", decision(current, source), fixture.adminId, "admin")).statusCode).toBe(200);
    }
    const current = await assessment();
    const prepared = await post("remedies/prepare", { commandId: randomUUID(), kind: "hire_request", assetDefinitionId: fixture.chairId,
      window: current.window, quantity: 10, expectedAssessmentDigest: current.assessmentDigest, reason: "Hire the shortfall" }, fixture.adminId, "manager");
    expect(prepared.statusCode, prepared.body.slice(0, 800)).toBe(200);
    const request = InventoryRemedyPrepareResponseSchema.parse(prepared.json()).data.remedy;
    expect(request).toMatchObject({ status: "prepared", preparedBy: fixture.adminId, preparedByRole: "manager", approvedBy: null,
      approvedByRole: null, approvedAt: null, check: "current" });

    const approved = await post(`remedies/${request.id}/approve`, { commandId: randomUUID(), expectedAssessmentDigest: current.assessmentDigest },
      fixture.secondAdminId, "admin");
    expect(approved.statusCode, approved.body.slice(0, 800)).toBe(200);
    expect(InventoryRemedyApproveResponseSchema.parse(approved.json()).data.remedy).toMatchObject({ status: "approved",
      preparedBy: fixture.adminId, preparedByRole: "manager", approvedBy: fixture.secondAdminId, approvedByRole: "admin", check: "current",
      preparedAt: request.preparedAt });
    const read = await server.inject({ method: "GET", url: path(`remedies/${request.id}`), headers: headers(fixture.adminId, "manager") });
    expect(read.statusCode, read.body.slice(0, 800)).toBe(200);
    expect(InventoryRemedyResponseSchema.parse(read.json()).data).toMatchObject({ preparedByRole: "manager", approvedByRole: "admin" });
  });

  it("records a manager's first count and an administrator's correction, each in their role", async () => {
    const counted = await server.inject({ method: "POST", url: path(`${fixture.unrecordedAssetId}/adjustments`), headers: headers(fixture.adminId, "manager"),
      payload: { commandId: randomUUID(), expectedRevision: null, ownedQuantity: 4, damagedQuantity: 0, unavailableQuantity: 0, hires: [],
        storageLocation: "AV cupboard", status: "active", reason: "First count" } });
    expect(counted.statusCode, counted.body.slice(0, 800)).toBe(200);
    expect(VenueInventoryWriteResponseSchema.parse(counted.json()).data.receipt)
      .toMatchObject({ kind: "created", actorRole: "manager", actorUserId: fixture.adminId });
    const corrected = await server.inject({ method: "POST", url: path(`${fixture.unrecordedAssetId}/adjustments`),
      headers: headers(fixture.secondAdminId, "admin"),
      payload: { commandId: randomUUID(), expectedRevision: 1, ownedQuantity: 5, damagedQuantity: 0, unavailableQuantity: 0, hires: [],
        storageLocation: "AV cupboard", status: "active", reason: "Recount" } });
    expect(corrected.statusCode, corrected.body.slice(0, 800)).toBe(200);
    expect(VenueInventoryWriteResponseSchema.parse(corrected.json()).data.receipt).toMatchObject({ kind: "adjusted", actorRole: "admin" });
    const history = await server.inject({ method: "GET", url: path(`${fixture.unrecordedAssetId}/history`), headers: headers(fixture.adminId, "staff") });
    expect(history.statusCode, history.body.slice(0, 800)).toBe(200);
    expect(VenueInventoryHistoryResponseSchema.parse(history.json()).data.map((receipt) => receipt.actorRole).sort()).toEqual(["admin", "manager"]);
  });

  it("imports stock as the account's own role, and refuses anyone who cannot keep it", async () => {
    const manager = randomUUID(), staff = randomUUID(), elsewhere = randomUUID();
    await db.insert(schema.users).values([
      { id: manager, name: "Venue manager", email: `${manager}@inventory.local.test`, role: "manager", platformRole: "none", venueId: fixture.venueId },
      { id: staff, name: "Venue staff", email: `${staff}@inventory.local.test`, role: "staff", platformRole: "admin", venueId: fixture.venueId },
      { id: elsewhere, name: "Another venue's administrator", email: `${elsewhere}@inventory.local.test`, role: "admin", platformRole: "none",
        venueId: fixture.otherVenueId },
    ]);
    await expect(stockActor(db, manager, fixture.venueId)).resolves.toEqual({ userId: manager, role: "manager", venueId: fixture.venueId });
    await expect(stockActor(db, staff, fixture.venueId)).rejects.toThrow(/cannot change its stock/u);
    await expect(stockActor(db, elsewhere, fixture.venueId)).rejects.toThrow(/cannot change its stock/u);
    await expect(stockActor(db, randomUUID(), fixture.venueId)).rejects.toThrow(/No account/u);
  });
});
