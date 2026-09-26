import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { proposalRoutes } from "../routes/proposals.js";

// ---------------------------------------------------------------------------
// An announcement must never be able to fail a save.
//
// The audience vocabulary and the database disagree across a deploy boundary.
// `COMMERCIAL_AUDIENCE_ROLES` gains `sales` the moment the roles lane widens
// `USER_ROLES`, while the deployed CHECK constraints from migration 0042 admit
// only the original seven values until the inventory lane's 0072 widens them
// to ten. In that window every announcement insert raises SQLSTATE 23514 — and
// before this fix that turned a staff member saving a proposal version into a
// 500 on work that had already committed.
//
// The other PostgreSQL fixtures in this repo build tables from
// `column.getSQLType()` alone, so they carry NO CHECK constraints and cannot
// see this class of failure at all. This one copies the real constraints out
// of 0042 verbatim.
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
    throw new Error("Announcement isolation tests require their explicit isolated loopback database");
  }
}

const VENUE = "22222222-2222-4222-8222-222222222222";
const CONFIG = "11111111-1111-4111-8111-111111111111";
const SPACE = "44444444-4444-4444-8444-444444444444";
const EVENT = "77777777-7777-4777-8777-777777777777";
const PROPOSAL = "66666666-6666-4666-8666-666666666666";
const STAFF = "33333333-3333-4333-8333-333333333333";

/** Copied verbatim from drizzle/0042_event_plan_lifecycle.sql:100-113. */
const DEPLOYED_AUDIENCE_VALUES = '["client", "planner", "staff", "hallkeeper", "admin", "supplier", "executive"]';
const DEPLOYED_ROLE_VALUES = "'client', 'planner', 'staff', 'hallkeeper', 'admin', 'supplier', 'executive'";

function audienceCheckSql(allowed: string): string {
  return `
    ALTER TABLE event_plan_changes
      ADD CONSTRAINT event_plan_changes_audience_json_check
      CHECK (
        jsonb_typeof(audience_roles) = 'array'
        AND jsonb_array_length(audience_roles) > 0
        AND audience_roles <@ '${allowed}'::jsonb
      )`;
}

function headers(): { authorization: string } {
  return {
    authorization: `Bearer ${JSON.stringify({
      id: STAFF, email: "fixture@example.test", role: "staff", platformRole: "none", venueId: VENUE,
    })}`,
  };
}

