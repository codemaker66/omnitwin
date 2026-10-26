import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { syncPlacedObjectBatch, type PlacedObjectBatchItem, type PlacedObjectRow } from "../lib/placed-object-batch.js";
import { configurationReviewRoutes } from "../routes/configuration-reviews.js";
import { configurationRoutes } from "../routes/configurations.js";
import { placedObjectRoutes } from "../routes/placed-objects.js";
import { publicConfigRoutes } from "../routes/public-configs.js";

// A real submit, without its emails.
const email = vi.hoisted(() => vi.fn());
vi.mock("../services/email.js", () => ({ sendEmailAsync: email }));

// Never load .env or fall back to DATABASE_URL: the migrated, disposable
// platform cluster only, so migration 0044's coordinate-write trigger is real.
const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("Placed-object batch tests require the explicit disposable platform database");
  }
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

// The per-object writes the set-based batch replaced, kept as the reference.
async function legacySync(tx: Transaction, configId: string, items: readonly PlacedObjectBatchItem[]): Promise<PlacedObjectRow[]> {
  const results: PlacedObjectRow[] = [];
  const toUpdate = items.filter((item) => item.id !== undefined);
  const toInsert = items.filter((item) => item.id === undefined);
  const batchIds = toUpdate.map((item) => item.id).filter((id): id is string => id !== undefined);
  if (batchIds.length > 0) {
    const existing = await tx.select({ id: schema.placedObjects.id }).from(schema.placedObjects)
      .where(eq(schema.placedObjects.configurationId, configId));
    const toDelete = existing.map((row) => row.id).filter((id) => !batchIds.includes(id));
    if (toDelete.length > 0) await tx.delete(schema.placedObjects).where(inArray(schema.placedObjects.id, toDelete));
  } else {
    await tx.delete(schema.placedObjects).where(eq(schema.placedObjects.configurationId, configId));
  }
  for (const item of toUpdate) {
    if (item.id === undefined) continue;
    const [updated] = await tx.update(schema.placedObjects).set({
      assetDefinitionId: item.assetDefinitionId,
      positionX: String(item.positionX), positionY: String(item.positionY), positionZ: String(item.positionZ),
      rotationX: String(item.rotationX), rotationY: String(item.rotationY), rotationZ: String(item.rotationZ),
      scale: String(item.scale), sortOrder: item.sortOrder, metadata: item.metadata ?? null,
      coordinateWriteToken: randomUUID(),
    }).where(and(eq(schema.placedObjects.id, item.id), eq(schema.placedObjects.configurationId, configId))).returning();
    if (updated !== undefined) results.push(updated);
  }
  if (toInsert.length > 0) {
    results.push(...await tx.insert(schema.placedObjects).values(toInsert.map((item) => ({
      configurationId: configId, assetDefinitionId: item.assetDefinitionId,
      positionX: String(item.positionX), positionY: String(item.positionY), positionZ: String(item.positionZ),
      rotationX: String(item.rotationX), rotationY: String(item.rotationY), rotationZ: String(item.rotationZ),
      scale: String(item.scale), sortOrder: item.sortOrder, metadata: item.metadata ?? null,
      coordinateWriteToken: randomUUID(),
    }))).returning());
  }
  return results;
}

/** Row content without identity: what two equivalent writes must agree on. */
function content(row: PlacedObjectRow) {
  const { id: _id, configurationId: _configurationId, coordinateWriteToken: _token, ...rest } = row;
  return rest;
}

