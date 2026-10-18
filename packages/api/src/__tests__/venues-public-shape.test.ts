import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { getTableColumns } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { spaces, venues } from "../db/schema.js";
import { PUBLIC_SPACE_COLUMNS, PUBLIC_VENUE_COLUMNS, venueRoutes } from "../routes/venues.js";

// GET /venues and GET /venues/:id are open to anyone. A live check found them
// returning whole rows, billing state and deletion time included. These tests
// pin what the public may see, and are written so that a column added to the
// tables later cannot reach the public by default:
//
//   1. Both routes must name their columns. The stub database behaves like
//      Drizzle: select(fields) keeps only the named keys, and select() with no
//      argument returns the whole row, so a route that goes back to
//      select() leaks the sentinel values below and fails.
//   2. Every column of venues and spaces has to be classified as public or
//      private. Adding a column breaks the classification test until someone
//      decides, and the route only ever returns the public list.

const VENUE_ID = "00000000-0000-4000-8000-000000000001";
const SPACE_ID = "00000000-0000-4000-8000-000000000002";

/** Every venue column that is not public, kept private on purpose. */
const PRIVATE_VENUE_COLUMNS = ["subscriptionStatus", "planTier", "createdAt", "updatedAt", "deletedAt"];
/** Every space column that is not on the public route. */
const PRIVATE_SPACE_COLUMNS = ["description", "meshUrl", "thumbnailUrl", "sortOrder", "createdAt", "updatedAt", "deletedAt"];

/** A venue row as the table would hold it, with a sentinel in each private column. */
const VENUE_ROW: Record<string, unknown> = {
  id: VENUE_ID,
  name: "Trades Hall",
  slug: "trades-hall-glasgow",
  address: "85 Glassford Street, Glasgow",
  logoUrl: null,
  brandColour: "#8a6d3b",
  timezone: "Europe/London",
  latitude: 55.8594,
  longitude: -4.2431,
  subscriptionStatus: "past_due",
  planTier: "enterprise-secret-plan",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-02-01T00:00:00Z"),
  deletedAt: null,
};

const SPACE_ROW: Record<string, unknown> = {
  id: SPACE_ID,
  venueId: VENUE_ID,
  name: "Grand Hall",
  slug: "grand-hall",
  widthM: "21.00",
  lengthM: "10.50",
  heightM: "7.00",
  floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }],
  description: "private-description-sentinel",
  meshUrl: "https://example.test/private-mesh.glb",
  thumbnailUrl: "https://example.test/private-thumb.png",
  sortOrder: 3,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-02-01T00:00:00Z"),
  deletedAt: null,
};

interface SelectCall { fields: Record<string, unknown> | undefined; table: unknown }

/** A Drizzle-shaped stub: select(fields).from(table)... resolves to the rows
 *  the table would return, shaped by the projection the route asked for. */
function projectingDb(calls: SelectCall[]): unknown {
  const project = (row: Record<string, unknown>, fields: Record<string, unknown> | undefined): Record<string, unknown> =>
    fields === undefined
      ? { ...row }
      : Object.fromEntries(Object.keys(fields).map((key) => [key, row[key]]));

  const select = (fields?: Record<string, unknown>): unknown => {
    const call: SelectCall = { fields, table: undefined };
    calls.push(call);
    const builder: Record<string, unknown> = {};
    builder["from"] = (table: unknown) => { call.table = table; return builder; };
    for (const name of ["where", "limit", "offset", "orderBy"]) builder[name] = () => builder;
    builder["then"] = (resolve: (rows: unknown[]) => unknown) => {
      if (fields !== undefined && "count" in fields) return resolve([{ count: 1 }]);
      const row = call.table === spaces ? SPACE_ROW : VENUE_ROW;
      return resolve([project(row, fields)]);
    };
    return builder;
  };
  return { select };
}

let server: FastifyInstance;
let calls: SelectCall[];

beforeEach(async () => {
  calls = [];
  server = Fastify({ logger: false });
  await server.register(venueRoutes, { db: projectingDb(calls) as Database, prefix: "/venues" });
  await server.ready();
});

afterEach(async () => { await server.close(); });

const FORBIDDEN_SUBSTRINGS = ["subscription", "plantier", "deletedat", "deleted_at", "past_due", "enterprise-secret-plan"];

