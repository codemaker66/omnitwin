import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { opportunityRoutes } from "../routes/opportunities.js";

// ---------------------------------------------------------------------------
// Opportunity list and detail on isolated PostgreSQL.
//
// The list was ordered by `updated_at` ASC — oldest first — with limit/offset
// paging over a non-unique sort key, so two rows sharing a timestamp could
// appear on both pages or on neither. The detail bundle's follow-ups were
// ordered oldest-first while the board showed newest-first, so the same tasks
// read in opposite directions on two screens.
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
    throw new Error("Opportunity tests require their explicit isolated loopback database");
  }
}

const VENUE = "22222222-2222-4222-8222-222222222222";
const OTHER_VENUE = "22222222-2222-4222-8222-222222222999";
const STAFF = "33333333-3333-4333-8333-333333333333";

function opportunityId(suffix: number): string {
  return `bbbbbbbb-0000-4000-8000-0000000000${suffix.toString().padStart(2, "0")}`;
}

function headers(role = "staff", venueId: string | null = VENUE): { authorization: string } {
  return {
    authorization: `Bearer ${JSON.stringify({
      id: STAFF, email: "fixture@example.test", role, platformRole: "none", venueId,
    })}`,
  };
}

interface ListBody {
  readonly data: readonly { readonly id: string; readonly title: string }[];
  readonly meta: { readonly total: number; readonly limit: number; readonly offset: number };
}

interface DetailBody {
  readonly data: {
    readonly opportunity: { readonly id: string };
    readonly tasks: readonly { readonly title: string }[];
    readonly proposals: readonly { readonly title: string }[];
  };
}

