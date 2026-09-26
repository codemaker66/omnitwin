import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NotificationSchema, type Notification } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { getUserByClerkId, type JwtUser } from "../middleware/auth.js";
import { notificationRoutes } from "../routes/event-plan-lifecycle.js";
import { analyticsRoutes, revenueScenarioRoutes } from "../routes/revenue-analytics.js";
import { requireEventAccessTestDatabaseUrl } from "../scripts/run-event-access-postgres-tests.js";

const target = process.env["VENVIEWER_EVENT_ACCESS_TEST_DATABASE_URL"];
if (target !== undefined) requireEventAccessTestDatabaseUrl(target);

// Real migrated PostgreSQL; only this invocation's UUID fixtures are written.
// Authentication resolves the current persisted account through the production
// Clerk-to-local-user bridge before supplying the test-only HTTP token seam.
describe.skipIf(target === undefined)("event capabilities on disposable PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;
  const fixtures: Fixture[] = [];
  const roles = ["client", "planner", "staff", "admin", "hallkeeper", "otherStaff", "platform"] as const;
  type ActorKey = typeof roles[number];
  interface Fixture {
    venues: [string, string];
    eventIds: [string, string, string];
    actor: Record<ActorKey, JwtUser>;
  }

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit disposable target required");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VENVIEWER_APPROVED_AUTH_DOMAINS", "");
    pool = new Pool({ connectionString: target, max: 4, application_name: `event-capabilities-${randomUUID()}` });
    expect((await pool.query<{ database: string }>("SELECT current_database() AS database")).rows[0]?.database)
      .toBe(new URL(target).pathname.slice(1));
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(notificationRoutes, { db, prefix: "/notifications" });
    await server.register(analyticsRoutes, { db, prefix: "/analytics" });
    await server.register(revenueScenarioRoutes, { db, prefix: "/revenue-scenarios" });
    await server.ready();
  });

  async function cleanFixtures() {
    if (db !== undefined) {
      for (const f of fixtures) {
        await db.delete(schema.eventPlanNotifications).where(inArray(schema.eventPlanNotifications.venueId, f.venues));
        await db.delete(schema.revenueScenarios).where(inArray(schema.revenueScenarios.venueId, f.venues));
        await db.delete(schema.events).where(inArray(schema.events.id, f.eventIds));
        // Personal notifications with null venue are removed by recipient FK.
        await db.delete(schema.users).where(inArray(schema.users.id, Object.values(f.actor).map(actor => actor.id)));
        await db.delete(schema.venues).where(inArray(schema.venues.id, f.venues));
      }
      fixtures.length = 0;
    }
  }

  afterEach(cleanFixtures);
  afterAll(async () => {
    await server?.close();
    await cleanFixtures();
    await pool?.end();
    vi.unstubAllEnvs();
  }, 30000);

  async function fixture(): Promise<Fixture> {
    const venues: Fixture["venues"] = [randomUUID(), randomUUID()];
    const actor = Object.fromEntries(roles.map(key => {
      const id = randomUUID();
      return [key, { id, email: `${id}@event-capabilities.invalid`, name: key,
        role: key === "platform" ? "admin" : key === "otherStaff" ? "staff" : key,
        platformRole: key === "platform" ? "admin" : "none",
        venueId: key === "platform" ? null : key === "otherStaff" ? venues[1] : venues[0] }];
    })) as Record<ActorKey, JwtUser>;
    const f: Fixture = { venues, eventIds: [randomUUID(), randomUUID(), randomUUID()], actor };
    fixtures.push(f);
    await db.insert(schema.venues).values(venues.map(id => ({ id, name: "Capability fixture venue", slug: id,
      address: "Test only", timezone: "Europe/London" })));
    await db.insert(schema.users).values(Object.values(actor).map(value => ({ ...value, clerkId: `user_${value.id.replaceAll("-", "")}` })));
    await db.insert(schema.events).values(f.eventIds.map((id, index) => ({ id,
      venueId: index === 1 ? venues[1] : venues[0], createdBy: actor.staff.id, name: "Internal event",
      notes: "INTERNAL_EVENT_NOTES", guestCount: 20, deletedAt: index === 2 ? new Date() : null })));
    return f;
  }

  async function headers(actor: JwtUser) {
    const current = await getUserByClerkId(db, `user_${actor.id.replaceAll("-", "")}`, actor.email);
    if (current === null) throw new Error("Fixture actor missing");
    return { authorization: `Bearer ${JSON.stringify(current)}` };
  }

  async function notification(f: Fixture, input: Partial<typeof schema.eventPlanNotifications.$inferInsert> = {}) {
    const id = randomUUID();
    await db.insert(schema.eventPlanNotifications).values({ id, venueId: f.venues[0], eventId: f.eventIds[0],
      recipientUserId: f.actor.staff.id, audienceRole: "staff", title: "Internal event update", body: "INTERNAL_STAFF_NOTE",
      createdAt: new Date("2026-09-14T12:00:00Z"), ...input });
    return id;
  }

  async function list(actor: JwtUser, status = "all", limit = 100): Promise<Notification[]> {
    const response = await server.inject({ method: "GET", url: `/notifications?status=${status}&limit=${String(limit)}`,
      headers: await headers(actor) });
    expect(response.statusCode, response.body).toBe(200);
    return NotificationSchema.array().parse(response.json<{ data: unknown }>().data);
  }

  const analytics = ["pipeline-summary", "room-utilisation", "venue-dashboard"] as const;
  it.each(["client", "planner"] as const)("refuses all venue analytics for same-venue %s", async role => {
    const f = await fixture();
    for (const route of analytics) {
      const response = await server.inject({ method: "GET", url: `/analytics/${route}?venueId=${f.venues[0]}`,
        headers: await headers(f.actor[role]) });
      expect(response.statusCode, response.body).toBe(403);
    }
  });

  // The analytics gate is split by what the payload contains, not by habit.
  // It used to be one predicate for all three routes, which put the venue
  // floor inside the venue's money: a hallkeeper could read pipeline value
  // and conversion while being refused the commercial board that produced
  // them, and a manager or sales user was refused the dashboard summarising
  // the pipeline they work. Priced surfaces now admit the commercial team;
  // room utilisation carries no money and stays with the floor, which is the
  // one of the three a hallkeeper has a real need for.
  const pricedAnalytics = ["pipeline-summary", "venue-dashboard"] as const;

  it.each(["staff", "admin", "platform"] as const)("preserves current %s priced analytics reads", async role => {
    const f = await fixture();
    for (const route of pricedAnalytics) {
      const response = await server.inject({ method: "GET", url: `/analytics/${route}?venueId=${f.venues[0]}`,
        headers: await headers(f.actor[role]) });
      expect(response.statusCode, response.body).toBe(200);
    }
  });

  it("keeps the venue floor out of the venue's money, and in the room book", async () => {
    // Intended change, not a regression: a hallkeeper loses the two priced
    // analytics reads and keeps room utilisation.
    const f = await fixture();
    for (const route of pricedAnalytics) {
      const response = await server.inject({ method: "GET", url: `/analytics/${route}?venueId=${f.venues[0]}`,
        headers: await headers(f.actor.hallkeeper) });
      expect(response.statusCode, response.body).toBe(403);
    }
  });

  it.each(["staff", "admin", "hallkeeper", "platform"] as const)("preserves current %s room utilisation reads", async role => {
    const f = await fixture();
    const response = await server.inject({ method: "GET", url: `/analytics/room-utilisation?venueId=${f.venues[0]}`,
      headers: await headers(f.actor[role]) });
    expect(response.statusCode, response.body).toBe(200);
  });

  it("refuses foreign and removed venue analytics scope", async () => {
    const f = await fixture();
    for (const venueId of [f.venues[1], null]) {
      await db.update(schema.users).set({ venueId }).where(eq(schema.users.id, f.actor.staff.id));
      const response = await server.inject({ method: "GET", url: `/analytics/venue-dashboard?venueId=${f.venues[0]}`,
        headers: await headers(f.actor.staff) });
      expect(response.statusCode, response.body).toBe(403);
    }
  });

  it.each(["client", "planner", "hallkeeper", "otherStaff"] as const)("refuses %s revenue scenario writes without persisting a row", async role => {
    const f = await fixture();
    const response = await server.inject({ method: "POST", url: "/revenue-scenarios", headers: await headers(f.actor[role]),
      payload: { venueId: f.venues[0], name: "Permission fixture scenario", estimatedRevenueMinor: 12300 } });
    expect(response.statusCode, response.body).toBe(403);
    expect(await db.select().from(schema.revenueScenarios).where(eq(schema.revenueScenarios.venueId, f.venues[0]))).toEqual([]);
  });

  it.each(["staff", "admin", "platform"] as const)("allows current %s revenue scenario writes", async role => {
    const f = await fixture();
    const response = await server.inject({ method: "POST", url: "/revenue-scenarios", headers: await headers(f.actor[role]),
      payload: { venueId: f.venues[0], eventId: f.eventIds[0], name: "Permission fixture scenario", estimatedRevenueMinor: 12300 } });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({ data: { scenario: { venueId: f.venues[0], createdBy: f.actor[role].id } } });
  });

  it.each(["client", "planner"] as const)("hides addressed and role event notifications from %s, preserving personal notifications", async role => {
    const f = await fixture();
    const direct = await notification(f, { recipientUserId: f.actor[role].id, audienceRole: role });
    const broadcast = await notification(f, { recipientUserId: null, audienceRole: role });
    const personal = await notification(f, { eventId: null, venueId: null, recipientUserId: f.actor[role].id, audienceRole: role, body: "Personal update" });
    const roleNotice = await notification(f, { eventId: null, recipientUserId: null, audienceRole: role, body: "Workspace update" });
    expect((await list(f.actor[role])).map(row => row.id).sort()).toEqual([personal, roleNotice].sort());
    for (const id of [direct, broadcast]) {
      const denied = await server.inject({ method: "PATCH", url: `/notifications/${id}/read`, headers: await headers(f.actor[role]) });
      expect([403, 404], denied.body).toContain(denied.statusCode);
      expect(await db.select().from(schema.eventPlanNotificationReads).where(eq(schema.eventPlanNotificationReads.notificationId, id))).toEqual([]);
    }
    const allowed = await server.inject({ method: "PATCH", url: `/notifications/${personal}/read`, headers: await headers(f.actor[role]) });
    expect(allowed.statusCode, allowed.body).toBe(200);
    expect((await list(f.actor[role], "read")).map(row => row.id)).toEqual([personal]);
  });

  it.each(["staff", "admin", "hallkeeper", "platform"] as const)("allows addressed and role event notifications for current %s", async role => {
    const f = await fixture();
    const audienceRole = role === "platform" ? "admin" : role;
    const direct = await notification(f, { recipientUserId: f.actor[role].id, audienceRole });
    const broadcast = await notification(f, { recipientUserId: null, audienceRole });
    expect((await list(f.actor[role])).map(row => row.id).sort()).toEqual([direct, broadcast].sort());
    for (const id of [direct, broadcast]) {
      const response = await server.inject({ method: "PATCH", url: `/notifications/${id}/read`, headers: await headers(f.actor[role]) });
      expect(response.statusCode, response.body).toBe(200);
    }
    expect((await list(f.actor[role], "unread"))).toEqual([]);
  });

  it("removes old addressed event notifications after a persisted role or venue change", async () => {
    const f = await fixture();
    const id = await notification(f);
    expect((await list(f.actor.staff)).map(row => row.id)).toEqual([id]);
    for (const update of [
      { role: "client", venueId: f.venues[0] }, { role: "planner", venueId: f.venues[0] },
      { role: "staff", venueId: f.venues[1] }, { role: "staff", venueId: null },
    ]) {
      await db.update(schema.users).set(update).where(eq(schema.users.id, f.actor.staff.id));
      expect(await list(f.actor.staff)).toEqual([]);
      const response = await server.inject({ method: "PATCH", url: `/notifications/${id}/read`, headers: await headers(f.actor.staff) });
      expect([403, 404], response.body).toContain(response.statusCode);
    }
    expect(await db.select().from(schema.eventPlanNotificationReads).where(eq(schema.eventPlanNotificationReads.notificationId, id))).toEqual([]);
  });

  it("hides deleted and foreign events even from the addressed recipient", async () => {
    const f = await fixture();
    const foreign = await notification(f, { eventId: f.eventIds[1], venueId: f.venues[1] });
    const deleted = await notification(f, { eventId: f.eventIds[2] });
    expect(await list(f.actor.staff)).toEqual([]);
    for (const id of [foreign, deleted]) {
      const response = await server.inject({ method: "PATCH", url: `/notifications/${id}/read`, headers: await headers(f.actor.staff) });
      expect([403, 404], response.body).toContain(response.statusCode);
    }
  });

  it("does not give staff or platform admins another user's personal notification", async () => {
    const f = await fixture();
    const id = await notification(f, { eventId: null, recipientUserId: f.actor.client.id });
    for (const actor of [f.actor.staff, f.actor.platform]) {
      expect(await list(actor)).toEqual([]);
      const response = await server.inject({ method: "PATCH", url: `/notifications/${id}/read`, headers: await headers(actor) });
      expect(response.statusCode, response.body).toBe(403);
    }
  });

  it("applies authority and read status before limit so older visible rows fill the page", async () => {
    const f = await fixture();
    const visible = await Promise.all(Array.from({ length: 4 }, (_, index) => notification(f, {
      createdAt: new Date(Date.UTC(2026, 8, 14, 10, index)) })));
    for (let index = 0; index < 12; index += 1) {
      await notification(f, { eventId: f.eventIds[1], venueId: f.venues[1], createdAt: new Date(Date.UTC(2026, 8, 14, 14, index)) });
      const id = await notification(f, { createdAt: new Date(Date.UTC(2026, 8, 14, 13, index)) });
      await db.insert(schema.eventPlanNotificationReads).values({ notificationId: id, userId: f.actor.staff.id });
    }
    expect((await list(f.actor.staff, "unread", 3)).map(row => row.id)).toEqual(visible.slice(1).reverse());
    expect((await list(f.actor.staff, "read", 3))).toHaveLength(3);
    expect((await list(f.actor.staff, "all", 100))).toHaveLength(16);
    expect((await list(f.actor.staff, "unread", 100))).toHaveLength(4);
    expect((await list(f.actor.staff, "read", 100))).toHaveLength(12);
  });

  it("stores one recipient read marker under concurrent acknowledgement", async () => {
    const f = await fixture();
    const id = await notification(f);
    const auth = await headers(f.actor.staff);
    const results = await Promise.all(Array.from({ length: 5 }, () => server.inject({ method: "PATCH",
      url: `/notifications/${id}/read`, headers: auth })));
    expect(results.map(result => result.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect(await db.select().from(schema.eventPlanNotificationReads).where(eq(schema.eventPlanNotificationReads.notificationId, id))).toHaveLength(1);
  });
});
