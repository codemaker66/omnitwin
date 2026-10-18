import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientHomeSchema, type ClientHome } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import type { JwtUser } from "../middleware/auth.js";
import { clientHomeRoutes } from "../routes/client-home.js";
import { clientEventScheduleRoutes } from "../routes/client-event-schedule.js";
import { configurationRoutes } from "../routes/configurations.js";

// ---------------------------------------------------------------------------
// Everyone lands on their own work (fix-first 12), on isolated PostgreSQL.
//
// A client or planner signs in to GET /client-home: the events they hold a
// live link to and the plans they saved. The planner here was invited AT the
// venue (venueId set), which is the case that must not leak: the venue's
// other customers' events and plans stay out of the home, and out of every
// other door a planner can knock on (the event page, a plan by id, the plan
// list, the plan summaries).
//
// Opt-in, isolated PostgreSQL only. Never consults DATABASE_URL or .env.
// Tables are created in a schema of their own from the real Drizzle schema,
// so no migration, shared table or production data is touched.
// ---------------------------------------------------------------------------

const testUrl = process.env["VENVIEWER_ROUTE_TEST_DATABASE_URL"];
if (testUrl !== undefined) {
  const parsed = new URL(testUrl);
  // CI's route database, or this suite's private local cluster.
  const allowedPort = parsed.port === "55476" || parsed.port === "55418";
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1" || !allowedPort
    || parsed.pathname !== "/venviewer_route_atomicity_test"
    || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Client home tests require their explicit isolated loopback database");
  }
}

const VENUE = randomUUID();
const OTHER_VENUE = randomUUID();
const ROOM = randomUUID();
const OTHER_ROOM = randomUUID();

const PLANNER: JwtUser = { id: randomUUID(), email: "planner@client-home.invalid", name: "Fixture planner", role: "planner", platformRole: "none", venueId: VENUE };
const CLIENT: JwtUser = { id: randomUUID(), email: "client@client-home.invalid", name: "Fixture client", role: "client", platformRole: "none", venueId: null };
const NEWCOMER: JwtUser = { id: randomUUID(), email: "new@client-home.invalid", name: "Fixture newcomer", role: "client", platformRole: "none", venueId: null };
const STAFF: JwtUser = { id: randomUUID(), email: "staff@client-home.invalid", name: "Fixture staff", role: "staff", platformRole: "none", venueId: VENUE };

const EVENT_PLANNER = randomUUID();
const EVENT_PLANNER_LATER = randomUUID();
const EVENT_CLIENT = randomUUID();
const EVENT_REVOKED = randomUUID();
const EVENT_DELETED = randomUUID();

const PLAN_LINKED = randomUUID();
const PLAN_ALONE = randomUUID();
const PLAN_VARIANT = randomUUID();
const PLAN_REJECTED_VARIANT = randomUUID();
const PLAN_ON_DELETED_EVENT = randomUUID();
const PLAN_DELETED = randomUUID();
const PLAN_PREVIEW = randomUUID();
const PLAN_TEMPLATE = randomUUID();
const PLAN_CLIENT = randomUUID();
const PLAN_STAFF_ON_CLIENT_EVENT = randomUUID();

const SECRET = "OTHER_CLIENT_SECRET";

