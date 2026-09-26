import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TurnaroundRuleSettingSchema, TurnaroundRulesResponseSchema, type TurnaroundRuleSetting } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { turnaroundRuleRoutes, turnaroundRuleName } from "../routes/turnaround-rules.js";

// ---------------------------------------------------------------------------
// Turnaround rules staff can set (T-637, slice A), against a real database:
// who may read and write them, rooms held to their venue, one live rule per
// room and event type, a stale edit refused rather than overwriting a newer
// one, and a seeded demo value that reads "Not confirmed" until kept.
//
// Opt-in, isolated PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
const testUrl = process.env["VENVIEWER_ROUTE_TEST_DATABASE_URL"];
if (testUrl !== undefined) {
  const parsed = new URL(testUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1" || parsed.port !== "55476"
    || parsed.pathname !== "/venviewer_route_atomicity_test"
    || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Turnaround rule tests require their explicit isolated loopback database");
  }
}

describe("turnaroundRuleName", () => {
  it("names a rule by its scope", () => {
    expect(turnaroundRuleName(null, null)).toBe("All rooms");
    expect(turnaroundRuleName("Grand Hall", null)).toBe("Grand Hall");
    expect(turnaroundRuleName("Grand Hall", "wedding")).toBe("Grand Hall, wedding");
  });
});

const VENUE = "71111111-1111-4111-8111-111111111111";
const OTHER_VENUE = "72222222-2222-4222-8222-222222222222";
const HALL = "73333333-3333-4333-8333-333333333333";
const SALOON = "74444444-4444-4444-8444-444444444444";
const FOREIGN_ROOM = "75555555-5555-4555-8555-555555555555";
const STAFF_ID = "76666666-6666-4666-8666-666666666666";

