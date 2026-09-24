import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { actionLogRoutes } from "../routes/action-log.js";
import { configurationRoutes } from "../routes/configurations.js";
import { enquiryRoutes } from "../routes/enquiries.js";
import { eventRoutes } from "../routes/events.js";
import { placedObjectRoutes } from "../routes/placed-objects.js";
import { publicConfigRoutes } from "../routes/public-configs.js";
import { analyticsRoutes } from "../routes/revenue-analytics.js";

// ---------------------------------------------------------------------------
// API hot paths on the migrated platform database: configuration reads that
// skip the stored thumbnail, the Diary tray's enquiry query, batched layout
// summaries, phase graphs without snapshot payloads, dashboard aggregates
// computed in SQL, and the foreign-key indexes of migration 0071.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("API hot-path tests require the explicit disposable platform database");
  }
}

/** Registered by migration 0067; present in every migrated database. */
const CHAIR = "7f1fb7a2-5210-57b1-9108-11255c059520";
const THUMBNAIL = `data:image/png;base64,${"A".repeat(200_000)}`;
const OUTLINE = [{ x: -10, y: -5 }, { x: 10, y: -5 }, { x: 10, y: 5 }, { x: -10, y: 5 }];

interface Actor { readonly id: string; readonly role: string; readonly venueId: string | null; readonly platformRole: "none" | "admin" }

