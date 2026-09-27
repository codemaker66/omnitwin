import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { pricingRuleRoutes } from "../routes/pricing-rules.js";

// ---------------------------------------------------------------------------
// Undo for a deleted pricing rule, on isolated PostgreSQL.
//
// A delete only marks the rule (deleted_at) and switches it off, so the
// admin panel's Undo puts it back. The WHERE clause is the guarantee: only
// a deleted rule of the URL's venue comes back. A mock cannot prove that.
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
    throw new Error("Pricing rule restore tests require their explicit isolated loopback database");
  }
}

const VENUE = "44444444-4444-4444-8444-444444444444";
const OTHER_VENUE = "44444444-4444-4444-8444-444444444999";
const RULE = "55555555-5555-4555-8555-555555555501";
const OTHER_VENUE_RULE = "55555555-5555-4555-8555-555555555502";
const LIVE_RULE = "55555555-5555-4555-8555-555555555503";

function headers(venueId: string = VENUE): { authorization: string } {
  return {
    authorization: `Bearer ${JSON.stringify({
      id: "66666666-6666-4666-8666-666666666666", email: "admin@example.test",
      role: "admin", platformRole: "none", venueId,
    })}`,
  };
}

describe.skipIf(testUrl === undefined)("pricing rule restore on isolated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const fixtureSchema = `pricing_restore_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [schema.venues, schema.pricingRules];

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
        return `"${column.name}" ${column.getSQLType()}${defaultSql}`;
      });
      await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    }
    const db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(pricingRuleRoutes, { db, prefix: "/venues/:venueId/pricing" });
    await server.ready();
  }, 120_000);

  beforeEach(async () => {
    await pool.query("TRUNCATE venues, pricing_rules");
    await pool.query("INSERT INTO venues (id, name, slug) VALUES ($1, 'Trades Hall', 'trades-hall'), ($2, 'Other venue', 'other-venue')", [VENUE, OTHER_VENUE]);
    const insert = `INSERT INTO pricing_rules (id, venue_id, name, type, amount, currency, is_active, deleted_at)
      VALUES ($1, $2, $3, 'flat_rate', '1500.00', 'GBP', $4, $5)`;
    // Deleted the way the DELETE route leaves a rule: marked and switched off.
    await pool.query(insert, [RULE, VENUE, "Grand Hall hire", false, new Date("2026-09-27T09:00:00Z")]);
    await pool.query(insert, [OTHER_VENUE_RULE, OTHER_VENUE, "Other venue hire", false, new Date("2026-09-27T09:00:00Z")]);
    await pool.query(insert, [LIVE_RULE, VENUE, "Reception hire", true, null]);
  });

  afterAll(async () => {
    await server?.close();
    await pool?.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
    await pool?.end();
  });

  async function row(id: string): Promise<{ readonly deleted_at: Date | null; readonly is_active: boolean }> {
    const result = await pool.query<{ deleted_at: Date | null; is_active: boolean }>(
      "SELECT deleted_at, is_active FROM pricing_rules WHERE id = $1", [id],
    );
    const found = result.rows[0];
    if (found === undefined) throw new Error(`pricing rule ${id} missing`);
    return found;
  }

  it("brings a deleted rule back as it was, and it reads again", async () => {
    const before = await server.inject({ method: "GET", url: `/venues/${VENUE}/pricing/${RULE}` });
    expect(before.statusCode).toBe(404);

    const res = await server.inject({
      method: "POST", url: `/venues/${VENUE}/pricing/${RULE}/restore`,
      headers: headers(), payload: { isActive: true },
    });
    expect(res.statusCode).toBe(200);
    expect(await row(RULE)).toEqual({ deleted_at: null, is_active: true });

    const after = await server.inject({ method: "GET", url: `/venues/${VENUE}/pricing/${RULE}` });
    expect(after.statusCode).toBe(200);
    const list = await server.inject({ method: "GET", url: `/venues/${VENUE}/pricing` });
    const listed = list.json<{ data: { id: string }[] }>().data.map((rule) => rule.id);
    expect([...listed].sort()).toEqual([LIVE_RULE, RULE].sort());
  });

  it("keeps an inactive rule inactive when it comes back", async () => {
    const res = await server.inject({
      method: "POST", url: `/venues/${VENUE}/pricing/${RULE}/restore`,
      headers: headers(), payload: { isActive: false },
    });
    expect(res.statusCode).toBe(200);
    expect(await row(RULE)).toEqual({ deleted_at: null, is_active: false });
  });

  it("does not restore another venue's rule through this venue's URL", async () => {
    const res = await server.inject({
      method: "POST", url: `/venues/${VENUE}/pricing/${OTHER_VENUE_RULE}/restore`,
      headers: headers(), payload: {},
    });
    expect(res.statusCode).toBe(404);
    expect((await row(OTHER_VENUE_RULE)).deleted_at).not.toBeNull();
  });

  it("answers 404 for a rule that was never deleted, and leaves it alone", async () => {
    const res = await server.inject({
      method: "POST", url: `/venues/${VENUE}/pricing/${LIVE_RULE}/restore`,
      headers: headers(), payload: { isActive: false },
    });
    expect(res.statusCode).toBe(404);
    expect(await row(LIVE_RULE)).toEqual({ deleted_at: null, is_active: true });
  });
});
