import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { analyticsRoutes } from "../routes/revenue-analytics.js";

// ---------------------------------------------------------------------------
// Who may read which analytics, per role, against a real database.
//
// Two definitions of "commercial" had drifted apart inside one lane: the CRM
// board admitted the commercial team (admin, manager, staff, sales) while
// every analytics route admitted the venue floor (admin, staff, hallkeeper).
// So a hallkeeper read venue-wide PRICING but was refused the pipeline that
// produced it, and a manager or sales user worked the pipeline but was
// refused the dashboard summarising it.
//
// The split these cases pin is by payload, not by habit: money is commercial,
// room use is the floor's. Role tables rather than prose, so a future role
// change shows up here as a named failure.
//
// Opt-in, isolated PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const testUrl = process.env["VENVIEWER_ROUTE_TEST_DATABASE_URL"];
if (testUrl !== undefined) {
  const parsed = new URL(testUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1" || parsed.port !== "55476"
    || parsed.pathname !== "/venviewer_route_atomicity_test"
    || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Analytics authority tests require their explicit isolated loopback database");
  }
}

const VENUE = "22222222-2222-4222-8222-222222222222";
const OTHER_VENUE = "22222222-2222-4222-8222-222222222999";
const SPACE = "44444444-4444-4444-8444-444444444444";
const USER = "33333333-3333-4333-8333-333333333333";

const PRICED_ROUTES = ["/analytics/pipeline-summary", "/analytics/venue-dashboard"] as const;
const ROOM_USE_ROUTE = "/analytics/room-utilisation";

function headers(
  role: string,
  venueId: string | null = VENUE,
  platformRole: "none" | "admin" = "none",
): { authorization: string } {
  return {
    authorization: `Bearer ${JSON.stringify({
      id: USER, email: "fixture@example.test", role, platformRole, venueId,
    })}`,
  };
}

describe.skipIf(testUrl === undefined)("analytics authority on isolated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const fixtureSchema = `analytics_authority_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [
    schema.venues, schema.spaces, schema.bookings, schema.opportunities,
    schema.proposals, schema.enquiries, schema.quotes, schema.revenueScenarios,
    schema.comfortConstraints, schema.configurations, schema.events,
  ];

  beforeAll(async () => {
    pool = new Pool({
      connectionString: testUrl, application_name: fixtureSchema, max: 4,
      options: `-c search_path=${fixtureSchema}`,
    });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    for (const table of tables) {
      const config = getTableConfig(table);
      const columns = config.columns.map((column) => {
        let defaultSql = "";
        if (column.name === "id") defaultSql = " primary key default gen_random_uuid()";
        else if (column.name === "created_at" || column.name === "updated_at") defaultSql = " default now()";
        else if (column.name === "revision") defaultSql = " default 1";
        return `"${column.name}" ${column.getSQLType()}${defaultSql}`;
      });
      await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    }
    const db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(analyticsRoutes, { db, prefix: "/analytics" });
    await server.ready();
  }, 120_000);

  beforeEach(async () => {
    await pool.query("TRUNCATE venues, spaces, bookings, opportunities, proposals, enquiries, quotes, revenue_scenarios, comfort_constraints");
    await pool.query(
      "INSERT INTO venues (id, name, slug, address) VALUES ($1, 'Trades Hall Glasgow', 'trades-hall-glasgow', '85 Glassford Street')",
      [VENUE],
    );
    await pool.query(
      "INSERT INTO spaces (id, venue_id, name, sort_order) VALUES ($1, $2, 'Grand Hall', 0)",
      [SPACE, VENUE],
    );
    await pool.query(
      `INSERT INTO opportunities (venue_id, title, stage, estimated_value_minor, currency, next_action)
       VALUES ($1, 'Autumn gala', 'qualified', 250000, 'GBP', 'Follow up')`,
      [VENUE],
    );
  }, 60_000);

  afterAll(async () => {
    if (server !== undefined) await server.close();
    if (pool !== undefined) {
      // Only the random schema created by this invocation is removed.
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
  }, 60_000);

  it("refuses every analytics route without authentication", async () => {
    for (const url of [...PRICED_ROUTES, ROOM_USE_ROUTE]) {
      const res = await server.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(401);
    }
  });

  // Priced payloads: pipeline value, conversion, proposal status counts.
  it.each([
    ["admin", 200],
    ["manager", 200],
    ["staff", 200],
    ["sales", 200],
    // The floor runs the rooms; it does not read the venue's money.
    ["hallkeeper", 403],
    ["planner", 403],
    ["client", 403],
  ] as const)("priced analytics: role %s gets %i", async (role, expected) => {
    for (const url of PRICED_ROUTES) {
      const res = await server.inject({ method: "GET", url, headers: headers(role) });
      expect(res.statusCode, `${role} ${url}`).toBe(expected);
    }
  });

  // Room use carries no money, and the hallkeeper who runs the rooms needs it.
  it.each([
    ["admin", 200],
    ["staff", 200],
    ["hallkeeper", 200],
    ["sales", 403],
    ["planner", 403],
    ["client", 403],
  ] as const)("room utilisation: role %s gets %i", async (role, expected) => {
    const res = await server.inject({ method: "GET", url: ROOM_USE_ROUTE, headers: headers(role) });
    expect(res.statusCode, role).toBe(expected);
  });

  it("keeps the two gates genuinely different", async () => {
    // The regression this split exists to prevent: a role admitted to exactly
    // one of the two. If these ever agree, the gates have collapsed back into
    // a single definition and this suite should be re-read.
    const hallkeeperPriced = await server.inject({
      method: "GET", url: PRICED_ROUTES[0], headers: headers("hallkeeper"),
    });
    const hallkeeperRooms = await server.inject({
      method: "GET", url: ROOM_USE_ROUTE, headers: headers("hallkeeper"),
    });
    expect(hallkeeperPriced.statusCode).toBe(403);
    expect(hallkeeperRooms.statusCode).toBe(200);

    const salesPriced = await server.inject({
      method: "GET", url: PRICED_ROUTES[0], headers: headers("sales"),
    });
    const salesRooms = await server.inject({
      method: "GET", url: ROOM_USE_ROUTE, headers: headers("sales"),
    });
    expect(salesPriced.statusCode).toBe(200);
    expect(salesRooms.statusCode).toBe(403);
  });

  it("holds the venue boundary and still demands a venue of a platform admin", async () => {
    const crossVenue = await server.inject({
      method: "GET", url: `${PRICED_ROUTES[0]}?venueId=${OTHER_VENUE}`, headers: headers("admin"),
    });
    expect(crossVenue.statusCode).toBe(403);

    const adminNoVenue = await server.inject({
      method: "GET", url: PRICED_ROUTES[0], headers: headers("admin", null, "admin"),
    });
    expect(adminNoVenue.statusCode).toBe(400);

    const adminWithVenue = await server.inject({
      method: "GET", url: `${PRICED_ROUTES[0]}?venueId=${VENUE}`, headers: headers("admin", null, "admin"),
    });
    expect(adminWithVenue.statusCode).toBe(200);
  });

  it("serves a venue user with no venue nothing at all", async () => {
    const res = await server.inject({
      method: "GET", url: PRICED_ROUTES[0], headers: headers("staff", null),
    });
    expect(res.statusCode).toBe(403);
  });
});
