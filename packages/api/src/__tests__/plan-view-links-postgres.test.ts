import Fastify, { type FastifyInstance } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  IssuedPlanViewLinkSchema,
  PLAN_VIEW_LINK_LIMIT,
  PlanViewLinkSchema,
  PlanViewSchema,
  type IssuedPlanViewLink,
} from "@omnitwin/types";
import * as schema from "../db/schema.js";
import type { Database } from "../db/client.js";
import { publicConfigRoutes } from "../routes/public-configs.js";
import { publicPlanViewRoutes } from "../routes/public-plan-views.js";
import { cleanupPreviewConfigurations } from "../services/cleanup.js";
import { migrationText } from "./migration-text.js";
import { pdfPageTexts } from "./support/pdf-text.js";

// ---------------------------------------------------------------------------
// View-only links to a visitor's plan on isolated PostgreSQL (fix-first item
// 11, 16 Oct 2026 brief).
//
// The guarantees live in WHERE clauses, a row lock and the migration's own
// constraints, which a mock cannot prove. The link table is created by the
// real migration SQL. These tests show that a token:
//   * is unguessable, handed over once and stored only as its SHA-256;
//   * shows one plan, without prices, ids or the planner address, and with
//     the provenance line, and names furniture as the planner does;
//   * cannot write, and cannot reach another plan;
//   * stops working when stopped, when it expires, or when its plan is claimed
//     or deleted;
// and that a working link keeps its plan out of the 72-hour sweep while a
// stopped or expired one does not.
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
    throw new Error("View-only link tests require their explicit isolated loopback database");
  }
}

const VENUE = "81111111-1111-4111-8111-111111111111";
const OTHER_VENUE = "81111111-1111-4111-8111-111111111999";
const GRAND_HALL = "82222222-2222-4222-8222-222222222201";
const SALOON = "82222222-2222-4222-8222-222222222202";
const TABLE = "83333333-3333-4333-8333-333333333301";
const LECTERN = "83333333-3333-4333-8333-333333333303";
// The canonical Turini identity: the planner shows it as "Velvet Banquet Chair".
const TURINI = "7f1fb7a2-5210-57b1-9108-11255c059520";
const PLAN = "84444444-4444-4444-8444-444444444401";
const OTHER_PLAN = "84444444-4444-4444-8444-444444444402";
const CLAIMED = "84444444-4444-4444-8444-444444444403";
const DELETED = "84444444-4444-4444-8444-444444444404";
const CROSS_VENUE = "84444444-4444-4444-8444-444444444405";
const OWNER = "85555555-5555-4555-8555-555555555501";
const PLAN_SHORT_CODE = "vw7k2p";
const OTHER_SHORT_CODE = "zw4m9x";
const OUTLINE = JSON.stringify([{ x: -10.5, y: -5 }, { x: 10.5, y: -5 }, { x: 10.5, y: 5 }, { x: -10.5, y: 5 }]);
const DAY_MS = 24 * 60 * 60 * 1000;

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