describe.skipIf(testUrl === undefined)("proposal announcements cannot fail a save", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const fixtureSchema = `announce_isolation_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [
    schema.proposals, schema.proposalVersions, schema.proposalStatusHistory,
    schema.proposalComments, schema.proposalShareTokens, schema.packageSelections,
    schema.venues, schema.configurations, schema.events, schema.eventConfigurationLinks,
    schema.handoffPacks, schema.eventPlanChanges, schema.eventPlanNotifications,
    schema.opportunities, schema.enquiries,
    // A proposal WITH a configuration makes the versions route resolve a
    // layout snapshot, which reads these three. Without them the route 500s
    // for a reason that has nothing to do with announcements, and the suite
    // would have "passed" its own premise while proving nothing.
    schema.spaces, schema.placedObjects, schema.assetDefinitions,
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
    await pool.query("ALTER TABLE proposal_versions ADD UNIQUE (proposal_id, version)");
    // The real constraints, verbatim. This is the whole point of the suite.
    await pool.query(audienceCheckSql(DEPLOYED_AUDIENCE_VALUES));
    await pool.query(`
      ALTER TABLE event_plan_notifications
        ADD CONSTRAINT event_plan_notifications_role_check
        CHECK (audience_role IN (${DEPLOYED_ROLE_VALUES}))`);

    const db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(proposalRoutes, { db, prefix: "/proposals" });
    await server.ready();
  }, 120_000);

  beforeEach(async () => {
    await pool.query("TRUNCATE proposals, proposal_versions, proposal_status_history, event_configuration_links, events, configurations, event_plan_changes, event_plan_notifications, venues, spaces, placed_objects, asset_definitions");
    await pool.query(
      "INSERT INTO venues (id, name, slug, address) VALUES ($1, 'Trades Hall Glasgow', 'trades-hall-glasgow', '85 Glassford Street')",
      [VENUE],
    );
    await pool.query(
      "INSERT INTO spaces (id, venue_id, name, sort_order) VALUES ($1, $2, 'Grand Hall', 0)",
      [SPACE, VENUE],
    );
    await pool.query(
      "INSERT INTO configurations (id, venue_id, space_id, is_public_preview, visibility) VALUES ($1, $2, $3, false, 'private')",
      [CONFIG, VENUE, SPACE],
    );
    // A LINKED event is what sends the code down the event-linked branch —
    // the one whose insert the deployed CHECK constrains.
    await pool.query(
      "INSERT INTO events (id, venue_id, created_by, name) VALUES ($1, $2, $3, 'Autumn gala')",
      [EVENT, VENUE, STAFF],
    );
    await pool.query(
      "INSERT INTO event_configuration_links (event_id, configuration_id) VALUES ($1, $2)",
      [EVENT, CONFIG],
    );
    await pool.query(
      `INSERT INTO proposals (id, venue_id, configuration_id, title, status, current_version)
       VALUES ($1, $2, $3, 'Autumn gala — Grand Hall', 'draft', 0)`,
      [PROPOSAL, VENUE, CONFIG],
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

  function createVersion(): Promise<LightMyRequestResponse> {
    return server.inject({
      method: "POST",
      url: `/proposals/${PROPOSAL}/versions`,
      headers: headers(),
      payload: {
        schemaVersion: "venviewer.proposal-version.v1",
        title: "Autumn gala — Grand Hall",
        clientMessage: null,
        configurationId: null,
        layoutRevision: null,
        capacityNote: null,
        quote: null,
      },
    });
  }

  async function changeCount(): Promise<number> {
    const rows = await pool.query<{ count: string }>("SELECT count(*) AS count FROM event_plan_changes");
    return Number(rows.rows[0]?.count ?? "0");
  }

  it("announces normally when the audience is inside the deployed CHECK", async () => {
    const res = await createVersion();
    expect(res.statusCode).toBe(201);
    // staff and admin are both among the deployed seven, so it lands.
    expect(await changeCount()).toBe(1);
  });

  it("still saves the version when the announcement violates the CHECK", async () => {
    // Narrow the REAL constraint by values the code actually emits. At this
    // base `sales` cannot be used to trigger it — `sales` is not yet in
    // USER_ROLES, so it never reaches the audience array — but the mechanism
    // reproduced here is identical: an audience value the deployed CHECK does
    // not admit, raising SQLSTATE 23514 on this exact insert. That is the
    // state of production between the roles lane merging and 0072 applying.
    await pool.query("ALTER TABLE event_plan_changes DROP CONSTRAINT event_plan_changes_audience_json_check");
    await pool.query(audienceCheckSql('["client", "planner", "hallkeeper", "supplier", "executive"]'));
    try {
      const res = await createVersion();

      // The point of the fix: a rejected announcement is not a failed save.
      // Before it, this was a 500 on work the staff member had already done.
      expect(res.statusCode).toBe(201);
      expect(await changeCount()).toBe(0);

      // And the business record is really there, not rolled back with it.
      const versions = await pool.query<{ version: number }>(
        "SELECT version FROM proposal_versions WHERE proposal_id = $1", [PROPOSAL],
      );
      expect(versions.rows.map((row) => row.version)).toEqual([1]);
      const proposal = await pool.query<{ current_version: number }>(
        "SELECT current_version FROM proposals WHERE id = $1", [PROPOSAL],
      );
      expect(proposal.rows[0]?.current_version).toBe(1);

      // Readable afterwards, which is what a staff member does next.
      const latest = await server.inject({
        method: "GET", url: `/proposals/${PROPOSAL}/versions/latest`, headers: headers(),
      });
      expect(latest.statusCode).toBe(200);
    } finally {
      await pool.query("ALTER TABLE event_plan_changes DROP CONSTRAINT event_plan_changes_audience_json_check");
      await pool.query(audienceCheckSql(DEPLOYED_AUDIENCE_VALUES));
    }
  });

  it("survives an announcement table that refuses every write", async () => {
    // A blunter failure than a CHECK — the wrapper must not care which.
    await pool.query("CREATE OR REPLACE FUNCTION reject_announcement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected announcement failure'; END $$");
    await pool.query("CREATE TRIGGER reject_announce BEFORE INSERT ON event_plan_changes FOR EACH ROW EXECUTE FUNCTION reject_announcement()");
    try {
      const res = await createVersion();
      expect(res.statusCode).toBe(201);
      expect(await changeCount()).toBe(0);
    } finally {
      await pool.query("DROP TRIGGER reject_announce ON event_plan_changes");
    }
  });
});
