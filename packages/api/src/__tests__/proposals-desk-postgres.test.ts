import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { proposalRoutes } from "../routes/proposals.js";

// ---------------------------------------------------------------------------
// The Proposals desk's ledger (roadmap X1) on isolated PostgreSQL.
//
// Only real rows show the desk's order across paging, that a row's client,
// date and guests come from its own deal or enquiry and never another
// venue's, that the latest version's total is read from its saved payload,
// and that the counts cover the whole list rather than the page.
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
    throw new Error("Proposals desk tests require their explicit isolated loopback database");
  }
}

const VENUE = "22222222-2222-4222-8222-222222222222";
const OTHER_VENUE = "22222222-2222-4222-8222-222222222999";
const STAFF = "33333333-3333-4333-8333-333333333333";

function headers(role = "staff", venueId: string | null = VENUE, id = STAFF): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify({ id, email: "fixture@example.test", role, platformRole: "none", venueId })}` };
}

interface DeskRow {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly dealTitle: string | null;
  readonly clientName: string | null;
  readonly eventDate: string | null;
  readonly guestCount: number | null;
  readonly eventType: string | null;
  readonly latestTotalMinor: number | null;
  readonly latestCurrency: string | null;
}

interface DeskBody {
  readonly data: readonly DeskRow[];
  readonly meta: { readonly total: number; readonly limit: number; readonly offset: number };
  readonly statusCounts: Readonly<Record<string, number>>;
}

describe.skipIf(testUrl === undefined)("the Proposals desk's ledger on isolated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const fixtureSchema = `proposals_desk_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [schema.proposals, schema.proposalVersions, schema.opportunities, schema.contacts, schema.enquiries];

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
    server = Fastify();
    await server.register(proposalRoutes, { db: drizzle(pool, { schema }), prefix: "/proposals" });
    await server.ready();
  }, 120_000);

  beforeEach(async () => {
    await pool.query("TRUNCATE proposals, proposal_versions, opportunities, contacts, enquiries");
  });

  afterAll(async () => {
    if (server !== undefined) await server.close();
    if (pool !== undefined) {
      // Only the random schema created by this invocation is removed.
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
  }, 60_000);

  async function proposal(title: string, status: string, updatedAt: string, links: { deal?: string; enquiry?: string; venueId?: string; createdBy?: string; version?: number } = {}): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO proposals (id, venue_id, opportunity_id, enquiry_id, title, status, current_version, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
      [id, links.venueId ?? VENUE, links.deal ?? null, links.enquiry ?? null, title, status, links.version ?? 0, links.createdBy ?? STAFF, updatedAt],
    );
    return id;
  }

  async function desk(query = ""): Promise<DeskBody> {
    const res = await server.inject({ method: "GET", url: `/proposals/desk${query}`, headers: headers() });
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as DeskBody;
  }

  it("lists what the client sent back first, then drafts, what is with the client, accepted and closed, newest change first in each", async () => {
    await proposal("Sent older", "sent", "2026-09-01T10:00:00Z");
    await proposal("Draft", "draft", "2026-09-02T10:00:00Z");
    await proposal("Declined", "declined", "2026-09-20T10:00:00Z");
    await proposal("Changes asked", "changes_requested", "2026-09-03T10:00:00Z");
    await proposal("Sent newer", "sent", "2026-09-10T10:00:00Z");
    await proposal("Accepted", "accepted", "2026-09-04T10:00:00Z");
    await proposal("Withdrawn", "withdrawn", "2026-09-21T10:00:00Z");

    expect((await desk()).data.map((row) => row.title)).toEqual([
      "Changes asked", "Draft", "Sent newer", "Sent older", "Accepted", "Withdrawn", "Declined",
    ]);
  });

  it("shows one group, and counts every status over the whole list rather than the page", async () => {
    for (const [title, status] of [["A", "sent"], ["B", "sent"], ["C", "declined"], ["D", "expired"], ["E", "archived"], ["F", "draft"]] as const) {
      await proposal(title, status, "2026-09-05T10:00:00Z");
    }
    await proposal("Elsewhere", "sent", "2026-09-05T10:00:00Z", { venueId: OTHER_VENUE });

    const closed = await desk("?group=closed&limit=2");
    expect(closed.data).toHaveLength(2);
    expect(closed.data.every((row) => ["declined", "expired", "archived"].includes(row.status))).toBe(true);
    expect(closed.meta.total).toBe(3);
    expect(closed.statusCounts).toEqual({ sent: 2, declined: 1, expired: 1, archived: 1, draft: 1 });
    expect((await server.inject({ method: "GET", url: "/proposals/desk?group=everything", headers: headers() })).statusCode).toBe(400);
  });

  it("pages in its order without repeating or dropping a row", async () => {
    for (let index = 0; index < 7; index += 1) await proposal(`Sent ${String(index)}`, "sent", "2026-09-05T10:00:00Z");
    const seen: string[] = [];
    for (let offset = 0; offset < 7; offset += 3) seen.push(...(await desk(`?limit=3&offset=${String(offset)}`)).data.map((row) => row.id));
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it("says who each is for, when and how many, from its deal or its enquiry, never another venue's", async () => {
    const contact = randomUUID();
    const foreignContact = randomUUID();
    await pool.query("INSERT INTO contacts (id, venue_id, name, email) VALUES ($1, $2, 'Ailsa Henderson', 'ailsa@example.test'), ($3, $4, 'Someone Else', 'else@example.test')",
      [contact, VENUE, foreignContact, OTHER_VENUE]);
    const enquiry = randomUUID();
    const dealEnquiry = randomUUID();
    await pool.query(
      `INSERT INTO enquiries (id, venue_id, name, email, preferred_date, estimated_guests, event_type, state)
       VALUES ($1, $2, 'Iain Robertson', 'iain@example.test', '2026-11-20', 90, 'dinner', 'approved'),
              ($3, $2, 'Ailsa (enquiry)', 'ailsa@example.test', '2027-06-01', 150, 'wedding', 'approved')`,
      [enquiry, VENUE, dealEnquiry],
    );
    const deal = randomUUID();
    const foreignContactDeal = randomUUID();
    const foreignDeal = randomUUID();
    await pool.query(
      `INSERT INTO opportunities (id, venue_id, title, stage, primary_contact_id, source_enquiry_id, preferred_date, guest_count, event_type, estimated_value_minor, currency, next_action)
       VALUES ($1, $2, 'Henderson wedding', 'proposal_sent', $3, $4, '2027-06-05', 160, 'wedding', 0, 'GBP', 'Wait'),
              ($5, $2, 'Gala with a stranger', 'qualified', $6, NULL, NULL, NULL, 'gala', 0, 'GBP', 'Draft'),
              ($7, $8, 'Another venue deal', 'qualified', NULL, NULL, '2027-01-01', 40, 'dinner', 0, 'GBP', 'Draft')`,
      [deal, VENUE, contact, dealEnquiry, foreignContactDeal, foreignContact, foreignDeal, OTHER_VENUE],
    );
    const fromDeal = await proposal("Henderson proposal", "sent", "2026-09-05T10:00:00Z", { deal });
    const fromEnquiry = await proposal("Merchants proposal", "draft", "2026-09-05T10:00:00Z", { enquiry });
    const stranger = await proposal("Gala proposal", "draft", "2026-09-04T10:00:00Z", { deal: foreignContactDeal });
    const foreign = await proposal("Pointing elsewhere", "draft", "2026-09-03T10:00:00Z", { deal: foreignDeal });

    const byId = new Map((await desk()).data.map((row) => [row.id, row]));
    // The deal's own date and guests win over its enquiry's; its contact names it.
    expect(byId.get(fromDeal)).toMatchObject({
      dealTitle: "Henderson wedding", clientName: "Ailsa Henderson", eventDate: "2027-06-05", guestCount: 160, eventType: "wedding",
    });
    expect(byId.get(fromEnquiry)).toMatchObject({
      dealTitle: null, clientName: "Iain Robertson", eventDate: "2026-11-20", guestCount: 90, eventType: "dinner",
    });
    // Another venue's contact is never shown, whatever the deal points at.
    expect(byId.get(stranger)).toMatchObject({ dealTitle: "Gala with a stranger", clientName: null, eventDate: null });
    // Nor is another venue's deal.
    expect(byId.get(foreign)).toMatchObject({ dealTitle: null, clientName: null, eventDate: null, guestCount: null });
  });

  it("gives a proposal opened by its address the same facts as its row", async () => {
    const enquiry = randomUUID();
    await pool.query(
      `INSERT INTO enquiries (id, venue_id, name, email, preferred_date, estimated_guests, event_type, state)
       VALUES ($1, $2, 'Iain Robertson', 'iain@example.test', '2026-11-20', 90, 'dinner', 'approved')`,
      [enquiry, VENUE],
    );
    const id = await proposal("Merchants proposal", "sent", "2026-09-05T10:00:00Z", { enquiry, version: 1 });
    await pool.query(`INSERT INTO proposal_versions (proposal_id, version, payload) VALUES ($1, 1, '{"quote": {"totalMinor": 620000, "currency": "GBP"}}')`, [id]);
    const res = await server.inject({ method: "GET", url: `/proposals/${id}`, headers: headers() });
    expect(res.statusCode).toBe(200);
    expect((JSON.parse(res.body) as { data: DeskRow }).data).toMatchObject({
      id, title: "Merchants proposal", clientName: "Iain Robertson", eventDate: "2026-11-20", guestCount: 90, eventType: "dinner",
      latestTotalMinor: 620_000, latestCurrency: "GBP",
    });
  });

  it("says what the latest version comes to, and nothing for one without a quote", async () => {
    const quoted = await proposal("Quoted", "sent", "2026-09-05T10:00:00Z", { version: 2 });
    const unquoted = await proposal("Unquoted", "draft", "2026-09-05T10:00:00Z", { version: 1 });
    const unsaved = await proposal("Unsaved", "draft", "2026-09-05T10:00:00Z");
    await pool.query(
      `INSERT INTO proposal_versions (proposal_id, version, payload) VALUES
       ($1, 1, '{"quote": {"totalMinor": 1500000, "currency": "GBP"}}'),
       ($1, 2, '{"quote": {"totalMinor": 1840000, "currency": "GBP"}}'),
       ($2, 1, '{"quote": null}')`,
      [quoted, unquoted],
    );
    const byId = new Map((await desk()).data.map((row) => [row.id, row]));
    expect(byId.get(quoted)).toMatchObject({ latestTotalMinor: 1_840_000, latestCurrency: "GBP" });
    expect(byId.get(unquoted)).toMatchObject({ latestTotalMinor: null, latestCurrency: null });
    expect(byId.get(unsaved)).toMatchObject({ latestTotalMinor: null, latestCurrency: null });
  });

  it("keeps each venue's proposals to itself, and a role without the commercial desk to its own", async () => {
    await proposal("Ours", "draft", "2026-09-05T10:00:00Z");
    await proposal("Theirs", "draft", "2026-09-05T10:00:00Z", { venueId: OTHER_VENUE, createdBy: randomUUID() });
    expect((await desk()).data.map((row) => row.title)).toEqual(["Ours"]);

    const planner = randomUUID();
    await proposal("A planner's own", "draft", "2026-09-06T10:00:00Z", { createdBy: planner });
    const own = await server.inject({ method: "GET", url: "/proposals/desk", headers: headers("planner", null, planner) });
    expect(own.statusCode).toBe(200);
    const body = JSON.parse(own.body) as DeskBody;
    expect(body.data.map((row) => row.title)).toEqual(["A planner's own"]);
    expect(body.statusCounts).toEqual({ draft: 1 });
  });
});
