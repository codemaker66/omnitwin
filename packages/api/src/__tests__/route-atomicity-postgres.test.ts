import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { claimConfigRoutes } from "../routes/claim-config.js";
import { publicConfigRoutes } from "../routes/public-configs.js";
import { quoteRoutes } from "../routes/quotes.js";
import { proposalRoutes } from "../routes/proposals.js";

// Opt-in, isolated PostgreSQL only. Never consult DATABASE_URL or load .env.
// This fixture exercises real row locks/rollback and the actual route handlers;
// it is deliberately not a full migration or foreign-key qualification suite.
const testUrl = process.env["VENVIEWER_ROUTE_TEST_DATABASE_URL"];
if (testUrl !== undefined) {
  const parsed = new URL(testUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1" || parsed.port !== "55476"
    || parsed.pathname !== "/venviewer_route_atomicity_test"
    || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Route atomicity tests require their explicit isolated loopback database");
  }
}

const CONFIG = "11111111-1111-4111-8111-111111111111";
const VENUE = "22222222-2222-4222-8222-222222222222";
const USER_A = "33333333-3333-4333-8333-333333333333";
const USER_B = "44444444-4444-4444-8444-444444444444";
const QUOTE = "55555555-5555-4555-8555-555555555555";
const PROPOSAL = "66666666-6666-4666-8666-666666666666";

