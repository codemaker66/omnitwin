import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import {
  InventoryAssessmentResponseSchema, InventoryReservationMutationResponseSchema,
  InventoryReservationHistoryResponseSchema, InventoryRemedyPrepareResponseSchema,
  InventoryRemedyApproveResponseSchema, VenueInventoryWriteResponseSchema,
  type InventoryAssessment, type InventoryReservationSource,
  type InventoryReservationApprovalInput, type InventoryReservationRelease,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { venueInventoryRoutes } from "../routes/venue-inventory.js";
import { inventoryReservationsRoutes } from "../routes/inventory-reservations.js";
import { seedInventoryReservationsFixture, type InventoryReservationsFixture } from "../test-support/inventory-reservations-fixture.js";

const databaseUrl = process.env["VENVIEWER_INVENTORY_TEST_DATABASE_URL"];
let pool: Pool;
let db: Database;
let server: FastifyInstance;
let fixture: InventoryReservationsFixture;

function headers(userId = fixture.adminId, role = "admin", venueId = fixture.venueId) {
  return { authorization: `Bearer ${JSON.stringify({ id: userId, name: "Inventory test admin",
    email: `${userId}@inventory.local.test`, role, platformRole: "none", venueId })}` };
}
function path(suffix: string): string { return `/venues/${fixture.venueId}/inventory/${suffix}`; }
function post(suffix: string, payload: Record<string, unknown>, userId = fixture.adminId) {
  return server.inject({ method: "POST", url: path(suffix), headers: headers(userId), payload });
}
async function assessment(): Promise<InventoryAssessment> {
  const query = new URLSearchParams({ from: fixture.window.startsAt, to: fixture.window.endsAt });
  const response = await server.inject({ method: "GET", url: path(`assessment?${query.toString()}`), headers: headers() });
  expect(response.statusCode, response.body.slice(0, 1200)).toBe(200);
  return InventoryAssessmentResponseSchema.parse(response.json()).data;
}
function command(current: InventoryAssessment, source: InventoryReservationSource): InventoryReservationApprovalInput {
  return { commandId: randomUUID(), eventId: source.eventId, spaceId: source.spaceId,
    window: current.window, expectedSourceDigest: source.sourceDigest,
    expectedAssessmentDigest: current.assessmentDigest, reason: "Reviewed exact layout demand and equipment return window",
    occupiedWindowConfirmed: true };
}
function firstSource(current: InventoryAssessment): InventoryReservationSource {
  const source = current.sources.find((entry) => entry.eventId === fixture.rooms[0]?.eventId);
  if (source === undefined) throw new Error("First fixture event is missing from source assessment");
  return source;
}
async function approveBoth(): Promise<InventoryAssessment> {
  for (const room of fixture.rooms) {
    const current = await assessment();
    const source = current.sources.find((entry) => entry.eventId === room.eventId);
    if (source === undefined) throw new Error("Fixture source missing");
    const response = await post("reservations/approve", command(current, source));
    expect(response.statusCode, response.body.slice(0, 1200)).toBe(200);
    InventoryReservationMutationResponseSchema.parse(response.json());
  }
  return assessment();
}
async function history(source: { eventId: string; spaceId: string }): Promise<InventoryReservationRelease[]> {
  const response = await server.inject({ method: "GET", headers: headers(),
    url: path(`reservations/${source.eventId}/${source.spaceId}/history`) });
  expect(response.statusCode, response.body.slice(0, 1200)).toBe(200);
  return InventoryReservationHistoryResponseSchema.parse(response.json()).data;
}
async function stockCorrection(ownedQuantity = 200) {
  const [stock] = await db.select().from(schema.venueInventoryStock).where(and(
    eq(schema.venueInventoryStock.venueId, fixture.venueId),
    eq(schema.venueInventoryStock.assetDefinitionId, fixture.chairId)));
  if (stock === undefined) throw new Error("Fixture stock missing");
  const response = await post(`${fixture.chairId}/adjustments`, {
    commandId: randomUUID(), expectedRevision: stock.revision, ownedQuantity,
    damagedQuantity: 20, unavailableQuantity: 0, hires: [], storageLocation: "East store", status: "active",
    reason: "Actual stock count correction while events are reserved",
  });
  expect(response.statusCode, response.body.slice(0, 1200)).toBe(200);
  return VenueInventoryWriteResponseSchema.parse(response.json()).data;
}

function gate(): { promise: Promise<void>; open: () => void } {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, open: () => { if (resolve === undefined) throw new Error("Gate not initialized"); resolve(); } };
}
async function waitForBlockedQuery(fragment: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = await db.execute(sql`SELECT count(*)::int AS total FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid() AND state = 'active'
      AND wait_event_type = 'Lock' AND query ILIKE ${`%${fragment}%`}`);
    if (Number(rows.rows[0]?.["total"]) > 0) return;
    await new Promise<void>((resolve) => { setTimeout(resolve, 25); });
  }
  throw new Error(`Expected a blocked ${fragment} query`);
}

