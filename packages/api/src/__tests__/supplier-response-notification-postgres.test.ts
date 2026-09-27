import Fastify, { type FastifyInstance } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { supplierShareRoutes } from "../routes/supplier-coordination.js";

// ---------------------------------------------------------------------------
// A supplier's response reaches the venue, on isolated PostgreSQL.
//
// A clarification request used to be stored on the pack and reach nobody:
// no notification was written, and no staff screen shows packs. The route
// now raises a venue notification for the people running the day, carrying
// the supplier's own words, and a notification that cannot be written never
// fails the supplier's response. Only real rows show either.
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
    throw new Error("Supplier response tests require their explicit isolated loopback database");
  }
}

const VENUE = "77777777-7777-4777-8777-777777777777";
const SUPPLIER = "77777777-7777-4777-8777-777777777701";
const HANDOFF = "77777777-7777-4777-8777-777777777702";
const PACK = "77777777-7777-4777-8777-777777777703";
const TOKEN_ID = "77777777-7777-4777-8777-777777777704";
const TOKEN = "supplierResponseToken_0123456789abcdefghijkl";

interface NotificationRow {
  readonly venue_id: string;
  readonly event_id: string | null;
  readonly change_id: string | null;
  readonly audience_role: string;
  readonly title: string;
  readonly body: string;
  readonly severity: string;
}

describe.skipIf(testUrl === undefined)("supplier responses reach the venue on isolated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const fixtureSchema = `supplier_response_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [
    schema.venues, schema.suppliers, schema.handoffPacks, schema.snapshotDiffs,
    schema.supplierCoordinationPacks, schema.supplierCoordinationShareTokens,
    schema.supplierAcknowledgements, schema.eventPlanNotifications,
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
        else if (column.name === "created_at" || column.name === "updated_at" || column.name === "compiled_at") defaultSql = " default now()";
        return `"${column.name}" ${column.getSQLType()}${defaultSql}`;
      });
      await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    }
    const db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(supplierShareRoutes, { db, prefix: "/supplier-share" });
    await server.ready();
  }, 120_000);

  beforeEach(async () => {
    await pool.query(`TRUNCATE venues, suppliers, handoff_packs, snapshot_diffs, supplier_coordination_packs,
      supplier_coordination_share_tokens, supplier_acknowledgements, event_plan_notifications`);
    await pool.query("INSERT INTO venues (id, name, slug) VALUES ($1, 'Trades Hall Glasgow', 'trades-hall')", [VENUE]);
    await pool.query(
      "INSERT INTO suppliers (id, venue_id, name, category, contact_name, email) VALUES ($1, $2, 'Bloom & Co', 'florist', 'Sam', 'sam@example.test')",
      [SUPPLIER, VENUE],
    );
    await pool.query("INSERT INTO handoff_packs (id, version, snapshot_hash, source_label, summary) VALUES ($1, 1, $2, 'Approved snapshot v1', 'Handoff')", [HANDOFF, "a".repeat(64)]);
    await pool.query(
      `INSERT INTO supplier_coordination_packs (id, venue_id, handoff_pack_id, supplier_id, title, status,
        source_snapshot_hash, source_digest, source_label, safe_status, issued_at)
       VALUES ($1, $2, $3, $4, 'Flowers for the Grand Hall dinner', 'issued', $5, $6, 'Approved snapshot v1',
        'supplier_safe_operations_handoff', now())`,
      [PACK, VENUE, HANDOFF, SUPPLIER, "a".repeat(64), "b".repeat(64)],
    );
    await pool.query(
      "INSERT INTO supplier_coordination_share_tokens (id, pack_id, token_hash, token_prefix) VALUES ($1, $2, $3, $4)",
      [TOKEN_ID, PACK, createHash("sha256").update(TOKEN, "utf8").digest("hex"), TOKEN.slice(0, 8)],
    );
  });

  afterAll(async () => {
    await server?.close();
    await pool?.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
    await pool?.end();
  });

  async function notifications(): Promise<readonly NotificationRow[]> {
    const result = await pool.query<NotificationRow>(
      "SELECT venue_id, event_id, change_id, audience_role, title, body, severity FROM event_plan_notifications ORDER BY audience_role",
    );
    return result.rows;
  }

  it("tells staff and hallkeepers when a supplier needs clarification, in the supplier's words", async () => {
    const res = await server.inject({
      method: "POST", url: `/supplier-share/${TOKEN}/acknowledge`,
      payload: {
        status: "needs_clarification",
        acknowledgedByName: "Sam",
        acknowledgedByEmail: "sam@example.test",
        note: "Which door do we load through?",
      },
    });
    expect(res.statusCode).toBe(201);

    const rows = await notifications();
    expect(rows.map((row) => row.audience_role)).toEqual(["hallkeeper", "staff"]);
    for (const row of rows) {
      expect(row).toMatchObject({
        venue_id: VENUE, event_id: null, change_id: null,
        title: "Bloom & Co needs clarification", severity: "attention",
      });
      expect(row.body).toBe("Flowers for the Grand Hall dinner. From Sam, sam@example.test. \"Which door do we load through?\"");
    }
  });

  it("tells them quietly when a supplier acknowledges the handoff", async () => {
    const res = await server.inject({
      method: "POST", url: `/supplier-share/${TOKEN}/acknowledge`,
      payload: { status: "acknowledged", acknowledgedByName: "Sam" },
    });
    expect(res.statusCode).toBe(201);
    const rows = await notifications();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.title === "Bloom & Co acknowledged the handoff" && row.severity === "info")).toBe(true);
    expect(rows[0]?.body).toBe("Flowers for the Grand Hall dinner. From Sam. No note.");
  });

  it("keeps the supplier's response when the notification cannot be written", async () => {
    await pool.query("ALTER TABLE event_plan_notifications RENAME TO event_plan_notifications_away");
    try {
      const res = await server.inject({
        method: "POST", url: `/supplier-share/${TOKEN}/acknowledge`,
        payload: { status: "needs_clarification", acknowledgedByName: "Sam", note: "Which door?" },
      });
      expect(res.statusCode).toBe(201);
      const saved = await pool.query<{ status: string }>("SELECT status FROM supplier_acknowledgements WHERE pack_id = $1", [PACK]);
      expect(saved.rows.map((row) => row.status)).toEqual(["needs_clarification"]);
    } finally {
      await pool.query("ALTER TABLE event_plan_notifications_away RENAME TO event_plan_notifications");
    }
  });
});
