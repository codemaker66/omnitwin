import Fastify, { type FastifyInstance } from "fastify";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { SQL } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { enquiryRoutes } from "../routes/enquiries.js";

process.env["NODE_ENV"] = "test";
const VENUE_ID = "00000000-0000-4000-8000-000000009001";
const ACTOR_ID = "00000000-0000-4000-8000-000000009002";
const predicates: (SQL | undefined)[] = [];

function select(fields?: unknown) {
  const result = fields === undefined ? [] : [{ count: 0 }];
  const query = {
    from() { return query; },
    where(value: SQL | undefined) { predicates.push(value); return query; },
    limit() { return query; },
    offset() { return query; },
    orderBy() { return query; },
    then(resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(result).then(resolve, reject);
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
beforeEach(() => { predicates.length = 0; });

async function inbox(role: string, venueId: string | null, platformRole = "none", query = "") {
  const response = await server.inject({ method: "GET", url: `/enquiries${query}`, headers: {
    authorization: `Bearer ${JSON.stringify({ id: ACTOR_ID, email: "inbox@test.invalid", role, venueId, platformRole })}`,
  } });
  expect(response.statusCode, response.body).toBe(200);
  expect(predicates).toHaveLength(2);
  expect(predicates[0]).toBe(predicates[1]);
  return predicates[0] === undefined ? null : new PgDialect().sqlToQuery(predicates[0]);
}

describe("enquiry inbox count and row authority", () => {
  it.each(["staff", "hallkeeper", "admin"])("scopes ordinary venue %s rows and count to their assigned venue", async (role) => {
    const predicate = await inbox(role, VENUE_ID);
    expect(predicate?.sql).toContain('"enquiries"."venue_id"');
    expect(predicate?.sql).not.toContain('"enquiries"."user_id"');
    expect(predicate?.params).toEqual([VENUE_ID]);
  });
  it.each(["client", "planner", "admin"])("uses owner-only rows/count when %s has no venue authority", async (role) => {
    const predicate = await inbox(role, null);
    expect(predicate?.sql).toContain('"enquiries"."user_id"');
    expect(predicate?.params).toEqual([ACTOR_ID]);
  });
  it("does not turn a venue-assigned client into venue staff", async () => {
    expect((await inbox("client", VENUE_ID))?.params).toEqual([ACTOR_ID]);
  });
  it("retains the status predicate alongside ordinary admin venue scope", async () => {
    const predicate = await inbox("admin", VENUE_ID, "none", "?status=submitted&limit=1&offset=1");
    expect(predicate?.params).toEqual(["submitted", VENUE_ID]);
  });
  it("retains explicit platform administrator scope", async () => {
    expect(await inbox("admin", null, "admin")).toBeNull();
  });
});