describe.skipIf(target === undefined)("placed-object batch saves on migrated PostgreSQL", () => {
  const applicationName = `placed_object_batch_${randomUUID()}`;
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;
  const statements: string[] = [];
  const venueId = randomUUID();
  const spaceId = randomUUID();
  const ownerId = randomUUID();
  const chairId = randomUUID();
  const tableId = randomUUID();

  function authHeaders(): { authorization: string } {
    return { authorization: `Bearer ${JSON.stringify({ id: ownerId, email: `${ownerId}@batch.invalid`,
      role: "planner", platformRole: "none", venueId: null })}` };
  }

  async function configuration(options: { guest?: boolean; owner?: string } = {}): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.configurations).values({ id, spaceId, venueId, name: "TEST ONLY batch layout",
      layoutStyle: "dinner-banquet", userId: options.guest === true ? null : options.owner ?? ownerId,
      isPublicPreview: options.guest === true });
    return id;
  }

  function item(index: number, overrides: Partial<PlacedObjectBatchItem> = {}): PlacedObjectBatchItem {
    return { assetDefinitionId: index % 2 === 0 ? chairId : tableId,
      positionX: 1 + (index % 17), positionY: 0, positionZ: 1 + Math.floor(index / 17),
      rotationX: 0, rotationY: 0.25 * index, rotationZ: 0, scale: 1, sortOrder: index,
      metadata: { label: `Seat ${String(index)}` }, ...overrides };
  }

  async function save(configId: string, revision: number, objects: readonly PlacedObjectBatchItem[], guest = false) {
    const response = await server.inject({ method: "POST",
      url: guest ? `/public/configurations/${configId}/objects/batch` : `/configurations/${configId}/objects/batch`,
      headers: guest ? {} : authHeaders(), payload: { expectedRevision: revision, objects } });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<{ data: { objects: PlacedObjectRow[]; revision: number } }>();
    return body.data;
  }

  async function stored(configId: string): Promise<PlacedObjectRow[]> {
    return db.select().from(schema.placedObjects).where(eq(schema.placedObjects.configurationId, configId))
      .orderBy(asc(schema.placedObjects.sortOrder), asc(schema.placedObjects.id));
  }

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: applicationName, max: 4,
      options: "-c statement_timeout=10000 -c lock_timeout=8000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name)
      .toBe("venviewer_platform_test");
    db = drizzle(pool, { schema, logger: { logQuery: (query) => { statements.push(query); } } });
    await db.insert(schema.venues).values({ id: venueId, name: "TEST ONLY batch venue", slug: venueId, address: "Disposable fixture" });
    await db.insert(schema.spaces).values({ id: spaceId, venueId, name: "Room", slug: "room", widthM: "20", lengthM: "20", heightM: "4",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }] });
    await db.insert(schema.users).values({ id: ownerId, name: "Batch owner", email: `${ownerId}@batch.invalid`, role: "planner" });
    await db.insert(schema.assetDefinitions).values([
      { id: chairId, name: "TEST ONLY chair", category: "chair", widthM: "0.5", depthM: "0.5", heightM: "0.9" },
      { id: tableId, name: "TEST ONLY table", category: "table", widthM: "1.8", depthM: "1.8", heightM: "0.75" },
    ]);
    server = Fastify();
    await server.register(configurationRoutes, { db, prefix: "/configurations" });
    await server.register(configurationReviewRoutes, { db, prefix: "/configurations" });
    await server.register(placedObjectRoutes, { db, prefix: "/configurations/:configId/objects" });
    await server.register(publicConfigRoutes, { db, prefix: "/public" });
    await server.ready();
  }, 60000);

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  it("rewrites a layout in the same number of statements whatever its size", async () => {
    const counts: number[] = [];
    for (const size of [3, 150]) {
      const configId = await configuration();
      const first = await save(configId, 1, Array.from({ length: size }, (_, index) => item(index)));
      const moved = first.objects.map((row, index) => item(index, { id: row.id, positionX: 2.5 + (index % 15) }));
      statements.length = 0;
      const second = await save(configId, first.revision, moved);
      counts.push(statements.length);
      expect(second.objects.map((row) => row.id)).toEqual(first.objects.map((row) => row.id));
      expect((await stored(configId)).map((row) => row.positionX)).toEqual(moved.map((entry) => entry.positionX.toFixed(3)));
    }
    expect(counts[1]).toBe(counts[0]);
  });

  it("matches the per-object writes it replaced, row for row", async () => {
    const legacyConfig = await configuration();
    const batchConfig = await configuration();
    const foreignConfig = await configuration();
    const seed = Array.from({ length: 8 }, (_, index) => item(index));
    const [legacySeed, batchSeed, foreign] = await Promise.all([
      save(legacyConfig, 1, seed), save(batchConfig, 1, seed), save(foreignConfig, 1, [item(99)]),
    ]);
    const foreignRow = foreign.objects[0];
    if (foreignRow === undefined) throw new Error("Missing foreign fixture row");

    // Rounding at numeric(8,3)/(8,5)/(5,3), null metadata, an omitted row,
    // a repeated id (last entry wins), an id from another layout and inserts.
    const plan = (ids: readonly string[]): PlacedObjectBatchItem[] => [
      item(0, { id: ids[0], positionX: 3.14159, rotationY: 1.0000049, scale: 1.2345, metadata: null }),
      item(1, { id: ids[1], positionZ: 7.0005, sortOrder: 40 }),
      item(2, { id: ids[2], positionX: 4 }),
      item(2, { id: ids[2], positionX: 5.5, metadata: { label: "moved twice" } }),
      item(3, { id: foreignRow.id, positionX: 9 }),
      ...ids.slice(3, 7).map((id, offset) => item(offset + 4, { id })),
      item(20, { positionX: 12.25, metadata: null }),
      item(21, { positionZ: 1e-7 }),
    ];
    const legacyIds = legacySeed.objects.map((row) => row.id);
    const batchIds = batchSeed.objects.map((row) => row.id);
    const legacyResult = await db.transaction((tx) => legacySync(tx, legacyConfig, plan(legacyIds)));
    const batchResult = await db.transaction((tx) => syncPlacedObjectBatch(tx, batchConfig, plan(batchIds)));

    // Repeated ids: the old loop returned the intermediate write first; the
    // final stored state and every other returned row are identical.
    const withoutFirstRepeat = (rows: PlacedObjectRow[], repeatedId: string | undefined) =>
      rows.filter((row, index) => !(row.id === repeatedId && rows.findIndex((other) => other.id === repeatedId) === index));
    expect(withoutFirstRepeat(batchResult, batchIds[2]).map(content))
      .toEqual(withoutFirstRepeat(legacyResult, legacyIds[2]).map(content));
    expect(batchResult.map((row) => row.id)).toEqual([...batchIds.slice(0, 3), batchIds[2], ...batchIds.slice(3, 7),
      ...batchResult.slice(-2).map((row) => row.id)]);
    expect((await stored(batchConfig)).map(content)).toEqual((await stored(legacyConfig)).map(content));
    expect(await stored(batchConfig)).toHaveLength(9);
    expect((await stored(batchConfig)).find((row) => row.id === batchIds[0])).toMatchObject({
      positionX: "3.142", rotationY: "1.00000", scale: "1.235", metadata: null,
    });
    expect(await stored(foreignConfig)).toEqual([expect.objectContaining({ id: foreignRow.id, positionX: foreignRow.positionX })]);
  });

  it("gives every moved row a fresh write token under the real coordinate trigger", async () => {
    const configId = await configuration();
    const first = await save(configId, 1, [item(0), item(1)]);
    const before = new Map((await stored(configId)).map((row) => [row.id, row.coordinateWriteToken]));
    await save(configId, first.revision, first.objects.map((row, index) => item(index, { id: row.id, positionX: 8 + index })));
    for (const row of await stored(configId)) {
      expect(row.coordinateWriteToken).not.toBe(before.get(row.id));
    }
    // The guard itself is intact: a coordinate write without a new token fails.
    await expect(pool.query("UPDATE placed_objects SET position_x = position_x + 1 WHERE configuration_id = $1", [configId]))
      .rejects.toMatchObject({ code: "23514" });
  });

  describe("a save that meets a newer revision says who made it and when, to those who may know", () => {
    // Elaine (venue staff) makes the newer revisions. The venue's manager may
    // join the layout's live room and is told her name; a client who owns a
    // layout may not join it and is told only the time, or their own name.
    const colleagueId = randomUUID();
    const colleagueEmail = `${colleagueId}@batch.invalid`;
    const managerId = randomUUID();
    const clientId = randomUUID();
    interface Headers { readonly authorization: string }

    function headersFor(id: string, role: string, userVenueId: string | null): Headers {
      return { authorization: `Bearer ${JSON.stringify({ id, email: `${id}@batch.invalid`,
        role, platformRole: "none", venueId: userVenueId })}` };
    }
    const colleague = (): Headers => headersFor(colleagueId, "staff", venueId);
    const manager = (): Headers => headersFor(managerId, "manager", venueId);
    const client = (): Headers => headersFor(clientId, "client", null);

    async function post(configId: string, expectedRevision: number, headers: Headers | null,
      objects: readonly PlacedObjectBatchItem[] = [item(0)]) {
      return server.inject({ method: "POST",
        url: headers === null ? `/public/configurations/${configId}/objects/batch` : `/configurations/${configId}/objects/batch`,
        headers: headers === null ? {} : { authorization: headers.authorization }, payload: { expectedRevision, objects } });
    }

    async function saved(configId: string, expectedRevision: number, headers: Headers,
      objects: readonly PlacedObjectBatchItem[] = [item(0)]): Promise<number> {
      const response = await post(configId, expectedRevision, headers, objects);
      expect(response.statusCode, response.body).toBe(200);
      return response.json<{ data: { revision: number } }>().data.revision;
    }

    async function conflict(configId: string, expectedRevision: number, headers: Headers | null) {
      const response = await post(configId, expectedRevision, headers);
      expect(response.statusCode, response.body).toBe(409);
      return { body: response.json<{ code: string; details: Record<string, unknown> }>(), raw: response.body };
    }

    async function revisionRow(configId: string, revision: number) {
      const [row] = await db.select().from(schema.configurationLayoutRevisions)
        .where(and(eq(schema.configurationLayoutRevisions.configurationId, configId),
          eq(schema.configurationLayoutRevisions.revision, revision)));
      if (row === undefined) throw new Error("Missing revision row");
      return row;
    }

    beforeAll(async () => {
      await db.insert(schema.users).values([
        { id: colleagueId, name: "Elaine Account-Name", displayName: "  Elaine  ", email: colleagueEmail, role: "staff", venueId },
        { id: managerId, name: "Morag Manager", email: `${managerId}@batch.invalid`, role: "manager", venueId },
        { id: clientId, name: "Fiona Client", email: `${clientId}@batch.invalid`, role: "client" },
      ]);
    });

    it("names the colleague to the venue's floor team by display name, never by email, with the revision's own time", async () => {
      const configId = await configuration();
      const mine = await saved(configId, 1, manager());
      await saved(configId, mine, colleague(), [item(0), item(1)]);

      const { body, raw } = await conflict(configId, mine, manager());
      const row = await revisionRow(configId, mine + 1);
      expect(body.code).toBe("REVISION_CONFLICT");
      expect(body.details).toEqual({
        expectedRevision: mine,
        currentRevision: mine + 1,
        changedBy: { userId: colleagueId, name: "Elaine" },
        changedAt: row.createdAt.toISOString(),
      });
      expect(raw).not.toContain(colleagueEmail);
      expect(raw).not.toContain("Account-Name");
    });

    it("falls back to the account name when the display name is blank", async () => {
      const configId = await configuration();
      await db.update(schema.users).set({ displayName: "   " }).where(eq(schema.users.id, colleagueId));
      try {
        const mine = await saved(configId, 1, manager());
        await saved(configId, mine, colleague(), []);
        const { body } = await conflict(configId, mine, manager());
        expect(body.details["changedBy"]).toEqual({ userId: colleagueId, name: "Elaine Account-Name" });
      } finally {
        await db.update(schema.users).set({ displayName: "  Elaine  " }).where(eq(schema.users.id, colleagueId));
      }
    });

    it("tells a client who owns the layout when the venue's staff changed it, never who", async () => {
      const configId = await configuration({ owner: clientId });
      const mine = await saved(configId, 1, client());
      await saved(configId, mine, colleague(), [item(0), item(1)]);

      const { body, raw } = await conflict(configId, mine, client());
      const row = await revisionRow(configId, mine + 1);
      expect(row.actorUserId).toBe(colleagueId);
      expect(body.details).toEqual({
        expectedRevision: mine,
        currentRevision: mine + 1,
        changedBy: null,
        changedAt: row.createdAt.toISOString(),
      });
      expect(raw).not.toContain(colleagueId);
      expect(raw).not.toContain("Elaine");
      expect(raw).not.toContain(colleagueEmail);
    });

    it("names the client's own newer revision as theirs, so another tab can say so", async () => {
      const configId = await configuration({ owner: clientId });
      const first = await saved(configId, 1, client());
      await saved(configId, first, client(), [item(0), item(1)]);

      const { body } = await conflict(configId, first, client());
      expect(body.details["changedBy"]).toEqual({ userId: clientId, name: "Fiona Client" });
      expect(body.details["changedAt"]).toBe((await revisionRow(configId, first + 1)).createdAt.toISOString());
    });

    it("says nothing it does not know: a revision with no row has no author or time", async () => {
      // A new layout sits at revision 1 with no revision row; a client
      // claiming a later base meets the 409 with both facts unknown.
      const configId = await configuration();
      const { body } = await conflict(configId, 4, authHeaders());
      expect(body.details).toEqual({ expectedRevision: 4, currentRevision: 1, changedBy: null, changedAt: null });
    });

    it("tells an anonymous guest when, never who, even when a named colleague made it", async () => {
      const configId = await configuration({ guest: true });
      const first = await save(configId, 1, [item(0)], true);
      await saved(configId, first.revision, colleague(), [item(0), item(1)]);
      expect((await revisionRow(configId, first.revision + 1)).actorUserId).toBe(colleagueId);
      const { body, raw } = await conflict(configId, first.revision, null);
      expect(raw).not.toContain(colleagueId);
      expect(raw).not.toContain("Elaine");
      const row = await revisionRow(configId, first.revision + 1);
      expect(body.details).toEqual({
        expectedRevision: first.revision,
        currentRevision: first.revision + 1,
        changedBy: null,
        changedAt: row.createdAt.toISOString(),
      });
    });

    describe("when the newer revision commits between the route's revision check and its write", () => {
      // Elaine's write is made first and left uncommitted, so the save's
      // pre-check still reads the old revision and passes; its guarded UPDATE
      // then waits behind her transaction and, re-evaluated once she commits,
      // matches no row: the in-transaction conflict branch, under the same
      // disclosure rule. (Her write goes first because the configurations
      // triggers take a lock before the row's: the other order deadlocks.)
      async function raceElaine(caller: Headers, owner?: string) {
        const configId = await configuration(owner === undefined ? {} : { owner });
        const mine = await saved(configId, 1, caller);
        const elaine = await pool.connect();
        try {
          await elaine.query("BEGIN");
          await elaine.query("UPDATE configurations SET revision = revision + 1, updated_at = now() WHERE id = $1", [configId]);
          await elaine.query(
            "INSERT INTO configuration_layout_revisions (configuration_id, revision, source, actor_user_id, payload) VALUES ($1, $2, 'authenticated_batch', $3, '{}'::jsonb)",
            [configId, mine + 1, colleagueId]);
          const pending = post(configId, mine, caller);
          // Only a save that has passed the pre-check waits behind her.
          const deadline = Date.now() + 8_000;
          for (;;) {
            const waiting = await pool.query<{ waiting: number }>(
              "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
              [applicationName]);
            if ((waiting.rows[0]?.waiting ?? 0) > 0) break;
            if (Date.now() > deadline) throw new Error("The save never reached its guarded write");
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          await elaine.query("COMMIT");
          const response = await pending;
          expect(response.statusCode, response.body).toBe(409);
          return { body: response.json<{ details: Record<string, unknown> }>(), raw: response.body, mine, configId };
        } catch (err) {
          await elaine.query("ROLLBACK").catch(() => undefined);
          throw err;
        } finally {
          elaine.release();
        }
      }

      it("names Elaine to the venue's manager", async () => {
        const { body, mine, configId } = await raceElaine(manager());
        expect(body.details).toEqual({
          expectedRevision: mine,
          currentRevision: mine + 1,
          changedBy: { userId: colleagueId, name: "Elaine" },
          changedAt: (await revisionRow(configId, mine + 1)).createdAt.toISOString(),
        });
        // Nothing of the refused save was written.
        expect(await stored(configId)).toHaveLength(1);
      });

      it("withholds her from the client who owns the layout, and keeps the time", async () => {
        const { body, raw, mine, configId } = await raceElaine(client(), clientId);
        expect(body.details).toEqual({
          expectedRevision: mine,
          currentRevision: mine + 1,
          changedBy: null,
          changedAt: (await revisionRow(configId, mine + 1)).createdAt.toISOString(),
        });
        expect(raw).not.toContain(colleagueId);
        expect(raw).not.toContain("Elaine");
      });
    });
  });

  it("saves guest preview batches through the same full-sync path", async () => {
    const configId = await configuration({ guest: true });
    const first = await save(configId, 1, [item(0), item(1), item(2)], true);
    const [keep, drop, move] = first.objects;
    if (keep === undefined || drop === undefined || move === undefined) throw new Error("Missing guest rows");
    const second = await save(configId, first.revision, [
      item(0, { id: keep.id }), item(2, { id: move.id, positionZ: 6.5 }), item(3),
    ], true);
    expect(second.revision).toBe(first.revision + 1);
    expect(second.objects.slice(0, 2).map((row) => row.id)).toEqual([keep.id, move.id]);
    const rows = await stored(configId);
    expect(rows.map((row) => row.id)).not.toContain(drop.id);
    expect(rows.find((row) => row.id === move.id)?.positionZ).toBe("6.500");
    expect(rows).toHaveLength(3);
    const revisions = await db.select().from(schema.configurationLayoutRevisions)
      .where(eq(schema.configurationLayoutRevisions.configurationId, configId));
    expect(revisions.map((revision) => revision.revision).sort()).toEqual([2, 3]);
  });

  /** How many of this suite's connections wait for a lock. */
  async function lockWaiters(): Promise<number> {
    const waiting = await pool.query<{ waiting: string }>(
      "SELECT count(*) AS waiting FROM pg_stat_activity WHERE datname = current_database() AND application_name = $1 AND wait_event_type = 'Lock'",
      [applicationName],
    );
    return Number(waiting.rows[0]?.waiting ?? 0);
  }

  async function waitForLockWaiters(count: number, why: string): Promise<void> {
    for (let tries = 0; (await lockWaiters()) < count; tries += 1) {
      if (tries > 200) throw new Error(why);
      await new Promise((resolve) => { setTimeout(resolve, 10); });
    }
  }

  /** Begins a review of the plan as one UPDATE of its status, uncommitted,
   *  sends a write (which passes its check, the review not yet seen, then
   *  waits behind it, unless it writes straight past), and commits the
   *  review: it began between the write's check and its write. The UPDATE
   *  takes migration 0058's global lock before the row, as a write does; the
   *  real submit locks the row first (the next tests). */
  async function racedWithSubmit(configId: string, write: () => Promise<LightMyRequestResponse>): Promise<LightMyRequestResponse> {
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("UPDATE configurations SET review_status = 'submitted' WHERE id = $1", [configId]);
      const writing = write();
      let settled = false;
      const markSettled = (): void => { settled = true; };
      void writing.then(markSettled, markSettled);
      for (let tries = 0; !settled; tries += 1) {
        if (await lockWaiters() > 0) break;
        if (tries > 200) throw new Error("the write never waited for the review");
        await new Promise((resolve) => { setTimeout(resolve, 10); });
      }
      await holder.query("COMMIT");
      return await writing;
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
    }
  }

  it("says a review begun during a guest write holds the plan, not that a newer version came", async () => {
    const configId = await configuration({ guest: true });
    const first = await save(configId, 1, [item(0)], true);
    const batch = await racedWithSubmit(configId, () => server.inject({ method: "POST",
      url: `/public/configurations/${configId}/objects/batch`, payload: { expectedRevision: first.revision, objects: [] } }));
    expect(batch.statusCode, batch.body).toBe(409);
    expect(batch.json()).toMatchObject({ code: "CONFIG_LOCKED", reviewStatus: "submitted" });
    expect(await stored(configId)).toHaveLength(1);
    await db.update(schema.configurations).set({ reviewStatus: "draft" }).where(eq(schema.configurations.id, configId));
    const thumbnail = await racedWithSubmit(configId, () => server.inject({ method: "POST",
      url: `/public/configurations/${configId}/thumbnail`, payload: { thumbnailUrl: "data:image/png;base64,iVBORw0KGgo=" } }));
    expect(thumbnail.statusCode, thumbnail.body).toBe(409);
    expect(thumbnail.json()).toMatchObject({ code: "CONFIG_LOCKED", reviewStatus: "submitted" });
  });

  it("holds a signed-in planner's layout for a review begun during any of its writes", async () => {
    const configId = await configuration();
    const first = await save(configId, 1, [item(0)]);
    const [only] = await stored(configId);
    if (only === undefined) throw new Error("the first save stored its object");
    const headers = authHeaders();
    const writes: Record<string, () => Promise<LightMyRequestResponse>> = {
      batch: () => server.inject({ method: "POST", url: `/configurations/${configId}/objects/batch`, headers,
        payload: { expectedRevision: first.revision, objects: [{ ...item(0, { positionX: 5 }), id: only.id }] } }),
      add: () => server.inject({ method: "POST", url: `/configurations/${configId}/objects`, headers,
        payload: { assetDefinitionId: chairId, positionX: 2, positionY: 0, positionZ: 2 } }),
      move: () => server.inject({ method: "PATCH", url: `/configurations/${configId}/objects/${only.id}`, headers,
        payload: { positionX: 3 } }),
      remove: () => server.inject({ method: "DELETE", url: `/configurations/${configId}/objects/${only.id}`, headers }),
      rename: () => server.inject({ method: "PATCH", url: `/configurations/${configId}`, headers,
        payload: { name: "TEST ONLY renamed in review" } }),
    };
    const answers: Record<string, string> = {};
    for (const [name, write] of Object.entries(writes)) {
      await db.update(schema.configurations).set({ reviewStatus: "draft" }).where(eq(schema.configurations.id, configId));
      const raced = await racedWithSubmit(configId, write);
      const refusal = raced.statusCode === 409 ? raced.json<{ code: string; reviewStatus: string }>() : null;
      answers[name] = refusal === null ? String(raced.statusCode) : `409 ${refusal.code} ${refusal.reviewStatus}`;
    }
    const held = "409 CONFIG_LOCKED submitted";
    expect(answers).toEqual({ batch: held, add: held, move: held, remove: held, rename: held });
    expect(await stored(configId)).toEqual([only]);
    const [kept] = await db.select({ name: schema.configurations.name, revision: schema.configurations.revision })
      .from(schema.configurations).where(eq(schema.configurations.id, configId));
    expect(kept).toEqual({ name: "TEST ONLY batch layout", revision: first.revision });
  });

  it("makes a review wait for a single-object write that already holds the layout", async () => {
    const configId = await configuration();
    const blocker = await pool.connect();
    let added: LightMyRequestResponse;
    let submitted: LightMyRequestResponse;
    try {
      await blocker.query("BEGIN");
      // Holds the write's insert back once the write has taken the layout.
      await blocker.query("LOCK TABLE placed_objects IN SHARE MODE");
      const adding = server.inject({ method: "POST", url: `/configurations/${configId}/objects`, headers: authHeaders(),
        payload: { assetDefinitionId: chairId, positionX: 2, positionY: 0, positionZ: 2 } });
      await waitForLockWaiters(1, "the write never reached its insert");
      const submitting = server.inject({ method: "POST", url: `/configurations/${configId}/review/submit`,
        headers: authHeaders(), payload: {} });
      await waitForLockWaiters(2, "the review did not wait for the write holding the layout");
      await blocker.query("COMMIT");
      [added, submitted] = await Promise.all([adding, submitting]);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }
    expect(added.statusCode, added.body).toBe(201);
    expect(submitted.statusCode, submitted.body).toBe(200);
    // The review froze the layout as the write left it.
    const [snapshot] = await db.select({ payload: schema.configurationSheetSnapshots.payload })
      .from(schema.configurationSheetSnapshots).where(eq(schema.configurationSheetSnapshots.configurationId, configId));
    expect((snapshot?.payload as { floorPlan?: { objects?: unknown[] } } | undefined)?.floorPlan?.objects).toHaveLength(1);
  });

  it.each(["batch", "rename"] as const)("asks a %s that deadlocks with the real submit to try again, never writing behind it", async (write) => {
    // The submit locks the layout's row, then takes migration 0058's global
    // lock for its snapshot; a write takes the lock first, then waits for the
    // row. Staged so both wait at once: the holder keeps the row while the
    // submit queues for it and the write takes the lock and queues behind.
    const configId = await configuration();
    const first = await save(configId, 1, [item(0)]);
    const before = await stored(configId);
    const [only] = before;
    if (only === undefined) throw new Error("the first save stored its object");
    const holder = await pool.connect();
    let submitted: LightMyRequestResponse;
    let written: LightMyRequestResponse;
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM configurations WHERE id = $1 FOR UPDATE", [configId]);
      const submitting = server.inject({ method: "POST", url: `/configurations/${configId}/review/submit`,
        headers: authHeaders(), payload: {} });
      await waitForLockWaiters(1, "the submit never waited for the row");
      const writing = write === "batch"
        ? server.inject({ method: "POST", url: `/configurations/${configId}/objects/batch`, headers: authHeaders(),
          payload: { expectedRevision: first.revision, objects: [{ ...item(0, { positionX: 5 }), id: only.id }] } })
        : server.inject({ method: "PATCH", url: `/configurations/${configId}`, headers: authHeaders(),
          payload: { name: "TEST ONLY renamed in review" } });
      await waitForLockWaiters(2, "the write never waited behind the submit");
      await holder.query("COMMIT");
      [submitted, written] = await Promise.all([submitting, writing]);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
    }
    expect([submitted.statusCode, written.statusCode], `${submitted.body} ${written.body}`).not.toContain(500);
    const [row] = await db.select({ reviewStatus: schema.configurations.reviewStatus, name: schema.configurations.name,
      revision: schema.configurations.revision }).from(schema.configurations).where(eq(schema.configurations.id, configId));
    if (submitted.statusCode === 200) {
      // The write lost: asked to try again (or, once the lock is shared,
      // told the review holds the layout), and the layout is as submitted.
      expect(written.statusCode, written.body).toBe(409);
      expect(["RETRY", "CONFIG_LOCKED"]).toContain(written.json<{ code: string }>().code);
      expect(row).toEqual({ reviewStatus: "submitted", name: "TEST ONLY batch layout", revision: first.revision });
      expect(await stored(configId)).toEqual(before);
    } else {
      // The submit lost: it is asked to try again, and the draft took the write.
      expect(submitted.statusCode, submitted.body).toBe(409);
      expect(submitted.json<{ code: string }>().code).toBe("RETRY");
      expect(row?.reviewStatus).toBe("draft");
    }
  });

  it("still lets the layout's venue admin write through a review", async () => {
    const configId = await configuration();
    const first = await save(configId, 1, [item(0)]);
    await db.update(schema.configurations).set({ reviewStatus: "submitted" }).where(eq(schema.configurations.id, configId));
    const admin = randomUUID();
    await db.insert(schema.users).values({ id: admin, venueId, name: "Batch venue admin", email: `${admin}@batch.invalid`, role: "admin" });
    const headers = { authorization: `Bearer ${JSON.stringify({ id: admin, email: `${admin}@batch.invalid`,
      role: "admin", platformRole: "none", venueId })}` };
    const fixed = await server.inject({ method: "POST", url: `/configurations/${configId}/objects/batch`, headers,
      payload: { expectedRevision: first.revision, objects: [] } });
    expect(fixed.statusCode, fixed.body).toBe(200);
    const added = await server.inject({ method: "POST", url: `/configurations/${configId}/objects`, headers,
      payload: { assetDefinitionId: chairId, positionX: 2, positionY: 0, positionZ: 2 } });
    expect(added.statusCode, added.body).toBe(201);
    const renamed = await server.inject({ method: "PATCH", url: `/configurations/${configId}`, headers,
      payload: { name: "TEST ONLY fixed by the venue" } });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(await stored(configId)).toHaveLength(1);
  });

  it("holds a guest plan in review still, as it holds a signed-in planner's", async () => {
    // The venue may take a guest plan into review; until it is sent back,
    // its snapshot is the plan, and the public link may not move it.
    const configId = await configuration({ guest: true });
    const first = await save(configId, 1, [item(0)], true);
    await db.update(schema.configurations).set({ reviewStatus: "submitted" }).where(eq(schema.configurations.id, configId));
    const held = await server.inject({ method: "POST", url: `/public/configurations/${configId}/objects/batch`,
      payload: { expectedRevision: first.revision, objects: [] } });
    expect(held.statusCode).toBe(409);
    expect(held.json()).toMatchObject({ code: "CONFIG_LOCKED", reviewStatus: "submitted" });
    const thumbnail = await server.inject({ method: "POST", url: `/public/configurations/${configId}/thumbnail`,
      payload: { thumbnailUrl: "data:image/png;base64,iVBORw0KGgo=" } });
    expect(thumbnail.statusCode).toBe(409);
    expect(await stored(configId)).toHaveLength(1);
    const [kept] = await db.select({ revision: schema.configurations.revision, thumbnailUrl: schema.configurations.thumbnailUrl })
      .from(schema.configurations).where(eq(schema.configurations.id, configId));
    expect(kept).toEqual({ revision: first.revision, thumbnailUrl: null });
    // Sent back for changes, it is the guest's to change again.
    await db.update(schema.configurations).set({ reviewStatus: "changes_requested" }).where(eq(schema.configurations.id, configId));
    expect((await save(configId, first.revision, [], true)).objects).toEqual([]);
  });
});
