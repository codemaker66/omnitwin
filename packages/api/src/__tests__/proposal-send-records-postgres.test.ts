import Fastify, { type FastifyInstance } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { proposalRoutes, proposalShareRoutes, publicProposalRoutes } from "../routes/proposals.js";

// ---------------------------------------------------------------------------
// What each send and each acceptance records (T-635, X1), on isolated
// PostgreSQL.
//
// Every send records the version the client is sent (proposals.sent_version)
// and every acceptance the name given with it (proposals.accepted_name). The
// client's link shows the version sent, never one saved since, and every
// answer is on it.
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
    throw new Error("Proposal send-record tests require their explicit isolated loopback database");
  }
}

const VENUE = "22222222-2222-4222-8222-222222222222";
const STAFF = "33333333-3333-4333-8333-333333333333";
const PROPOSAL = "66666666-6666-4666-8666-666666666666";
const TOKEN = "sendRecordsToken_0123456789abcdefghijklmnopqrstu";
const SHARE_CODE = "abcdef";

const VERSION_PAYLOAD = {
  schemaVersion: PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION,
  title: "Crawford wedding proposal",
  clientMessage: null,
  configurationId: null,
  layoutRevision: null,
  capacityNote: null,
  packageSummary: [],
  quote: null,
};

const headers = { authorization: `Bearer ${JSON.stringify({ id: STAFF, email: "fixture@example.test", role: "staff", platformRole: "none", venueId: VENUE })}` };

