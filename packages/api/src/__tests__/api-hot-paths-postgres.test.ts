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
import { calendarRoutes } from "../routes/calendar.js";
import { formatVenueDay, runHoldReminderPass } from "../services/hold-reminders.js";

// ---------------------------------------------------------------------------
// API hot paths on the migrated platform database: configuration reads that
// skip the stored thumbnail, the Diary tray's enquiry query, the staff
// dashboard's newest-first enquiry pages and their indexes (migration 0072),
// batched layout summaries, phase graphs without snapshot payloads, dashboard
// aggregates computed in SQL, the foreign-key indexes of migration 0071, and
// the Diary's calendar read (owners by name, the venue-wide decisions list)
// and hold-reminder pass (T-619).
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
  const statementParams: unknown[][] = [];

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `api_hot_paths_${randomUUID()}` });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name).toBe("venviewer_platform_test");
    db = drizzle(pool, { schema, logger: { logQuery: (query, params) => { statements.push(query); statementParams.push(params); } } });
    server = Fastify();
    await server.register(configurationRoutes, { db, prefix: "/configurations" });
    await server.register(placedObjectRoutes, { db, prefix: "/configurations/:configId/objects" });
    await server.register(actionLogRoutes, { db, prefix: "/configurations/:configId/actions" });
    await server.register(publicConfigRoutes, { db, prefix: "/public" });
    await server.register(enquiryRoutes, { db, prefix: "/enquiries" });
    await server.register(eventRoutes, { db, prefix: "/events" });
    await server.register(analyticsRoutes, { db, prefix: "/analytics" });
    await server.register(calendarRoutes, { db, prefix: "/calendar" });
    await server.ready();
  });
  beforeEach(() => { statements.length = 0; statementParams.length = 0; });
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

  describe("GET /enquiries for the staff dashboard list", () => {
    type ListPage = { data: { id: string; venueId: string }[]; meta: { total: number; limit: number; offset: number; order: string } };

    async function dashboardFixture() {
      const a = await venue("dashboard A");
      const b = await venue("dashboard B");
      const staff = await a.actor("staff");
      const start = Date.parse("2026-08-01T09:00:00.000Z");
      // 45 enquiries a minute apart, except five created in one instant, which
      // straddle the first page boundary and can only be ordered by id.
      await db.insert(schema.enquiries).values(Array.from({ length: 45 }, (_, index) => ({
        venueId: a.venueId, spaceId: a.rooms[index % 2] ?? "", state: index % 3 === 0 ? "submitted" : "approved",
        name: `Dashboard ${String(index)}`, email: "d@hot-paths.invalid",
        createdAt: new Date(start + (index >= 22 && index <= 26 ? 24 : index) * 60_000),
        updatedAt: new Date(start + (45 - index) * 60_000),
      })));
      // now() records microseconds, which a JavaScript Date cannot tell apart.
      await pool.query(
        `INSERT INTO enquiries (venue_id, space_id, state, name, email, created_at)
         SELECT $1, $2, 'submitted', 'Microsecond ' || n, 'd@hot-paths.invalid',
                timestamptz '2026-08-01 09:10:30.123+00' + n * interval '1 microsecond'
         FROM generate_series(1, 3) AS n`, [a.venueId, a.rooms[0]]);
      // Another venue's newer enquiries are neither listed nor counted.
      await db.insert(schema.enquiries).values(Array.from({ length: 5 }, (_, index) => ({
        venueId: b.venueId, spaceId: b.rooms[0] ?? "", state: "submitted", name: `Foreign ${String(index)}`,
        email: "f@hot-paths.invalid", createdAt: new Date(start + (100 + index) * 60_000),
      })));
      return { a, staff };
    }

    async function pages(staff: Actor, query: string, limit: number, count: number): Promise<ListPage[]> {
      const served: ListPage[] = [];
      for (let offset = 0; offset < count * limit; offset += limit) {
        const response = await server.inject({ method: "GET", url: `/enquiries?${query}&limit=${String(limit)}&offset=${String(offset)}`, headers: bearer(staff) });
        expect(response.statusCode, response.body).toBe(200);
        served.push(response.json<ListPage>());
      }
      return served;
    }

    async function newestFirst(venueId: string, state?: string): Promise<string[]> {
      const rows = await pool.query<{ id: string }>(
        `SELECT id FROM enquiries WHERE venue_id = $1 AND ($2::text IS NULL OR state = $2)
         ORDER BY created_at DESC, id DESC`, [venueId, state ?? null]);
      return rows.rows.map((row) => row.id);
    }

    it("pages a venue newest first without repeating or skipping an enquiry", async () => {
      const f = await dashboardFixture();
      const served = await pages(f.staff, "order=created_desc", 20, 3);
      expect(served.map((page) => page.meta)).toEqual([0, 20, 40].map((offset) => ({ total: 48, limit: 20, offset, order: "created_desc" })));
      const listed = served.flatMap((page) => page.data);
      expect(listed.every((row) => row.venueId === f.a.venueId)).toBe(true);
      expect(listed.map((row) => row.id)).toEqual(await newestFirst(f.a.venueId));
      expect(new Set(listed.map((row) => row.id)).size).toBe(48);
    });

    it("pages one status newest first with its own total", async () => {
      const f = await dashboardFixture();
      const served = await pages(f.staff, "status=submitted&order=created_desc", 10, 2);
      expect(served.map((page) => page.meta.total)).toEqual([18, 18]);
      expect(served.map((page) => page.data.length)).toEqual([10, 8]);
      expect(served.flatMap((page) => page.data).map((row) => row.id)).toEqual(await newestFirst(f.a.venueId, "submitted"));
    });

    it("reads each page of the route from a 0072 index, with or without a status", async () => {
      const indexes = await pool.query<{ indexdef: string }>(
        "SELECT indexdef FROM pg_indexes WHERE indexname = ANY($1) ORDER BY indexname",
        [["enquiries_venue_created_idx", "enquiries_venue_state_created_idx"]],
      );
      expect(indexes.rows.map((row) => row.indexdef)).toEqual([
        "CREATE INDEX enquiries_venue_created_idx ON public.enquiries USING btree (venue_id, created_at, id)",
        "CREATE INDEX enquiries_venue_state_created_idx ON public.enquiries USING btree (venue_id, state, created_at, id)",
      ]);

      const staff = await (await venue("dashboard plans")).actor("staff");
      const plans: string[] = [];
      for (const [query, index] of [
        ["order=created_desc&limit=25&offset=15", "enquiries_venue_created_idx"],
        ["status=withdrawn&order=created_desc&limit=20&offset=0", "enquiries_venue_state_created_idx"],
      ] as const) {
        statements.length = 0;
        statementParams.length = 0;
        const response = await server.inject({ method: "GET", url: `/enquiries?${query}`, headers: bearer(staff) });
        expect(response.statusCode, response.body).toBe(200);
        const position = statements.findIndex((text) => text.includes('from "enquiries"') && text.includes("order by"));
        const routeSql = statements[position];
        if (routeSql === undefined) throw new Error(`The route issued no ordered enquiry select for ${query}`);
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          // Planner choice depends on table size. With scans and sorts priced
          // out, the plan shows an index can serve the route's own statement in order.
          await client.query("SET LOCAL enable_seqscan = off");
          await client.query("SET LOCAL enable_bitmapscan = off");
          await client.query("SET LOCAL enable_sort = off");
          const plan = (await client.query<{ "QUERY PLAN": string }>(`EXPLAIN ${routeSql}`, statementParams[position]))
            .rows.map((row) => row["QUERY PLAN"]).join("\n");
          plans.push(plan);
          expect(plan).toContain(`Index Scan Backward using ${index}`);
          expect(plan).not.toMatch(/\bSort\b/);
        } finally {
          await client.query("ROLLBACK");
          client.release();
        }
      }
      expect(plans).toHaveLength(2);
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

  it("computes the venue dashboard's totals in SQL, with pipeline value from open opportunities and room figures from the diary", async () => {
    const a = await venue("dashboard A");
    const b = await venue("dashboard B");
    const staff = await a.actor("staff");
    const [roomOne, roomTwo] = a.rooms;
    if (roomOne === undefined || roomTwo === undefined) throw new Error("Room fixtures missing");
    // Quotes stay in the fixture on purpose: they total 700, and none of it is
    // pipeline. Pipeline value is the one shared definition the Pipeline tab
    // also reads (services/commercial-pipeline.ts): open opportunities.
    const quote = (spaceId: string | null, status: string, totalMinor: number, deleted = false) => ({
      venueId: a.venueId, name: `Quote ${status}`, spaceId, status, subtotalMinor: totalMinor, totalMinor, deletedAt: deleted ? new Date() : null,
    });
    await db.insert(schema.quotes).values([
      quote(roomOne, "issued", 100), quote(roomOne, "accepted", 250), quote(roomTwo, "accepted", 300),
      quote(null, "draft", 50), quote(roomOne, "accepted", 999, true),
    ]);
    const opportunity = (venueId: string, stage: string, estimatedValueMinor: number, deleted = false) => ({
      venueId, title: `Opportunity ${stage}`, stage, estimatedValueMinor, deletedAt: deleted ? new Date() : null,
    });
    await db.insert(schema.opportunities).values([
      opportunity(a.venueId, "new", 1_200), opportunity(a.venueId, "negotiation", 3_400),
      opportunity(a.venueId, "won", 9_000), opportunity(a.venueId, "lost", 4_000),
      opportunity(a.venueId, "qualified", 800, true), opportunity(b.venueId, "new", 5_000),
    ]);
    const proposal = (status: string, deleted = false) => ({
      venueId: a.venueId, title: `Proposal ${status}`, status, sentAt: status === "draft" ? null : new Date(), deletedAt: deleted ? new Date() : null,
    });
    await db.insert(schema.proposals).values([proposal("sent"), proposal("accepted"), proposal("draft"), proposal("accepted"), proposal("accepted", true)]);
    await db.insert(schema.enquiries).values(Array.from({ length: 4 }, (_, index) => ({
      venueId: a.venueId, spaceId: roomOne, name: `Enquiry ${String(index)}`, email: "d@hot-paths.invalid",
    })));
    // Utilisation reads the diary over the route's 90-day window from today's
    // UTC midnight: active confirmed ("ink") days, with prospects and holds
    // beside them as demand. Released, cancelled, deleted and out-of-window
    // bookings are none of these.
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const at = (day: number, hour: number) => new Date(today + day * 86_400_000 + hour * 3_600_000);
    const booking = (spaceId: string, kind: "prospect" | "hold" | "ink", from: Date, to: Date,
      status: "active" | "released" | "cancelled" = "active", deleted = false) => ({
      venueId: a.venueId, spaceId, kind, status, title: `Booking ${kind}`, startsAt: from, endsAt: to, deletedAt: deleted ? new Date() : null,
    });
    await db.insert(schema.bookings).values([
      booking(roomOne, "ink", at(1, 10), at(1, 18)),
      booking(roomOne, "prospect", at(3, 10), at(3, 18)), booking(roomOne, "hold", at(4, 10), at(4, 18)),
      booking(roomOne, "ink", at(5, 10), at(5, 18), "released"), booking(roomOne, "hold", at(6, 10), at(6, 18), "cancelled"),
      booking(roomOne, "ink", at(7, 10), at(7, 18), "active", true), booking(roomOne, "ink", at(200, 10), at(200, 18)),
      booking(roomTwo, "ink", at(10, 9), at(11, 17)), booking(roomTwo, "hold", at(12, 10), at(12, 18)),
      booking(roomTwo, "ink", at(-3, 9), at(-2, 17)),
    ]);
    const layoutOne = await configuration({ venueId: a.venueId, spaceId: roomOne, userId: null });
    const layoutTwo = await configuration({ venueId: a.venueId, spaceId: roomTwo, userId: null, deleted: true });
    const foreignLayout = await configuration({ venueId: b.venueId, spaceId: b.rooms[0] ?? "", userId: null });
    await db.insert(schema.revenueScenarios).values([
      { venueId: a.venueId, configurationId: layoutOne.id, name: "One", reviewGateCount: 2 },
      { venueId: a.venueId, configurationId: layoutTwo.id, name: "Two", reviewGateCount: 1 },
      { venueId: a.venueId, configurationId: null, name: "Unplaced", reviewGateCount: 3 },
      { venueId: a.venueId, configurationId: foreignLayout.id, name: "Foreign layout", reviewGateCount: 5 },
    ]);
    statements.length = 0;

    const pipeline = await server.inject({ method: "GET", url: "/analytics/pipeline-summary", headers: bearer(staff) });
    expect(pipeline.statusCode, pipeline.body).toBe(200);
    expect(pipeline.json()).toEqual({ data: {
      currency: "GBP", pipelineValueMinor: 4_600, enquiryCount: 4, proposalCount: 4, acceptedProposalCount: 2,
      conversionPercent: 50, proposalStatusCounts: { accepted: 2, draft: 1, sent: 1 },
    } });
    const rooms = await server.inject({ method: "GET", url: "/analytics/room-utilisation", headers: bearer(staff) });
    expect(rooms.statusCode, rooms.body).toBe(200);
    const byName = (rows: { roomName: string }[]) => [...rows].sort((left, right) => left.roomName.localeCompare(right.roomName));
    // One confirmed day of 90 is 1%; a booking over two calendar days is 2%.
    expect(byName(rooms.json<{ data: { roomName: string }[] }>().data)).toEqual([
      { spaceId: roomOne, roomName: "Room 0", bookedEvents: 1, proposedEvents: 2, utilisationPercent: 1, reviewBottlenecks: 2 },
      { spaceId: roomTwo, roomName: "Room 1", bookedEvents: 1, proposedEvents: 1, utilisationPercent: 2, reviewBottlenecks: 1 },
    ]);
    const dashboard = await server.inject({ method: "GET", url: "/analytics/venue-dashboard", headers: bearer(staff) });
    expect(dashboard.statusCode, dashboard.body).toBe(200);
    expect(dashboard.json<{ data: Record<string, unknown> }>().data).toMatchObject({
      pipelineValueMinor: 4_600, enquiryConversionPercent: 50, proposalStatusCounts: { accepted: 2, draft: 1, sent: 1 },
    });
    // Aggregated in SQL: no statement reads the venue's rows one by one, and
    // no quote total is read at all, so no quote can leak into the pipeline.
    expect(statements.filter((sql) => /select "id" from "enquiries"|select "status" from "proposals"|select "estimated_value_minor" from "opportunities"/.test(sql))).toEqual([]);
    expect(statements.filter((sql) => sql.includes('from "quotes"'))).toEqual([]);
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

  describe("the Diary's calendar read and hold reminders (T-619)", () => {
    const DAY = 86_400_000;
    const HOUR = 3_600_000;

    async function diaryFixture() {
      const a = await venue("diary A");
      const b = await venue("diary B");
      const staff = await a.actor("staff");
      const otherStaff = await b.actor("staff");
      const now = Date.now();
      const fiona = randomUUID();
      const elaine = randomUUID();
      await db.insert(schema.users).values([
        { id: fiona, email: `${fiona}@hot-paths.invalid`, name: "Fiona Coordinator", displayName: "Fiona", role: "staff", venueId: a.venueId },
        // A blank display name falls back to the account's name.
        { id: elaine, email: `${elaine}@hot-paths.invalid`, name: "Elaine Gray", displayName: "  ", role: "staff", venueId: a.venueId },
      ]);
      const [roomA0, roomA1] = [a.rooms[0] ?? "", a.rooms[1] ?? ""];
      const hold = (venueId: string, spaceId: string, title: string, startsInDays: number, decisionInDays: number,
        extra: Partial<typeof schema.bookings.$inferInsert> = {}): typeof schema.bookings.$inferInsert => ({
        venueId, spaceId, kind: "hold", title, rank: 1, ownerUserId: fiona, nextAction: "Call the client.",
        nextActionDueAt: new Date(now + DAY), decisionAt: new Date(now + decisionInDays * DAY),
        startsAt: new Date(now + startsInDays * DAY), endsAt: new Date(now + startsInDays * DAY + 4 * HOUR), ...extra,
      });
      const rows = await db.insert(schema.bookings).values([
        hold(a.venueId, roomA0, "In range, decision in 3 days", 2, 3),
        hold(a.venueId, roomA1, "Six months out, decision overdue", 180, -1, { ownerUserId: elaine, rank: 2 }),
        hold(a.venueId, roomA1, "Nobody owns this, decision tomorrow", 60, 1, { ownerUserId: null, jointFlag: true }),
        hold(a.venueId, roomA0, "Decision next month", 200, 30),
        hold(a.venueId, roomA0, "Released, decision overdue", 190, -2, { status: "released" }),
        hold(a.venueId, roomA0, "Deleted, decision overdue", 191, -3, { deletedAt: new Date(now) }),
        { venueId: a.venueId, spaceId: roomA1, kind: "ink", title: "Confirmed dinner",
          startsAt: new Date(now + 3 * DAY), endsAt: new Date(now + 3 * DAY + 4 * HOUR), decisionAt: new Date(now - DAY) },
        hold(b.venueId, b.rooms[0] ?? "", "Other venue, decision overdue", 30, -1, { ownerUserId: null }),
      ]).returning({ id: schema.bookings.id, title: schema.bookings.title });
      const id = (title: string): string => rows.find((row) => row.title === title)?.id ?? "";
      return { a, b, staff, otherStaff, now, id, roomA0, roomA1 };
    }

    type CalendarPayload = { data: {
      entries: { id: string; ownerName?: string | null }[];
      decisionsDue: { holds: { id: string; title: string; ownerName?: string | null; decisionAt: string }[]; total: number };
    } };
    const calendarUrl = (venueId: string, now: number, extra = "") =>
      `/calendar?venueId=${venueId}&from=${new Date(now - DAY).toISOString()}&to=${new Date(now + 7 * DAY).toISOString()}${extra}`;

    it("names owners and lists the venue's decisions due, whatever the booking's date", async () => {
      const f = await diaryFixture();
      const response = await server.inject({ method: "GET", url: calendarUrl(f.a.venueId, f.now), headers: bearer(f.staff) });
      expect(response.statusCode, response.body).toBe(200);
      const { data } = response.json<CalendarPayload>();
      expect(data.entries.find((row) => row.id === f.id("In range, decision in 3 days"))?.ownerName).toBe("Fiona");
      // Overdue first, then by decision date; out-of-range holds included;
      // released, deleted, confirmed and far-off decisions left out.
      expect(data.decisionsDue.holds.map((row) => row.title)).toEqual([
        "Six months out, decision overdue",
        "Nobody owns this, decision tomorrow",
        "In range, decision in 3 days",
      ]);
      expect(data.decisionsDue.total).toBe(3);
      expect(data.decisionsDue.holds.map((row) => row.ownerName ?? null)).toEqual(["Elaine Gray", null, "Fiona"]);
    });

    it("keeps the list to the caller's venue, and to the venue rather than the lanes asked for", async () => {
      const f = await diaryFixture();
      const lanes = await server.inject({ method: "GET", url: calendarUrl(f.a.venueId, f.now, `&spaceIds=${f.roomA0}`), headers: bearer(f.staff) });
      expect(lanes.statusCode, lanes.body).toBe(200);
      expect(lanes.json<CalendarPayload>().data.decisionsDue.total).toBe(3);
      const foreign = await server.inject({ method: "GET", url: calendarUrl(f.b.venueId, f.now), headers: bearer(f.staff) });
      expect(foreign.statusCode).toBe(403);
      const other = await server.inject({ method: "GET", url: calendarUrl(f.b.venueId, f.now), headers: bearer(f.otherStaff) });
      expect(other.json<CalendarPayload>().data.decisionsDue.holds.map((row) => row.title)).toEqual(["Other venue, decision overdue"]);
    });

    it("dry-runs the reminder pass from the database: who is told, about what, and never an address", async () => {
      const f = await diaryFixture();
      // One minute after the T-3 instant of the 3-day decision (and the T-1
      // instant of tomorrow's); the overdue decision earns nothing.
      const summary = await runHoldReminderPass({ db, dryRun: true, now: new Date(f.now + 60_000) });
      const mine = summary.reminders.filter((row) => [
        f.id("In range, decision in 3 days"), f.id("Nobody owns this, decision tomorrow"), f.id("Six months out, decision overdue"),
      ].includes(row.bookingId));
      expect(mine).toEqual([
        {
          bookingId: f.id("In range, decision in 3 days"), holdTitle: "In range, decision in 3 days", spaceName: "Room 0",
          holdDate: formatVenueDay(new Date(f.now + 2 * DAY)), decisionDate: formatVenueDay(new Date(f.now + 3 * DAY)),
          daysBefore: 3, ownerName: "Fiona", idempotencyKey: expect.stringMatching(/:t-3$/u), outcome: "dry_run",
        },
        {
          bookingId: f.id("Nobody owns this, decision tomorrow"), holdTitle: "Nobody owns this, decision tomorrow", spaceName: "Room 1",
          holdDate: formatVenueDay(new Date(f.now + 60 * DAY)), decisionDate: formatVenueDay(new Date(f.now + DAY)),
          daysBefore: 1, ownerName: null, idempotencyKey: expect.stringMatching(/:t-1$/u), outcome: "no_owner",
        },
      ]);
      expect(JSON.stringify(summary)).not.toContain("@hot-paths.invalid");
      // A dry run writes nothing: no send row exists for these reminders.
      const sends = await pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM email_sends WHERE idempotency_key LIKE $1 OR idempotency_key LIKE $2",
        [`hold-reminder:${f.id("In range, decision in 3 days")}:%`, `hold-reminder:${f.id("Nobody owns this, decision tomorrow")}:%`],
      );
      expect(sends.rows[0]?.count).toBe(0);
    });
  });
});
