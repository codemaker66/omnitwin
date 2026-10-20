import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { publicConfigRoutes } from "../routes/public-configs.js";
import { pdfPageTexts } from "./support/pdf-text.js";

// ---------------------------------------------------------------------------
// GET /public/configurations/:configId/plan.pdf on isolated PostgreSQL
// (fix-first item 11: an organiser's hand-off without an account).
//
// The route's guarantees live in its WHERE clauses, which a mock cannot
// prove: only a live public preview is drawn; a claimed, deleted or
// cross-venue plan answers the same bare 404; one plan's PDF never carries
// another plan's furniture, room, id or short code; and asking for a PDF
// writes nothing.
//
// Opt-in, isolated PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const testUrl = process.env["VENVIEWER_VISITOR_PLAN_TEST_DATABASE_URL"];
if (testUrl !== undefined) {
  const parsed = new URL(testUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1" || parsed.port !== "55417"
    || parsed.pathname !== "/venviewer_visitor_plan_test"
    || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Visitor plan PDF tests require their explicit isolated loopback database");
  }
}

const VENUE = "71111111-1111-4111-8111-111111111111";
const OTHER_VENUE = "71111111-1111-4111-8111-111111111999";
const GRAND_HALL = "72222222-2222-4222-8222-222222222201";
const SALOON = "72222222-2222-4222-8222-222222222202";
const TABLE = "73333333-3333-4333-8333-333333333301";
const CHAIR = "73333333-3333-4333-8333-333333333302";
const LECTERN = "73333333-3333-4333-8333-333333333303";
const PLAN = "74444444-4444-4444-8444-444444444401";
const OTHER_PLAN = "74444444-4444-4444-8444-444444444402";
const CLAIMED = "74444444-4444-4444-8444-444444444403";
const DELETED = "74444444-4444-4444-8444-444444444404";
const CROSS_VENUE = "74444444-4444-4444-8444-444444444405";
const OWNER = "75555555-5555-4555-8555-555555555501";
const PLAN_SHORT_CODE = "vq7k2p";
const OTHER_SHORT_CODE = "zt4m9x";
const CHANGED_AT = new Date("2026-10-17T13:02:00.000Z");
const OUTLINE = JSON.stringify([{ x: -10.5, y: -5 }, { x: 10.5, y: -5 }, { x: 10.5, y: 5 }, { x: -10.5, y: 5 }]);

