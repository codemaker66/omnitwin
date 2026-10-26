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

const ADMIN_ID = "66666666-6666-4666-8666-666666666666";
const STAFF_ID = "66666666-6666-4666-8666-666666666667";

function headers(venueId: string = VENUE, role = "admin", id = ADMIN_ID): { authorization: string } {
  return {
    authorization: `Bearer ${JSON.stringify({
      id, email: `${role}@example.test`, role, platformRole: "none", venueId,
    })}`,
  };
}

describe.skipIf(testUrl === undefined)("pricing rule restore on isolated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const fixtureSchema = `pricing_restore_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [schema.venues, schema.pricingRules, schema.users, schema.generalAuditLog];

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
    await pool.query("TRUNCATE venues, pricing_rules, users, general_audit_log");
    await pool.query(`INSERT INTO users (id, email, name, display_name, role, venue_id)
      VALUES ($1, 'admin@example.test', 'Moira Stewart', NULL, 'admin', $3), ($2, 'staff@example.test', 'Callum Reid', NULL, 'staff', $3)`,
    [ADMIN_ID, STAFF_ID, VENUE]);
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
    // Prices are read by the venue's commercial team; staff reads them here.
    const asStaff = headers(VENUE, "staff", STAFF_ID);
    const before = await server.inject({ method: "GET", url: `/venues/${VENUE}/pricing/${RULE}`, headers: asStaff });
    expect(before.statusCode).toBe(404);

    const res = await server.inject({
      method: "POST", url: `/venues/${VENUE}/pricing/${RULE}/restore`,
      headers: headers(), payload: { isActive: true },
    });
    expect(res.statusCode).toBe(200);
    expect(await row(RULE)).toEqual({ deleted_at: null, is_active: true });

    const after = await server.inject({ method: "GET", url: `/venues/${VENUE}/pricing/${RULE}`, headers: asStaff });
    expect(after.statusCode).toBe(200);
    const list = await server.inject({ method: "GET", url: `/venues/${VENUE}/pricing`, headers: asStaff });
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

  async function auditRows(ruleId: string) {
    return (await pool.query<{ actor_user_id: string; action: string; summary: string; metadata: Record<string, unknown> }>(
      "SELECT actor_user_id, action, summary, metadata FROM general_audit_log WHERE target_type = 'pricing_rule' AND target_id = $1 ORDER BY created_at",
      [ruleId],
    )).rows;
  }

  it("records who brought a rule back, in the same write", async () => {
    const res = await server.inject({
      method: "POST", url: `/venues/${VENUE}/pricing/${RULE}/restore`,
      headers: headers(), payload: { isActive: true },
    });
    expect(res.statusCode).toBe(200);
    const audit = await auditRows(RULE);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_user_id: ADMIN_ID,
      action: "pricing_rule.restored",
      summary: "Brought back \"Grand Hall hire\".",
      metadata: { venueId: VENUE, changedFields: ["isActive", "deletedAt"], after: { isActive: true, deletedAt: null } },
    });
  });

  it("records a price change with the amount before and after, and shows it in the rule's history", async () => {
    const res = await server.inject({
      method: "PATCH", url: `/venues/${VENUE}/pricing/${LIVE_RULE}`,
      headers: headers(), payload: { amount: 1750 },
    });
    expect(res.statusCode).toBe(200);
    const audit = await auditRows(LIVE_RULE);
    expect(audit).toEqual([expect.objectContaining({
      actor_user_id: ADMIN_ID,
      action: "pricing_rule.updated",
      summary: "Changed \"Reception hire\": amount.",
      metadata: { venueId: VENUE, changedFields: ["amount"], before: { amount: "1500.00" }, after: { amount: "1750.00" } },
    })]);

    const history = await server.inject({
      method: "GET", url: `/venues/${VENUE}/pricing/${LIVE_RULE}/history`, headers: headers(VENUE, "staff", STAFF_ID),
    });
    expect(history.statusCode).toBe(200);
    expect(history.json<{ data: unknown[] }>().data).toEqual([
      { action: "updated", at: expect.any(String) as string, by: "Moira Stewart", summary: "Changed \"Reception hire\": amount." },
    ]);
  });

  // zod 4 applies a default inside .partial(): an update schema made from the
  // create one would send currency GBP and isActive true with every patch.
  it("leaves the currency and the switch of a paused rule as stored when a patch does not send them", async () => {
    const PAUSED_RULE = "55555555-5555-4555-8555-555555555504";
    await pool.query(`INSERT INTO pricing_rules (id, venue_id, name, type, amount, currency, is_active, deleted_at)
      VALUES ($1, $2, 'Saloon hire', 'flat_rate', '900.00', 'EUR', false, NULL)`, [PAUSED_RULE, VENUE]);
    const res = await server.inject({
      method: "PATCH", url: `/venues/${VENUE}/pricing/${PAUSED_RULE}`,
      headers: headers(), payload: { amount: 950 },
    });
    expect(res.statusCode).toBe(200);
    const stored = await pool.query<{ currency: string; is_active: boolean; amount: string }>(
      "SELECT currency, is_active, amount FROM pricing_rules WHERE id = $1", [PAUSED_RULE],
    );
    expect(stored.rows[0]).toEqual({ currency: "EUR", is_active: false, amount: "950.00" });
    expect((await auditRows(PAUSED_RULE)).map((entry) => entry.metadata)).toEqual([
      expect.objectContaining({ changedFields: ["amount"] }),
    ]);
  });

  it("records a create and a delete", async () => {
    const created = await server.inject({
      method: "POST", url: `/venues/${VENUE}/pricing`,
      headers: headers(), payload: { name: "Saloon hire", type: "flat_rate", amount: 900 },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ data: { id: string } }>().data.id;
    const deleted = await server.inject({ method: "DELETE", url: `/venues/${VENUE}/pricing/${id}`, headers: headers() });
    expect(deleted.statusCode).toBe(204);
    expect((await auditRows(id)).map((entry) => entry.action)).toEqual(["pricing_rule.created", "pricing_rule.deleted"]);
  });

  it("refuses venue staff a price change and leaves the rule and the record untouched", async () => {
    const res = await server.inject({
      method: "PATCH", url: `/venues/${VENUE}/pricing/${LIVE_RULE}`,
      headers: headers(VENUE, "staff", STAFF_ID), payload: { amount: 1 },
    });
    expect(res.statusCode).toBe(403);
    const amount = await pool.query<{ amount: string }>("SELECT amount FROM pricing_rules WHERE id = $1", [LIVE_RULE]);
    expect(amount.rows[0]?.amount).toBe("1500.00");
    expect(await auditRows(LIVE_RULE)).toEqual([]);
  });

  it("does not show another venue's rule history", async () => {
    const res = await server.inject({
      method: "GET", url: `/venues/${VENUE}/pricing/${OTHER_VENUE_RULE}/history`, headers: headers(),
    });
    expect(res.statusCode).toBe(404);
  });
});