describe.skipIf(testUrl === undefined)("what a send and an acceptance record, on isolated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const fixtureSchema = `send_records_${randomUUID().replaceAll("-", "")}`;
  // The older share-code path retires on a date; these tests use it as it
  // stands until then.
  const sunset = process.env["LEGACY_PROPOSAL_SHARE_CODE_SUNSET"];
  const tables: PgTable[] = [
    schema.proposals, schema.proposalVersions, schema.proposalStatusHistory, schema.proposalComments,
    schema.proposalShareTokens, schema.packageSelections, schema.venues, schema.configurations,
    schema.opportunities, schema.opportunityStatusHistory, schema.events, schema.eventConfigurationLinks,
    schema.handoffPacks, schema.eventPlanChanges, schema.eventPlanNotifications, schema.contacts, schema.enquiries,
  ];

  beforeAll(async () => {
    process.env["LEGACY_PROPOSAL_SHARE_CODE_SUNSET"] = "2099-01-01T00:00:00.000Z";
    pool = new Pool({ connectionString: testUrl, application_name: fixtureSchema, max: 4, options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    // Columns derive from the real Drizzle schema; no production migration or
    // data is touched.
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
    // Migration 0082's own check on the version recorded.
    await pool.query(`ALTER TABLE proposals ADD CONSTRAINT proposals_sent_version_positive
      CHECK (sent_version IS NULL OR (sent_version >= 1 AND sent_version <= current_version))`);
    const db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(proposalRoutes, { db, prefix: "/proposals" });
    await server.register(proposalShareRoutes, { db, prefix: "/proposal-share" });
    await server.register(publicProposalRoutes, { db, prefix: "/public" });
    await server.ready();
  }, 120_000);

  beforeEach(async () => {
    await pool.query(`TRUNCATE ${tables.map((table) => `"${getTableConfig(table).name}"`).join(", ")}`);
    await pool.query("INSERT INTO venues (id, name, slug) VALUES ($1, 'Trades Hall Glasgow', 'trades-hall-glasgow')", [VENUE]);
    await pool.query(
      `INSERT INTO proposals (id, venue_id, title, status, current_version, created_by, share_code)
       VALUES ($1, $2, 'Crawford wedding proposal', 'draft', 0, $3, $4)`,
      [PROPOSAL, VENUE, STAFF, SHARE_CODE],
    );
    await saveVersion(1);
  }, 60_000);

  afterAll(async () => {
    if (sunset === undefined) delete process.env["LEGACY_PROPOSAL_SHARE_CODE_SUNSET"];
    else process.env["LEGACY_PROPOSAL_SHARE_CODE_SUNSET"] = sunset;
    if (server !== undefined) await server.close();
    if (pool !== undefined) {
      // Only the random schema created by this invocation is removed.
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
  }, 60_000);

  async function saveVersion(version: number): Promise<void> {
    await pool.query("INSERT INTO proposal_versions (proposal_id, version, payload) VALUES ($1, $2, $3)",
      [PROPOSAL, version, JSON.stringify(VERSION_PAYLOAD)]);
    await pool.query("UPDATE proposals SET current_version = $2 WHERE id = $1", [PROPOSAL, version]);
  }

  async function row(): Promise<{ status: string; sent_version: number | null; accepted_name: string | null }> {
    const found = (await pool.query<{ status: string; sent_version: number | null; accepted_name: string | null }>(
      "SELECT status, sent_version, accepted_name FROM proposals WHERE id = $1", [PROPOSAL],
    )).rows[0];
    if (found === undefined) throw new Error("no proposal");
    return found;
  }

  async function makeLink(): Promise<number> {
    return (await server.inject({ method: "POST", url: `/proposals/${PROPOSAL}/share-token`, headers })).statusCode;
  }

  async function move(status: string): Promise<number> {
    return (await server.inject({ method: "POST", url: `/proposals/${PROPOSAL}/transition`, headers, payload: { status } })).statusCode;
  }

  it("records the version each send sends, by link or by moving it to sent", async () => {
    await saveVersion(2);
    expect(await makeLink()).toBe(201);
    expect(await row()).toMatchObject({ status: "sent", sent_version: 2 });

    // The client asks for changes; version 3 is saved and sent by moving it.
    await pool.query("UPDATE proposals SET status = 'changes_requested' WHERE id = $1", [PROPOSAL]);
    await saveVersion(3);
    expect((await row()).sent_version).toBe(2);
    expect(await move("sent")).toBe(200);
    expect(await row()).toMatchObject({ status: "sent", sent_version: 3 });

    // A new link on a proposal still with the client sends what is current.
    await saveVersion(4);
    expect(await makeLink()).toBe(201);
    expect((await row()).sent_version).toBe(4);
  });

  it("answers a new link and a move with the proposal as its row on the desk now reads", async () => {
    const quoted = (totalMinor: number): string => JSON.stringify({ ...VERSION_PAYLOAD, quote: { totalMinor, currency: "GBP" } });
    await pool.query("UPDATE proposal_versions SET payload = $2 WHERE proposal_id = $1 AND version = 1", [PROPOSAL, quoted(1_000_000)]);
    const link = await server.inject({ method: "POST", url: `/proposals/${PROPOSAL}/share-token`, headers });
    expect(link.statusCode, link.body).toBe(201);
    const sent = (JSON.parse(link.body) as { data: { proposal: Record<string, unknown> } }).data.proposal;
    expect(sent).toMatchObject({ status: "sent", sentVersion: 1, latestTotalMinor: 1_000_000, linkOpenedAt: null, hasLink: true, linkOpen: true });
    expect(Math.abs(Date.parse(String(sent["lastSentAt"])) - Date.parse(String(sent["sentAt"])))).toBeLessThan(60_000);

    // A version saved while it is out is a draft: the figure is still the one
    // sent, and once withdrawn the link no longer opens.
    await pool.query("INSERT INTO proposal_versions (proposal_id, version, payload) VALUES ($1, 2, $2)", [PROPOSAL, quoted(1_200_000)]);
    await pool.query("UPDATE proposals SET current_version = 2 WHERE id = $1", [PROPOSAL]);
    const moved = await server.inject({ method: "POST", url: `/proposals/${PROPOSAL}/transition`, headers, payload: { status: "withdrawn" } });
    expect(moved.statusCode, moved.body).toBe(200);
    expect((JSON.parse(moved.body) as { data: Record<string, unknown> }).data)
      .toMatchObject({ status: "withdrawn", currentVersion: 2, sentVersion: 1, latestTotalMinor: 1_000_000, hasLink: true, linkOpen: false });
  });

  it("keeps a version saved while a proposal is out as a draft, and the team's answer on the version sent", async () => {
    expect(await makeLink()).toBe(201);
    // A platform administrator saves version 2 while version 1 is out: the
    // link keeps version 1 until version 2 is sent.
    const admin = { authorization: `Bearer ${JSON.stringify({ id: STAFF, email: "fixture@example.test", role: "admin", platformRole: "admin", venueId: VENUE })}` };
    const saved = await server.inject({ method: "POST", url: `/proposals/${PROPOSAL}/versions`, headers: admin, payload: VERSION_PAYLOAD });
    expect(saved.statusCode, saved.body).toBe(201);
    expect(await row()).toMatchObject({ status: "sent", sent_version: 1 });

    // The team records the client's decline of what the link showed.
    expect(await move("declined")).toBe(200);
    expect(await row()).toMatchObject({ status: "declined", sent_version: 1 });
  });

  it("records no version for an answer given on a proposal with none saved", async () => {
    // A venue administrator may move a proposal anywhere, even one with
    // nothing written yet.
    await pool.query("DELETE FROM proposal_versions");
    await pool.query("UPDATE proposals SET current_version = 0 WHERE id = $1", [PROPOSAL]);
    const venueAdmin = { authorization: `Bearer ${JSON.stringify({ id: STAFF, email: "fixture@example.test", role: "admin", platformRole: "none", venueId: VENUE })}` };
    const declined = await server.inject({ method: "POST", url: `/proposals/${PROPOSAL}/transition`, headers: venueAdmin, payload: { status: "declined" } });
    expect(declined.statusCode, declined.body).toBe(200);
    expect(await row()).toMatchObject({ status: "declined", sent_version: null });
  });

  it("makes no link over an answer that landed after the proposal was read", async () => {
    expect(await makeLink()).toBe(201);
    await saveVersion(2);
    const other = await pool.connect();
    try {
      // The client accepts while the link is being made.
      await other.query("BEGIN");
      await other.query("UPDATE proposals SET status = 'accepted' WHERE id = $1", [PROPOSAL]);
      const pending = server.inject({ method: "POST", url: `/proposals/${PROPOSAL}/share-token`, headers });
      await expect.poll(async () => Number((await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
        [fixtureSchema],
      )).rows[0]?.count), { timeout: 5000 }).toBe(1);
      await other.query("COMMIT");
      const res = await pending;
      expect(res.statusCode, res.body).toBe(409);
      expect((JSON.parse(res.body) as { code: string }).code).toBe("PROPOSAL_STATUS_CHANGED");
    } finally {
      other.release();
    }
    // The acceptance stands on the version sent, and no second link exists.
    expect(await row()).toMatchObject({ status: "accepted", sent_version: 1 });
    expect((await pool.query("SELECT id FROM proposal_share_tokens")).rowCount).toBe(1);
  });

  it("keeps an answered proposal on the version that was answered when a new link is made", async () => {
    expect(await makeLink()).toBe(201);
    await pool.query("UPDATE proposals SET status = 'accepted' WHERE id = $1", [PROPOSAL]);
    await saveVersion(2);
    expect(await makeLink()).toBe(201);
    expect(await row()).toMatchObject({ status: "accepted", sent_version: 1 });
  });

  it("keeps each client answer on the version its link shows, the one sent", async () => {
    expect(await makeLink()).toBe(201);
    await pool.query("INSERT INTO proposal_share_tokens (proposal_id, token_hash, token_prefix) VALUES ($1, $2, 'sendReco')",
      [PROPOSAL, createHash("sha256").update(TOKEN, "utf8").digest("hex")]);
    // A version saved since is not on the link, so no answer is on it.
    await saveVersion(2);
    const changes = await server.inject({ method: "POST", url: `/proposal-share/${TOKEN}/comment`, payload: { body: "A later finish?", kind: "request_changes", version: 1 } });
    expect(changes.statusCode, changes.body).toBe(201);
    expect(await row()).toMatchObject({ status: "changes_requested", sent_version: 1 });

    await pool.query("UPDATE proposals SET status = 'sent' WHERE id = $1", [PROPOSAL]);
    const accepted = await server.inject({ method: "POST", url: `/proposal-share/${TOKEN}/approve`, payload: { authorName: "Elaine Crawford", version: 1 } });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(await row()).toMatchObject({ status: "accepted", sent_version: 1 });

    await pool.query("UPDATE proposals SET status = 'sent' WHERE id = $1", [PROPOSAL]);
    const legacy = await server.inject({ method: "POST", url: `/public/proposals/${SHARE_CODE}/respond`, payload: { action: "request_changes", note: "Seats?", version: 1 } });
    expect(legacy.statusCode, legacy.body).toBe(200);
    expect(await row()).toMatchObject({ status: "changes_requested", sent_version: 1 });
  });

  it("keeps the name given with an acceptance, and no earlier name for one given without", async () => {
    expect(await makeLink()).toBe(201);
    await pool.query("INSERT INTO proposal_share_tokens (proposal_id, token_hash, token_prefix) VALUES ($1, $2, 'sendReco')",
      [PROPOSAL, createHash("sha256").update(TOKEN, "utf8").digest("hex")]);
    const accepted = await server.inject({ method: "POST", url: `/proposal-share/${TOKEN}/approve`, payload: { authorName: "  Elaine Crawford " } });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(await row()).toMatchObject({ status: "accepted", accepted_name: "Elaine Crawford" });

    // Reopened, then marked accepted by the team.
    await pool.query("UPDATE proposals SET status = 'sent' WHERE id = $1", [PROPOSAL]);
    expect(await move("accepted")).toBe(200);
    expect(await row()).toMatchObject({ status: "accepted", accepted_name: null });

    // Reopened, then accepted through the older share code.
    await pool.query("UPDATE proposals SET status = 'sent', accepted_name = 'Elaine Crawford' WHERE id = $1", [PROPOSAL]);
    const legacy = await server.inject({ method: "POST", url: `/public/proposals/${SHARE_CODE}/respond`, payload: { action: "accept" } });
    expect(legacy.statusCode, legacy.body).toBe(200);
    expect(await row()).toMatchObject({ status: "accepted", accepted_name: null });

    // Accepted through a link without a name.
    await pool.query("UPDATE proposals SET status = 'sent', accepted_name = 'Elaine Crawford' WHERE id = $1", [PROPOSAL]);
    const nameless = await server.inject({ method: "POST", url: `/proposal-share/${TOKEN}/approve`, payload: {} });
    expect(nameless.statusCode, nameless.body).toBe(200);
    expect(await row()).toMatchObject({ status: "accepted", accepted_name: null });
  });
});
