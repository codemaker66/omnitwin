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

function headers(venueId = VENUE, id = STAFF, role = "staff"): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify({ id, email: "fixture@example.test", role, platformRole: "none", venueId })}` };
}

interface ClientPage {
  readonly title: string;
  readonly version: number;
  readonly venueSlug: string | null;
  readonly venueAddress: string | null;
  readonly facts: { eventDate: string | null; guestCount: number | null; occasion: string | null; roomName: string | null; roomSlug: string | null };
  readonly accepted: { by: string | null; at: string } | null;
  readonly status: string;
}

const NO_FACTS = { eventDate: null, guestCount: null, occasion: null, roomName: null, roomSlug: null };

describe.skipIf(testUrl === undefined)("the client's proposal page on isolated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const fixtureSchema = `client_page_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [
    schema.proposals, schema.proposalVersions, schema.proposalStatusHistory, schema.proposalComments,
    schema.proposalShareTokens, schema.packageSelections, schema.venues, schema.configurations, schema.spaces,
    schema.enquiries, schema.opportunities, schema.opportunityStatusHistory, schema.events, schema.eventConfigurationLinks,
    schema.handoffPacks, schema.eventPlanChanges, schema.eventPlanNotifications, schema.contacts,
  ];

  // The older share-code path retires on a date; these tests read it as it
  // stands until then.
  const sunset = process.env["LEGACY_PROPOSAL_SHARE_CODE_SUNSET"];

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
    if (sunset === undefined) delete process.env["LEGACY_PROPOSAL_SHARE_CODE_SUNSET"];
    else process.env["LEGACY_PROPOSAL_SHARE_CODE_SUNSET"] = sunset;
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

  it("names no room from a removed layout, or from another venue's", async () => {
    const saloon = await room("Saloon", "saloon");
    const configuration = randomUUID();
    await pool.query("INSERT INTO configurations (id, venue_id, space_id, name) VALUES ($1, $2, $3, 'Dinner rounds')", [configuration, VENUE, saloon]);
    await pool.query("UPDATE proposals SET configuration_id = $2 WHERE id = $1", [PROPOSAL, configuration]);
    expect((await clientPage()).facts.roomName).toBe("Saloon");
    await pool.query("UPDATE configurations SET deleted_at = now() WHERE id = $1", [configuration]);
    expect((await clientPage()).facts.roomName).toBeNull();
    await pool.query("UPDATE configurations SET deleted_at = NULL, venue_id = $2 WHERE id = $1", [configuration, OTHER_VENUE]);
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
    // Accepted without a message: the note kept in its place is not put in their mouth.
    expect(await notices()).toEqual([{
      title: "Elaine Crawford accepted Crawford wedding proposal", body: "Version 1.", action_path: `/dashboard?view=proposals&proposal=${PROPOSAL}`,
    }]);
  });

  async function notices(): Promise<readonly { title: string; body: string; action_path: string | null }[]> {
    // One row per commercial role, all alike: the words and the way in are the point here.
    const rows = await pool.query<{ title: string; body: string; action_path: string | null }>(
      "SELECT DISTINCT title, body, action_path FROM event_plan_notifications ORDER BY title",
    );
    return rows.rows;
  }

  it("tells the venue team who wrote or accepted, on which version, in their words, and opens the proposal", async () => {
    const proposalAt = `/dashboard?view=proposals&proposal=${PROPOSAL}`;
    const asked = await server.inject({
      method: "POST", url: `/proposal-share/${TOKEN}/comment`,
      payload: { kind: "comment", authorName: "Elaine Crawford", body: "Is there parking nearby?", version: 1 },
    });
    expect(asked.statusCode, asked.body).toBe(201);
    expect(await notices()).toEqual([{
      title: "Elaine Crawford wrote about Crawford wedding proposal", body: "Version 1. “Is there parking nearby?”", action_path: proposalAt,
    }]);

    await pool.query("TRUNCATE event_plan_notifications");
    const approved = await server.inject({
      method: "POST", url: `/proposal-share/${TOKEN}/approve`,
      payload: { authorName: "Elaine Crawford", body: "See you in June.", version: 1 },
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(await notices()).toEqual([{
      title: "Elaine Crawford accepted Crawford wedding proposal", body: "Version 1. “See you in June.”", action_path: proposalAt,
    }]);
  });

  it("tells the venue team what changes were asked for, on the version read, with no name when none was given", async () => {
    await pool.query("UPDATE proposals SET current_version = 2, sent_version = 1 WHERE id = $1", [PROPOSAL]);
    const changes = await server.inject({
      method: "POST", url: `/proposal-share/${TOKEN}/comment`,
      payload: { kind: "request_changes", body: "Could we start at seven?", version: 1 },
    });
    expect(changes.statusCode, changes.body).toBe(201);
    // The version the client was sent, not the draft saved since.
    expect(await notices()).toEqual([{
      title: "The client asked for changes to Crawford wedding proposal",
      body: "Version 1. “Could we start at seven?”",
      action_path: `/dashboard?view=proposals&proposal=${PROPOSAL}`,
    }]);
  });

  it("names the version accepted, not a draft saved since", async () => {
    await pool.query("UPDATE proposals SET current_version = 2, sent_version = 1 WHERE id = $1", [PROPOSAL]);
    const approved = await server.inject({ method: "POST", url: `/proposal-share/${TOKEN}/approve`, payload: { version: 1 } });
    expect(approved.statusCode, approved.body).toBe(200);
    expect((await notices()).map((notice) => notice.body)).toEqual(["Version 1."]);
  });

  it("names the version a question was asked on when the link has shown it, and the link's own otherwise", async () => {
    // Version 2 was sent while the client still had version 1 open.
    await pool.query("UPDATE proposals SET current_version = 2, sent_version = 2 WHERE id = $1", [PROPOSAL]);
    const ask = async (version: number | undefined, body: string): Promise<void> => {
      const res = await server.inject({
        method: "POST", url: `/proposal-share/${TOKEN}/comment`,
        payload: version === undefined ? { kind: "comment", body } : { kind: "comment", body, version },
      });
      expect(res.statusCode, res.body).toBe(201);
    };
    await ask(1, "Is the bar in the same place?");
    await ask(5, "Is there a cloakroom?");
    await ask(undefined, "Can we park nearby?");
    expect((await notices()).map((notice) => notice.body).sort()).toEqual([
      "Version 1. “Is the bar in the same place?”",
      "Version 2. “Can we park nearby?”",
      "Version 2. “Is there a cloakroom?”",
    ]);
  });

  it("refuses changes asked for on a version since replaced, even once changes were asked for on the newer one", async () => {
    // Version 2 was sent and changes were asked for on it; a page still showing version 1 asks too.
    await pool.query("UPDATE proposals SET status = 'changes_requested', current_version = 2, sent_version = 2 WHERE id = $1", [PROPOSAL]);
    const stale = await server.inject({
      method: "POST", url: `/proposal-share/${TOKEN}/comment`, payload: { kind: "request_changes", body: "Could the bar move?", version: 1 },
    });
    expect(stale.statusCode, stale.body).toBe(409);
    expect((JSON.parse(stale.body) as { code: string }).code).toBe("PROPOSAL_VERSION_CHANGED");
    expect(await notices()).toEqual([]);
    const current = await server.inject({
      method: "POST", url: `/proposal-share/${TOKEN}/comment`, payload: { kind: "request_changes", body: "And the stage?", version: 2 },
    });
    expect(current.statusCode, current.body).toBe(201);
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

  // -------------------------------------------------------------------------
  // The version the client was sent (X1). Versions saved since are the
  // team's drafts: the client's link keeps showing, and answers only, the one
  // sent, and the team can read the draft as the client will.
  // -------------------------------------------------------------------------

  async function saveVersion(version: number, title: string): Promise<void> {
    await pool.query("INSERT INTO proposal_versions (proposal_id, version, payload, coordinate_space) VALUES ($1, $2, $3, 'real_metre')",
      [PROPOSAL, version, JSON.stringify({ ...VERSION_PAYLOAD, title })]);
    await pool.query("UPDATE proposals SET current_version = $2 WHERE id = $1", [PROPOSAL, version]);
  }

  async function row(): Promise<{ status: string; sent_version: number | null; accepted_name: string | null; sent_at: Date | null }> {
    const found = (await pool.query<{ status: string; sent_version: number | null; accepted_name: string | null; sent_at: Date | null }>(
      "SELECT status, sent_version, accepted_name, sent_at FROM proposals WHERE id = $1", [PROPOSAL],
    )).rows[0];
    if (found === undefined) throw new Error("no proposal");
    return found;
  }

  it("shows the client the version they were sent, never one saved since, and the team the one saved", async () => {
    await pool.query("UPDATE proposals SET status = 'changes_requested', sent_version = 1 WHERE id = $1", [PROPOSAL]);
    await saveVersion(2, "Crawford wedding proposal, revised");

    const page = await clientPage();
    expect(page).toMatchObject({ version: 1, title: "Crawford wedding proposal", venueSlug: "trades-hall-glasgow", venueAddress: "85 Glassford Street" });

    // The older six-letter code shows the same version, and none of the
    // event's particulars.
    const legacy = await server.inject({ method: "GET", url: `/public/proposals/${SHARE_CODE}` });
    expect(legacy.statusCode, legacy.body).toBe(200);
    expect((JSON.parse(legacy.body) as { data: ClientPage }).data).toMatchObject({
      version: 1, title: "Crawford wedding proposal", facts: NO_FACTS, accepted: null, venueSlug: "trades-hall-glasgow",
    });

    const preview = await server.inject({ method: "GET", url: `/proposals/${PROPOSAL}/preview`, headers: headers() });
    expect(preview.statusCode, preview.body).toBe(200);
    expect((JSON.parse(preview.body) as { data: ClientPage & { sentVersion: number | null } }).data).toMatchObject({
      version: 2, title: "Crawford wedding proposal, revised", sentVersion: 1,
    });
  });

  it("lets the venue's commercial team preview it, and nobody else", async () => {
    const preview = (who: { authorization: string }) => server.inject({ method: "GET", url: `/proposals/${PROPOSAL}/preview`, headers: who });
    expect((await preview(headers(VENUE, randomUUID(), "sales"))).statusCode).toBe(200);
    // Prices are the commercial team's, not the hallkeeper's.
    expect((await preview(headers(VENUE, randomUUID(), "hallkeeper"))).statusCode).toBe(403);
    expect((await preview(headers(OTHER_VENUE, randomUUID(), "manager"))).statusCode).toBe(403);
    // Whoever made it, once they work at another venue, reads it no longer.
    expect((await preview(headers(OTHER_VENUE, STAFF))).statusCode).toBe(403);
  });

  const STALE_ANSWERS = [
    ["accepts through their link", { method: "POST" as const, url: `/proposal-share/${TOKEN}/approve`, payload: { authorName: "Elaine Crawford", version: 1 } }],
    ["asks for changes through their link", { method: "POST" as const, url: `/proposal-share/${TOKEN}/comment`, payload: { body: "A later finish?", kind: "request_changes", version: 1 } }],
    ["accepts through the older share code", { method: "POST" as const, url: `/public/proposals/${SHARE_CODE}/respond`, payload: { action: "accept", version: 1 } }],
    ["asks for changes through the older share code", { method: "POST" as const, url: `/public/proposals/${SHARE_CODE}/respond`, payload: { action: "request_changes", version: 1 } }],
  ] as const;

  it.each(STALE_ANSWERS)("refuses, and writes nothing, when the client %s on a version since replaced", async (_, request) => {
    await saveVersion(2, "Crawford wedding proposal, revised");
    await pool.query("UPDATE proposals SET sent_version = 2 WHERE id = $1", [PROPOSAL]);
    const res = await server.inject(request);
    expect(res.statusCode, res.body).toBe(409);
    expect((JSON.parse(res.body) as { code: string }).code).toBe("PROPOSAL_VERSION_CHANGED");
    expect(await stored()).toEqual({ status: "sent", moves: [], notes: [] });

    // On the version sent, it is taken.
    const fresh = await server.inject({ ...request, payload: { ...request.payload, version: 2 } });
    expect(fresh.statusCode, fresh.body).toBeLessThan(300);
  });

  it("keeps an acceptance's name to the acceptance itself", async () => {
    // Nobody with the link can write an approval of their own.
    const planted = await server.inject({
      method: "POST", url: `/proposal-share/${TOKEN}/comment`, payload: { body: "Approved.", kind: "approval_note", authorName: "Mallory" },
    });
    expect(planted.statusCode, planted.body).toBe(400);
    expect(await stored()).toEqual({ status: "sent", moves: [], notes: [] });

    // One written before this release is never taken for the acceptance's.
    const token = (await pool.query<{ id: string }>("SELECT id FROM proposal_share_tokens")).rows[0]?.id;
    await pool.query(
      `INSERT INTO proposal_comments (proposal_id, share_token_id, kind, author_name, body, is_client_visible)
       VALUES ($1, $2, 'approval_note', 'Mallory', 'Approved.', true)`,
      [PROPOSAL, token],
    );
    const accepted = await server.inject({ method: "POST", url: `/proposal-share/${TOKEN}/approve`, payload: { version: 1 } });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect((await clientPage()).accepted?.by).toBeNull();
  });

  it("gives the name as it was given, and drops it when the acceptance is not the client's by name", async () => {
    const accepted = await server.inject({ method: "POST", url: `/proposal-share/${TOKEN}/approve`, payload: { authorName: "  Elaine Crawford ", version: 1 } });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect((await row()).accepted_name).toBe("Elaine Crawford");

    // Reopened, then marked accepted by the team: no name stands.
    await pool.query("UPDATE proposals SET status = 'sent' WHERE id = $1", [PROPOSAL]);
    const marked = await server.inject({ method: "POST", url: `/proposals/${PROPOSAL}/transition`, headers: headers(), payload: { status: "accepted" } });
    expect(marked.statusCode, marked.body).toBe(200);
    expect((await row()).accepted_name).toBeNull();

    // Reopened, then accepted through the older code, which takes no name.
    await pool.query("UPDATE proposals SET status = 'sent', accepted_name = 'Elaine Crawford' WHERE id = $1", [PROPOSAL]);
    const legacy = await server.inject({ method: "POST", url: `/public/proposals/${SHARE_CODE}/respond`, payload: { action: "accept" } });
    expect(legacy.statusCode, legacy.body).toBe(200);
    expect((await row()).accepted_name).toBeNull();
  });

  it("still reads as accepted once the team archives it, and closes a link archived before acceptance", async () => {
    const accepted = await server.inject({ method: "POST", url: `/proposal-share/${TOKEN}/approve`, payload: { authorName: "Elaine Crawford", version: 1 } });
    expect(accepted.statusCode, accepted.body).toBe(200);
    await pool.query("UPDATE proposals SET status = 'archived' WHERE id = $1", [PROPOSAL]);
    await pool.query("INSERT INTO proposal_status_history (proposal_id, from_status, to_status) VALUES ($1, 'accepted', 'archived')", [PROPOSAL]);
    const page = await clientPage();
    expect(page.status).toBe("accepted");
    expect(page.accepted?.by).toBe("Elaine Crawford");
    // Pressed again, it is answered as accepted and nothing more is written.
    const again = await server.inject({ method: "POST", url: `/proposal-share/${TOKEN}/approve`, payload: { authorName: "Elaine Crawford", version: 1 } });
    expect(again.statusCode, again.body).toBe(200);
    expect(await stored()).toEqual({ status: "archived", moves: ["accepted", "archived"], notes: ["approval_note"] });

    // Archived while it was still with the client: the link is closed.
    await pool.query("DELETE FROM proposal_status_history");
    await pool.query("INSERT INTO proposal_status_history (proposal_id, from_status, to_status) VALUES ($1, 'sent', 'archived')", [PROPOSAL]);
    expect((await server.inject({ method: "GET", url: `/proposal-share/${TOKEN}` })).statusCode).toBe(404);
  });

  it("sends only the version the team was shown, freezes its facts, and stamps each send", async () => {
    const deal = randomUUID();
    await pool.query(
      `INSERT INTO opportunities (id, venue_id, title, stage, preferred_date, guest_count, event_type, estimated_value_minor, currency, next_action)
       VALUES ($1, $2, 'Crawford wedding', 'proposal_sent', '2027-06-05', 160, 'wedding', 0, 'GBP', 'Wait')`,
      [deal, VENUE],
    );
    await pool.query(
      "UPDATE proposals SET status = 'changes_requested', sent_version = 1, sent_at = '2026-09-01T10:00:00Z', opportunity_id = $2 WHERE id = $1",
      [PROPOSAL, deal],
    );
    const saved = await server.inject({
      method: "POST", url: `/proposals/${PROPOSAL}/versions`, headers: headers(),
      payload: { ...VERSION_PAYLOAD, title: "Crawford wedding proposal, revised", facts: { ...NO_FACTS, guestCount: 9999 } },
    });
    expect(saved.statusCode, saved.body).toBe(201);

    // Sending what the team read as version 1 is refused: version 2 is the
    // one that would go.
    const stale = await server.inject({ method: "POST", url: `/proposals/${PROPOSAL}/share-token`, headers: headers(), payload: { version: 1 } });
    expect(stale.statusCode, stale.body).toBe(409);
    expect((JSON.parse(stale.body) as { code: string }).code).toBe("PROPOSAL_VERSION_CHANGED");
    expect((await pool.query("SELECT id FROM proposal_share_tokens")).rowCount).toBe(1);
    expect(await row()).toMatchObject({ status: "changes_requested", sent_version: 1 });

    const sent = await server.inject({ method: "POST", url: `/proposals/${PROPOSAL}/share-token`, headers: headers(), payload: { version: 2 } });
    expect(sent.statusCode, sent.body).toBe(201);
    const after = await row();
    expect(after).toMatchObject({ status: "sent", sent_version: 2 });
    expect(after.sent_at?.getTime()).toBeGreaterThan(Date.parse("2026-09-02T00:00:00Z"));

    // The deal changes after the send; what was sent does not. Facts sent in
    // the request were never taken.
    await pool.query("UPDATE opportunities SET guest_count = 200 WHERE id = $1", [deal]);
    const page = await clientPage();
    expect(page).toMatchObject({ version: 2, title: "Crawford wedding proposal, revised" });
    expect(page.facts).toEqual({ eventDate: "2027-06-05", guestCount: 160, occasion: "wedding", roomName: null, roomSlug: null });
  });

  it("answers an acceptance on a version since replaced with 409, even once someone has accepted", async () => {
    await saveVersion(2, "Crawford wedding proposal, revised");
    await pool.query("UPDATE proposals SET sent_version = 2 WHERE id = $1", [PROPOSAL]);
    const first = await server.inject({ method: "POST", url: `/proposal-share/${TOKEN}/approve`, payload: { authorName: "Bea Crawford", version: 2 } });
    expect(first.statusCode, first.body).toBe(200);

    // A page still showing version 1 is not told it accepted.
    const stale = await server.inject({ method: "POST", url: `/proposal-share/${TOKEN}/approve`, payload: { authorName: "Alex Crawford", version: 1 } });
    expect(stale.statusCode, stale.body).toBe(409);
    expect((JSON.parse(stale.body) as { code: string }).code).toBe("PROPOSAL_VERSION_CHANGED");
    // The same version, pressed again by someone else, is answered as accepted already.
    const again = await server.inject({ method: "POST", url: `/proposal-share/${TOKEN}/approve`, payload: { authorName: "Alex Crawford", version: 2 } });
    expect(again.statusCode, again.body).toBe(200);
    expect(JSON.parse(again.body)).toEqual({ data: { status: "accepted", already: true } });
    expect(await stored()).toEqual({ status: "accepted", moves: ["accepted"], notes: ["approval_note"] });
    expect((await row()).accepted_name).toBe("Bea Crawford");

    // Archived by the team, it reads as accepted, and answers the same way.
    await pool.query("UPDATE proposals SET status = 'archived' WHERE id = $1", [PROPOSAL]);
    await pool.query("INSERT INTO proposal_status_history (proposal_id, from_status, to_status) VALUES ($1, 'accepted', 'archived')", [PROPOSAL]);
    expect((await server.inject({ method: "POST", url: `/proposal-share/${TOKEN}/approve`, payload: { version: 1 } })).statusCode).toBe(409);
  });

  it("previews what the client's link presents, and says when that link no longer opens", async () => {
    const preview = async (): Promise<ClientPage & { sentVersion: number | null; linkOpen: boolean }> => {
      const res = await server.inject({ method: "GET", url: `/proposals/${PROPOSAL}/preview`, headers: headers() });
      expect(res.statusCode, res.body).toBe(200);
      return (JSON.parse(res.body) as { data: ClientPage & { sentVersion: number | null; linkOpen: boolean } }).data;
    };
    await pool.query("UPDATE proposals SET sent_version = 1 WHERE id = $1", [PROPOSAL]);
    const accepted = await server.inject({ method: "POST", url: `/proposal-share/${TOKEN}/approve`, payload: { authorName: "Elaine Crawford", version: 1 } });
    expect(accepted.statusCode, accepted.body).toBe(200);
    await pool.query("UPDATE proposals SET status = 'archived' WHERE id = $1", [PROPOSAL]);
    await pool.query("INSERT INTO proposal_status_history (proposal_id, from_status, to_status) VALUES ($1, 'accepted', 'archived')", [PROPOSAL]);
    expect(await preview()).toMatchObject({ status: "accepted", accepted: { by: "Elaine Crawford" }, version: 1, sentVersion: 1, linkOpen: true });
    // The older code shows it accepted too, rather than as gone.
    const legacy = await server.inject({ method: "GET", url: `/public/proposals/${SHARE_CODE}` });
    expect(legacy.statusCode, legacy.body).toBe(200);
    expect((JSON.parse(legacy.body) as { data: ClientPage }).data.status).toBe("accepted");

    // Withdrawn: the link no longer opens, and the preview says so.
    await pool.query("DELETE FROM proposal_status_history");
    await pool.query("UPDATE proposals SET status = 'withdrawn', accepted_name = NULL WHERE id = $1", [PROPOSAL]);
    expect(await preview()).toMatchObject({ status: "withdrawn", linkOpen: false, accepted: null });

    // A version saved since the one sent carries no standing of the sent one.
    await pool.query("UPDATE proposals SET status = 'accepted', accepted_name = 'Elaine Crawford' WHERE id = $1", [PROPOSAL]);
    await pool.query("INSERT INTO proposal_status_history (proposal_id, from_status, to_status) VALUES ($1, 'sent', 'accepted')", [PROPOSAL]);
    await saveVersion(2, "Crawford wedding proposal, amended");
    expect(await preview()).toMatchObject({ version: 2, sentVersion: 1, accepted: null, linkOpen: true });
  });

  it("stamps a new link that sends a version saved since, so opens are counted from it", async () => {
    await pool.query("UPDATE proposals SET sent_version = 1, sent_at = '2026-09-20T10:00:00Z' WHERE id = $1", [PROPOSAL]);
    // A new link sending the same version is not a new send.
    const same = await server.inject({ method: "POST", url: `/proposals/${PROPOSAL}/share-token`, headers: headers(), payload: { version: 1 } });
    expect(same.statusCode, same.body).toBe(201);
    expect((await row()).sent_at?.toISOString()).toBe("2026-09-20T10:00:00.000Z");
    // A platform administrator saved version 2 while version 1 was out.
    await saveVersion(2, "Crawford wedding proposal, revised");
    const newer = await server.inject({ method: "POST", url: `/proposals/${PROPOSAL}/share-token`, headers: headers(), payload: { version: 2 } });
    expect(newer.statusCode, newer.body).toBe(201);
    const after = await row();
    expect(after.sent_version).toBe(2);
    expect(after.sent_at?.getTime()).toBeGreaterThan(Date.parse("2026-09-21T00:00:00Z"));
  });

  it("names the version answered, not a draft saved since, in the deal's history", async () => {
    const deal = randomUUID();
    await pool.query(
      `INSERT INTO opportunities (id, venue_id, title, stage, estimated_value_minor, currency, next_action)
       VALUES ($1, $2, 'Crawford wedding', 'proposal_sent', 0, 'GBP', 'Wait')`,
      [deal, VENUE],
    );
    await pool.query("UPDATE proposals SET opportunity_id = $2, sent_version = 1 WHERE id = $1", [PROPOSAL, deal]);
    // A platform administrator's draft, not on the link.
    await saveVersion(2, "Crawford wedding proposal, draft");
    const accepted = await server.inject({ method: "POST", url: `/proposal-share/${TOKEN}/approve`, payload: { authorName: "Elaine Crawford", version: 1 } });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const notes = (await pool.query<{ note: string | null }>("SELECT note FROM opportunity_status_history WHERE opportunity_id = $1", [deal])).rows
      .map((row) => row.note ?? "").join(" ");
    expect(notes).toContain("(version 1)");
    expect(notes).not.toContain("(version 2)");
  });

  it("shows no version for a proposal answered before any was saved", async () => {
    await pool.query("DELETE FROM proposal_versions");
    await pool.query("UPDATE proposals SET status = 'accepted', current_version = 0, sent_version = NULL WHERE id = $1", [PROPOSAL]);
    // A platform administrator saves a first version after the answer.
    await saveVersion(1, "Saved after the answer");
    await pool.query("UPDATE proposals SET sent_version = NULL WHERE id = $1", [PROPOSAL]);
    expect((await server.inject({ method: "GET", url: `/proposal-share/${TOKEN}` })).statusCode).toBe(404);
    expect((await server.inject({ method: "GET", url: `/public/proposals/${SHARE_CODE}` })).statusCode).toBe(404);
  });

  it("keeps an answered proposal on the version that was answered when another link is made", async () => {
    await pool.query("UPDATE proposals SET status = 'accepted', sent_version = 1 WHERE id = $1", [PROPOSAL]);
    // A platform administrator saved version 2 after the acceptance.
    await saveVersion(2, "Crawford wedding proposal, amended");
    const link = await server.inject({ method: "POST", url: `/proposals/${PROPOSAL}/share-token`, headers: headers(), payload: { version: 2 } });
    expect(link.statusCode, link.body).toBe(201);
    expect(await row()).toMatchObject({ status: "accepted", sent_version: 1 });
    expect((await clientPage()).version).toBe(1);
  });
});