function headers(id = USER_A, platformRole: "none" | "admin" = "none"): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify({ id, email: "fixture@example.test", role: "staff", platformRole, venueId: VENUE })}` };
}

describe.skipIf(testUrl === undefined)("route atomicity on isolated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const fixtureSchema = `route_atomicity_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [schema.configurations, schema.enquiries, schema.quotes,
    schema.quoteLineItems, schema.proposals, schema.proposalVersions];

  beforeAll(async () => {
    pool = new Pool({ connectionString: testUrl, application_name: fixtureSchema, max: 8,
      options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    // Derive every selected column from the real Drizzle schema. Minimal defaults
    // support the routes under test; no production migrations or data are touched.
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
    await pool.query("ALTER TABLE proposal_versions ADD UNIQUE (proposal_id, version)");
    const db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(claimConfigRoutes, { db, prefix: "/configurations" });
    await server.register(publicConfigRoutes, { db, prefix: "/public" });
    await server.register(quoteRoutes, { db, prefix: "/quotes" });
    await server.register(proposalRoutes, { db, prefix: "/proposals" });
    await server.ready();
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE configurations, enquiries, quotes, quote_line_items, proposals, proposal_versions");
    await pool.query("INSERT INTO configurations (id, venue_id, is_public_preview, visibility) VALUES ($1, $2, true, 'public')", [CONFIG, VENUE]);
    await pool.query("INSERT INTO enquiries (configuration_id) VALUES ($1)", [CONFIG]);
    await pool.query("INSERT INTO quotes (id, venue_id, status, subtotal_minor, total_minor) VALUES ($1, $2, 'draft', 10000, 10000)", [QUOTE, VENUE]);
    await pool.query("INSERT INTO quote_line_items (quote_id, description, quantity, unit_amount_minor, line_total_minor, sort_order) VALUES ($1, 'Base', 1, 10000, 10000, 0)", [QUOTE]);
    await pool.query("INSERT INTO proposals (id, venue_id, title, status, current_version) VALUES ($1, $2, 'Fixture', 'draft', 0)", [PROPOSAL, VENUE]);
  });

  afterAll(async () => {
    if (server !== undefined) await server.close();
    if (pool !== undefined) {
      // Only the random schema created by this invocation is removed.
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
  });

  async function waitForBlockedQueries(count: number): Promise<void> {
    await expect.poll(async () => {
      const result = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
        [fixtureSchema],
      );
      return Number(result.rows[0]?.count);
    }, { timeout: 5000 }).toBe(count);
  }

  async function withBlocker(run: (client: PoolClient) => Promise<void>): Promise<void> {
    const client = await pool.connect();
    await client.query("BEGIN");
    try { await run(client); } finally { await client.query("ROLLBACK"); client.release(); }
  }

  it("allows exactly one concurrent claimant and links enquiries to that winner", async () => {
    await withBlocker(async (client) => {
      await client.query("SELECT id FROM configurations WHERE id = $1 FOR UPDATE", [CONFIG]);
      const responses = Promise.all([USER_A, USER_B].map((id) => server.inject({
        method: "POST", url: `/configurations/${CONFIG}/claim`, headers: headers(id),
      })));
      await waitForBlockedQueries(2);
      await client.query("COMMIT");
      const completed = await responses;
      expect(completed.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      const result = await pool.query<{ owner: string; enquiry_owner: string }>(
        "SELECT c.user_id AS owner, e.user_id AS enquiry_owner FROM configurations c JOIN enquiries e ON e.configuration_id = c.id WHERE c.id = $1", [CONFIG]);
      expect(result.rows[0]?.owner).toBe(result.rows[0]?.enquiry_owner);
      expect([USER_A, USER_B]).toContain(result.rows[0]?.owner);
    });
  });

  it("rolls back ownership when enquiry linking fails", async () => {
    await installFailure("enquiries", "UPDATE");
    try {
      const response = await server.inject({ method: "POST", url: `/configurations/${CONFIG}/claim`, headers: headers() });
      expect(response.statusCode).toBe(500);
      const result = await pool.query<{ user_id: string | null; is_public_preview: boolean }>("SELECT user_id, is_public_preview FROM configurations WHERE id = $1", [CONFIG]);
      expect(result.rows[0]).toEqual({ user_id: null, is_public_preview: true });
    } finally { await pool.query("DROP TRIGGER reject_write ON enquiries"); }
  });

  it("rejects a delayed anonymous thumbnail write once its preview is claimed", async () => {
    await withBlocker(async (client) => {
      await client.query("SELECT id FROM configurations WHERE id = $1 FOR UPDATE", [CONFIG]);
      const response = server.inject({ method: "POST", url: `/public/configurations/${CONFIG}/thumbnail`, payload: { thumbnailUrl: "data:image/png;base64,YQ==" } }).then((r) => r);
      await waitForBlockedQueries(1);
      await client.query("UPDATE configurations SET user_id = $1, is_public_preview = false, visibility = 'private' WHERE id = $2", [USER_A, CONFIG]);
      await client.query("COMMIT");
      expect((await response).statusCode).toBe(404);
      const result = await pool.query<{ thumbnail_url: string | null }>("SELECT thumbnail_url FROM configurations WHERE id = $1", [CONFIG]);
      expect(result.rows[0]?.thumbnail_url).toBeNull();
    });
  });

  function appendLine(amount: number): Promise<{ statusCode: number; body: string }> {
    return server.inject({ method: "POST", url: `/quotes/${QUOTE}/line-items`, headers: headers(), payload: { description: "Additional", quantity: 1, unitAmountMinor: amount } }).then((r) => r);
  }

  it("retains both concurrent quote additions in the exact stored total", async () => {
    await withBlocker(async (client) => {
      // Both old handlers read the same lines before their inserts block. With
      // the fix, the second handler instead waits for the quote-row lock.
      await client.query("LOCK TABLE quote_line_items IN SHARE MODE");
      const responses = Promise.all([appendLine(2000), appendLine(3000)]);
      await waitForBlockedQueries(2);
      await client.query("COMMIT");
      expect((await responses).map((r) => r.statusCode)).toEqual([201, 201]);
      const quote = await pool.query<{ total_minor: number }>("SELECT total_minor FROM quotes WHERE id = $1", [QUOTE]);
      const lines = await pool.query<{ line_total_minor: number; sort_order: number }>("SELECT line_total_minor, sort_order FROM quote_line_items WHERE quote_id = $1 ORDER BY sort_order", [QUOTE]);
      expect(quote.rows[0]?.total_minor).toBe(15000);
      expect(lines.rows.reduce((sum, line) => sum + line.line_total_minor, 0)).toBe(15000);
      expect(lines.rows.map((line) => line.sort_order)).toEqual([0, 1, 2]);
    });
  });

  it("rechecks quote editability after waiting for a concurrent issue", async () => {
    await withBlocker(async (client) => {
      await client.query("SELECT id FROM quotes WHERE id = $1 FOR UPDATE", [QUOTE]);
      const response = appendLine(2000);
      await waitForBlockedQueries(1);
      await client.query("UPDATE quotes SET status = 'issued' WHERE id = $1", [QUOTE]);
      await client.query("COMMIT");
      expect((await response).statusCode).toBe(422);
      const result = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM quote_line_items WHERE quote_id = $1", [QUOTE]);
      expect(result.rows[0]?.count).toBe("1");
    });
  });

  it.each([
    { platformRole: "none", change: "issue", expectedStatus: 422 },
    { platformRole: "admin", change: "issue", expectedStatus: 200 },
    { platformRole: "none", change: "delete", expectedStatus: 404 },
    { platformRole: "admin", change: "delete", expectedStatus: 404 },
  ] as const)("guards delayed quote metadata after $change with platform role $platformRole", async ({ platformRole, change, expectedStatus }) => {
    await pool.query("UPDATE quotes SET name = 'Original', notes = 'Original notes', valid_until = '2026-09-30' WHERE id = $1", [QUOTE]);
    await withBlocker(async (client) => {
      await client.query("SELECT id FROM quotes WHERE id = $1 FOR UPDATE", [QUOTE]);
      const response = server.inject({ method: "PATCH", url: `/quotes/${QUOTE}`, headers: headers(USER_A, platformRole),
        payload: { name: "Changed", notes: "Changed notes", validUntil: "2026-10-31" } }).then((r) => r);
      await waitForBlockedQueries(1);
      if (change === "issue") {
        await client.query("UPDATE quotes SET status = 'issued' WHERE id = $1", [QUOTE]);
      } else {
        await client.query("UPDATE quotes SET deleted_at = now() WHERE id = $1", [QUOTE]);
      }
      await client.query("COMMIT");
      expect((await response).statusCode).toBe(expectedStatus);
      const result = await pool.query<{ name: string; notes: string; valid_until: string }>(
        "SELECT name, notes, valid_until::text FROM quotes WHERE id = $1", [QUOTE]);
      expect(result.rows[0]).toEqual(expectedStatus === 200
        ? { name: "Changed", notes: "Changed notes", valid_until: "2026-10-31" }
        : { name: "Original", notes: "Original notes", valid_until: "2026-09-30" });
    });
  });

  function createVersion(): Promise<{ statusCode: number; body: string }> {
    return server.inject({ method: "POST", url: `/proposals/${PROPOSAL}/versions`, headers: headers(), payload: {
      schemaVersion: "venviewer.proposal-version.v1", title: "Fixture", clientMessage: null,
      configurationId: null, layoutRevision: null, capacityNote: null, quote: null,
    } }).then((r) => r);
  }

  async function installFailure(table: "enquiries" | "proposal_versions", operation: "INSERT" | "UPDATE"): Promise<void> {
    await pool.query("CREATE OR REPLACE FUNCTION reject_fixture_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected fixture write failure'; END $$");
    await pool.query(`CREATE TRIGGER reject_write BEFORE ${operation} ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_fixture_write()`);
  }

  it("keeps the previous version readable when the next snapshot insert fails", async () => {
    expect((await createVersion()).statusCode).toBe(201);
    await installFailure("proposal_versions", "INSERT");
    try {
      expect((await createVersion()).statusCode).toBe(500);
      const result = await pool.query<{ current_version: number }>("SELECT current_version FROM proposals WHERE id = $1", [PROPOSAL]);
      expect(result.rows[0]?.current_version).toBe(1);
      const latest = await server.inject({ method: "GET", url: `/proposals/${PROPOSAL}/versions/latest`, headers: headers() });
      expect(latest.statusCode).toBe(200);
    } finally { await pool.query("DROP TRIGGER reject_write ON proposal_versions"); }
  });

  it("allocates distinct concurrent versions and leaves an existing snapshot at the head", async () => {
    expect((await Promise.all([createVersion(), createVersion()])).map((r) => r.statusCode)).toEqual([201, 201]);
    const result = await pool.query<{ version: number }>("SELECT version FROM proposal_versions WHERE proposal_id = $1 ORDER BY version", [PROPOSAL]);
    expect(result.rows.map((row) => row.version)).toEqual([1, 2]);
    const latest = await server.inject({ method: "GET", url: `/proposals/${PROPOSAL}/versions/latest`, headers: headers() });
    expect(latest.statusCode).toBe(200);
  });

  it("rechecks proposal editability after a concurrent send freezes its content", async () => {
    await withBlocker(async (client) => {
      await client.query("SELECT id FROM proposals WHERE id = $1 FOR UPDATE", [PROPOSAL]);
      const response = createVersion();
      await waitForBlockedQueries(1);
      await client.query("UPDATE proposals SET status = 'sent' WHERE id = $1", [PROPOSAL]);
      await client.query("COMMIT");
      expect((await response).statusCode).toBe(422);
      const result = await pool.query<{ current_version: number }>("SELECT current_version FROM proposals WHERE id = $1", [PROPOSAL]);
      expect(result.rows[0]?.current_version).toBe(0);
    });
  });

  it("does not publish a prepared snapshot after its linked configuration changes", async () => {
    await withBlocker(async (client) => {
      await client.query("SELECT id FROM proposals WHERE id = $1 FOR UPDATE", [PROPOSAL]);
      const response = createVersion();
      await waitForBlockedQueries(1);
      await client.query("UPDATE proposals SET configuration_id = $1 WHERE id = $2", [CONFIG, PROPOSAL]);
      await client.query("COMMIT");
      expect((await response).statusCode).toBe(409);
      const result = await pool.query<{ current_version: number }>("SELECT current_version FROM proposals WHERE id = $1", [PROPOSAL]);
      expect(result.rows[0]?.current_version).toBe(0);
    });
  });
});
