import Fastify, { type FastifyInstance } from "fastify";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { enquiryRoutes } from "../routes/enquiries.js";

// ---------------------------------------------------------------------------
// GET /enquiries ordering and paging as the route builds them: the staff
// dashboard pages newest first with limit/offset, the default stays least
// recently updated first, and `meta` echoes the order it applied (an older
// API omits it, which is how the web knows not to claim an order).
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
const VENUE_ID = "00000000-0000-4000-8000-000000009101";
const ACTOR_ID = "00000000-0000-4000-8000-000000009102";

interface CapturedSelect {
  counted: boolean;
  where: SQL | undefined;
  orderBy: SQLWrapper[];
  limit: number | null;
  offset: number | null;
}

const selects: CapturedSelect[] = [];
let listedRows: unknown[] = [];
let countedTotal = 0;

function select(fields?: unknown) {
  const captured: CapturedSelect = { counted: fields !== undefined, where: undefined, orderBy: [], limit: null, offset: null };
  selects.push(captured);
  const query = {
    from() { return query; },
    where(value: SQL | undefined) { captured.where = value; return query; },
    limit(value: number) { captured.limit = value; return query; },
    offset(value: number) { captured.offset = value; return query; },
    orderBy(...values: SQLWrapper[]) { captured.orderBy = values; return query; },
    then(resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(captured.counted ? [{ count: countedTotal }] : listedRows).then(resolve, reject);
    },
  };
  return query;
}

let server: FastifyInstance;
beforeAll(async () => {
  server = Fastify();
  const db: Database = Object.assign(drizzle.mock({ schema }), { select });
  await server.register(enquiryRoutes, { db, prefix: "/enquiries" });
  await server.ready();
});
afterAll(async () => { await server.close(); });
beforeEach(() => {
  selects.length = 0;
  listedRows = [];
  countedTotal = 0;
});

function staffHeaders(): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify({ id: ACTOR_ID, email: "list@test.invalid", role: "staff", venueId: VENUE_ID, platformRole: "none" })}` };
}

function rendered(fragment: SQLWrapper[] | SQL | undefined): { sql: string; params: unknown[] } | null {
  if (fragment === undefined) return null;
  const chunk = Array.isArray(fragment) ? sql.join(fragment, sql`, `) : fragment;
  return new PgDialect().sqlToQuery(chunk.getSQL());
}

function rowsSelect(): CapturedSelect {
  const captured = selects.find((entry) => !entry.counted);
  if (captured === undefined) throw new Error("The route did not select rows");
  return captured;
}

describe("GET /enquiries order and paging", () => {
  it("pages newest first by creation, ties broken by id, and echoes the page it served", async () => {
    listedRows = [{ id: "row-a" }, { id: "row-b" }];
    countedTotal = 57;
    const response = await server.inject({ method: "GET", url: "/enquiries?order=created_desc&limit=20&offset=40", headers: staffHeaders() });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      data: [{ id: "row-a" }, { id: "row-b" }],
      meta: { total: 57, limit: 20, offset: 40, order: "created_desc" },
    });
    const rows = rowsSelect();
    expect(rendered(rows.orderBy)?.sql).toBe('"enquiries"."created_at" desc, "enquiries"."id" desc');
    expect(rows).toMatchObject({ limit: 20, offset: 40 });
    const count = selects.find((entry) => entry.counted);
    expect(count).toMatchObject({ orderBy: [], limit: null, offset: null });
  });

  it("keeps least recently updated first, 20 rows from the start, as the default", async () => {
    countedTotal = 3;
    const response = await server.inject({ method: "GET", url: "/enquiries", headers: staffHeaders() });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<{ meta: unknown }>().meta).toEqual({ total: 3, limit: 20, offset: 0, order: "updated_asc" });
    const rows = rowsSelect();
    expect(rendered(rows.orderBy)?.sql).toBe('"enquiries"."updated_at"');
    expect(rows).toMatchObject({ limit: 20, offset: 0 });
  });

  it("filters one status within the caller's venue for the rows and their total alike", async () => {
    const response = await server.inject({
      method: "GET", url: "/enquiries?status=submitted&order=created_desc&limit=25&offset=15", headers: staffHeaders(),
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(selects).toHaveLength(2);
    const [count, rows] = [selects.find((entry) => entry.counted), rowsSelect()];
    expect(count?.where).toBe(rows.where);
    const predicate = rendered(rows.where);
    expect(predicate?.sql).toContain('"enquiries"."state" = $1');
    expect(predicate?.sql).toContain('"enquiries"."venue_id" = $2');
    expect(predicate?.params).toEqual(["submitted", VENUE_ID]);
    expect(rows).toMatchObject({ limit: 25, offset: 15 });
  });

  it.each(["limit=0", "limit=101", "limit=2.5", "limit=many", "offset=-1", "offset=1.5", "order=created_asc", "order=updated_desc"])(
    "rejects an invalid page query before reading anything: %s",
    async (query) => {
      const response = await server.inject({ method: "GET", url: `/enquiries?${query}`, headers: staffHeaders() });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ code: string }>().code).toBe("VALIDATION_ERROR");
      expect(selects).toHaveLength(0);
    },
  );
});
