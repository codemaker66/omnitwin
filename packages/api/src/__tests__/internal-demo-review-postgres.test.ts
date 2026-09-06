import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../db/schema.js";
import { configurationReviewRoutes } from "../routes/configuration-reviews.js";
import { validateEnv } from "../env.js";
import { InternalDemoNameSchema } from "../services/internal-demo-review.js";
import { assembleSheetDataV2 } from "../services/hallkeeper-sheet-v2-data.js";

const email = vi.hoisted(() => vi.fn());
vi.mock("../services/email.js", () => ({ sendEmailAsync: email }));
vi.mock("../services/pdf-prerender.js", () => ({ schedulePrerender: vi.fn() }));

const target = process.env["VENVIEWER_INTERNAL_DEMO_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55476"
    || parsed.pathname !== "/venviewer_internal_demo_review_test" || parsed.search || parsed.hash) {
    throw new Error("Internal review tests require their explicit disposable loopback database");
  }
}

describe("explicit persisted demo name contract", () => {
  it.each(["DEMO ONLY - rehearsal", "DEMO ONLY — rehearsal"])("accepts %s", name => {
    expect(InternalDemoNameSchema.safeParse(name).success).toBe(true);
  });
  it.each(["Actual event DEMO ONLY - rehearsal", "demo only - rehearsal", " DEMO ONLY - rehearsal",
    "DEMO ONLY plan", "DEMO ONLY - ", "DEMO ONLY — \nrehearsal", "DEMO ONLY - x\n"])("rejects %s", name => {
    expect(InternalDemoNameSchema.safeParse(name).success).toBe(false);
  });
});

