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
// The client's proposal page (roadmap X1) on isolated PostgreSQL.
//
// The page tells the client the event it is for: the date, how many, the
// occasion and the room, from the proposal's layout, its deal or its
// enquiry, never another venue's. Once accepted it names who accepted it and
// when. The venue team can read it exactly as the client does without it
// counting as the client opening it.
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
    throw new Error("Client page tests require their explicit isolated loopback database");
  }
}

const VENUE = "22222222-2222-4222-8222-222222222222";
const OTHER_VENUE = "22222222-2222-4222-8222-222222222999";
const STAFF = "33333333-3333-4333-8333-333333333333";
const PROPOSAL = "66666666-6666-4666-8666-666666666666";
// The shape the API issues: 32 random bytes, base64url.
const TOKEN = "clientPageToken_0123456789abcdefghijklmnopqrstuv";
// The older six-letter share code.
const SHARE_CODE = "abcdef";

const VERSION_PAYLOAD = {
  schemaVersion: PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION,
  title: "Crawford wedding proposal",
  clientMessage: "Planning-grade proposal for your wedding on 5 June.",
  configurationId: null,
  layoutRevision: null,
  capacityNote: null,
  packageSummary: [],
  quote: null,
};

function headers(venueId = VENUE, id = STAFF): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify({ id, email: "fixture@example.test", role: "staff", platformRole: "none", venueId })}` };
}

interface ClientPage {
  readonly facts: { eventDate: string | null; guestCount: number | null; occasion: string | null; roomName: string | null; roomSlug: string | null };
  readonly accepted: { by: string | null; at: string } | null;
  readonly status: string;
}

describe.skipIf(testUrl === undefined)("the client's proposal page on isolated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const fixtureSchema = `client_page_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [
    schema.proposals, schema.proposalVersions, schema.proposalStatusHistory, schema.proposalComments,
    schema.proposalShareTokens, schema.packageSelections, schema.venues, schema.configurations, schema.spaces,
    schema.enquiries, schema.opportunities, schema.opportunityStatusHistory, schema.events, schema.eventConfigurationLinks,
    schema.handoffPacks, schema.eventPlanChanges, schema.eventPlanNotifications,
  ];

  beforeAll(async () => {
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
        return `"${column.name}" ${column.getSQLType()}${defaultSql}`;
      });
      await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    }
    const db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(proposalRoutes, { db, prefix: "/proposals" });
    await server.register(proposalShareRoutes, { db, prefix: "/proposal-share" });
    await server.register(publicProposalRoutes, { db, prefix: "/public" });
    await server.ready();
  }, 120_000);

  beforeEach(async () => {
    await pool.query(`TRUNCATE ${tables.map((table) => `"${getTableConfig(table).name}"`).join(", ")}`);
    await pool.query("INSERT INTO venues (id, name, slug, address) VALUES ($1, 'Trades Hall Glasgow', 'trades-hall-glasgow', '85 Glassford Street')", [VENUE]);
    await pool.query(
      `INSERT INTO proposals (id, venue_id, title, status, current_version, sent_at, created_by, share_code)
       VALUES ($1, $2, 'Crawford wedding proposal', 'sent', 1, now(), $3, $4)`,
      [PROPOSAL, VENUE, STAFF, SHARE_CODE],
    );
    await pool.query("INSERT INTO proposal_versions (proposal_id, version, payload, coordinate_space) VALUES ($1, 1, $2, 'real_metre')",
      [PROPOSAL, JSON.stringify(VERSION_PAYLOAD)]);
    await pool.query("INSERT INTO proposal_share_tokens (proposal_id, token_hash, token_prefix) VALUES ($1, $2, 'client-p')",
      [PROPOSAL, createHash("sha256").update(TOKEN, "utf8").digest("hex")]);
  }, 60_000);

  afterAll(async () => {
    if (server !== undefined) await server.close();
    if (pool !== undefined) {
      // Only the random schema created by this invocation is removed.
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
  }, 60_000);

  async function room(name: string, slug: string, venueId = VENUE): Promise<string> {
    const id = randomUUID();
    await pool.query("INSERT INTO spaces (id, venue_id, name, slug) VALUES ($1, $2, $3, $4)", [id, venueId, name, slug]);
    return id;
  }

  async function clientPage(): Promise<ClientPage> {
    const res = await server.inject({ method: "GET", url: `/proposal-share/${TOKEN}` });
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { data: ClientPage }).data;
  }

  it("tells the client the event's date, guests, occasion and the room they chose", async () => {
    const hall = await room("Grand Hall", "grand-hall");
    const enquiry = randomUUID();
    await pool.query(
      `INSERT INTO enquiries (id, venue_id, space_id, name, email, preferred_date, estimated_guests, event_type, state, room_chosen)
       VALUES ($1, $2, $3, 'Elaine Crawford', 'elaine@example.test', '2027-06-01', 150, 'wedding', 'approved', true)`,
      [enquiry, VENUE, hall],
    );
    const deal = randomUUID();
    await pool.query(
      `INSERT INTO opportunities (id, venue_id, title, stage, source_enquiry_id, preferred_date, guest_count, event_type, estimated_value_minor, currency, next_action)
       VALUES ($1, $2, 'Crawford wedding', 'proposal_sent', $3, '2027-06-05', 160, 'wedding', 0, 'GBP', 'Wait')`,
      [deal, VENUE, enquiry],
    );
    await pool.query("UPDATE proposals SET opportunity_id = $2 WHERE id = $1", [PROPOSAL, deal]);

    // The deal's date and guests stand over its enquiry's; the room is the one the guest chose.
    expect((await clientPage()).facts).toEqual({
      eventDate: "2027-06-05", guestCount: 160, occasion: "wedding", roomName: "Grand Hall", roomSlug: "grand-hall",
    });
    // A room the guest never chose is not presented as theirs.
    await pool.query("UPDATE enquiries SET room_chosen = false WHERE id = $1", [enquiry]);
    expect((await clientPage()).facts.roomName).toBeNull();
  });

  it("takes the room from the layout first, and tells nothing of another venue's", async () => {
    const saloon = await room("Saloon", "saloon");
    const configuration = randomUUID();
    await pool.query("INSERT INTO configurations (id, venue_id, space_id, name) VALUES ($1, $2, $3, 'Dinner rounds')", [configuration, VENUE, saloon]);
    const foreignDeal = randomUUID();
    await pool.query(
      `INSERT INTO opportunities (id, venue_id, title, stage, preferred_date, guest_count, event_type, estimated_value_minor, currency, next_action)
       VALUES ($1, $2, 'Elsewhere', 'qualified', '2027-01-01', 40, 'dinner', 0, 'GBP', 'Draft')`,
      [foreignDeal, OTHER_VENUE],
    );
    await pool.query("UPDATE proposals SET configuration_id = $2, opportunity_id = $3 WHERE id = $1", [PROPOSAL, configuration, foreignDeal]);
    expect((await clientPage()).facts).toEqual({ eventDate: null, guestCount: null, occasion: null, roomName: "Saloon", roomSlug: "saloon" });

    // Another venue's room behind the layout is not named either.
    await pool.query("UPDATE spaces SET venue_id = $2 WHERE id = $1", [saloon, OTHER_VENUE]);
    expect((await clientPage()).facts.roomName).toBeNull();
  });

  it("names who accepted it and when, as they gave their name", async () => {
    expect((await clientPage()).accepted).toBeNull();
    const approved = await server.inject({
      method: "POST", url: `/proposal-share/${TOKEN}/approve`, payload: { authorName: "Elaine Crawford" },
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const page = await clientPage();
    expect(page.status).toBe("accepted");
    expect(page.accepted?.by).toBe("Elaine Crawford");
    expect(Number.isNaN(Date.parse(page.accepted?.at ?? ""))).toBe(false);
  });

  it("lets the venue team read it as the client does, without counting as the client opening it", async () => {
    await clientPage();
    const opened = (await pool.query<{ last_viewed_at: Date | null }>("SELECT last_viewed_at FROM proposal_share_tokens")).rows[0]?.last_viewed_at ?? null;
    expect(opened).not.toBeNull();
    await pool.query("UPDATE proposal_share_tokens SET last_viewed_at = '2026-09-01T10:00:00Z'");

    const preview = await server.inject({ method: "GET", url: `/proposals/${PROPOSAL}/preview`, headers: headers() });
    expect(preview.statusCode, preview.body).toBe(200);
    expect((JSON.parse(preview.body) as { data: ClientPage & { title: string } }).data.title).toBe("Crawford wedding proposal");
    const after = (await pool.query<{ last_viewed_at: Date }>("SELECT last_viewed_at FROM proposal_share_tokens")).rows[0]?.last_viewed_at;
    expect(after?.toISOString()).toBe("2026-09-01T10:00:00.000Z");

    // Only its own venue's team (or whoever made it) may read it, and only
    // once there is a version.
    const stranger = headers(OTHER_VENUE, randomUUID());
    expect((await server.inject({ method: "GET", url: `/proposals/${PROPOSAL}/preview`, headers: stranger })).statusCode).toBe(403);
    await pool.query("UPDATE proposals SET current_version = 2 WHERE id = $1", [PROPOSAL]);
    const unsaved = await server.inject({ method: "GET", url: `/proposals/${PROPOSAL}/preview`, headers: headers() });
    expect(unsaved.statusCode).toBe(422);
    expect((JSON.parse(unsaved.body) as { code: string }).code).toBe("PROPOSAL_HAS_NO_VERSION");
  });

  // -------------------------------------------------------------------------
  // Two answers at once. Each action reads where the proposal stands and then
  // writes; a change that commits in between must not be written over. The
  // other side holds the row, as a transaction mid-way through its own change
  // does, while the request is made, then commits.
  // -------------------------------------------------------------------------

  async function waitingOnTheRow(): Promise<void> {
    await expect.poll(async () => Number((await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
      [fixtureSchema],
    )).rows[0]?.count), { timeout: 5000 }).toBe(1);
  }

  async function whileChanging<T>(to: string, request: () => Promise<T>): Promise<T> {
    const other = await pool.connect();
    try {
      await other.query("BEGIN");
      await other.query("UPDATE proposals SET status = $2, updated_at = now() WHERE id = $1", [PROPOSAL, to]);
      const pending = request();
      await waitingOnTheRow();
      await other.query("COMMIT");
      return await pending;
    } catch (error) {
      await other.query("ROLLBACK");
      throw error;
    } finally {
      other.release();
    }
  }

  async function stored(): Promise<{ status: string; moves: string[]; notes: string[] }> {
    const status = (await pool.query<{ status: string }>("SELECT status FROM proposals WHERE id = $1", [PROPOSAL])).rows[0]?.status ?? "";
    const moves = (await pool.query<{ to_status: string }>("SELECT to_status FROM proposal_status_history ORDER BY created_at")).rows.map((row) => row.to_status);
    const notes = (await pool.query<{ kind: string }>("SELECT kind FROM proposal_comments ORDER BY created_at")).rows.map((row) => row.kind);
    return { status, moves, notes };
  }

  const CLIENT_ANSWERS = [
    ["accepts through their link", { method: "POST" as const, url: `/proposal-share/${TOKEN}/approve`, payload: { authorName: "Elaine Crawford" } }],
    ["asks for changes through their link", { method: "POST" as const, url: `/proposal-share/${TOKEN}/comment`, payload: { body: "A later finish?", kind: "request_changes" } }],
    ["accepts through the older share code", { method: "POST" as const, url: `/public/proposals/${SHARE_CODE}/respond`, payload: { action: "accept" } }],
    ["asks for changes through the older share code", { method: "POST" as const, url: `/public/proposals/${SHARE_CODE}/respond`, payload: { action: "request_changes", note: "A later finish?" } }],
  ] as const;

  it.each(CLIENT_ANSWERS)("keeps a withdrawal that lands while the client %s", async (_, request) => {
    const res = await whileChanging("withdrawn", () => server.inject(request));
    expect(res.statusCode, res.body).toBe(409);
    expect((JSON.parse(res.body) as { code: string }).code).toBe("PROPOSAL_STATUS_CHANGED");
    // Nothing of the client's answer is kept against a proposal it no longer
    // answers: no move, and no note that reads as if it were taken.
    expect(await stored()).toEqual({ status: "withdrawn", moves: [], notes: [] });
  });

  it("keeps the client's acceptance that lands while the team withdraws", async () => {
    const res = await whileChanging("accepted", () => server.inject({
      method: "POST", url: `/proposals/${PROPOSAL}/transition`, headers: headers(), payload: { status: "withdrawn" },
    }));
    expect(res.statusCode, res.body).toBe(409);
    expect((JSON.parse(res.body) as { code: string }).code).toBe("PROPOSAL_STATUS_CHANGED");
    expect(await stored()).toEqual({ status: "accepted", moves: [], notes: [] });
  });

  it("keeps a withdrawal that lands while the team sends the proposal, and issues no link", async () => {
    await pool.query("UPDATE proposals SET status = 'changes_requested' WHERE id = $1", [PROPOSAL]);
    await pool.query("DELETE FROM proposal_share_tokens");
    const res = await whileChanging("withdrawn", () => server.inject({
      method: "POST", url: `/proposals/${PROPOSAL}/share-token`, headers: headers(),
    }));
    expect(res.statusCode, res.body).toBe(409);
    expect(await stored()).toEqual({ status: "withdrawn", moves: [], notes: [] });
    expect((await pool.query("SELECT id FROM proposal_share_tokens")).rowCount).toBe(0);
  });

  it("keeps both of two requests for changes at once, and moves the proposal once", async () => {
    const ask = (body: string) => server.inject({ method: "POST", url: `/proposal-share/${TOKEN}/comment`, payload: { body, kind: "request_changes" } });
    const [first, second] = await Promise.all([ask("A later finish?"), ask("And a piper?")]);
    expect([first?.statusCode, second?.statusCode], `${first?.body ?? ""} ${second?.body ?? ""}`).toEqual([201, 201]);
    expect(await stored()).toEqual({ status: "changes_requested", moves: ["changes_requested"], notes: ["request_changes", "request_changes"] });
  });

  it("answers a second acceptance as the first, and records it once", async () => {
    const [first, second] = await Promise.all([
      server.inject({ method: "POST", url: `/proposal-share/${TOKEN}/approve`, payload: { authorName: "Elaine Crawford" } }),
      server.inject({ method: "POST", url: `/proposal-share/${TOKEN}/approve`, payload: { authorName: "Elaine Crawford" } }),
    ]);
    expect([first?.statusCode, second?.statusCode], `${first?.body ?? ""} ${second?.body ?? ""}`).toEqual([200, 200]);
    expect(await stored()).toEqual({ status: "accepted", moves: ["accepted"], notes: ["approval_note"] });
  });
});