function expectNoBillingOrDeletion(body: string): void {
  const lower = body.toLowerCase();
  for (const word of FORBIDDEN_SUBSTRINGS) expect(lower).not.toContain(word);
}

describe("public venue columns", () => {
  it("classifies every venues column as public or private", () => {
    const all = Object.keys(getTableColumns(venues)).sort();
    const classified = [...Object.keys(PUBLIC_VENUE_COLUMNS), ...PRIVATE_VENUE_COLUMNS].sort();
    expect(classified).toEqual(all);
  });

  it("classifies every spaces column as public or private", () => {
    const all = Object.keys(getTableColumns(spaces)).sort();
    const classified = [...Object.keys(PUBLIC_SPACE_COLUMNS), ...PRIVATE_SPACE_COLUMNS].sort();
    expect(classified).toEqual(all);
  });

  it("never lists billing, plan or deletion columns as public", () => {
    for (const forbidden of ["subscriptionStatus", "planTier", "deletedAt"]) {
      expect(Object.keys(PUBLIC_VENUE_COLUMNS)).not.toContain(forbidden);
      expect(Object.keys(PUBLIC_SPACE_COLUMNS)).not.toContain(forbidden);
    }
  });
});

describe("GET /venues public shape", () => {
  it("returns only the public venue fields", async () => {
    const response = await server.inject({ method: "GET", url: "/venues" });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: Record<string, unknown>[]; meta: { total: number } }>();
    expect(body.meta.total).toBe(1);
    expect(body.data).toHaveLength(1);
    expect(Object.keys(body.data[0] ?? {}).sort()).toEqual(Object.keys(PUBLIC_VENUE_COLUMNS).sort());
    expect(body.data[0]).toMatchObject({ id: VENUE_ID, slug: "trades-hall-glasgow", timezone: "Europe/London" });
    expectNoBillingOrDeletion(response.body);
  });

  it("names its columns rather than selecting the whole row", async () => {
    await server.inject({ method: "GET", url: "/venues" });
    const rowSelect = calls.find((call) => call.table === venues && call.fields !== undefined && !("count" in call.fields));
    expect(rowSelect?.fields).toBe(PUBLIC_VENUE_COLUMNS);
    expect(calls.every((call) => call.fields !== undefined)).toBe(true);
  });
});

describe("GET /venues/:id public shape", () => {
  it("returns only the public venue and space fields", async () => {
    const response = await server.inject({ method: "GET", url: `/venues/${VENUE_ID}` });
    expect(response.statusCode).toBe(200);
    const { data } = response.json<{ data: Record<string, unknown> & { spaces: Record<string, unknown>[] } }>();
    const { spaces: venueSpaces, ...venue } = data;
    expect(Object.keys(venue).sort()).toEqual(Object.keys(PUBLIC_VENUE_COLUMNS).sort());
    expect(venueSpaces).toHaveLength(1);
    expect(Object.keys(venueSpaces[0] ?? {}).sort()).toEqual(Object.keys(PUBLIC_SPACE_COLUMNS).sort());
    expect(venueSpaces[0]).toMatchObject({ id: SPACE_ID, venueId: VENUE_ID, widthM: "21.00", slug: "grand-hall" });
    expectNoBillingOrDeletion(response.body);
    expect(response.body).not.toContain("private-description-sentinel");
    expect(response.body).not.toContain("private-mesh");
  });

  it("names its columns for the venue and for its spaces", async () => {
    await server.inject({ method: "GET", url: `/venues/${VENUE_ID}` });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.fields).toBe(PUBLIC_VENUE_COLUMNS);
    expect(calls[1]?.fields).toBe(PUBLIC_SPACE_COLUMNS);
  });

  it("still answers 404 when no live venue matches", async () => {
    const empty = Fastify({ logger: false });
    const none = (): unknown => ({ select: () => {
      const builder: Record<string, unknown> = {};
      for (const name of ["from", "where", "limit"]) builder[name] = () => builder;
      builder["then"] = (resolve: (rows: unknown[]) => unknown) => resolve([]);
      return builder;
    } });
    await empty.register(venueRoutes, { db: none() as Database, prefix: "/venues" });
    const response = await empty.inject({ method: "GET", url: `/venues/${VENUE_ID}` });
    expect(response.statusCode).toBe(404);
    await empty.close();
  });
});