describe.skipIf(databaseUrl === undefined)("inventory reservations with real PostgreSQL", () => {
  beforeAll(async () => {
    if (databaseUrl === undefined) throw new Error("Local fixture database URL required");
    const url = new URL(databaseUrl);
    if (url.hostname !== "127.0.0.1" || url.port !== "54329" || !url.pathname.startsWith("/venviewer_inventory_")) {
      throw new Error("Reservation tests require a disposable local venviewer_inventory_ database on port 54329");
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
    // Frozen evidence is intentionally immutable. Fixtures remain in this
    // disposable database; there is no trigger bypass or destructive cleanup.
    if (server !== undefined) await server.close();
    if (pool !== undefined) await pool.end();
  });

  it("projects exact catalogue demand and room peaks without treating frozen layouts as approval", async () => {
    const current = await assessment();
    expect(current.coverage).toBe("partial");
    expect(current.sources).toHaveLength(2);
    expect(current.sources.every((source) => source.state === "unapproved")).toBe(true);
    expect(current.sources.map((source) => source.demands[0]?.quantity).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([70, 120]);
    expect(current.sources.every((source) => source.phases.length === 4)).toBe(true);
    const source = firstSource(current);
    expect(source.occupiedWindow?.startsAt).toContain("T09:00:00.000Z");
    expect(source.occupiedWindow?.endsAt).toContain("T17:00:00.000Z");
    expect(current.items.find((item) => item.assetDefinitionId === fixture.chairId)?.availability?.maximumShortageQuantity).toBe(0);
  });

  it("reserves 190 chairs across rooms and exposes the signed ten-chair shortage and affected events", async () => {
    const current = await approveBoth();
    const availability = current.items.find((item) => item.assetDefinitionId === fixture.chairId)?.availability;
    expect(availability?.minimumRemainingQuantity).toBe(-10);
    expect(availability?.maximumShortageQuantity).toBe(10);
    const shortage = availability?.segments.find((segment) => segment.shortageQuantity === 10);
    expect(shortage?.reservedQuantity).toBe(190);
    expect(shortage?.usableQuantity).toBe(180);
    expect(shortage?.eventIds.sort()).toEqual(fixture.rooms.map((room) => room.eventId).sort());
    expect(shortage?.startsAt).toContain("T10:00:00.000Z");
    expect(shortage?.endsAt).toContain("T16:00:00.000Z");
  });

  it("requires explicit occupation confirmation and narrow own-venue admin authority", async () => {
    const current = await assessment();
    const payload = command(current, firstSource(current));
    expect((await post("reservations/approve", { ...payload, occupiedWindowConfirmed: false })).statusCode).toBe(400);
    for (const role of ["staff", "hallkeeper", "client", "planner"]) {
      const response = await server.inject({ method: "POST", url: path("reservations/approve"),
        headers: headers(fixture.adminId, role), payload });
      expect(response.statusCode).toBe(403);
    }
    const foreign = await server.inject({ method: "POST", url: path("reservations/approve"),
      headers: headers(fixture.adminId, "admin", fixture.otherVenueId), payload });
    expect(foreign.statusCode).toBe(403);
    expect(await history(firstSource(current))).toHaveLength(0);
  });

  it("includes later competing demand in a full reservation proposal viewed through a short observation window", async () => {
    const initial = await assessment();
    const second = initial.sources.find((source) => source.eventId === fixture.rooms[1]?.eventId);
    if (second === undefined) throw new Error("Second fixture source missing");
    const reserved = await post("reservations/approve", command(initial, second));
    expect(reserved.statusCode, reserved.body.slice(0, 1200)).toBe(200);
    fixture.window = { startsAt: "2031-09-06T08:00:00.000Z", endsAt: "2031-09-06T09:30:00.000Z" };
    const narrow = await assessment();
    const proposal = firstSource(narrow);
    expect(proposal.proposalImpact.find((item) => item.assetDefinitionId === fixture.chairId)?.availability?.minimumRemainingQuantity).toBe(-10);
    expect(proposal.occupiedWindow?.endsAt).toBe("2031-09-06T17:00:00.000Z");
    const approved = await post("reservations/approve", command(narrow, proposal));
    expect(approved.statusCode, approved.body.slice(0, 1200)).toBe(200);
    expect(InventoryReservationMutationResponseSchema.parse(approved.json()).data.release.occupiedWindow.endsAt).toBe("2031-09-06T17:00:00.000Z");
  });

  it("replays one exact approval after newer stock while rejecting another actor's command collision", async () => {
    const current = await assessment();
    const payload = command(current, firstSource(current));
    const first = await post("reservations/approve", payload);
    expect(first.statusCode, first.body.slice(0, 1200)).toBe(200);
    const original = InventoryReservationMutationResponseSchema.parse(first.json()).data.release;
    await stockCorrection(210);
    const second = await post("reservations/approve", payload);
    expect(second.statusCode, second.body.slice(0, 1200)).toBe(200);
    const replay = InventoryReservationMutationResponseSchema.parse(second.json()).data;
    expect(replay.replayed).toBe(true);
    expect(replay.release).toEqual(original);
    expect(await history(firstSource(current))).toHaveLength(1);
    expect((await post("reservations/approve", payload, fixture.secondAdminId)).statusCode).toBe(409);
  });

  it("serializes two approvals reviewed against the same assessment", async () => {
    const current = await assessment();
    const responses = await Promise.all(current.sources.map((source) => post("reservations/approve", command(current, source))));
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const fresh = await assessment();
    expect(fresh.sources.filter((source) => source.state === "approved")).toHaveLength(1);
    const unapproved = fresh.sources.find((source) => source.state === "unapproved");
    if (unapproved === undefined) throw new Error("Expected one source to require fresh review");
    expect((await post("reservations/approve", command(fresh, unapproved))).statusCode).toBe(200);
    expect((await assessment()).items.find((item) => item.assetDefinitionId === fixture.chairId)?.availability?.maximumShortageQuantity).toBe(10);
  });

  it("does not reject a truthful count correction when it creates a larger shortage", async () => {
    await approveBoth();
    const correction = await stockCorrection(190);
    expect(correction.stock.ownedQuantity).toBe(190);
    const current = await assessment();
    expect(current.items.find((item) => item.assetDefinitionId === fixture.chairId)?.availability?.minimumRemainingQuantity).toBe(-20);
  });

  it("rechecks stock after waiting behind an actual READ COMMITTED stock correction", async () => {
    const current = await assessment();
    const source = firstSource(current);
    const locked = gate(); const release = gate();
    await db.execute(sql`CREATE FUNCTION inventory_test_stock_pause_593() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(593054329); RETURN NEW; END $$`);
    await db.execute(sql`CREATE TRIGGER inventory_test_stock_pause_593 BEFORE UPDATE ON venue_inventory_stock FOR EACH ROW EXECUTE FUNCTION inventory_test_stock_pause_593()`);
    const blocker = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(593054329)`); locked.open(); await release.promise;
    });
    await locked.promise;
    let correction: ReturnType<typeof stockCorrection> | undefined;
    let approval: ReturnType<typeof post> | undefined;
    try {
      correction = stockCorrection(210);
      await waitForBlockedQuery('update "venue_inventory_stock"');
      approval = post("reservations/approve", command(current, source));
      await waitForBlockedQuery('"venues"');
      release.open(); await blocker; await correction;
      const response = await approval;
      expect(response.statusCode, response.body.slice(0, 1200)).toBe(409);
      expect(await history(source)).toHaveLength(0);
    } finally {
      release.open(); await blocker;
      if (correction !== undefined) await correction;
      if (approval !== undefined) await approval;
      await db.execute(sql`DROP TRIGGER inventory_test_stock_pause_593 ON venue_inventory_stock`);
      await db.execute(sql`DROP FUNCTION inventory_test_stock_pause_593()`);
    }
  }, 20_000);

  it("refuses approval when the full occupied footprint requires unsupported historical evidence", async () => {
    const tomorrow = new Date(); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    fixture = await db.transaction((tx) => seedInventoryReservationsFixture(tx, tomorrow.toISOString().slice(0, 10)));
    const room = fixture.rooms[0];
    if (room === undefined) throw new Error("Fixture room missing");
    await db.update(schema.bookings).set({ startsAt: new Date(Date.now() - 3_600_000), updatedAt: new Date() })
      .where(eq(schema.bookings.id, room.bookingId));
    const current = await assessment();
    const source = firstSource(current);
    expect(source.proposalImpact.some((item) => item.unavailableReason === "historical_unsupported")).toBe(true);
    const response = await post("reservations/approve", command(current, source));
    expect(response.statusCode, response.body.slice(0, 1200)).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVENTORY_HISTORY_UNSUPPORTED" });
    expect(await history(source)).toHaveLength(0);
  });

  it("rejects stale stock and phase evidence without creating a reservation", async () => {
    const current = await assessment();
    const source = firstSource(current);
    await stockCorrection(210);
    expect((await post("reservations/approve", command(current, source))).statusCode).toBe(409);
    const fresh = await assessment();
    const room = fixture.rooms[0];
    if (room?.phaseIds[0] === undefined) throw new Error("Fixture phase missing");
    await db.update(schema.eventPhases).set({ durationMinutes: 90, updatedAt: new Date() }).where(eq(schema.eventPhases.id, room.phaseIds[0]));
    expect((await post("reservations/approve", command(fresh, firstSource(fresh)))).statusCode).toBe(409);
    expect(await history(source)).toHaveLength(0);
  });

  it("detects a newly inserted unscoped phase as missing evidence", async () => {
    const current = await assessment();
    const source = firstSource(current);
    await db.insert(schema.eventPhases).values({ id: randomUUID(), eventId: source.eventId,
      templateKey: "arrival", name: "Unscoped arrival", sortOrder: 9, durationMinutes: 0 });
    const fresh = await assessment();
    expect(firstSource(fresh).state).toBe("incomplete");
    expect(firstSource(fresh).issues.length).toBeGreaterThan(0);
    expect((await post("reservations/approve", command(current, source))).statusCode).toBe(409);
  });

  it("preserves unknown stock and refuses a historical availability claim", async () => {
    await db.delete(schema.venueInventoryStock).where(and(eq(schema.venueInventoryStock.venueId, fixture.venueId),
      eq(schema.venueInventoryStock.assetDefinitionId, fixture.chairId)));
    const current = await assessment();
    const chair = current.items.find((item) => item.assetDefinitionId === fixture.chairId);
    expect(chair?.availability).toBeNull();
    expect(chair?.unavailableReason).toBe("stock_unrecorded");
    const query = new URLSearchParams({ from: "2025-09-06T08:00:00Z", to: "2025-09-06T19:00:00Z" });
    const response = await server.inject({ method: "GET", url: path(`assessment?${query.toString()}`), headers: headers() });
    expect(response.statusCode, response.body.slice(0, 1200)).toBe(200);
    const old = InventoryAssessmentResponseSchema.parse(response.json()).data;
    expect(old.items.every((item) => item.availability === null)).toBe(true);
  });

  it("supersedes and revokes by appending while retaining the exact old source facts", async () => {
    const approved = await approveBoth();
    const source = firstSource(approved);
    const original = source.approvedRelease;
    if (original === null) throw new Error("Approved release missing");
    const room = fixture.rooms[0];
    if (room === undefined) throw new Error("Fixture room missing");
    await db.update(schema.bookings).set({ endsAt: new Date("2031-09-06T18:00:00Z"), updatedAt: new Date() }).where(eq(schema.bookings.id, room.bookingId));
    const stale = await assessment();
    expect(firstSource(stale).state).toBe("stale");
    const replacementResponse = await post("reservations/approve", command(stale, firstSource(stale)));
    expect(replacementResponse.statusCode, replacementResponse.body.slice(0, 1200)).toBe(200);
    const replacement = InventoryReservationMutationResponseSchema.parse(replacementResponse.json()).data;
    expect(replacement.release.supersedesReleaseId).toBe(original.id);
    expect(replacement.release.revision).toBe(2);
    const records = await history(source);
    expect(records.find((record) => record.id === original.id)).toEqual(original);
    const revokeSource = firstSource(replacement.assessment);
    const { occupiedWindowConfirmed: _confirmed, ...revoke } = command(replacement.assessment, revokeSource);
    const revokedResponse = await post("reservations/revoke", revoke);
    expect(revokedResponse.statusCode, revokedResponse.body.slice(0, 1200)).toBe(200);
    const revoked = InventoryReservationMutationResponseSchema.parse(revokedResponse.json()).data;
    expect(revoked.release.action).toBe("revoked");
    expect(revoked.release.revision).toBe(3);
    expect(await history(source)).toHaveLength(3);
    expect(firstSource(await assessment()).state).toBe("revoked");
    expect((await assessment()).items.find((item) => item.assetDefinitionId === fixture.chairId)?.availability?.maximumShortageQuantity).toBe(0);
  });

  it("removes cancelled bookings from active demand without erasing release history", async () => {
    const approved = await approveBoth();
    const source = firstSource(approved);
    const room = fixture.rooms[0];
    if (room === undefined) throw new Error("Fixture room missing");
    await db.update(schema.bookings).set({ status: "cancelled", updatedAt: new Date() }).where(eq(schema.bookings.id, room.bookingId));
    const current = await assessment();
    expect(current.items.find((item) => item.assetDefinitionId === fixture.chairId)?.availability?.maximumShortageQuantity).toBe(0);
    expect(await history(source)).toHaveLength(1);
  });

  it("lets another own-venue admin approve an idempotent hire request without claiming new supply", async () => {
    const current = await approveBoth();
    const prepareInput = { commandId: randomUUID(), kind: "hire_request", assetDefinitionId: fixture.chairId,
      window: current.window, quantity: 10, expectedAssessmentDigest: current.assessmentDigest,
      reason: "Request ten chairs for the verified overlap" };
    const preparedResponse = await post("remedies/prepare", prepareInput);
    expect(preparedResponse.statusCode, preparedResponse.body.slice(0, 1200)).toBe(200);
    const prepared = InventoryRemedyPrepareResponseSchema.parse(preparedResponse.json()).data.remedy;
    expect(prepared.status).toBe("prepared");
    expect(prepared.effect).toBe("internal_request_only");
    const prepareReplay = await post("remedies/prepare", prepareInput);
    expect(InventoryRemedyPrepareResponseSchema.parse(prepareReplay.json()).data).toMatchObject({ replayed: true, remedy: { id: prepared.id } });
    const approval = { commandId: randomUUID(), expectedAssessmentDigest: current.assessmentDigest };
    const response = await post(`remedies/${prepared.id}/approve`, approval, fixture.secondAdminId);
    expect(response.statusCode, response.body.slice(0, 1200)).toBe(200);
    const approved = InventoryRemedyApproveResponseSchema.parse(response.json()).data.remedy;
    expect(approved.status).toBe("approved");
    expect(approved.preparedBy).toBe(fixture.adminId);
    expect(approved.approvedBy).toBe(fixture.secondAdminId);
    const replayResponse = await post(`remedies/${prepared.id}/approve`, approval, fixture.secondAdminId);
    expect(InventoryRemedyApproveResponseSchema.parse(replayResponse.json()).data.replayed).toBe(true);
    expect((await post(`remedies/${prepared.id}/approve`, approval)).statusCode).toBe(409);
    const remaining = await assessment();
    expect(remaining.items.find((item) => item.assetDefinitionId === fixture.chairId)?.availability?.minimumRemainingQuantity).toBe(-10);
    expect(remaining.remedies.filter((remedy) => remedy.status === "approved")).toHaveLength(1);
  });

  it("requires fresh remedy review after stock changes and keeps the prepared record", async () => {
    const current = await approveBoth();
    const preparedResponse = await post("remedies/prepare", { commandId: randomUUID(), kind: "stock_inspection",
      assetDefinitionId: fixture.chairId, window: current.window, quantity: 10,
      expectedAssessmentDigest: current.assessmentDigest, reason: "Inspect ten damaged chairs before any count correction" });
    expect(preparedResponse.statusCode, preparedResponse.body.slice(0, 1200)).toBe(200);
    const prepared = InventoryRemedyPrepareResponseSchema.parse(preparedResponse.json()).data.remedy;
    await stockCorrection(210);
    const stale = await post(`remedies/${prepared.id}/approve`, { commandId: randomUUID(), expectedAssessmentDigest: current.assessmentDigest });
    expect(stale.statusCode, stale.body.slice(0, 1200)).toBe(409);
    expect((await assessment()).remedies.find((remedy) => remedy.id === prepared.id)?.status).toBe("prepared");
  });

  it("rolls back the reservation if storing its idempotency receipt fails", async () => {
    const current = await assessment();
    const source = firstSource(current);
    await db.execute(sql`CREATE FUNCTION inventory_test_decision_failure_593() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'T593 injected receipt storage failure'; END $$`);
    await db.execute(sql`CREATE TRIGGER inventory_test_decision_failure_593 BEFORE INSERT ON inventory_decision_commands FOR EACH ROW EXECUTE FUNCTION inventory_test_decision_failure_593()`);
    try {
      const response = await post("reservations/approve", command(current, source));
      expect(response.statusCode, response.body.slice(0, 1200)).toBe(500);
      expect(await history(source)).toHaveLength(0);
      expect(firstSource(await assessment()).state).toBe("unapproved");
    } finally {
      await db.execute(sql`DROP TRIGGER inventory_test_decision_failure_593 ON inventory_decision_commands`);
      await db.execute(sql`DROP FUNCTION inventory_test_decision_failure_593()`);
    }
  });

  it("enforces immutable approved release and command history at the database boundary", async () => {
    const current = await assessment();
    const source = firstSource(current);
    const response = await post("reservations/approve", command(current, source));
    expect(response.statusCode, response.body.slice(0, 1200)).toBe(200);
    const original = InventoryReservationMutationResponseSchema.parse(response.json()).data.release;
    await expect(db.execute(sql`UPDATE inventory_reservation_releases SET recorded_at = now() WHERE id = ${original.id}::uuid`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM inventory_reservation_releases WHERE id = ${original.id}::uuid`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM inventory_decision_commands WHERE venue_id = ${fixture.venueId}::uuid`)).rejects.toThrow();
    expect(await history(source)).toEqual([original]);
  });
});