function bearer(actor: Actor): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify({ ...actor, email: `${actor.id}@hot-paths.invalid` })}` };
}

describe.skipIf(target === undefined)("API hot paths through real routes and PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;
  const statements: string[] = [];

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `api_hot_paths_${randomUUID()}` });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema, logger: { logQuery: (query) => { statements.push(query); } } });
    server = Fastify();
    await server.register(configurationRoutes, { db, prefix: "/configurations" });
    await server.register(placedObjectRoutes, { db, prefix: "/configurations/:configId/objects" });
    await server.register(actionLogRoutes, { db, prefix: "/configurations/:configId/actions" });
    await server.register(publicConfigRoutes, { db, prefix: "/public" });
    await server.register(enquiryRoutes, { db, prefix: "/enquiries" });
    await server.register(eventRoutes, { db, prefix: "/events" });
    await server.register(analyticsRoutes, { db, prefix: "/analytics" });
    await server.ready();
  });
  beforeEach(() => { statements.length = 0; });
  afterAll(async () => { await server?.close(); await pool?.end(); });

  async function venue(label: string) {
    const venueId = randomUUID();
    await db.insert(schema.venues).values({ id: venueId, name: `TEST ONLY ${label}`, slug: `hot-paths-${venueId}`, address: "Disposable fixture" });
    const rooms = [randomUUID(), randomUUID()];
    await db.insert(schema.spaces).values(rooms.map((id, index) => ({
      id, venueId, name: `Room ${String(index)}`, slug: `room-${id}`, widthM: "20", lengthM: "10", heightM: "6",
      floorPlanOutline: OUTLINE, sortOrder: index,
    })));
    const actor = async (role: string, platformRole: "none" | "admin" = "none", venueScope: string | null = venueId): Promise<Actor> => {
      const id = randomUUID();
      await db.insert(schema.users).values({ id, email: `${id}@hot-paths.invalid`, name: "Fixture", role, platformRole, venueId: venueScope });
      return { id, role, venueId: venueScope, platformRole };
    };
    return { venueId, rooms, actor };
  }

  async function configuration(input: { venueId: string; spaceId: string; userId: string | null; isPublicPreview?: boolean; deleted?: boolean }) {
    const [row] = await db.insert(schema.configurations).values({
      venueId: input.venueId, spaceId: input.spaceId, userId: input.userId, name: `Layout ${randomUUID().slice(0, 8)}`,
      layoutStyle: "custom", thumbnailUrl: THUMBNAIL, isPublicPreview: input.isPublicPreview ?? false,
      visibility: input.isPublicPreview === true ? "public" : "private", metadata: { instructions: { specialInstructions: "Keep" } },
      deletedAt: input.deleted === true ? new Date() : null,
    }).returning();
    if (row === undefined) throw new Error("Configuration fixture missing");
    const objects = await db.insert(schema.placedObjects).values([0, 1, 2].map((index) => ({
      configurationId: row.id, assetDefinitionId: CHAIR, positionX: String(index * 2), positionY: "0", positionZ: "1",
      sortOrder: index, coordinateWriteToken: randomUUID(),
    }))).returning();
    return { ...row, objects };
  }

  function configurationSelects(): string[] {
    return statements.filter((sql) => /^select\b/i.test(sql) && sql.includes('from "configurations"'));
  }

  it("serves planner saves, reads, audit flushes and metadata edits without reading the stored thumbnail", async () => {
    const v = await venue("thumbnail reads");
    const planner = await v.actor("planner", "none", null);
    const owned = await configuration({ venueId: v.venueId, spaceId: v.rooms[0] ?? "", userId: planner.id });
    const preview = await configuration({ venueId: v.venueId, spaceId: v.rooms[0] ?? "", userId: null, isPublicPreview: true });
    const doomed = await configuration({ venueId: v.venueId, spaceId: v.rooms[0] ?? "", userId: planner.id });
    const batch = (objects: typeof owned.objects) => ({ expectedRevision: 1, objects: objects.map((object) => ({
      id: object.id, assetDefinitionId: CHAIR, positionX: Number(object.positionX) + 0.5, positionY: 0, positionZ: 1,
      rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1, sortOrder: object.sortOrder,
    })) });

    const reads = await server.inject({ method: "GET", url: `/configurations/${owned.id}/objects`, headers: bearer(planner) });
    expect(reads.statusCode, reads.body).toBe(200);
    expect(reads.json<{ data: unknown[] }>().data).toHaveLength(3);
    const saved = await server.inject({ method: "POST", url: `/configurations/${owned.id}/objects/batch`, headers: bearer(planner), payload: batch(owned.objects) });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json<{ data: { revision: number } }>().data.revision).toBe(2);
    const audit = await server.inject({ method: "POST", url: `/configurations/${owned.id}/actions`, headers: bearer(planner), payload: {
      batchId: randomUUID(), revision: 2, actions: [{ id: randomUUID(), actor: { kind: "operator" }, intent: "object.move",
        payload: { x: 1 }, inverse: { x: 0 }, provenance: { surface: "planner" }, ts: "2026-09-24T10:00:00.000Z" }],
    } });
    expect(audit.statusCode, audit.body).toBe(200);
    const guest = await server.inject({ method: "POST", url: `/public/configurations/${preview.id}/objects/batch`, payload: batch(preview.objects) });
    expect(guest.statusCode, guest.body).toBe(200);
    const edited = await server.inject({ method: "PATCH", url: `/configurations/${owned.id}`, headers: bearer(planner),
      payload: { metadata: { instructions: { accessNotes: "Side door" } } } });
    expect(edited.statusCode, edited.body).toBe(200);
    const removed = await server.inject({ method: "DELETE", url: `/configurations/${doomed.id}`, headers: bearer(planner) });
    expect(removed.statusCode, removed.body).toBe(204);

    expect(configurationSelects().length).toBeGreaterThanOrEqual(6);
    expect(configurationSelects().filter((sql) => sql.includes('"thumbnail_url"'))).toEqual([]);
    // Responses that return the whole layout still carry the thumbnail.
    const updated = edited.json<{ data: { thumbnailUrl: string; metadata: { instructions: { accessNotes: string } } } }>().data;
    expect(updated.thumbnailUrl).toBe(THUMBNAIL);
    expect(updated.metadata.instructions.accessNotes).toBe("Side door");
    const loaded = await server.inject({ method: "GET", url: `/configurations/${owned.id}`, headers: bearer(planner) });
    expect(loaded.json<{ data: { thumbnailUrl: string } }>().data.thumbnailUrl).toBe(THUMBNAIL);
  });

  describe("GET /enquiries for the Diary tray", () => {
    async function trayFixture() {
      const a = await venue("tray A");
      const b = await venue("tray B");
      const staff = await a.actor("staff");
      const admin = await a.actor("admin", "admin", null);
      const planner = await a.actor("planner", "none", null);
      const start = Date.parse("2026-09-01T09:00:00.000Z");
      const insert = (venueId: string, spaceId: string, state: string, minute: number, userId: string | null = null) =>
        db.insert(schema.enquiries).values({ venueId, spaceId, userId, state, name: `${state} ${String(minute)}`, email: "t@hot-paths.invalid",
          createdAt: new Date(start + minute * 60_000), updatedAt: new Date(start + (100 - minute) * 60_000) }).returning({ id: schema.enquiries.id });
      for (let minute = 0; minute < 25; minute += 1) await insert(a.venueId, a.rooms[0] ?? "", minute % 2 === 0 ? "submitted" : "under_review", minute);
      for (const [index, state] of ["draft", "approved", "withdrawn", "rejected", "archived", "draft", "approved", "withdrawn", "rejected", "archived"].entries()) {
        await insert(a.venueId, a.rooms[1] ?? "", state, 30 + index);
      }
      for (let minute = 0; minute < 5; minute += 1) await insert(b.venueId, b.rooms[0] ?? "", "submitted", 50 + minute);
      await insert(a.venueId, a.rooms[0] ?? "", "submitted", 60, planner.id);
      await insert(a.venueId, a.rooms[0] ?? "", "draft", 61, planner.id);
      return { a, b, staff, admin, planner };
    }
    const tray = (venueId: string) => `/enquiries?states=submitted,under_review&order=created_desc&limit=51&venueId=${venueId}`;
    type Page = { data: { state: string; name: string; venueId: string; createdAt: string }[]; meta: { total: number; limit: number } };

    it("returns exactly the open states, newest first, within the caller's own scope", async () => {
      const f = await trayFixture();
      const own = await server.inject({ method: "GET", url: tray(f.a.venueId), headers: bearer(f.staff) });
      expect(own.statusCode, own.body).toBe(200);
      const page = own.json<Page>();
      expect(page.meta).toMatchObject({ total: 26, limit: 51 });
      expect(page.data).toHaveLength(26);
      expect(page.data.every((row) => row.venueId === f.a.venueId && ["submitted", "under_review"].includes(row.state))).toBe(true);
      const created = page.data.map((row) => Date.parse(row.createdAt));
      expect(created).toEqual([...created].sort((left, right) => right - left));
      expect(page.data[0]?.name).toBe("submitted 60");

      // venueId narrows; it never widens a venue team's scope.
      const foreign = await server.inject({ method: "GET", url: tray(f.b.venueId), headers: bearer(f.staff) });
      expect(foreign.json<Page>()).toMatchObject({ data: [], meta: { total: 0 } });
      const platform = await server.inject({ method: "GET", url: tray(f.b.venueId), headers: bearer(f.admin) });
      expect(platform.json<Page>().data.map((row) => row.venueId)).toEqual(Array(5).fill(f.b.venueId));
      const mine = await server.inject({ method: "GET", url: tray(f.a.venueId), headers: bearer(f.planner) });
      expect(mine.json<Page>().data.map((row) => row.name)).toEqual(["submitted 60"]);
    });

    it("keeps the original default: every visible state, least recently updated first, 20 rows", async () => {
      const f = await trayFixture();
      const response = await server.inject({ method: "GET", url: "/enquiries", headers: bearer(f.staff) });
      const page = response.json<{ data: { state: string; updatedAt: string }[]; meta: { total: number; limit: number } }>();
      expect(page.meta).toMatchObject({ total: 37, limit: 20 });
      expect(page.data).toHaveLength(20);
      const updated = page.data.map((row) => Date.parse(row.updatedAt));
      expect(updated).toEqual([...updated].sort((left, right) => left - right));
      expect(new Set(page.data.map((row) => row.state)).size).toBeGreaterThan(2);
    });

    it("rejects invalid tray queries", async () => {
      const staff = await (await venue("tray validation")).actor("staff");
      for (const query of ["states=bogus", "states=", "states=submitted,", "status=draft&states=submitted", "order=sideways", "venueId=not-a-uuid"]) {
        const response = await server.inject({ method: "GET", url: `/enquiries?${query}`, headers: bearer(staff) });
        expect(response.statusCode, query).toBe(400);
      }
    });
  });

  it("summarises only the layouts the caller could open, in request order", async () => {
    const a = await venue("summaries A");
    const b = await venue("summaries B");
    const staff = await a.actor("staff");
    const planner = await a.actor("planner", "none", null);
    const first = await configuration({ venueId: a.venueId, spaceId: a.rooms[1] ?? "", userId: null });
    const second = await configuration({ venueId: a.venueId, spaceId: a.rooms[0] ?? "", userId: planner.id });
    const deleted = await configuration({ venueId: a.venueId, spaceId: a.rooms[0] ?? "", userId: null, deleted: true });
    const foreign = await configuration({ venueId: b.venueId, spaceId: b.rooms[0] ?? "", userId: null });
    const ownedElsewhere = await configuration({ venueId: b.venueId, spaceId: b.rooms[0] ?? "", userId: planner.id });
    const ids = [second.id, deleted.id, foreign.id, randomUUID(), first.id, ownedElsewhere.id, second.id];
    const summaries = (actor: Actor) => server.inject({ method: "GET", url: `/configurations/summaries?ids=${ids.join(",")}`, headers: bearer(actor) });

    const venueTeam = await summaries(staff);
    expect(venueTeam.statusCode, venueTeam.body).toBe(200);
    expect(venueTeam.json()).toEqual({ data: [
      { id: second.id, name: second.name, spaceId: second.spaceId, venueId: a.venueId },
      { id: first.id, name: first.name, spaceId: first.spaceId, venueId: a.venueId },
    ] });
    expect(JSON.stringify(venueTeam.json())).not.toContain("data:image");
    const owner = await summaries(planner);
    expect(owner.json<{ data: { id: string }[] }>().data.map((row) => row.id)).toEqual([second.id, ownedElsewhere.id]);

    for (const query of ["ids=", "ids=not-a-uuid", `ids=${Array.from({ length: 101 }, () => randomUUID()).join(",")}`]) {
      expect((await server.inject({ method: "GET", url: `/configurations/summaries?${query}`, headers: bearer(staff) })).statusCode).toBe(400);
    }
    expect((await server.inject({ method: "GET", url: `/configurations/summaries?ids=${first.id}` })).statusCode).toBe(401);
  });

  it("omits phase snapshot payloads on request without changing anything else or who may read the graph", async () => {
    const a = await venue("phase graph A");
    const b = await venue("phase graph B");
    const staff = await a.actor("staff");
    const outsider = await b.actor("staff");
    const layout = await configuration({ venueId: a.venueId, spaceId: a.rooms[0] ?? "", userId: null });
    const [event] = await db.insert(schema.events).values({ venueId: a.venueId, name: "Phase fixture" }).returning();
    if (event === undefined) throw new Error("Event fixture missing");
    const [phase] = await db.insert(schema.eventPhases).values({ eventId: event.id, spaceId: a.rooms[0] ?? null, name: "Dinner", sortOrder: 0 }).returning();
    if (phase === undefined) throw new Error("Phase fixture missing");
    const payload = { objects: Array.from({ length: 50 }, (_, index) => ({ id: randomUUID(), x: index })) };
    await db.insert(schema.phaseLayoutSnapshots).values([
      { eventPhaseId: phase.id, configurationId: layout.id, status: "stale", objectCount: 50, payload, createdAt: new Date("2026-09-01T10:00:00Z") },
      { eventPhaseId: phase.id, configurationId: layout.id, status: "frozen", objectCount: 50, payload, createdAt: new Date("2026-09-02T10:00:00Z"),
        frozenAt: new Date("2026-09-02T10:00:00Z") },
    ]);
    type Graph = { data: { phaseLayoutSnapshots: { payload: unknown }[] } };

    const full = await server.inject({ method: "GET", url: `/events/${event.id}/phase-graph`, headers: bearer(staff) });
    const summary = await server.inject({ method: "GET", url: `/events/${event.id}/phase-graph?snapshotPayloads=omit`, headers: bearer(staff) });
    expect(full.statusCode, full.body).toBe(200);
    expect(summary.statusCode, summary.body).toBe(200);
    expect(full.json<Graph>().data.phaseLayoutSnapshots.map((snapshot) => snapshot.payload)).toEqual([payload, payload]);
    expect(summary.json<Graph>().data.phaseLayoutSnapshots.map((snapshot) => snapshot.payload)).toEqual([null, null]);
    const withoutPayloads = (graph: Graph) => ({ ...graph.data,
      phaseLayoutSnapshots: graph.data.phaseLayoutSnapshots.map((snapshot) => ({ ...snapshot, payload: null })) });
    expect(withoutPayloads(summary.json<Graph>())).toEqual(withoutPayloads(full.json<Graph>()));
    expect(summary.body.length).toBeLessThan(full.body.length - 2 * JSON.stringify(payload).length + 100);

    expect((await server.inject({ method: "GET", url: `/events/${event.id}/phase-graph?snapshotPayloads=some`, headers: bearer(staff) })).statusCode).toBe(400);
    expect((await server.inject({ method: "GET", url: `/events/${event.id}/phase-graph?snapshotPayloads=omit`, headers: bearer(outsider) })).statusCode).toBe(403);
  });

  it("computes the venue dashboard's totals and room figures in SQL with unchanged results", async () => {
    const a = await venue("dashboard A");
    const b = await venue("dashboard B");
    const staff = await a.actor("staff");
    const [roomOne, roomTwo] = a.rooms;
    if (roomOne === undefined || roomTwo === undefined) throw new Error("Room fixtures missing");
    const quote = (spaceId: string | null, status: string, totalMinor: number, deleted = false) => ({
      venueId: a.venueId, name: `Quote ${status}`, spaceId, status, subtotalMinor: totalMinor, totalMinor, deletedAt: deleted ? new Date() : null,
    });
    await db.insert(schema.quotes).values([
      quote(roomOne, "issued", 100), quote(roomOne, "accepted", 250), quote(roomTwo, "accepted", 300),
      quote(null, "draft", 50), quote(roomOne, "accepted", 999, true),
    ]);
    const proposal = (status: string, deleted = false) => ({
      venueId: a.venueId, title: `Proposal ${status}`, status, sentAt: status === "draft" ? null : new Date(), deletedAt: deleted ? new Date() : null,
    });
    await db.insert(schema.proposals).values([proposal("sent"), proposal("accepted"), proposal("draft"), proposal("accepted"), proposal("accepted", true)]);
    await db.insert(schema.enquiries).values(Array.from({ length: 4 }, (_, index) => ({
      venueId: a.venueId, spaceId: roomOne, name: `Enquiry ${String(index)}`, email: "d@hot-paths.invalid",
    })));
    const layoutOne = await configuration({ venueId: a.venueId, spaceId: roomOne, userId: null });
    const layoutTwo = await configuration({ venueId: a.venueId, spaceId: roomTwo, userId: null, deleted: true });
    const foreignLayout = await configuration({ venueId: b.venueId, spaceId: b.rooms[0] ?? "", userId: null });
    await db.insert(schema.revenueScenarios).values([
      { venueId: a.venueId, configurationId: layoutOne.id, name: "One", reviewGateCount: 2 },
      { venueId: a.venueId, configurationId: layoutTwo.id, name: "Two", reviewGateCount: 1 },
      { venueId: a.venueId, configurationId: null, name: "Unplaced", reviewGateCount: 3 },
      { venueId: a.venueId, configurationId: foreignLayout.id, name: "Foreign layout", reviewGateCount: 5 },
    ]);

    const pipeline = await server.inject({ method: "GET", url: "/analytics/pipeline-summary", headers: bearer(staff) });
    expect(pipeline.statusCode, pipeline.body).toBe(200);
    expect(pipeline.json()).toEqual({ data: {
      currency: "GBP", pipelineValueMinor: 700, enquiryCount: 4, proposalCount: 4, acceptedProposalCount: 2,
      conversionPercent: 50, proposalStatusCounts: { accepted: 2, draft: 1, sent: 1 },
    } });
    const rooms = await server.inject({ method: "GET", url: "/analytics/room-utilisation", headers: bearer(staff) });
    const byName = (rows: { roomName: string }[]) => [...rows].sort((left, right) => left.roomName.localeCompare(right.roomName));
    expect(byName(rooms.json<{ data: { roomName: string }[] }>().data)).toEqual([
      { spaceId: roomOne, roomName: "Room 0", bookedEvents: 1, proposedEvents: 2, utilisationPercent: 50, reviewBottlenecks: 2 },
      { spaceId: roomTwo, roomName: "Room 1", bookedEvents: 1, proposedEvents: 1, utilisationPercent: 100, reviewBottlenecks: 1 },
    ]);
    const dashboard = await server.inject({ method: "GET", url: "/analytics/venue-dashboard", headers: bearer(staff) });
    expect(dashboard.json<{ data: Record<string, unknown> }>().data).toMatchObject({
      pipelineValueMinor: 700, enquiryConversionPercent: 50, proposalStatusCounts: { accepted: 2, draft: 1, sent: 1 },
    });
    // Aggregated in SQL: no statement reads the venue's rows one by one.
    expect(statements.filter((sql) => /select "id" from "enquiries"|select "status" from "proposals"|select "total_minor" from "quotes"/.test(sql))).toEqual([]);
  });

  it("indexes enquiries and proposals by configuration for their real lookups (migration 0071)", async () => {
    const indexes = await pool.query<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE indexname = ANY($1) ORDER BY indexname",
      [["enquiries_configuration_created_idx", "proposals_configuration_idx"]],
    );
    expect(indexes.rows.map((row) => row.indexdef)).toEqual([
      "CREATE INDEX enquiries_configuration_created_idx ON public.enquiries USING btree (configuration_id, created_at)",
      "CREATE INDEX proposals_configuration_idx ON public.proposals USING btree (configuration_id)",
    ]);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Planner choice depends on table size; this proves the lookups can use them.
      await client.query("SET LOCAL enable_seqscan = off");
      const timing = await client.query<{ "QUERY PLAN": string }>(
        "EXPLAIN SELECT preferred_date FROM enquiries WHERE configuration_id = $1 ORDER BY created_at DESC LIMIT 1", [randomUUID()]);
      expect(timing.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain("enquiries_configuration_created_idx");
      const unlink = await client.query<{ "QUERY PLAN": string }>(
        "EXPLAIN UPDATE proposals SET configuration_id = NULL WHERE configuration_id = $1", [randomUUID()]);
      expect(unlink.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain("proposals_configuration_idx");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
