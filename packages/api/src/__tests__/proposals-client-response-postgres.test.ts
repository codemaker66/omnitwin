import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { publicProposalRoutes } from "../routes/proposals.js";

// ---------------------------------------------------------------------------
// Client accept / request-changes, with no linked configuration.
//
// `recordProposalLifecycleChange` began `if (context === null) return;` — and
// `context` is null whenever the proposal has no configuration linked to an
// event. That is the ordinary shape of a proposal for a venue that quotes
// before it lays anything out, so "the client accepted your proposal" reached
// nobody at all. These cases pin the notification for exactly that shape, and
// the legacy share-code retirement that ships with it.
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
    throw new Error("Proposal client-response tests require their explicit isolated loopback database");
  }
}

const VENUE = "22222222-2222-4222-8222-222222222222";
const PROPOSAL = "66666666-6666-4666-8666-666666666666";
const SHARE_CODE = "abcdef";

// A stored payload that no longer parses is treated as an integrity fault and
// answered 404, so this fixture must satisfy ProposalVersionPayloadSchema in
// full — schemaVersion included — or the legacy-link case silently tests the
// wrong thing.
const VERSION_PAYLOAD = {
  schemaVersion: PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION,
  title: "Autumn gala — Grand Hall",
  clientMessage: "Planning-grade draft for your review. Human review required before anything is finalised.",
  configurationId: null,
  layoutRevision: null,
  capacityNote: "Planning estimate only; human review required; final capacity confirmed by the venue team.",
  packageSummary: [],
  quote: {
    quoteId: null,
    currency: "GBP",
    lineItems: [{ description: "Grand Hall hire", quantity: 1, unitAmountMinor: 250_000, lineTotalMinor: 250_000 }],
    subtotalMinor: 250_000,
    totalMinor: 250_000,
  },
};

interface NotificationRow {
  readonly audience_role: string;
  readonly title: string;
  readonly venue_id: string | null;
  readonly event_id: string | null;
  readonly change_id: string | null;
  readonly action_path: string | null;
  readonly severity: string;
}

describe.skipIf(testUrl === undefined)("client proposal responses on isolated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const fixtureSchema = `proposal_response_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [
    schema.proposals, schema.proposalVersions, schema.proposalStatusHistory,
    schema.proposalComments, schema.packageSelections, schema.venues,
    schema.configurations, schema.events, schema.eventConfigurationLinks,
    schema.handoffPacks, schema.eventPlanChanges, schema.eventPlanNotifications,
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
    await server.register(publicProposalRoutes, { db, prefix: "/public" });
    await server.ready();
  }, 120_000);

  beforeEach(async () => {
    await pool.query("TRUNCATE proposals, proposal_versions, proposal_status_history, event_plan_changes, event_plan_notifications, venues");
    await pool.query(
      "INSERT INTO venues (id, name, slug, address) VALUES ($1, 'Trades Hall Glasgow', 'trades-hall-glasgow', '85 Glassford Street')",
      [VENUE],
    );
    // No configuration_id — the shape that used to notify nobody.
    await pool.query(
      `INSERT INTO proposals (id, venue_id, title, status, current_version, share_code, sent_at)
       VALUES ($1, $2, 'Autumn gala — Grand Hall', 'sent', 1, $3, now())`,
      [PROPOSAL, VENUE, SHARE_CODE],
    );
    await pool.query(
      "INSERT INTO proposal_versions (proposal_id, version, payload) VALUES ($1, 1, $2)",
      [PROPOSAL, JSON.stringify(VERSION_PAYLOAD)],
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

  async function respond(action: "accept" | "request_changes", note?: string): Promise<void> {
    const res = await server.inject({
      method: "POST",
      url: `/public/proposals/${SHARE_CODE}/respond`,
      payload: note === undefined ? { action } : { action, note },
    });
    expect(res.statusCode).toBe(200);
  }

  async function notifications(): Promise<readonly NotificationRow[]> {
    const rows = await pool.query<NotificationRow>(
      "SELECT audience_role, title, venue_id, event_id, change_id, action_path, severity FROM event_plan_notifications ORDER BY audience_role",
    );
    return rows.rows;
  }

  it("notifies the commercial team when a client accepts a proposal with no configuration", async () => {
    await respond("accept");
    const rows = await notifications();

    expect(rows.length).toBeGreaterThan(0);
    const roles = rows.map((row) => row.audience_role);
    expect(roles).toContain("staff");
    expect(roles).toContain("admin");
    for (const row of rows) {
      expect(row.title).toBe("Client approved proposal");
      expect(row.venue_id).toBe(VENUE);
      // No event to hang off — that is the whole point of the fix.
      expect(row.event_id).toBeNull();
      expect(row.change_id).toBeNull();
      expect(row.action_path).toBe("/dashboard?view=proposals");
      expect(row.severity).toBe("attention");
    }
  });

  it("notifies on request-changes and keeps the client's note", async () => {
    await respond("request_changes", "Could we move the bar to the north wall?");
    const rows = await notifications();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.title).toBe("Client requested proposal changes");
    }

    const status = await pool.query<{ to_status: string; note: string | null }>(
      "SELECT to_status, note FROM proposal_status_history WHERE proposal_id = $1", [PROPOSAL],
    );
    expect(status.rows[0]?.to_status).toBe("changes_requested");
    expect(status.rows[0]?.note).toBe("Could we move the bar to the north wall?");
  });

  it("still serves the legacy share-code link inside the retirement window", async () => {
    const res = await server.inject({ method: "GET", url: `/public/proposals/${SHARE_CODE}` });
    expect(res.statusCode).toBe(200);
    // Every response advertises the retirement so a client integration can see
    // it coming rather than discovering it the day the link dies.
    expect(res.headers["deprecation"]).toBe("true");
    expect(typeof res.headers["sunset"]).toBe("string");
  });

  it("answers 410 with plain English once the retirement date has passed", async () => {
    const saved = process.env["LEGACY_PROPOSAL_SHARE_CODE_SUNSET"];
    process.env["LEGACY_PROPOSAL_SHARE_CODE_SUNSET"] = "2000-01-01T00:00:00.000Z";
    try {
      const res = await server.inject({ method: "GET", url: `/public/proposals/${SHARE_CODE}` });
      expect(res.statusCode).toBe(410);
      const body = JSON.parse(res.body) as { error: string; code: string };
      expect(body.code).toBe("SHARE_CODE_RETIRED");
      expect(body.error).toContain("Ask the venue team");

      const respondRes = await server.inject({
        method: "POST", url: `/public/proposals/${SHARE_CODE}/respond`, payload: { action: "accept" },
      });
      expect(respondRes.statusCode).toBe(410);
    } finally {
      if (saved === undefined) delete process.env["LEGACY_PROPOSAL_SHARE_CODE_SUNSET"];
      else process.env["LEGACY_PROPOSAL_SHARE_CODE_SUNSET"] = saved;
    }
  });
});