describe.skipIf(testUrl === undefined)("visitor plan PDF on isolated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const fixtureSchema = `visitor_plan_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [
    schema.venues, schema.spaces, schema.assetDefinitions, schema.configurations, schema.placedObjects,
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
        return `"${column.name}" ${column.getSQLType()}${defaultSql}`;
      });
      await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    }
    const db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(publicConfigRoutes, { db, prefix: "/public" });
    await server.ready();
  }, 120_000);

  beforeEach(async () => {
    await pool.query("TRUNCATE venues, spaces, asset_definitions, configurations, placed_objects");
    await pool.query(
      `INSERT INTO venues (id, name, slug, address, timezone) VALUES
        ($1, 'Trades Hall Glasgow', 'trades-hall-glasgow', '85 Glassford Street, Glasgow G1 1UH', 'Europe/London'),
        ($2, 'Other Venue', 'other-venue', '1 Elsewhere Road', 'Europe/London')`,
      [VENUE, OTHER_VENUE],
    );
    await pool.query(
      `INSERT INTO spaces (id, venue_id, name, slug, floor_plan_outline) VALUES
        ($1, $3, 'Grand Hall', 'grand-hall', $5::jsonb),
        ($2, $4, 'Saloon', 'saloon', $5::jsonb)`,
      [GRAND_HALL, SALOON, VENUE, OTHER_VENUE, OUTLINE],
    );
    await pool.query(
      `INSERT INTO asset_definitions (id, name, category, width_m, depth_m, height_m, collision_type) VALUES
        ($1, 'Round table 1.8 m', 'table', 1.8, 1.8, 0.75, 'cylinder'),
        ($2, 'Banquet chair', 'chair', 0.45, 0.45, 0.9, 'box'),
        ($3, 'Lectern', 'lectern', 0.6, 0.5, 1.2, 'box')`,
      [TABLE, CHAIR, LECTERN],
    );
    const insertConfig = `INSERT INTO configurations
      (id, space_id, venue_id, user_id, name, is_public_preview, short_code, revision, updated_at, deleted_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 3, $8, $9)`;
    await pool.query(insertConfig, [PLAN, GRAND_HALL, VENUE, null, "Untitled Layout", true, PLAN_SHORT_CODE, CHANGED_AT, null]);
    await pool.query(insertConfig, [OTHER_PLAN, SALOON, OTHER_VENUE, null, "Morrison wedding", true, OTHER_SHORT_CODE, CHANGED_AT, null]);
    await pool.query(insertConfig, [CLAIMED, GRAND_HALL, VENUE, OWNER, "Claimed plan", false, null, CHANGED_AT, null]);
    await pool.query(insertConfig, [DELETED, GRAND_HALL, VENUE, null, "Deleted plan", true, null, CHANGED_AT, CHANGED_AT]);
    // A guest plan whose room belongs to a different venue: never drawn.
    await pool.query(insertConfig, [CROSS_VENUE, SALOON, VENUE, null, "Cross venue", true, null, CHANGED_AT, null]);

    const insertObject = `INSERT INTO placed_objects
      (id, configuration_id, asset_definition_id, position_x, position_y, position_z, rotation_y, scale)
      VALUES (gen_random_uuid(), $1, $2, $3, 0, $4, 0, 1)`;
    for (const [x, z] of [[-4, -1], [0, -1]] as const) await pool.query(insertObject, [PLAN, TABLE, x, z]);
    for (const [x, z] of [[-4, 0.4], [0, 0.4], [3, 0.4]] as const) await pool.query(insertObject, [PLAN, CHAIR, x, z]);
    await pool.query(insertObject, [OTHER_PLAN, LECTERN, 0, -4]);
    for (const config of [CLAIMED, DELETED, CROSS_VENUE]) await pool.query(insertObject, [config, LECTERN, 1, 1]);
  });

  afterAll(async () => {
    await server?.close();
    await pool?.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
    await pool?.end();
  });

  async function pdfOf(configId: string): Promise<{ readonly raw: string; readonly text: string; readonly headers: Record<string, unknown> }> {
    const res = await server.inject({ method: "GET", url: `/public/configurations/${configId}/plan.pdf` });
    expect(res.statusCode).toBe(200);
    const buf = res.rawPayload;
    return { raw: buf.toString("latin1"), text: pdfPageTexts(buf).join("\n"), headers: res.headers };
  }

  it("draws a guest plan as a download-only PDF with no account", async () => {
    const { text, headers } = await pdfOf(PLAN);
    expect(headers["content-type"]).toBe("application/pdf");
    expect(headers["content-disposition"]).toBe('attachment; filename="Grand Hall plan.pdf"');
    expect(headers["cache-control"]).toBe("no-store");
    expect(text).toContain("Drawn by a visitor; not reviewed by the venue.");
    expect(text).toContain("Last changed 17 October 2026, 14:02.");
    expect(text).toContain("Grand Hall");
    expect(text).toMatch(/2\nRound table 1\.8 m/u);
    expect(text).toMatch(/3\nBanquet chair/u);
    // The planner's default name says nothing to a reader.
    expect(text).not.toContain("Untitled Layout");
  });

  it("never carries the plan's id or short code, the edit capability of a guest plan", async () => {
    const { raw, text } = await pdfOf(PLAN);
    for (const secret of [PLAN, PLAN_SHORT_CODE, `/plan/${PLAN_SHORT_CODE}`]) {
      expect(raw).not.toContain(secret);
      expect(text).not.toContain(secret);
    }
  });

  it("shows no prices", async () => {
    const { text } = await pdfOf(PLAN);
    expect(text).not.toMatch(/£|\bGBP\b|per cover|total estimate/iu);
  });

  it("keeps each plan to itself: no other plan's room, furniture, id or code", async () => {
    const mine = await pdfOf(PLAN);
    expect(mine.text).not.toContain("Lectern");
    expect(mine.text).not.toContain("Saloon");
    expect(mine.text).not.toContain("Other Venue");
    for (const secret of [OTHER_PLAN, OTHER_SHORT_CODE]) expect(mine.raw).not.toContain(secret);

    const theirs = await pdfOf(OTHER_PLAN);
    expect(theirs.text).toContain("Saloon");
    expect(theirs.text).toContain("Morrison wedding");
    expect(theirs.text).toMatch(/1\nLectern/u);
    expect(theirs.text).not.toContain("Banquet chair");
    expect(theirs.text).not.toContain("Grand Hall");
    for (const secret of [PLAN, PLAN_SHORT_CODE, OTHER_PLAN, OTHER_SHORT_CODE]) expect(theirs.raw).not.toContain(secret);
  });

  it.each([
    ["a claimed (private) plan", CLAIMED],
    ["a deleted plan", DELETED],
    ["a plan whose room belongs to another venue", CROSS_VENUE],
    ["an id that was never issued", "74444444-4444-4444-8444-444444444499"],
  ])("answers the same bare 404 for %s", async (_label, configId) => {
    const res = await server.inject({ method: "GET", url: `/public/configurations/${configId}/plan.pdf` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Public preview configuration not found", code: "NOT_FOUND" });
  });

  it("refuses a malformed id before touching the database", async () => {
    const res = await server.inject({ method: "GET", url: "/public/configurations/not-a-uuid/plan.pdf" });
    expect(res.statusCode).toBe(400);
  });

  it("writes nothing: no revision, timestamp or furniture changes, and no write verb exists", async () => {
    const before = await pool.query("SELECT id, revision, updated_at, name FROM configurations ORDER BY id");
    const objectsBefore = await pool.query("SELECT * FROM placed_objects ORDER BY configuration_id, position_x");
    await pdfOf(PLAN);
    await pdfOf(OTHER_PLAN);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const res = await server.inject({ method, url: `/public/configurations/${PLAN}/plan.pdf`, payload: { objects: [] } });
      expect(res.statusCode).toBe(404);
    }
    expect((await pool.query("SELECT id, revision, updated_at, name FROM configurations ORDER BY id")).rows).toEqual(before.rows);
    expect((await pool.query("SELECT * FROM placed_objects ORDER BY configuration_id, position_x")).rows).toEqual(objectsBefore.rows);
  });
});