describe.skipIf(testUrl === undefined)("view-only links on isolated PostgreSQL", () => {
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;
  const fixtureSchema = `plan_view_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [
    schema.venues, schema.spaces, schema.assetDefinitions, schema.configurations, schema.placedObjects,
    schema.enquiries,
  ];

  beforeAll(async () => {
    pool = new Pool({
      connectionString: testUrl, application_name: fixtureSchema, max: 6,
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
    // The link table exactly as the migration makes it: its FK, cascade,
    // uniqueness and checks are part of what is under test.
    for (const statement of (await migrationText("configuration_view_tokens")).split("--> statement-breakpoint")) {
      if (statement.trim() !== "") await pool.query(statement);
    }
    db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(publicConfigRoutes, { db, prefix: "/public" });
    await server.register(publicPlanViewRoutes, { db, prefix: "/public" });
    await server.ready();
  }, 120_000);

  beforeEach(async () => {
    await pool.query("TRUNCATE configuration_view_tokens, enquiries, placed_objects, configurations, asset_definitions, spaces, venues");
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
        ($1, 'Round Table (White Cloth)', 'table', 1.8, 1.8, 0.75, 'cylinder'),
        ($2, 'Burgess Turini 18/3', 'chair', 0.42, 0.58, 0.88, 'box'),
        ($3, 'Lectern', 'lectern', 0.6, 0.5, 1.2, 'box')`,
      [TABLE, TURINI, LECTERN],
    );
    const insertConfig = `INSERT INTO configurations
      (id, space_id, venue_id, user_id, name, is_public_preview, short_code, revision, updated_at, deleted_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 3, now(), $8)`;
    await pool.query(insertConfig, [PLAN, GRAND_HALL, VENUE, null, "Untitled Layout", true, PLAN_SHORT_CODE, null]);
    await pool.query(insertConfig, [OTHER_PLAN, SALOON, OTHER_VENUE, null, "Morrison wedding", true, OTHER_SHORT_CODE, null]);
    await pool.query(insertConfig, [CLAIMED, GRAND_HALL, VENUE, OWNER, "Claimed plan", false, null, null]);
    await pool.query(insertConfig, [DELETED, GRAND_HALL, VENUE, null, "Deleted plan", true, null, new Date()]);
    await pool.query(insertConfig, [CROSS_VENUE, SALOON, VENUE, null, "Cross venue", true, null, null]);

    const insertObject = `INSERT INTO placed_objects
      (id, configuration_id, asset_definition_id, position_x, position_y, position_z, rotation_y, scale)
      VALUES (gen_random_uuid(), $1, $2, $3, 0, $4, 0, 1)`;
    for (const [x, z] of [[-4, -1], [0, -1]] as const) await pool.query(insertObject, [PLAN, TABLE, x, z]);
    for (const [x, z] of [[-4, 0.4], [0, 0.4], [3, 0.4]] as const) await pool.query(insertObject, [PLAN, TURINI, x, z]);
    await pool.query(insertObject, [OTHER_PLAN, LECTERN, 0, -4]);
  });

  afterAll(async () => {
    await server?.close();
    await pool?.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
    await pool?.end();
  });

  async function issue(configId: string): Promise<IssuedPlanViewLink> {
    const res = await server.inject({ method: "POST", url: `/public/configurations/${configId}/view-tokens` });
    expect(res.statusCode).toBe(201);
    return IssuedPlanViewLinkSchema.parse(res.json<{ data: unknown }>().data);
  }

  async function view(token: string) {
    return server.inject({ method: "GET", url: `/public/plan-views/${token}` });
  }

  async function snapshot(): Promise<Record<string, unknown>[][]> {
    return Promise.all([
      "SELECT * FROM configurations ORDER BY id",
      "SELECT * FROM placed_objects ORDER BY configuration_id, position_x, position_z",
      "SELECT * FROM configuration_view_tokens ORDER BY id",
    ].map(async (text) => (await pool.query<Record<string, unknown>>(text)).rows));
  }

  it("hands the token over once, 256 bits, and stores only its SHA-256 and first eight characters", async () => {
    const link = await issue(PLAN);
    expect(Buffer.from(link.token, "base64url")).toHaveLength(32);
    expect(link.prefix).toBe(link.token.slice(0, 8));

    const { rows } = await pool.query<{ token_hash: string; token_prefix: string; configuration_id: string; whole: string; lifetime_ms: string }>(
      `SELECT token_hash, token_prefix, configuration_id, row_to_json(t)::text AS whole,
         (extract(epoch FROM expires_at - created_at) * 1000)::bigint AS lifetime_ms
       FROM configuration_view_tokens t`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).toBe(sha256(link.token));
    expect(rows[0]?.token_prefix).toBe(link.prefix);
    expect(rows[0]?.configuration_id).toBe(PLAN);
    expect(rows[0]?.whole).not.toContain(link.token);
    expect(Number(rows[0]?.lifetime_ms)).toBe(30 * DAY_MS);

    // Listing names the link but never gives the token back.
    const listed = await server.inject({ method: "GET", url: `/public/configurations/${PLAN}/view-tokens` });
    expect(listed.statusCode).toBe(200);
    expect(listed.headers["cache-control"]).toBe("no-store");
    const links = listed.json<{ data: unknown[] }>().data.map((entry) => PlanViewLinkSchema.strict().parse(entry));
    expect(links).toEqual([{ id: link.id, prefix: link.prefix, createdAt: link.createdAt, expiresAt: link.expiresAt }]);
    expect(listed.body).not.toContain(link.token);

    // Two links are two different secrets.
    const second = await issue(PLAN);
    expect(second.token).not.toBe(link.token);
  });

  it("shows the plan with the provenance line, the planner's names, and no prices, ids or address", async () => {
    const link = await issue(PLAN);
    const res = await view(link.token);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    const plan = PlanViewSchema.parse(res.json<{ data: unknown }>().data);
    expect(plan).toMatchObject({
      venueName: "Trades Hall Glasgow",
      roomName: "Grand Hall",
      planName: null,
      provenance: "Drawn by a visitor; not reviewed by the venue.",
      linkExpiresAt: link.expiresAt,
    });
    expect(plan.items).toEqual([
      { name: "Round Table (White Cloth)", category: "table", count: 2 },
      { name: "Velvet Banquet Chair", category: "chair", count: 3 },
    ]);
    expect(plan.objects).toHaveLength(5);
    for (const secret of [PLAN, PLAN_SHORT_CODE, "/plan/", TABLE, TURINI, "Burgess Turini"]) {
      expect(res.body).not.toContain(secret);
    }
    expect(res.body).not.toMatch(/£|\bGBP\b|price|per cover/iu);
  });

  it("gives the recipient the same one-page PDF, naming chairs as the planner does", async () => {
    const link = await issue(PLAN);
    const res = await server.inject({ method: "GET", url: `/public/plan-views/${link.token}/plan.pdf` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="Grand Hall plan.pdf"');
    const raw = res.rawPayload.toString("latin1");
    const text = pdfPageTexts(res.rawPayload).join("\n");
    expect(text).toContain("Drawn by a visitor; not reviewed by the venue.");
    expect(text).toMatch(/3\nVelvet Banquet Chair/u);
    expect(text).not.toContain("Turini");
    for (const secret of [PLAN, PLAN_SHORT_CODE, link.token]) expect(raw).not.toContain(secret);

    // The organiser's own PDF names them the same way.
    const own = await server.inject({ method: "GET", url: `/public/configurations/${PLAN}/plan.pdf` });
    const ownText = pdfPageTexts(own.rawPayload).join("\n");
    expect(ownText).toMatch(/3\nVelvet Banquet Chair/u);
    expect(ownText).not.toContain("Turini");
  });

  it("cannot write: no write verb answers under the token, no plan route takes it, and reading changes nothing", async () => {
    const link = await issue(PLAN);
    const before = await snapshot();

    expect((await view(link.token)).statusCode).toBe(200);
    expect((await server.inject({ method: "GET", url: `/public/plan-views/${link.token}/plan.pdf` })).statusCode).toBe(200);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      for (const url of [`/public/plan-views/${link.token}`, `/public/plan-views/${link.token}/plan.pdf`]) {
        const res = await server.inject({ method, url, payload: { expectedRevision: 3, objects: [] } });
        expect(res.statusCode, `${method} ${url}`).toBe(404);
      }
    }
    // Every route that acts on a plan demands its id; the token is not one.
    const asPlanId: readonly { method: "GET" | "POST"; url: string; payload?: Record<string, unknown> }[] = [
      { method: "POST", url: `/public/configurations/${link.token}/objects/batch`, payload: { expectedRevision: 3, objects: [] } },
      { method: "POST", url: `/public/configurations/${link.token}/thumbnail`, payload: { thumbnailUrl: "data:image/png;base64,AAAA" } },
      { method: "GET", url: `/public/configurations/${link.token}` },
      { method: "GET", url: `/public/configurations/${link.token}/plan.pdf` },
      { method: "POST", url: `/public/configurations/${link.token}/view-tokens` },
      { method: "GET", url: `/public/configurations/${link.token}/view-tokens` },
      { method: "POST", url: `/public/configurations/${link.token}/view-tokens/${link.id}/revoke` },
    ];
    for (const attempt of asPlanId) {
      const res = await server.inject(attempt);
      expect(res.statusCode, `${attempt.method} ${attempt.url}`).toBe(400);
    }

    expect(await snapshot()).toEqual(before);
  });

  it("cannot reach another plan: each token shows its own, and one plan's id cannot stop another's link", async () => {
    const mine = await issue(PLAN);
    const theirs = await issue(OTHER_PLAN);

    const mineView = PlanViewSchema.parse((await view(mine.token)).json<{ data: unknown }>().data);
    const theirView = PlanViewSchema.parse((await view(theirs.token)).json<{ data: unknown }>().data);
    expect(mineView.roomName).toBe("Grand Hall");
    expect(mineView.items.map((item) => item.name)).not.toContain("Lectern");
    expect(theirView).toMatchObject({ roomName: "Saloon", venueName: "Other Venue", planName: "Morrison wedding" });
    expect(theirView.items).toEqual([{ name: "Lectern", category: "lectern", count: 1 }]);
    expect((await view(theirs.token)).body).not.toContain(OTHER_PLAN);

    const crossed = await server.inject({ method: "POST", url: `/public/configurations/${OTHER_PLAN}/view-tokens/${mine.id}/revoke` });
    expect(crossed.statusCode).toBe(404);
    expect((await view(mine.token)).statusCode).toBe(200);

    const theirList = await server.inject({ method: "GET", url: `/public/configurations/${OTHER_PLAN}/view-tokens` });
    expect(theirList.json<{ data: { id: string }[] }>().data.map((entry) => entry.id)).toEqual([theirs.id]);
  });

  it("stops working when the organiser stops it, and stopping again keeps the first time", async () => {
    const link = await issue(PLAN);
    const stop = await server.inject({ method: "POST", url: `/public/configurations/${PLAN}/view-tokens/${link.id}/revoke` });
    expect(stop.statusCode).toBe(204);

    const res = await view(link.token);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "This view-only link is not working", code: "VIEW_LINK_NOT_FOUND" });
    expect((await server.inject({ method: "GET", url: `/public/plan-views/${link.token}/plan.pdf` })).statusCode).toBe(404);
    const listed = await server.inject({ method: "GET", url: `/public/configurations/${PLAN}/view-tokens` });
    expect(listed.json<{ data: unknown[] }>().data).toEqual([]);

    const first = (await pool.query<{ revoked_at: Date }>("SELECT revoked_at FROM configuration_view_tokens")).rows[0]?.revoked_at;
    expect(first).toBeInstanceOf(Date);
    const again = await server.inject({ method: "POST", url: `/public/configurations/${PLAN}/view-tokens/${link.id}/revoke` });
    expect(again.statusCode).toBe(204);
    const kept = (await pool.query<{ revoked_at: Date }>("SELECT revoked_at FROM configuration_view_tokens")).rows[0]?.revoked_at;
    expect(kept?.toISOString()).toBe(first?.toISOString());
  });

  it("stops working when it expires", async () => {
    const link = await issue(PLAN);
    await pool.query(
      `UPDATE configuration_view_tokens
         SET created_at = now() - interval '31 days', expires_at = now() - interval '1 second'
       WHERE id = $1`,
      [link.id],
    );
    expect((await view(link.token)).statusCode).toBe(404);
    const listed = await server.inject({ method: "GET", url: `/public/configurations/${PLAN}/view-tokens` });
    expect(listed.json<{ data: unknown[] }>().data).toEqual([]);
  });

  it("stops working once its plan is claimed or deleted", async () => {
    const claimed = await issue(PLAN);
    await pool.query("UPDATE configurations SET is_public_preview = false, user_id = $2 WHERE id = $1", [PLAN, OWNER]);
    expect((await view(claimed.token)).statusCode).toBe(404);

    const deleted = await issue(OTHER_PLAN);
    await pool.query("UPDATE configurations SET deleted_at = now() WHERE id = $1", [OTHER_PLAN]);
    expect((await view(deleted.token)).statusCode).toBe(404);
  });

  it.each([
    ["a claimed (private) plan", CLAIMED],
    ["a deleted plan", DELETED],
    ["a plan whose room belongs to another venue", CROSS_VENUE],
    ["an id that was never issued", "84444444-4444-4444-8444-444444444499"],
  ])("makes, lists and stops no link for %s", async (_label, configId) => {
    const made = await server.inject({ method: "POST", url: `/public/configurations/${configId}/view-tokens` });
    expect(made.statusCode).toBe(404);
    expect(made.json()).toEqual({ error: "Public preview configuration not found", code: "NOT_FOUND" });
    expect((await pool.query("SELECT 1 FROM configuration_view_tokens")).rowCount).toBe(0);
    if (configId !== CROSS_VENUE) {
      const listed = await server.inject({ method: "GET", url: `/public/configurations/${configId}/view-tokens` });
      expect(listed.statusCode).toBe(404);
    }
  });

  it("answers a malformed, unknown or guessed token with the same 404", async () => {
    const link = await issue(PLAN);
    const unknown = `${link.token.slice(0, 42)}${link.token.endsWith("A") ? "B" : "A"}`;
    for (const token of ["not-a-token", unknown, link.prefix, sha256(link.token)]) {
      const res = await view(token);
      expect(res.statusCode, token).toBe(404);
      expect(res.json()).toEqual({ error: "This view-only link is not working", code: "VIEW_LINK_NOT_FOUND" });
    }
  });

  it(`keeps at most ${String(PLAN_VIEW_LINK_LIMIT)} working links, even when asked at once, and stopping one frees a place`, async () => {
    const attempts = await Promise.all(Array.from({ length: PLAN_VIEW_LINK_LIMIT + 2 }, () =>
      server.inject({ method: "POST", url: `/public/configurations/${PLAN}/view-tokens` })));
    const made = attempts.filter((res) => res.statusCode === 201);
    const refused = attempts.filter((res) => res.statusCode === 409);
    expect(made).toHaveLength(PLAN_VIEW_LINK_LIMIT);
    expect(refused).toHaveLength(2);
    expect(refused[0]?.json()).toMatchObject({ code: "VIEW_LINK_LIMIT", details: { limit: PLAN_VIEW_LINK_LIMIT } });

    const first = IssuedPlanViewLinkSchema.parse(made[0]?.json<{ data: unknown }>().data);
    await server.inject({ method: "POST", url: `/public/configurations/${PLAN}/view-tokens/${first.id}/revoke` });
    await issue(PLAN);
    // A stopped link does not count; another plan's links never did.
    await issue(OTHER_PLAN);
  });

  it("holds the migration's own guarantees: one row per hash, hex hashes only, expiry after creation, gone with its plan", async () => {
    const link = await issue(PLAN);
    const insert = `INSERT INTO configuration_view_tokens (configuration_id, token_prefix, token_hash, expires_at)
      VALUES ($1, 'abcdefgh', $2, now() + interval '1 day')`;
    await expect(pool.query(insert, [OTHER_PLAN, sha256(link.token)])).rejects.toMatchObject({ code: "23505" });
    await expect(pool.query(insert, [OTHER_PLAN, "not-a-sha256"])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(
      `INSERT INTO configuration_view_tokens (configuration_id, token_prefix, token_hash, expires_at)
        VALUES ($1, 'abcdefgh', $2, now() - interval '1 day')`,
      [OTHER_PLAN, sha256("another")],
    )).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(insert, [randomUUID(), sha256("orphan")])).rejects.toMatchObject({ code: "23503" });

    await pool.query("DELETE FROM configurations WHERE id = $1", [PLAN]);
    expect((await pool.query("SELECT 1 FROM configuration_view_tokens")).rowCount).toBe(0);
  });

  it("spares a plan with a working link from the 72-hour sweep, and not one whose link was stopped or ran out", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 4 * DAY_MS);
    const plans = {
      working: randomUUID(), stopped: randomUUID(), expired: randomUUID(),
      noLink: randomUUID(), enquiry: randomUUID(), recent: randomUUID(),
    } as const;
    for (const [label, id] of Object.entries(plans)) {
      await pool.query(
        `INSERT INTO configurations (id, space_id, venue_id, user_id, name, is_public_preview, revision, created_at, updated_at)
          VALUES ($1, $2, $3, null, $4, true, 1, $5, $5)`,
        [id, GRAND_HALL, VENUE, label, label === "recent" ? new Date(now.getTime() - 60 * 60 * 1000) : old],
      );
    }
    const linkRow = `INSERT INTO configuration_view_tokens (configuration_id, token_prefix, token_hash, created_at, expires_at, revoked_at)
      VALUES ($1, 'abcdefgh', $2, $3, $4, $5)`;
    await pool.query(linkRow, [plans.working, sha256("working"), old, new Date(now.getTime() + 26 * DAY_MS), null]);
    await pool.query(linkRow, [plans.stopped, sha256("stopped"), old, new Date(now.getTime() + 26 * DAY_MS), new Date(now.getTime() - DAY_MS)]);
    await pool.query(linkRow, [plans.expired, sha256("expired"), new Date(now.getTime() - 40 * DAY_MS), new Date(now.getTime() - 10 * DAY_MS), null]);
    await pool.query(
      "INSERT INTO enquiries (id, venue_id, space_id, configuration_id, name, email, state) VALUES (gen_random_uuid(), $1, $2, $3, 'Guest', 'guest@example.test', 'submitted')",
      [VENUE, GRAND_HALL, plans.enquiry],
    );

    const removed = await cleanupPreviewConfigurations(db, now);

    const left = new Set((await pool.query<{ id: string }>("SELECT id FROM configurations")).rows.map((row) => row.id));
    expect(left.has(plans.working)).toBe(true);
    expect(left.has(plans.enquiry)).toBe(true);
    expect(left.has(plans.recent)).toBe(true);
    expect(left.has(plans.stopped)).toBe(false);
    expect(left.has(plans.expired)).toBe(false);
    expect(left.has(plans.noLink)).toBe(false);
    // The fixture plans were made just now, so only the three are swept.
    expect(removed).toBe(3);
    const links = (await pool.query<{ configuration_id: string }>("SELECT configuration_id FROM configuration_view_tokens")).rows;
    expect(links.map((row) => row.configuration_id)).toEqual([plans.working]);
  });
});
