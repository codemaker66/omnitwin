import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { crmRoutes } from "../routes/crm.js";

// ---------------------------------------------------------------------------
// CRM pipeline on isolated PostgreSQL.
//
// Ordering and pagination are invisible to a mocked-database test by
// construction: `orderBy(updatedAt)` and `orderBy(desc(createdAt), desc(id))`
// both "work" against a mock. Only real rows in a real table show that the
// board was ordered oldest-first, that its stage counts came from a silently
// truncated 200-row window, and that its pipeline total was summed in the
// browser from whatever page happened to be loaded.
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
    throw new Error("CRM pipeline tests require their explicit isolated loopback database");
  }
}

const VENUE = "22222222-2222-4222-8222-222222222222";
const OTHER_VENUE = "22222222-2222-4222-8222-222222222999";
const STAFF = "33333333-3333-4333-8333-333333333333";

function opportunityId(suffix: number): string {
  return `aaaaaaaa-0000-4000-8000-0000000000${suffix.toString().padStart(2, "0")}`;
}

function headers(
  role: string,
  venueId: string | null = VENUE,
  platformRole: "none" | "admin" = "none",
): { authorization: string } {
  return {
    authorization: `Bearer ${JSON.stringify({
      id: STAFF, email: "fixture@example.test", role, platformRole, venueId,
    })}`,
  };
}

interface PipelineBody {
  readonly data: {
    readonly opportunities: readonly { readonly id: string; readonly title: string; readonly contactName?: string | null }[];
    readonly todayTasks: readonly { readonly id: string; readonly title: string }[];
    readonly stageCounts: Record<string, number>;
    readonly stageValues: Record<string, number>;
    readonly due: { readonly overdue: number; readonly today: number };
    readonly pipelineValueMinor: number;
    readonly currency: string;
    // Inside `data`, not beside it: the shared web client unwraps `data`
    // before any caller sees the envelope, so a sibling `meta` never reaches
    // the board — and the board is what needs these numbers.
    readonly page: {
      readonly total: number;
      readonly limit: number;
      readonly offset: number;
      readonly taskTotal: number;
      readonly taskLimit: number;
      readonly taskOffset: number;
    };
  };
}