function headers(user: JwtUser): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify(user)}` };
}

describe.skipIf(testUrl === undefined)("the client's own home on isolated PostgreSQL", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let server: FastifyInstance;
  const fixtureSchema = `client_home_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [
    schema.users, schema.venues, schema.spaces, schema.configurations, schema.placedObjects,
    schema.events, schema.eventConfigurationLinks, schema.layoutVariants, schema.eventPhases, schema.bookings,
  ];

  beforeAll(async () => {
    vi.stubEnv("NODE_ENV", "test");
    pool = new Pool({ connectionString: testUrl, application_name: fixtureSchema, max: 4, options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    for (const table of tables) {
      const config = getTableConfig(table);
      const columns = config.columns.map((column) => {
        let defaultSql = "";
        if (column.name === "id") defaultSql = " primary key default gen_random_uuid()";
        else if (column.name === "created_at" || column.name === "updated_at") defaultSql = " default now()";
        else if (typeof column.default === "boolean" || typeof column.default === "number") defaultSql = ` default ${String(column.default)}`;
        else if (typeof column.default === "string") defaultSql = ` default '${column.default.replaceAll("'", "''")}'`;
        return `"${column.name}" ${column.getSQLType()}${defaultSql}`;
      });
      await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    }
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(clientHomeRoutes, { db, prefix: "/client-home" });
    await server.register(clientEventScheduleRoutes, { db, prefix: "/events" });
    await server.register(configurationRoutes, { db, prefix: "/configurations" });
    await server.ready();
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    if (pool !== undefined) {
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
    vi.unstubAllEnvs();
  }, 30_000);

  beforeEach(async () => {
    await pool.query(`TRUNCATE ${tables.map((table) => `"${getTableConfig(table).name}"`).join(", ")}`);
    await db.insert(schema.venues).values([
      { id: VENUE, name: "Trades Hall Glasgow", slug: "home-venue", address: "INTERNAL_ADDRESS", timezone: "Europe/London" },
      { id: OTHER_VENUE, name: "Another venue", slug: "home-other-venue", address: "INTERNAL_ADDRESS", timezone: "Europe/London" },
    ]);
    await db.insert(schema.spaces).values([
      { id: ROOM, venueId: VENUE, name: "Grand Hall", slug: "grand-hall", widthM: "10", lengthM: "20", heightM: "5", floorPlanOutline: [] },
      { id: OTHER_ROOM, venueId: OTHER_VENUE, name: "Other room", slug: "other-room", widthM: "10", lengthM: "20", heightM: "5", floorPlanOutline: [] },
    ]);
    await db.insert(schema.users).values([PLANNER, CLIENT, NEWCOMER, STAFF].map((user) => ({
      id: user.id, email: user.email, name: user.name, role: user.role, platformRole: user.platformRole, venueId: user.venueId,
      clerkId: `user_${user.id.replaceAll("-", "")}`,
    })));
    const event = (id: string, name: string, startsAt: Date | null, deletedAt: Date | null = null) => ({
      id, venueId: VENUE, createdBy: STAFF.id, name, eventType: "dinner", status: "in_planning", startsAt,
      endsAt: startsAt === null ? null : new Date(startsAt.getTime() + 5 * 3_600_000), guestCount: 120,
      notes: "INTERNAL_EVENT_NOTES", clientName: "INTERNAL_CLIENT_NAME", deletedAt,
    });
    await db.insert(schema.events).values([
      event(EVENT_PLANNER_LATER, "Spring dinner", new Date("2027-04-10T18:00:00Z")),
      event(EVENT_PLANNER, "Winter dinner", new Date("2026-12-05T18:00:00Z")),
      { ...event(EVENT_CLIENT, `${SECRET} wedding`, new Date("2026-11-20T14:00:00Z")), clientName: SECRET },
      event(EVENT_REVOKED, "Revoked event", new Date("2026-11-01T18:00:00Z")),
      event(EVENT_DELETED, "Deleted event", new Date("2026-11-02T18:00:00Z"), new Date("2026-10-01T00:00:00Z")),
    ]);
    const plan = (id: string, userId: string, name: string, updatedAt: string, extra: Partial<typeof schema.configurations.$inferInsert> = {}) => ({
      id, venueId: VENUE, spaceId: ROOM, userId, name, layoutStyle: "dinner-rounds", state: "draft",
      isPublicPreview: false, isTemplate: false, visibility: "private", slug: id.slice(0, 8),
      metadata: { instructions: { specialInstructions: "INTERNAL_DIETARY" } }, updatedAt: new Date(updatedAt), ...extra,
    });
    await db.insert(schema.configurations).values([
      plan(PLAN_LINKED, PLANNER.id, "Rounds of ten", "2026-10-10T10:00:00Z"),
      plan(PLAN_ALONE, PLANNER.id, "Long tables idea", "2026-10-15T10:00:00Z"),
      plan(PLAN_VARIANT, PLANNER.id, "Spring option", "2026-10-12T10:00:00Z"),
      plan(PLAN_REJECTED_VARIANT, PLANNER.id, "Old option", "2026-10-11T10:00:00Z"),
      plan(PLAN_ON_DELETED_EVENT, PLANNER.id, "Kept after the event went", "2026-10-09T10:00:00Z"),
      plan(PLAN_DELETED, PLANNER.id, "Deleted plan", "2026-10-16T10:00:00Z", { deletedAt: new Date("2026-10-16T11:00:00Z") }),
      plan(PLAN_PREVIEW, PLANNER.id, "Public preview", "2026-10-16T10:00:00Z", { isPublicPreview: true }),
      plan(PLAN_TEMPLATE, PLANNER.id, "House template", "2026-10-16T10:00:00Z", { isTemplate: true }),
      plan(PLAN_CLIENT, CLIENT.id, `${SECRET} layout`, "2026-10-14T10:00:00Z"),
      plan(PLAN_STAFF_ON_CLIENT_EVENT, STAFF.id, "Office working copy", "2026-10-14T09:00:00Z"),
    ]);
    const liveVariant = randomUUID();
    const rejectedVariant = randomUUID();
    await db.insert(schema.layoutVariants).values([
      { id: liveVariant, eventId: EVENT_PLANNER_LATER, configurationId: PLAN_VARIANT, name: "INTERNAL_VARIANT", status: "candidate" },
      { id: rejectedVariant, eventId: EVENT_REVOKED, configurationId: PLAN_REJECTED_VARIANT, name: "INTERNAL_VARIANT", status: "rejected" },
    ]);
    await db.insert(schema.eventConfigurationLinks).values([
      { eventId: EVENT_PLANNER, configurationId: PLAN_LINKED, linkType: "source_configuration" },
      { eventId: EVENT_PLANNER_LATER, configurationId: PLAN_VARIANT, layoutVariantId: liveVariant, linkType: "variant_configuration" },
      { eventId: EVENT_REVOKED, configurationId: PLAN_REJECTED_VARIANT, layoutVariantId: rejectedVariant, linkType: "variant_configuration" },
      { eventId: EVENT_DELETED, configurationId: PLAN_ON_DELETED_EVENT, linkType: "source_configuration" },
      { eventId: EVENT_CLIENT, configurationId: PLAN_CLIENT, linkType: "source_configuration" },
      { eventId: EVENT_CLIENT, configurationId: PLAN_STAFF_ON_CLIENT_EVENT, linkType: "source_configuration" },
    ]);
  });

  async function home(user: JwtUser): Promise<ClientHome> {
    const response = await server.inject({ method: "GET", url: "/client-home", headers: headers(user) });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    return ClientHomeSchema.parse(response.json<{ data: unknown }>().data);
  }

  it("gives the planner their own events, earliest first, and their own plans, latest first", async () => {
    const data = await home(PLANNER);
    expect(data.events.map((event) => event.id)).toEqual([EVENT_PLANNER, EVENT_PLANNER_LATER]);
    expect(data.events[0]).toMatchObject({ name: "Winter dinner", guestCount: 120, layoutCount: 1,
      venue: { id: VENUE, name: "Trades Hall Glasgow", timezone: "Europe/London" } });
    expect(data.plans.map((plan) => [plan.id, plan.eventId])).toEqual([
      [PLAN_ALONE, null],
      [PLAN_VARIANT, EVENT_PLANNER_LATER],
      [PLAN_REJECTED_VARIANT, null],
      [PLAN_LINKED, EVENT_PLANNER],
      [PLAN_ON_DELETED_EVENT, null],
    ]);
    expect(data.planTotal).toBe(5);
    expect(data.plans[0]).toMatchObject({ space: { id: ROOM, name: "Grand Hall" }, venue: { id: VENUE, name: "Trades Hall Glasgow" } });
  });

  it("never shows the invited planner another client's event or plan, nor the venue's notes", async () => {
    const response = await server.inject({ method: "GET", url: "/client-home", headers: headers(PLANNER) });
    expect(response.statusCode).toBe(200);
    for (const forbidden of [SECRET, EVENT_CLIENT, PLAN_CLIENT, PLAN_STAFF_ON_CLIENT_EVENT, "INTERNAL_", EVENT_REVOKED, EVENT_DELETED, PLAN_DELETED, PLAN_PREVIEW, PLAN_TEMPLATE]) {
      expect(response.body).not.toContain(forbidden);
    }
  });

  it("keeps the client's home to the client's own event and plan", async () => {
    const data = await home(CLIENT);
    expect(data.events.map((event) => event.id)).toEqual([EVENT_CLIENT]);
    // The office's own plan on the same event is not the client's to count.
    expect(data.events[0]?.layoutCount).toBe(1);
    expect(data.plans.map((plan) => plan.id)).toEqual([PLAN_CLIENT]);
    expect(JSON.stringify(data)).not.toContain(PLAN_LINKED);
  });

  it("refuses the invited planner the other client's work at every other door", async () => {
    const schedule = await server.inject({ method: "GET", url: `/events/${EVENT_CLIENT}/client-schedule`, headers: headers(PLANNER) });
    expect(schedule.statusCode).toBe(404);
    expect(schedule.body).not.toContain(SECRET);

    const byId = await server.inject({ method: "GET", url: `/configurations/${PLAN_CLIENT}`, headers: headers(PLANNER) });
    expect(byId.statusCode).toBe(403);
    expect(byId.body).not.toContain(SECRET);

    const list = await server.inject({ method: "GET", url: "/configurations?limit=100", headers: headers(PLANNER) });
    expect(list.statusCode).toBe(200);
    const listed = list.json<{ data: { id: string; userId: string }[] }>().data;
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((row) => row.userId === PLANNER.id)).toBe(true);
    expect(list.body).not.toContain(SECRET);

    const summaries = await server.inject({ method: "GET", url: `/configurations/summaries?ids=${PLAN_CLIENT},${PLAN_LINKED}`, headers: headers(PLANNER) });
    expect(summaries.statusCode).toBe(200);
    expect(summaries.json<{ data: { id: string }[] }>().data.map((row) => row.id)).toEqual([PLAN_LINKED]);
  });

  it("lists only events whose page opens for that person", async () => {
    for (const user of [PLANNER, CLIENT]) {
      const data = await home(user);
      for (const event of data.events) {
        const page = await server.inject({ method: "GET", url: `/events/${event.id}/client-schedule`, headers: headers(user) });
        expect(page.statusCode, `${user.role} opens ${event.name}`).toBe(200);
      }
    }
    // And the events left off the planner's home are the ones that refuse them.
    for (const eventId of [EVENT_REVOKED, EVENT_DELETED]) {
      const page = await server.inject({ method: "GET", url: `/events/${eventId}/client-schedule`, headers: headers(PLANNER) });
      expect(page.statusCode).toBe(404);
    }
  });

  it("takes an event off the home once the venue revokes the plan that linked it", async () => {
    await db.update(schema.configurations).set({ deletedAt: new Date() }).where(eq(schema.configurations.id, PLAN_LINKED));
    const data = await home(PLANNER);
    expect(data.events.map((event) => event.id)).toEqual([EVENT_PLANNER_LATER]);
    expect(data.plans.some((plan) => plan.id === PLAN_LINKED)).toBe(false);
  });

  it("answers a person with nothing yet with empty lists, not an error", async () => {
    const data = await home(NEWCOMER);
    expect(data).toEqual({ events: [], plans: [], planTotal: 0 });
  });

  it("asks for sign-in without a session", async () => {
    const response = await server.inject({ method: "GET", url: "/client-home" });
    expect(response.statusCode).toBe(401);
  });
});