describe.skipIf(testUrl === undefined)("turnaround rules on isolated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const fixtureSchema = `turnaround_rules_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [schema.venues, schema.spaces, schema.users, schema.turnaroundRules, schema.bookings, schema.events];

  function as(role: string, venueId: string | null = VENUE, id = STAFF_ID): { authorization: string } {
    return { authorization: `Bearer ${JSON.stringify({ id, email: `${role}@example.test`, name: role, role, venueId })}` };
  }

  async function list(role = "staff"): Promise<{ statusCode: number; body: ReturnType<typeof TurnaroundRulesResponseSchema.parse> | null }> {
    const res = await server.inject({ method: "GET", url: `/venues/${VENUE}/turnaround-rules`, headers: as(role) });
    return {
      statusCode: res.statusCode,
      body: res.statusCode === 200 ? TurnaroundRulesResponseSchema.parse((JSON.parse(res.body) as { data: unknown }).data) : null,
    };
  }

  async function create(body: Record<string, unknown>, role = "staff"): Promise<{ statusCode: number; code?: string; rule?: TurnaroundRuleSetting }> {
    const res = await server.inject({ method: "POST", url: `/venues/${VENUE}/turnaround-rules`, headers: as(role), payload: body });
    // A refusal carries the rule as it stands in `details`, where the web
    // client's ApiError keeps it.
    const parsed = JSON.parse(res.body) as { code?: string; data?: unknown; details?: unknown };
    const rule = res.statusCode === 409 ? parsed.details : parsed.data;
    return { statusCode: res.statusCode, code: parsed.code, rule: rule === undefined ? undefined : TurnaroundRuleSettingSchema.parse(rule) };
  }

  async function update(id: string, body: Record<string, unknown>, role = "staff"): Promise<{ statusCode: number; code?: string; rule?: TurnaroundRuleSetting }> {
    const res = await server.inject({ method: "PATCH", url: `/venues/${VENUE}/turnaround-rules/${id}`, headers: as(role), payload: body });
    // A refusal carries the rule as it stands in `details`, where the web
    // client's ApiError keeps it.
    const parsed = JSON.parse(res.body) as { code?: string; data?: unknown; details?: unknown };
    const rule = res.statusCode === 409 ? parsed.details : parsed.data;
    return { statusCode: res.statusCode, code: parsed.code, rule: rule === undefined ? undefined : TurnaroundRuleSettingSchema.parse(rule) };
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: testUrl, application_name: fixtureSchema, max: 4, options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    for (const table of tables) {
      const config = getTableConfig(table);
      const columns = config.columns.map((column) => {
        let defaultSql = "";
        if (column.name === "id") defaultSql = " primary key default gen_random_uuid()";
        else if (column.name === "created_at" || column.name === "updated_at") defaultSql = " default now()";
        else if (column.name === "is_active") defaultSql = " default true";
        return `"${column.name}" ${column.getSQLType()}${defaultSql}`;
      });
      await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    }
    // The live-rule uniqueness exactly as migration 0076 adds it.
    await pool.query(`CREATE UNIQUE INDEX "turnaround_rules_one_live_rule" ON "turnaround_rules" (
      "venue_id", COALESCE("space_id", '00000000-0000-0000-0000-000000000000'::uuid), COALESCE("event_type", ''))
      WHERE "is_active" AND "deleted_at" IS NULL`);

    const db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(turnaroundRuleRoutes, { db, prefix: "/venues/:venueId/turnaround-rules" });
    await server.ready();
  }, 120_000);

  beforeEach(async () => {
    await pool.query("TRUNCATE venues, spaces, users, turnaround_rules, bookings, events");
    await pool.query("INSERT INTO venues (id, name, slug, address) VALUES ($1, 'Trades Hall Glasgow', 'trades-hall-glasgow', '85 Glassford Street'), ($2, 'Elsewhere', 'elsewhere', '1 Road')", [VENUE, OTHER_VENUE]);
    await pool.query(`INSERT INTO spaces (id, venue_id, name, sort_order) VALUES ($1, $3, 'Grand Hall', 0), ($2, $3, 'Saloon', 1), ($4, $5, 'Their Hall', 0)`,
      [HALL, SALOON, VENUE, FOREIGN_ROOM, OTHER_VENUE]);
    await pool.query("INSERT INTO users (id, email, name, role, venue_id) VALUES ($1, 'elaine@example.test', 'Elaine MacGregor', 'staff', $2)", [STAFF_ID, VENUE]);
    // The seed's demo values: nobody has confirmed them, and their timestamps
    // carry microseconds, as the database's own now() writes them.
    await pool.query(`INSERT INTO turnaround_rules (venue_id, space_id, event_type, name, minutes) VALUES
      ($1, NULL, NULL, 'House default turnaround', 90),
      ($1, $2, NULL, 'Grand Hall reset', 120),
      ($1, $2, 'wedding', 'Grand Hall wedding reset', 180)`, [VENUE, HALL]);
    await pool.query("INSERT INTO bookings (venue_id, event_type) VALUES ($1, 'wedding'), ($1, 'wedding'), ($1, 'conference'), ($2, 'gala')", [VENUE, OTHER_VENUE]);
    await pool.query("INSERT INTO events (venue_id, event_type) VALUES ($1, 'conference'), ($1, 'conference'), ($1, 'dinner')", [VENUE]);
  }, 60_000);

  afterAll(async () => {
    if (server !== undefined) await server.close();
    if (pool !== undefined) {
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
  }, 60_000);

  it("lists the live rules, unconfirmed demo values included, with the venue's rooms and event types", async () => {
    const { statusCode, body } = await list();
    expect(statusCode).toBe(200);
    expect(body?.rules.map((rule) => [rule.spaceId, rule.eventType, rule.minutes, rule.confirmedAt])).toEqual([
      [null, null, 90, null], [HALL, null, 120, null], [HALL, "wedding", 180, null],
    ]);
    expect(body?.rooms).toEqual([{ id: HALL, name: "Grand Hall" }, { id: SALOON, name: "Saloon" }]);
    // Most used first across bookings and events; another venue's types never.
    expect(body?.eventTypes).toEqual(["conference", "wedding", "dinner"]);
  });

  it("lets everyone who reads the Diary read the rules, and only the venue's administrators set them", async () => {
    for (const role of ["hallkeeper", "sales", "manager", "admin"]) expect((await list(role)).statusCode, role).toBe(200);
    for (const role of ["caterer", "client", "planner"]) expect((await list(role)).statusCode, role).toBe(403);
    const another = await server.inject({ method: "GET", url: `/venues/${VENUE}/turnaround-rules`, headers: as("staff", OTHER_VENUE) });
    expect(another.statusCode).toBe(403);
    const unauthenticated = await server.inject({ method: "GET", url: `/venues/${VENUE}/turnaround-rules` });
    expect(unauthenticated.statusCode).toBe(401);

    for (const role of ["hallkeeper", "sales"]) {
      expect((await create({ spaceId: SALOON, eventType: null, minutes: 45 }, role)).statusCode, role).toBe(403);
    }
    for (const role of ["staff", "manager", "admin"]) {
      const made = await create({ spaceId: SALOON, eventType: role, minutes: 45 }, role);
      expect(made.statusCode, role).toBe(201);
    }
  });

  it("keeps a demo value as it is, and records who confirmed it", async () => {
    const before = (await list()).body?.rules.find((rule) => rule.spaceId === HALL && rule.eventType === null);
    if (before === undefined) throw new Error("expected the Grand Hall rule");
    const kept = await update(before.id, { minutes: 120, expectedUpdatedAt: before.updatedAt });
    expect(kept.statusCode).toBe(200);
    expect(kept.rule?.minutes).toBe(120);
    expect(kept.rule?.confirmedAt).not.toBeNull();
    expect(kept.rule?.updatedByName).toBe("Elaine MacGregor");
  });

  it("refuses an edit made from a stale copy, and shows what the rule says now", async () => {
    const [rule] = (await list()).body?.rules ?? [];
    if (rule === undefined) throw new Error("expected a rule");
    expect((await update(rule.id, { minutes: 75, expectedUpdatedAt: rule.updatedAt })).statusCode).toBe(200);
    const stale = await update(rule.id, { minutes: 60, expectedUpdatedAt: rule.updatedAt });
    expect(stale.statusCode).toBe(409);
    expect(stale.code).toBe("RULE_CHANGED");
    expect(stale.rule?.minutes).toBe(75);
  });

  it("names a new rule by its scope, holds its room to the venue, and allows one live rule per scope", async () => {
    const made = await create({ spaceId: SALOON, eventType: "wedding", minutes: 150 });
    expect(made.statusCode).toBe(201);
    expect(made.rule?.name).toBe("Saloon, wedding");
    expect(made.rule?.confirmedAt).not.toBeNull();

    expect((await create({ spaceId: FOREIGN_ROOM, eventType: null, minutes: 30 })).statusCode).toBe(404);

    const again = await create({ spaceId: HALL, eventType: "wedding", minutes: 200 });
    expect(again.statusCode).toBe(409);
    expect(again.code).toBe("RULE_EXISTS");
    expect(again.rule?.minutes).toBe(180);
  });

  it("retires a rule, and the scope can then take a new one", async () => {
    const rule = (await list()).body?.rules.find((candidate) => candidate.eventType === "wedding");
    if (rule === undefined) throw new Error("expected the wedding rule");
    const retired = await server.inject({ method: "DELETE", url: `/venues/${VENUE}/turnaround-rules/${rule.id}`, headers: as("staff") });
    expect(retired.statusCode).toBe(204);
    expect((await list()).body?.rules.map((candidate) => candidate.id)).not.toContain(rule.id);
    expect((await create({ spaceId: HALL, eventType: "wedding", minutes: 165 })).statusCode).toBe(201);
    const again = await server.inject({ method: "DELETE", url: `/venues/${VENUE}/turnaround-rules/${rule.id}`, headers: as("staff") });
    expect(again.statusCode).toBe(404);
  });

  it("refuses minutes outside a day, and a rule of another venue", async () => {
    for (const minutes of [-1, 1441, 12.5]) {
      expect((await create({ spaceId: null, eventType: "gala", minutes })).statusCode, String(minutes)).toBe(400);
    }
    const [rule] = (await list()).body?.rules ?? [];
    if (rule === undefined) throw new Error("expected a rule");
    const foreign = await server.inject({
      method: "PATCH", url: `/venues/${OTHER_VENUE}/turnaround-rules/${rule.id}`, headers: as("staff", OTHER_VENUE),
      payload: { minutes: 10, expectedUpdatedAt: rule.updatedAt },
    });
    expect(foreign.statusCode).toBe(404);
  });
});