describe.skipIf(testUrl === undefined)("CRM pipeline on isolated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;
  const fixtureSchema = `crm_pipeline_${randomUUID().replaceAll("-", "")}`;
  // Only the tables the routes under test read and write. `POST
  // /crm/from-enquiry` keeps its auth coverage in commercial-spine-routes.test.ts;
  // here it meets real concurrency.
  const tables: PgTable[] = [
    schema.opportunities, schema.followUpTasks, schema.activities,
    schema.opportunityStatusHistory, schema.enquiries, schema.clientAccounts, schema.contacts,
  ];

  beforeAll(async () => {
    pool = new Pool({
      connectionString: testUrl, application_name: fixtureSchema, max: 4,
      options: `-c search_path=${fixtureSchema}`,
    });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    // Columns derive from the real Drizzle schema; no production migration or
    // data is touched. Minimal defaults only, enough for the routes under test.
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
    await server.register(crmRoutes, { db, prefix: "/crm" });
    await server.ready();
    // Schema creation from the Drizzle table config is slower than the
    // suite's 10s default hook budget on a cold Windows checkout.
  }, 120_000);

  beforeEach(async () => {
    await pool.query("TRUNCATE opportunities, follow_up_tasks, activities, opportunity_status_history, enquiries, client_accounts, contacts");
    // Five opportunities created on five consecutive days, inserted
    // oldest-first so a route that forgets to sort returns them in exactly
    // the wrong order and the assertions below fail loudly.
    for (let index = 1; index <= 5; index += 1) {
      await pool.query(
        `INSERT INTO opportunities (id, venue_id, title, stage, estimated_value_minor, currency, next_action, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'GBP', 'Follow up', $6, $6)`,
        [
          opportunityId(index), VENUE, `Opportunity ${String(index)}`,
          index === 5 ? "won" : "qualified",
          index * 100_000,
          `2026-09-0${String(index)}T10:00:00.000Z`,
        ],
      );
    }
    // A sixth in another venue proves the venue boundary still holds.
    await pool.query(
      `INSERT INTO opportunities (id, venue_id, title, stage, estimated_value_minor, currency, next_action, created_at, updated_at)
       VALUES ($1, $2, 'Other venue', 'qualified', 9000000, 'GBP', 'Follow up', now(), now())`,
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

  async function pipeline(query = ""): Promise<PipelineBody> {
    const res = await server.inject({ method: "GET", url: `/crm/pipeline${query}`, headers: headers("staff") });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as PipelineBody;
  }

  it("makes one deal of an enquiry, however many presses reach it at once", async () => {
    const enquiryId = randomUUID();
    await pool.query(
      `INSERT INTO enquiries (id, venue_id, space_id, name, email, state, event_type, room_chosen)
       VALUES ($1, $2, $3, 'Elaine Fraser', 'elaine@example.test', 'approved', 'wedding', false)`,
      [enquiryId, VENUE, randomUUID()],
    );
    const press = (): Promise<LightMyRequestResponse> =>
      server.inject({ method: "POST", url: `/crm/from-enquiry/${enquiryId}`, headers: headers("staff") });
    const responses = await Promise.all([press(), press(), press()]);
    expect(responses.map((res) => res.statusCode).sort()).toEqual([200, 200, 201]);
    const ids = responses.map((res) => (JSON.parse(res.body) as { data: { opportunity: { id: string } } }).data.opportunity.id);
    expect(new Set(ids).size).toBe(1);
    for (const table of ["opportunities", "client_accounts", "contacts"]) {
      const { rows } = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table} WHERE source_enquiry_id = $1`, [enquiryId]);
      expect(rows[0]?.count, table).toBe(1);
    }
    // A later press lands on the same deal.
    const again = await press();
    expect(again.statusCode).toBe(200);
    expect((JSON.parse(again.body) as { data: { created: boolean; opportunity: { id: string } } }).data).toMatchObject({ created: false, opportunity: { id: ids[0] } });
  });

  it("returns the pipeline newest first", async () => {
    const body = await pipeline();
    expect(body.data.opportunities.map((row) => row.title)).toEqual([
      "Opportunity 5", "Opportunity 4", "Opportunity 3", "Opportunity 2", "Opportunity 1",
    ]);
  });

  it("pages without repeating or dropping a row, and reports the true total", async () => {
    const first = await pipeline("?limit=2&offset=0");
    const second = await pipeline("?limit=2&offset=2");
    const third = await pipeline("?limit=2&offset=4");

    expect(first.data.page.total).toBe(5);
    expect(first.data.opportunities).toHaveLength(2);
    expect(second.data.opportunities).toHaveLength(2);
    expect(third.data.opportunities).toHaveLength(1);

    const seen = [...first.data.opportunities, ...second.data.opportunities, ...third.data.opportunities]
      .map((row) => row.id);
    expect(new Set(seen).size).toBe(5);
  });

  it("hands the board the numbers it needs to page honestly", async () => {
    // Stage counts span the whole pipeline, so a board without these reads
    // "qualified 4" above one card and offers no way to the rest.
    const page = await pipeline("?limit=2&offset=2");
    expect(page.data.page).toMatchObject({ total: 5, limit: 2, offset: 2 });
    expect(page.data.page.taskLimit).toBeGreaterThan(0);
  });

  it("orders the desk's view by when each open deal's next step is due, then the closed, and leaves the archived out", async () => {
    const due = async (suffix: number, at: string | null): Promise<void> => {
      await pool.query("UPDATE opportunities SET next_action_due_at = $2 WHERE id = $1", [opportunityId(suffix), at]);
    };
    await due(1, "2026-10-09T09:00:00.000Z");
    await due(2, null);
    await due(3, "2026-10-02T09:00:00.000Z");
    await due(4, "2026-10-05T09:00:00.000Z");
    // Won and lost come last, most recently closed first, whatever their dates.
    await pool.query("UPDATE opportunities SET closed_at = '2026-09-20T10:00:00Z', next_action_due_at = '2026-09-01T09:00:00Z' WHERE id = $1", [opportunityId(5)]);
    await pool.query(
      `INSERT INTO opportunities (id, venue_id, title, stage, estimated_value_minor, currency, next_action, closed_at, created_at, updated_at)
       VALUES ($1, $2, 'Lost later', 'lost', 50000, 'GBP', 'Record the reason', '2026-09-25T10:00:00Z', now(), now()),
              ($3, $2, 'Put away', 'archived', 70000, 'GBP', 'No next action', NULL, now(), now())`,
      [opportunityId(6), VENUE, opportunityId(7)],
    );

    const desk = await pipeline("?order=due");
    expect(desk.data.opportunities.map((row) => row.title)).toEqual([
      "Opportunity 3", "Opportunity 4", "Opportunity 1", "Opportunity 2", "Lost later", "Opportunity 5",
    ]);
    expect(desk.data.page.total).toBe(6);
    // Paging the desk's order repeats and drops nothing.
    const pages = await Promise.all([0, 2, 4].map((offset) => pipeline(`?order=due&limit=2&offset=${String(offset)}`)));
    expect(pages.flatMap((page) => page.data.opportunities.map((row) => row.title)))
      .toEqual(desk.data.opportunities.map((row) => row.title));
    // The board's own order still has every deal, archived included, newest first.
    expect((await pipeline()).data.page.total).toBe(7);
  });

  it("says what the deals at each stage are worth, over the whole pipeline", async () => {
    const page = await pipeline("?limit=1&order=due");
    // Opportunities 1–4 are qualified (100k–400k); 5 is won (500k).
    expect(page.data.stageValues["qualified"]).toBe(1_000_000);
    expect(page.data.stageValues["won"]).toBe(500_000);
    expect(page.data.stageValues["lost"]).toBe(0);
    // Another venue's 9,000,000 is in none of them.
    expect(Object.values(page.data.stageValues).reduce((sum, value) => sum + value, 0)).toBe(1_500_000);
  });

  it("shows one stage when asked, and pages it honestly", async () => {
    const won = await pipeline("?order=due&stage=won");
    expect(won.data.opportunities.map((row) => row.title)).toEqual(["Opportunity 5"]);
    expect(won.data.page.total).toBe(1);
    const qualified = await pipeline("?stage=qualified&limit=3");
    expect(qualified.data.page.total).toBe(4);
    expect(qualified.data.opportunities).toHaveLength(3);
    const refused = await server.inject({ method: "GET", url: "/crm/pipeline?stage=nonsense", headers: headers("staff") });
    expect(refused.statusCode).toBe(400);
  });

  it("counts the open deals whose next step is due today or already past, on the venue's calendar", async () => {
    // Glasgow's today at noon, yesterday, and a week on; the won deal's past
    // date is history, not a step anyone owes.
    await pool.query(
      `UPDATE opportunities SET next_action_due_at = CASE id
         WHEN $1 THEN ((now() AT TIME ZONE 'Europe/London')::date + time '12:00') AT TIME ZONE 'Europe/London'
         WHEN $2 THEN ((now() AT TIME ZONE 'Europe/London')::date - 1 + time '12:00') AT TIME ZONE 'Europe/London'
         WHEN $3 THEN ((now() AT TIME ZONE 'Europe/London')::date + 7 + time '12:00') AT TIME ZONE 'Europe/London'
         WHEN $4 THEN ((now() AT TIME ZONE 'Europe/London')::date - 3 + time '12:00') AT TIME ZONE 'Europe/London'
       END WHERE id IN ($1, $2, $3, $4)`,
      [opportunityId(1), opportunityId(2), opportunityId(3), opportunityId(5)],
    );
    const body = await pipeline("?order=due&limit=1");
    expect(body.data.due).toEqual({ overdue: 1, today: 1 });
  });

  it("names the deal each open follow-up is for", async () => {
    await pool.query(
      "INSERT INTO follow_up_tasks (opportunity_id, title, status, due_at) VALUES ($1, 'Send the menu', 'open', '2026-10-01T12:00:00Z')",
      [opportunityId(3)],
    );
    const tasks = (await pipeline()).data.todayTasks as readonly { title: string; opportunityTitle?: string | null }[];
    expect(tasks).toEqual([expect.objectContaining({ title: "Send the menu", opportunityTitle: "Opportunity 3" })]);
  });

  it("names who each deal is with, and never another venue's contact", async () => {
    const ailsa = randomUUID();
    const stranger = randomUUID();
    await pool.query(
      `INSERT INTO contacts (id, venue_id, name, email) VALUES ($1, $2, 'Ailsa Henderson', 'ailsa@example.test'), ($3, $4, 'Somebody Else', 'else@example.test')`,
      [ailsa, VENUE, stranger, OTHER_VENUE],
    );
    await pool.query("UPDATE opportunities SET primary_contact_id = $2 WHERE id = $1", [opportunityId(1), ailsa]);
    await pool.query("UPDATE opportunities SET primary_contact_id = $2 WHERE id = $1", [opportunityId(2), stranger]);
    const rows = (await pipeline("?order=due")).data.opportunities;
    expect(rows.find((row) => row.id === opportunityId(1))?.contactName).toBe("Ailsa Henderson");
    expect(rows.find((row) => row.id === opportunityId(2))?.contactName).toBeNull();
  });

  it("counts stages over the whole pipeline, not over the page", async () => {
    const page = await pipeline("?limit=1");
    expect(page.data.opportunities).toHaveLength(1);
    // Four qualified plus one won exist; a page of one must still say so.
    expect(page.data.stageCounts["qualified"]).toBe(4);
    expect(page.data.stageCounts["won"]).toBe(1);
    // Every stage in the vocabulary is present, not only the occupied ones.
    expect(page.data.stageCounts["lost"]).toBe(0);
  });

  it("serves one pipeline value that excludes closed stages and ignores paging", async () => {
    // 100k + 200k + 300k + 400k are open; the 500k "won" row is not pipeline.
    const full = await pipeline();
    const onePage = await pipeline("?limit=1");
    expect(full.data.pipelineValueMinor).toBe(1_000_000);
    expect(onePage.data.pipelineValueMinor).toBe(1_000_000);
    expect(full.data.currency).toBe("GBP");

    const valueRes = await server.inject({
      method: "GET", url: "/crm/pipeline/value", headers: headers("staff"),
    });
    expect(valueRes.statusCode).toBe(200);
    const value = JSON.parse(valueRes.body) as { data: { totalMinor: number; currency: string } };
    // The board and the dedicated value route must agree exactly.
    expect(value.data.totalMinor).toBe(full.data.pipelineValueMinor);
  });

  it("totals a pipeline past a 32-bit sum instead of failing", async () => {
    // Each opportunity fits in its integer column, but a venue's open pipeline
    // is their sum: three at £10,000,000 are 3,000,000,000 minor units, past
    // the 2,147,483,647 an int cast can hold. The dashboard's own totals are
    // bounded only by exact integer precision, and so is this one.
    for (let index = 11; index <= 13; index += 1) {
      await pool.query(
        `INSERT INTO opportunities (id, venue_id, title, stage, estimated_value_minor, currency, next_action, created_at, updated_at)
         VALUES ($1, $2, $3, 'qualified', 1000000000, 'GBP', 'Follow up', now(), now())`,
        [opportunityId(index), VENUE, `Large opportunity ${String(index)}`],
      );
    }
    const expected = 1_000_000 + 3_000_000_000;
    expect((await pipeline()).data.pipelineValueMinor).toBe(expected);
    const valueRes = await server.inject({ method: "GET", url: "/crm/pipeline/value", headers: headers("staff") });
    expect(valueRes.statusCode, valueRes.body).toBe(200);
    expect((JSON.parse(valueRes.body) as { data: { totalMinor: number } }).data.totalMinor).toBe(expected);
  });

  it("keeps the venue boundary", async () => {
    const body = await pipeline();
    expect(body.data.page.total).toBe(5);
    expect(body.data.opportunities.some((row) => row.title === "Other venue")).toBe(false);
  });

  it("scopes open follow-ups to the venue rather than to the loaded page", async () => {
    await pool.query(
      "INSERT INTO follow_up_tasks (opportunity_id, title, due_at, status) VALUES ($1, 'Call the client', $2, 'open')",
      [opportunityId(1), "2026-09-20T09:00:00.000Z"],
    );
    await pool.query(
      "INSERT INTO follow_up_tasks (opportunity_id, title, due_at, status) VALUES ($1, 'Send the quote', $2, 'open')",
      [opportunityId(5), "2026-09-18T09:00:00.000Z"],
    );
    await pool.query(
      "INSERT INTO follow_up_tasks (opportunity_id, title, due_at, status) VALUES ($1, 'Already done', $2, 'done')",
      [opportunityId(2), "2026-09-19T09:00:00.000Z"],
    );

    // A one-row page must still surface the task hanging off a row it did not
    // return; the old code only looked at the current page's opportunity ids.
    const page = await pipeline("?limit=1");
    expect(page.data.page.taskTotal).toBe(2);
    expect(page.data.todayTasks.map((task) => task.title)).toEqual([
      "Send the quote", "Call the client", // due 18th before due 20th
    ]);
  });

  it("serves a venue's own admin, who used to be 403'd on their own pipeline", async () => {
    const board = await server.inject({ method: "GET", url: "/crm/pipeline", headers: headers("admin") });
    expect(board.statusCode).toBe(200);
    const value = await server.inject({ method: "GET", url: "/crm/pipeline/value", headers: headers("admin") });
    expect(value.statusCode).toBe(200);
  });

  it("serves the manager and sales roles the commercial capability now covers", async () => {
    for (const role of ["manager", "sales"]) {
      const res = await server.inject({ method: "GET", url: "/crm/pipeline", headers: headers(role) });
      expect(res.statusCode, `role ${role}`).toBe(200);
    }
  });

  it("rejects a role the commercial API does not serve", async () => {
    const res = await server.inject({ method: "GET", url: "/crm/pipeline", headers: headers("planner", null) });
    expect(res.statusCode).toBe(403);
    // A hallkeeper runs the room; the commercial board is not theirs.
    const hallkeeper = await server.inject({ method: "GET", url: "/crm/pipeline", headers: headers("hallkeeper") });
    expect(hallkeeper.statusCode).toBe(403);
  });

  it("validates pagination input before touching the database", async () => {
    const res = await server.inject({
      method: "GET", url: "/crm/pipeline?limit=0", headers: headers("staff"),
    });
    expect(res.statusCode).toBe(400);
  });
});