describe.skipIf(target === undefined)("supported internal review routes on disposable PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;
  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit target required");
    pool = new Pool({ connectionString: target });
    expect((await pool.query<{ database: string }>("SELECT current_database() AS database")).rows[0]?.database)
      .toBe("venviewer_internal_demo_review_test");
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    server = Fastify();
    await server.register(configurationReviewRoutes, { db, prefix: "/configurations",
      env: validateEnv({ NODE_ENV: "test", DATABASE_URL: target }) });
    await server.ready();
  }, 120000);
  beforeEach(() => { email.mockClear(); });
  afterAll(async () => { await server?.close(); await pool?.end(); });

  async function fixture(options: { role?: string; name?: string; eventName?: string; public?: boolean; linked?: boolean; visibility?: string } = {}) {
    const venueId = randomUUID(), roomId = randomUUID(), userId = randomUUID(), configId = randomUUID(), eventId = randomUUID();
    const assetId = randomUUID();
    await db.insert(schema.venues).values({ id: venueId, name: "Disposable venue", slug: venueId, address: "Test only" });
    await db.insert(schema.spaces).values({ id: roomId, venueId, name: "Room", slug: "room", widthM: "10", lengthM: "10", heightM: "3",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] });
    await db.insert(schema.users).values([
      { id: userId, venueId, name: "Test actor", email: `${userId}@demo.invalid`, role: options.role ?? "admin" },
      { venueId, name: "Test staff", email: `${randomUUID()}@demo.invalid`, role: "staff" },
      { venueId, name: "Test hallkeeper", email: `${randomUUID()}@demo.invalid`, role: "hallkeeper" },
    ]);
    await db.insert(schema.configurations).values({ id: configId, venueId, spaceId: roomId,
      userId: options.public === true ? null : userId, name: options.name ?? "DEMO ONLY - Internal rehearsal",
      slug: "plan", layoutStyle: "custom", isPublicPreview: options.public ?? false, visibility: options.visibility ?? "private" });
    await db.insert(schema.assetDefinitions).values({ id: assetId, name: "Chair", category: "chair", widthM: ".45", depthM: ".45", heightM: ".9", collisionType: "box" });
    await db.insert(schema.placedObjects).values({ configurationId: configId, assetDefinitionId: assetId, positionX: "1", positionY: "0", positionZ: "1", coordinateWriteToken: randomUUID() });
    await db.insert(schema.events).values({ id: eventId, venueId, createdBy: userId, name: options.eventName ?? "DEMO ONLY — Event rehearsal" });
    if (options.linked !== false) await db.insert(schema.eventConfigurationLinks).values({ eventId, configurationId: configId, linkType: "variant_configuration" });
    const headers = { authorization: `Bearer ${JSON.stringify({ id: userId, name: "Test actor", email: `${userId}@demo.invalid`, role: options.role ?? "admin", venueId })}` };
    return { configId, venueId, roomId, userId, eventId, headers };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function post(f: Fixture, action: string, payload: Record<string, unknown> = {}) {
    return server.inject({ method: "POST", url: `/configurations/${f.configId}/review/${action}`, headers: f.headers, payload });
  }
  async function state(f: Fixture) {
    const [config] = await db.select().from(schema.configurations).where(eq(schema.configurations.id, f.configId));
    const snapshots = await db.select().from(schema.configurationSheetSnapshots).where(eq(schema.configurationSheetSnapshots.configurationId, f.configId));
    const history = await db.select().from(schema.configurationReviewHistory).where(eq(schema.configurationReviewHistory.configurationId, f.configId));
    const audit = await db.select().from(schema.generalAuditLog).where(eq(schema.generalAuditLog.targetId, f.configId));
    return { config, snapshots, history, audit };
  }

  it("defaults to requesting emails on submit and approval", async () => {
    const f = await fixture({ name: "Real event plan", eventName: "Real event" });
    expect((await post(f, "submit")).statusCode).toBe(200);
    await expect.poll(() => email.mock.calls.length).toBe(1);
    expect((await post(f, "start-review")).statusCode).toBe(200);
    const approved = await post(f, "approve");
    expect(approved.statusCode).toBe(200);
    expect(approved.json< { data: { notificationPolicy: string } } >().data.notificationPolicy).toBe("team_requested");
    await expect.poll(() => email.mock.calls.length).toBe(3);
  });

  it("submits, approves and reopens a real frozen sheet without invoking email", async () => {
    const f = await fixture();
    const availability = await server.inject({ method: "GET", url: `/configurations/${f.configId}/review/available-transitions`, headers: f.headers });
    expect(availability.json<{ data: { internalDemoReviewEligible: boolean } }>().data.internalDemoReviewEligible).toBe(true);
    expect((await post(f, "submit", { notifyTeam: false, note: "Internal rehearsal" })).statusCode).toBe(200);
    expect((await post(f, "start-review")).statusCode).toBe(200);
    const approved = await post(f, "approve", { notifyTeam: false });
    expect(approved.statusCode).toBe(200);
    expect(approved.json<{ data: { notificationPolicy: string } }>().data.notificationPolicy).toBe("suppressed_demo");
    const saved = await state(f);
    expect(saved.config?.reviewStatus).toBe("approved");
    expect(saved.snapshots).toHaveLength(1);
    expect(saved.snapshots[0]?.approvedBy).toBe(f.userId);
    expect(saved.history.map(row => row.toStatus)).toEqual(["submitted", "under_review", "approved"]);
    expect(saved.audit).toHaveLength(2);
    expect(saved.audit[1]).toMatchObject({ actorUserId: f.userId, metadata: { notifyTeam: false, eventIds: [f.eventId], transition: "approved" } });
    expect((await assembleSheetDataV2(db, f.configId, "http://127.0.0.1"))?.payload.floorPlan?.objects).toHaveLength(1);
    expect(email).not.toHaveBeenCalled();
  });

  it.each([
    { role: "planner" }, { public: true }, { name: "Real event DEMO ONLY - text" },
    { eventName: "Real event" }, { linked: false }, { visibility: "public" }, { visibility: "unlisted" },
  ])("rejects suppression outside its persisted role/scope: %j", async options => {
    const f = await fixture(options);
    const response = await post(f, "submit", { notifyTeam: false });
    expect(response.statusCode).toBe(403);
    expect(await state(f)).toMatchObject({ config: { reviewStatus: "draft" }, snapshots: [], history: [], audit: [] });
    expect(email).not.toHaveBeenCalled();
  });

  it("rejects missing auth and a string false at runtime", async () => {
    const f = await fixture();
    expect((await server.inject({ method: "POST", url: `/configurations/${f.configId}/review/submit`, payload: { notifyTeam: false } })).statusCode).toBe(401);
    expect((await post(f, "submit", { notifyTeam: "false" })).statusCode).toBe(400);
    expect((await state(f)).snapshots).toHaveLength(0);
  });

  it("does not let configuration ownership grant foreign venue staff suppression", async () => {
    const f = await fixture();
    const foreign = randomUUID();
    await db.insert(schema.venues).values({ id: foreign, name: "Foreign test venue", slug: foreign, address: "Test" });
    await db.update(schema.users).set({ venueId: foreign }).where(eq(schema.users.id, f.userId));
    const token = { id: f.userId, email: "fixture@demo.invalid", role: "staff", venueId: foreign };
    const response = await server.inject({ method: "POST", url: `/configurations/${f.configId}/review/submit`,
      headers: { authorization: `Bearer ${JSON.stringify(token)}` }, payload: { notifyTeam: false } });
    expect(response.statusCode).toBe(403);
    expect((await state(f)).snapshots).toHaveLength(0);
    expect(email).not.toHaveBeenCalled();
  });

  it("rejects an equally named demo event in a foreign venue", async () => {
    const f = await fixture();
    const venueId = randomUUID();
    await db.insert(schema.venues).values({ id: venueId, name: "Foreign test venue", slug: venueId, address: "Test" });
    await db.update(schema.events).set({ venueId }).where(eq(schema.events.id, f.eventId));
    expect((await post(f, "submit", { notifyTeam: false })).statusCode).toBe(403);
    expect(email).not.toHaveBeenCalled();
  });

  it.each(["rename", "link"])("rechecks persisted scope after a concurrent %s while waiting for the config lock", async change => {
    const f = await fixture();
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    try {
      await blocker.query("SELECT id FROM configurations WHERE id=$1 FOR UPDATE", [f.configId]);
      const response = post(f, "submit", { notifyTeam: false }).then(value => value);
      await expect.poll(async () => Number((await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'",
      )).rows[0]?.count)).toBeGreaterThan(0);
      if (change === "rename") await blocker.query("UPDATE configurations SET name='Actual event' WHERE id=$1", [f.configId]);
      else {
        const realEvent = randomUUID();
        await blocker.query("INSERT INTO events(id,venue_id,name) VALUES($1,$2,'Actual event')", [realEvent, f.venueId]);
        await blocker.query("INSERT INTO event_configuration_links(event_id,configuration_id,link_type) VALUES($1,$2,'variant_configuration')", [realEvent, f.configId]);
      }
      await blocker.query("COMMIT");
      expect((await response).statusCode).toBe(403);
      expect((await state(f)).snapshots).toHaveLength(0);
      expect(email).not.toHaveBeenCalled();
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  });

  it.each(["variant", "phase"])("rejects a hidden real event association through %s", async kind => {
    const f = await fixture();
    const realEvent = randomUUID();
    await db.insert(schema.events).values({ id: realEvent, venueId: f.venueId, name: "Real event" });
    if (kind === "variant") await db.insert(schema.layoutVariants).values({ eventId: realEvent, configurationId: f.configId, name: "Real variant" });
    else {
      const phaseId = randomUUID();
      await db.insert(schema.eventPhases).values({ id: phaseId, eventId: realEvent, spaceId: f.roomId, name: "Real dinner", templateKey: "dinner", sortOrder: 0 });
      await db.insert(schema.phaseLayoutSnapshots).values({ eventPhaseId: phaseId, configurationId: f.configId });
    }
    expect((await post(f, "submit", { notifyTeam: false })).statusCode).toBe(403);
    expect(email).not.toHaveBeenCalled();
  });

  async function rejectAudit(action: () => Promise<void>) {
    await pool.query("CREATE OR REPLACE FUNCTION reject_demo_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Deliberate isolated audit failure'; END $$");
    await pool.query("CREATE TRIGGER reject_demo_audit BEFORE INSERT ON general_audit_log FOR EACH ROW EXECUTE FUNCTION reject_demo_audit()");
    try { await action(); } finally { await pool.query("DROP TRIGGER reject_demo_audit ON general_audit_log"); }
  }
  it("rolls back the new snapshot and review when suppression audit fails", async () => {
    const f = await fixture();
    await rejectAudit(async () => {
      expect((await post(f, "submit", { notifyTeam: false })).statusCode).toBe(500);
    });
    expect(await state(f)).toMatchObject({ config: { reviewStatus: "draft" }, snapshots: [], history: [], audit: [] });
    expect(email).not.toHaveBeenCalled();
  });
  it("rolls back snapshot approval, mirror and history when suppression audit fails", async () => {
    const f = await fixture();
    await post(f, "submit", { notifyTeam: false }); await post(f, "start-review");
    await rejectAudit(async () => {
      expect((await post(f, "approve", { notifyTeam: false })).statusCode).toBe(500);
    });
    const saved = await state(f);
    expect(saved.config).toMatchObject({ reviewStatus: "under_review", approvedAt: null });
    expect(saved.snapshots[0]?.approvedAt).toBeNull();
    expect(saved.history).toHaveLength(2); expect(saved.audit).toHaveLength(1);
    expect(email).not.toHaveBeenCalled();
  });
});
