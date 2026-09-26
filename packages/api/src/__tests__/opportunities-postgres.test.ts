import Fastify, { type FastifyInstance } from "fastify";
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
    await pool.query("TRUNCATE opportunities, follow_up_tasks, activities, opportunity_status_history, proposals");
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