describe.skipIf(testUrl === undefined)("opportunities on isolated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const fixtureSchema = `opportunities_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [
    schema.opportunities, schema.followUpTasks, schema.activities,
    schema.opportunityStatusHistory, schema.proposals,
    schema.users, schema.contacts, schema.clientAccounts, schema.enquiries, schema.spaces, schema.quotes,
  ];

  beforeAll(async () => {
    pool = new Pool({
      connectionString: testUrl, application_name: fixtureSchema, max: 4,
      options: `-c search_path=${fixtureSchema}`,
    });
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
    const db = drizzle(pool, { schema });
    server = Fastify();
    await server.register(opportunityRoutes, { db, prefix: "/opportunities" });
    await server.ready();
  }, 120_000);

  beforeEach(async () => {
    await pool.query("TRUNCATE opportunities, follow_up_tasks, activities, opportunity_status_history, proposals, users, contacts, client_accounts, enquiries, spaces, quotes");
    for (let index = 1; index <= 4; index += 1) {
      await pool.query(
        `INSERT INTO opportunities (id, venue_id, title, stage, estimated_value_minor, currency, next_action, created_at, updated_at)
         VALUES ($1, $2, $3, 'qualified', 100000, 'GBP', 'Follow up', $4, $4)`,
        [opportunityId(index), VENUE, `Opportunity ${String(index)}`, `2026-09-0${String(index)}T10:00:00.000Z`],
      );
    }
    await pool.query(
      `INSERT INTO opportunities (id, venue_id, title, stage, estimated_value_minor, currency, next_action, created_at, updated_at)
       VALUES ($1, $2, 'Other venue', 'qualified', 100000, 'GBP', 'Follow up', now(), now())`,
      [opportunityId(90), OTHER_VENUE],
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

  async function list(query = ""): Promise<ListBody> {
    const res = await server.inject({ method: "GET", url: `/opportunities${query}`, headers: headers() });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as ListBody;
  }

  it("lists opportunities newest first", async () => {
    const body = await list();
    expect(body.data.map((row) => row.title)).toEqual([
      "Opportunity 4", "Opportunity 3", "Opportunity 2", "Opportunity 1",
    ]);
  });

  it("pages deterministically when rows share a created_at instant", async () => {
    // Same instant for every row: without the id tiebreak the sort is not a
    // total order and offset paging may repeat or skip rows.
    await pool.query("UPDATE opportunities SET created_at = '2026-09-10T10:00:00.000Z' WHERE venue_id = $1", [VENUE]);

    const first = await list("?limit=2&offset=0");
    const second = await list("?limit=2&offset=2");
    expect(first.meta.total).toBe(4);
    const seen = [...first.data, ...second.data].map((row) => row.id);
    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
  });

  it("reports the unpaged total alongside the page", async () => {
    const page = await list("?limit=1");
    expect(page.data).toHaveLength(1);
    expect(page.meta.total).toBe(4);
    expect(page.meta.limit).toBe(1);
  });

  it("keeps the venue boundary on the list", async () => {
    const body = await list();
    expect(body.meta.total).toBe(4);
    expect(body.data.some((row) => row.title === "Other venue")).toBe(false);
  });

  it("orders an opportunity's follow-ups and proposals newest first", async () => {
    for (let index = 1; index <= 3; index += 1) {
      await pool.query(
        "INSERT INTO follow_up_tasks (opportunity_id, title, status, created_at, updated_at) VALUES ($1, $2, 'open', $3, $3)",
        [opportunityId(1), `Task ${String(index)}`, `2026-09-0${String(index)}T12:00:00.000Z`],
      );
      await pool.query(
        `INSERT INTO proposals (venue_id, opportunity_id, title, status, current_version, created_at, updated_at)
         VALUES ($1, $2, $3, 'draft', 0, $4, $4)`,
        [VENUE, opportunityId(1), `Proposal ${String(index)}`, `2026-09-0${String(index)}T12:00:00.000Z`],
      );
    }

    const res = await server.inject({
      method: "GET", url: `/opportunities/${opportunityId(1)}`, headers: headers(),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as DetailBody;
    expect(body.data.tasks.map((task) => task.title)).toEqual(["Task 3", "Task 2", "Task 1"]);
    expect(body.data.proposals.map((row) => row.title)).toEqual([
      "Proposal 3", "Proposal 2", "Proposal 1",
    ]);
  });

  it("says who the deal is with, the room they asked for, and every move with who made it and why", async () => {
    const account = randomUUID();
    const contact = randomUUID();
    const room = randomUUID();
    const enquiry = randomUUID();
    await pool.query("INSERT INTO users (id, email, name, display_name, role) VALUES ($1, 'catherine@example.test', 'C Tait', 'Catherine Tait', 'staff')", [STAFF]);
    await pool.query("INSERT INTO client_accounts (id, venue_id, name, account_type) VALUES ($1, $2, 'Henderson Family', 'individual')", [account, VENUE]);
    await pool.query(
      "INSERT INTO contacts (id, venue_id, client_account_id, name, email, phone) VALUES ($1, $2, $3, 'Ailsa Henderson', 'ailsa@example.test', '0141 555 0100')",
      [contact, VENUE, account],
    );
    await pool.query("INSERT INTO spaces (id, venue_id, name, slug) VALUES ($1, $2, 'Grand Hall', 'grand-hall')", [room, VENUE]);
    await pool.query(
      "INSERT INTO enquiries (id, venue_id, space_id, name, email, state, room_chosen) VALUES ($1, $2, $3, 'Ailsa Henderson', 'ailsa@example.test', 'approved', true)",
      [enquiry, VENUE, room],
    );
    await pool.query("UPDATE opportunities SET primary_contact_id = $2, source_enquiry_id = $3 WHERE id = $1", [opportunityId(1), contact, enquiry]);
    await pool.query(
      `INSERT INTO opportunity_status_history (opportunity_id, from_stage, to_stage, changed_by, note, created_at)
       VALUES ($1, 'new', 'qualified', $2, 'Date and numbers confirmed', '2026-09-03T10:00:00Z'),
              ($1, 'qualified', 'proposal_drafting', NULL, NULL, '2026-09-04T10:00:00Z')`,
      [opportunityId(1), STAFF],
    );

    const detail = async (): Promise<{ contact: unknown; room: string | null; history: unknown[] }> => {
      const res = await server.inject({ method: "GET", url: `/opportunities/${opportunityId(1)}`, headers: headers() });
      expect(res.statusCode).toBe(200);
      return (JSON.parse(res.body) as { data: { contact: unknown; room: string | null; history: unknown[] } }).data;
    };
    const found = await detail();
    expect(found.contact).toEqual({
      id: contact, name: "Ailsa Henderson", email: "ailsa@example.test", phone: "0141 555 0100", accountName: "Henderson Family",
    });
    expect(found.room).toBe("Grand Hall");
    expect(found.history).toEqual([
      expect.objectContaining({ fromStage: "qualified", toStage: "proposal_drafting", note: null, changedByName: null }),
      expect.objectContaining({ fromStage: "new", toStage: "qualified", note: "Date and numbers confirmed", changedByName: "Catherine Tait" }),
    ]);

    // A room the guest never chose is not presented as theirs.
    await pool.query("UPDATE enquiries SET room_chosen = false WHERE id = $1", [enquiry]);
    expect((await detail()).room).toBeNull();
    // Nor is another venue's contact, whatever the deal points at.
    await pool.query("UPDATE contacts SET venue_id = $2 WHERE id = $1", [contact, OTHER_VENUE]);
    expect((await detail()).contact).toBeNull();
  });

  it("offers the deal's newest live quote, made for it or for one of its proposals, and no other", async () => {
    const proposal = randomUUID();
    await pool.query(
      "INSERT INTO proposals (id, venue_id, opportunity_id, title, status, current_version) VALUES ($1, $2, $3, 'Henderson wedding', 'draft', 1)",
      [proposal, VENUE, opportunityId(1)],
    );
    const quote = async (name: string, day: number, link: { deal?: string; proposal?: string }, status = "draft", venueId = VENUE, deleted = false): Promise<void> => {
      await pool.query(
        `INSERT INTO quotes (venue_id, opportunity_id, proposal_id, name, status, currency, subtotal_minor, total_minor, created_at, updated_at, deleted_at)
         VALUES ($1, $2, $3, $4, $5, 'GBP', $6, $6, $7, $7, $8)`,
        [venueId, link.deal ?? null, link.proposal ?? null, name, status, 1_000_000 + day, `2026-09-${String(day).padStart(2, "0")}T10:00:00.000Z`, deleted ? new Date() : null],
      );
    };
    const latest = async (): Promise<{ name: string; totalMinor: number; currency: string; status: string } | null> => {
      const res = await server.inject({ method: "GET", url: `/opportunities/${opportunityId(1)}`, headers: headers() });
      expect(res.statusCode).toBe(200);
      return (JSON.parse(res.body) as { data: { latestQuote: { name: string; totalMinor: number; currency: string; status: string } | null } }).data.latestQuote;
    };

    expect(await latest()).toBeNull();
    await quote("First quote", 1, { deal: opportunityId(1) });
    expect(await latest()).toMatchObject({ name: "First quote", totalMinor: 1_000_001, currency: "GBP", status: "draft" });
    // A later one made for the deal's proposal alone is the latest.
    await quote("Revised quote", 5, { proposal });
    expect(await latest()).toMatchObject({ name: "Revised quote", totalMinor: 1_000_005 });
    // Replaced, declined, run out or deleted, another deal's, and another
    // venue's are all passed over, however new.
    await quote("Replaced", 6, { deal: opportunityId(1) }, "superseded");
    await quote("Declined", 7, { deal: opportunityId(1) }, "declined");
    await quote("Run out", 8, { deal: opportunityId(1) }, "expired");
    await quote("Deleted", 9, { deal: opportunityId(1) }, "draft", VENUE, true);
    await quote("Another deal", 10, { deal: opportunityId(2) });
    await quote("Elsewhere", 11, { deal: opportunityId(1) }, "draft", OTHER_VENUE);
    expect(await latest()).toMatchObject({ name: "Revised quote" });
    await quote("Accepted", 12, { deal: opportunityId(1) }, "accepted");
    expect(await latest()).toMatchObject({ name: "Accepted", status: "accepted" });
  });

  /** What the route asks of the pool while `work` runs: the clients it hands
   *  out (each query outside a transaction takes one), the queries sent, and
   *  the most of them waiting on an answer at once. Counting queries, not
   *  checkouts, keeps the measure off how fast the pool opens connections. */
  async function poolUse(work: () => Promise<void>): Promise<{ readonly acquired: number; readonly sent: number; readonly peak: number }> {
    let acquired = 0;
    let sent = 0;
    let outstanding = 0;
    let peak = 0;
    const acquire = (): void => { acquired += 1; };
    const original = pool.query.bind(pool) as (...args: unknown[]) => unknown;
    const counting = (...args: unknown[]): unknown => {
      sent += 1;
      outstanding += 1;
      peak = Math.max(peak, outstanding);
      const answer = original(...args);
      if (answer instanceof Promise) return answer.finally(() => { outstanding -= 1; });
      outstanding -= 1;
      return answer;
    };
    pool.on("acquire", acquire);
    pool.query = counting as typeof pool.query;
    try {
      await work();
    } finally {
      // The pool's own query is its class's; the counting one was this
      // pool's alone.
      Reflect.deleteProperty(pool, "query");
      pool.off("acquire", acquire);
    }
    return { acquired, sent, peak };
  }

  it("keeps a long-running deal's newest notes, answered oldest first", async () => {
    await pool.query(
      `INSERT INTO activities (opportunity_id, type, body, created_at)
       SELECT $1, 'note', 'Note ' || n, '2026-09-01T00:00:00Z'::timestamptz + n * interval '1 minute' FROM generate_series(0, 104) AS n`,
      [opportunityId(1)],
    );
    const res = await server.inject({ method: "GET", url: `/opportunities/${opportunityId(1)}`, headers: headers() });
    expect(res.statusCode, res.body).toBe(200);
    const notes = (JSON.parse(res.body) as { data: { activities: { body: string }[] } }).data.activities.map((row) => row.body);
    expect(notes).toHaveLength(100);
    expect(notes[0]).toBe("Note 5");
    expect(notes.at(-1)).toBe("Note 104");
  });

  it("answers a deal's detail whole and in one shape, reading its parts at once and only after its venue is checked", async () => {
    const account = randomUUID();
    const contact = randomUUID();
    const room = randomUUID();
    const enquiry = randomUUID();
    const proposal = randomUUID();
    await pool.query("INSERT INTO users (id, email, name, display_name, role) VALUES ($1, 'catherine@example.test', 'C Tait', 'Catherine Tait', 'staff')", [STAFF]);
    await pool.query("INSERT INTO client_accounts (id, venue_id, name, account_type) VALUES ($1, $2, 'Henderson Family', 'individual')", [account, VENUE]);
    await pool.query(
      "INSERT INTO contacts (id, venue_id, client_account_id, name, email, phone) VALUES ($1, $2, $3, 'Ailsa Henderson', 'ailsa@example.test', '0141 555 0100')",
      [contact, VENUE, account],
    );
    await pool.query("INSERT INTO spaces (id, venue_id, name, slug) VALUES ($1, $2, 'Grand Hall', 'grand-hall')", [room, VENUE]);
    await pool.query(
      "INSERT INTO enquiries (id, venue_id, space_id, name, email, state, room_chosen) VALUES ($1, $2, $3, 'Ailsa Henderson', 'ailsa@example.test', 'approved', true)",
      [enquiry, VENUE, room],
    );
    await pool.query("UPDATE opportunities SET primary_contact_id = $2, source_enquiry_id = $3 WHERE id = $1", [opportunityId(1), contact, enquiry]);
    await pool.query(
      `INSERT INTO activities (opportunity_id, type, body, created_by, created_at)
       VALUES ($1, 'call', 'First call', $2, '2026-09-02T09:00:00Z'), ($1, 'note', 'Site visit booked', NULL, '2026-09-03T09:00:00Z')`,
      [opportunityId(1), STAFF],
    );
    await pool.query(
      `INSERT INTO follow_up_tasks (opportunity_id, title, status, created_at, updated_at)
       VALUES ($1, 'Send the menus', 'open', '2026-09-02T12:00:00Z', '2026-09-02T12:00:00Z'),
              ($1, 'Book the tasting', 'open', '2026-09-04T12:00:00Z', '2026-09-04T12:00:00Z')`,
      [opportunityId(1)],
    );
    await pool.query(
      "INSERT INTO proposals (id, venue_id, opportunity_id, title, status, current_version) VALUES ($1, $2, $3, 'Henderson wedding', 'draft', 1)",
      [proposal, VENUE, opportunityId(1)],
    );
    await pool.query(
      `INSERT INTO opportunity_status_history (opportunity_id, from_stage, to_stage, changed_by, note, created_at)
       VALUES ($1, 'new', 'qualified', $2, 'Date and numbers confirmed', '2026-09-03T10:00:00Z')`,
      [opportunityId(1), STAFF],
    );
    await pool.query(
      `INSERT INTO quotes (venue_id, proposal_id, name, status, currency, subtotal_minor, total_minor, created_at, updated_at)
       VALUES ($1, $2, 'Wedding quote', 'issued', 'GBP', 1840000, 1840000, '2026-09-05T10:00:00Z', '2026-09-05T10:00:00Z')`,
      [VENUE, proposal],
    );

    let res: LightMyRequestResponse | undefined;
    const use = await poolUse(async () => {
      res = await server.inject({ method: "GET", url: `/opportunities/${opportunityId(1)}`, headers: headers() });
    });
    expect(res?.statusCode).toBe(200);
    const data = (JSON.parse(res?.body ?? "{}") as { data: Record<string, unknown> }).data;
    expect(Object.keys(data)).toEqual(["opportunity", "activities", "tasks", "proposals", "history", "contact", "room", "latestQuote"]);
    expect(data["opportunity"]).toMatchObject({ id: opportunityId(1), venueId: VENUE, title: "Opportunity 1", primaryContactId: contact, sourceEnquiryId: enquiry });
    // Activities oldest first; follow-ups and proposals newest first.
    expect((data["activities"] as { body: string; type: string }[]).map((row) => `${row.type}: ${row.body}`))
      .toEqual(["call: First call", "note: Site visit booked"]);
    expect((data["tasks"] as { title: string }[]).map((row) => row.title)).toEqual(["Book the tasting", "Send the menus"]);
    expect((data["proposals"] as { id: string }[]).map((row) => row.id)).toEqual([proposal]);
    expect(data["history"]).toEqual([expect.objectContaining({
      fromStage: "new", toStage: "qualified", note: "Date and numbers confirmed", changedByName: "Catherine Tait", createdAt: "2026-09-03T10:00:00.000Z",
    })]);
    expect(data["contact"]).toEqual({
      id: contact, name: "Ailsa Henderson", email: "ailsa@example.test", phone: "0141 555 0100", accountName: "Henderson Family",
    });
    expect(data["room"]).toBe("Grand Hall");
    expect(data["latestQuote"]).toEqual({
      id: expect.any(String) as unknown, name: "Wedding quote", status: "issued", currency: "GBP", totalMinor: 1_840_000, createdAt: "2026-09-05T10:00:00.000Z",
    });
    // The deal itself, then its seven parts, all asked for at once.
    expect(use.acquired).toBe(8);
    expect(use.sent).toBe(8);
    expect(use.peak).toBe(7);

    // Another venue's deal is refused, and nothing of it is read past the
    // deal's own row; a deleted one is not found.
    let refused: LightMyRequestResponse | undefined;
    const refusal = await poolUse(async () => {
      refused = await server.inject({ method: "GET", url: `/opportunities/${opportunityId(90)}`, headers: headers() });
    });
    expect(refused?.statusCode).toBe(403);
    expect(JSON.parse(refused?.body ?? "{}")).toEqual({ error: "Insufficient permissions", code: "FORBIDDEN" });
    expect(refusal.acquired).toBe(1);
    expect(refusal.sent).toBe(1);
    await pool.query("UPDATE opportunities SET deleted_at = now() WHERE id = $1", [opportunityId(2)]);
    const gone = await server.inject({ method: "GET", url: `/opportunities/${opportunityId(2)}`, headers: headers() });
    expect(gone.statusCode).toBe(404);
  });

  it("closes a deal as won or lost only with the reason it was", async () => {
    await pool.query("INSERT INTO users (id, email, name, role) VALUES ($1, 'catherine@example.test', 'Catherine Tait', 'staff')", [STAFF]);
    await pool.query("UPDATE opportunities SET stage = 'proposal_sent' WHERE id = $1", [opportunityId(1)]);
    const move = (id: string, body: Record<string, unknown>): Promise<LightMyRequestResponse> =>
      server.inject({ method: "PATCH", url: `/opportunities/${id}`, headers: headers(), payload: body });

    for (const body of [{ stage: "won" }, { stage: "won", note: "   " }, { stage: "lost", note: "" }]) {
      const refused = await move(body.stage === "won" ? opportunityId(1) : opportunityId(2), body);
      expect(refused.statusCode, JSON.stringify(body)).toBe(422);
      expect((JSON.parse(refused.body) as { code: string }).code).toBe("REASON_REQUIRED");
    }
    const unchanged = await pool.query<{ stage: string }>("SELECT stage FROM opportunities WHERE id = ANY($1) ORDER BY id", [[opportunityId(1), opportunityId(2)]]);
    expect(unchanged.rows.map((row) => row.stage)).toEqual(["proposal_sent", "qualified"]);

    const won = await move(opportunityId(1), { stage: "won", note: "Accepted the proposal for 5 June" });
    expect(won.statusCode).toBe(200);
    const lost = await move(opportunityId(2), { stage: "lost", note: "Chose another venue" });
    expect(lost.statusCode).toBe(200);
    const history = await pool.query<{ to_stage: string; note: string }>(
      "SELECT to_stage, note FROM opportunity_status_history WHERE opportunity_id = ANY($1) ORDER BY to_stage", [[opportunityId(1), opportunityId(2)]],
    );
    expect(history.rows).toEqual([
      { to_stage: "lost", note: "Chose another venue" },
      { to_stage: "won", note: "Accepted the proposal for 5 June" },
    ]);
    // Other moves still need no reason.
    expect((await move(opportunityId(3), { stage: "proposal_drafting" })).statusCode).toBe(200);
  });

  it("serves a venue's own admin, who used to be 403'd on their own opportunities", async () => {
    const res = await server.inject({ method: "GET", url: "/opportunities", headers: headers("admin") });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as ListBody;
    expect(body.meta.total).toBe(4);
  });

  it("rejects a role the commercial API does not serve", async () => {
    const res = await server.inject({ method: "GET", url: "/opportunities", headers: headers("planner", null) });
    expect(res.statusCode).toBe(403);
    const hallkeeper = await server.inject({ method: "GET", url: "/opportunities", headers: headers("hallkeeper") });
    expect(hallkeeper.statusCode).toBe(403);
  });
});
