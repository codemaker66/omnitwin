import Fastify, { type FastifyInstance } from "fastify";
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
    readonly opportunities: readonly { readonly id: string; readonly title: string }[];
    readonly todayTasks: readonly { readonly id: string; readonly title: string }[];
    readonly stageCounts: Record<string, number>;
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
  // Only the tables the routes under test read. `POST /crm/from-enquiry`
  // keeps its existing auth coverage in commercial-spine-routes.test.ts.
  const tables: PgTable[] = [
    schema.opportunities, schema.followUpTasks, schema.activities,
    schema.opportunityStatusHistory,
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
    await pool.query("TRUNCATE opportunities, follow_up_tasks, activities, opportunity_status_history");
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
