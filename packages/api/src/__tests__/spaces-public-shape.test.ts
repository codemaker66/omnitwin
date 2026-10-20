import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { Database } from "../db/client.js";
import { referenceLoadouts, spaces } from "../db/schema.js";
import { spaceRoutes } from "../routes/spaces.js";
import { PUBLIC_SPACE_COLUMNS } from "../routes/venues.js";

// GET /venues/:venueId/spaces and GET /venues/:venueId/spaces/:id are open to
// anyone. They used to select the whole row, so the columns PR #129 classed as
// private for the venue route's nested spaces went to anyone who asked. These
// tests pin the same public list for both routes:
//
//   1. Each route names PUBLIC_SPACE_COLUMNS (the very same object) in its
//      select. The stub database behaves like Drizzle: select(fields) keeps
//      only the named keys, and select() with no argument returns the whole
//      row, so a route that goes back to select() leaks the sentinel values
//      below and fails.
//   2. The response keys are exactly the public keys (plus loadoutCount on the
//      single-space route), and no private sentinel appears anywhere in a body.
//
// The column classification itself is pinned in venues-public-shape.test.ts.

const VENUE_ID = "00000000-0000-4000-8000-000000000001";
const SPACE_ID = "00000000-0000-4000-8000-000000000002";

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
  sortOrder: 7_654_321,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-02-01T00:00:00Z"),
  deletedAt: null,
};

/** Text that must never appear in a response body: one marker per private column. */
const PRIVATE_SENTINELS = [
  "private-description-sentinel",
  "private-mesh",
  "private-thumb",
  "7654321",
  "2026-01-01T00:00:00",
  "2026-02-01T00:00:00",
  "description",
  "meshUrl",
  "thumbnailUrl",
  "sortOrder",
  "createdAt",
  "updatedAt",
  "deletedAt",
];

interface SelectCall { fields: Record<string, unknown> | undefined; table: unknown }

interface StubOptions {
  /** False when no live venue matches (a soft-deleted or unknown venue). */
  readonly venueFound: boolean;
  /** False when no live space matches. */
  readonly spaceFound?: boolean;
}

/** A Drizzle-shaped stub: select(fields).from(table)... resolves to the rows
 *  the table would return, shaped by the projection the route asked for. */
function projectingDb(calls: SelectCall[], orderings: unknown[][], options: StubOptions): unknown {
  const project = (row: Record<string, unknown>, fields: Record<string, unknown> | undefined): Record<string, unknown> =>
    fields === undefined
      ? { ...row }
      : Object.fromEntries(Object.keys(fields).map((key) => [key, row[key]]));

  const select = (fields?: Record<string, unknown>): unknown => {
    const call: SelectCall = { fields, table: undefined };
    calls.push(call);
    const builder: Record<string, unknown> = {};
    builder["from"] = (table: unknown) => { call.table = table; return builder; };
    for (const name of ["where", "limit", "offset"]) builder[name] = () => builder;
    builder["orderBy"] = (...order: unknown[]) => { orderings.push(order); return builder; };
    builder["then"] = (resolve: (rows: unknown[]) => unknown) => {
      if (call.table === referenceLoadouts) return resolve([{ count: 4 }]);
      if (call.table !== spaces) {
        // The venue existence check: select({ id: venues.id }).
        return resolve(options.venueFound ? [{ id: VENUE_ID }] : []);
      }
      return resolve(options.spaceFound === false ? [] : [project(SPACE_ROW, fields)]);
    };
    return builder;
  };
  return { select };
}

let server: FastifyInstance;
let calls: SelectCall[];
let orderings: unknown[][];

async function build(options: StubOptions): Promise<void> {
  calls = [];
  orderings = [];
  server = Fastify({ logger: false });
  await server.register(spaceRoutes, {
    db: projectingDb(calls, orderings, options) as Database,
    prefix: "/venues/:venueId/spaces",
  });
  await server.ready();
}

beforeEach(async () => { await build({ venueFound: true }); });

afterEach(async () => { await server.close(); });

function expectNoPrivateText(body: string): void {
  for (const sentinel of PRIVATE_SENTINELS) expect(body).not.toContain(sentinel);
}

function spaceSelect(): SelectCall | undefined {
  return calls.find((call) => call.table === spaces);
}

describe("GET /venues/:venueId/spaces public shape", () => {
  it("returns only the public space fields", async () => {
    const response = await server.inject({ method: "GET", url: `/venues/${VENUE_ID}/spaces` });
    expect(response.statusCode).toBe(200);
    const { data } = response.json<{ data: Record<string, unknown>[] }>();
    expect(data).toHaveLength(1);
    expect(Object.keys(data[0] ?? {}).sort()).toEqual(Object.keys(PUBLIC_SPACE_COLUMNS).sort());
    expect(data[0]).toMatchObject({ id: SPACE_ID, venueId: VENUE_ID, widthM: "21.00", slug: "grand-hall" });
    expectNoPrivateText(response.body);
  });

  it("names the public columns rather than selecting the whole row", async () => {
    await server.inject({ method: "GET", url: `/venues/${VENUE_ID}/spaces` });
    expect(spaceSelect()?.fields).toBe(PUBLIC_SPACE_COLUMNS);
    expect(calls.every((call) => call.fields !== undefined)).toBe(true);
  });

  it("still orders by sortOrder, which does not need the column selected", async () => {
    await server.inject({ method: "GET", url: `/venues/${VENUE_ID}/spaces` });
    expect(orderings).toEqual([[spaces.sortOrder]]);
  });

  it("still answers 400 for a venue id that is not a UUID", async () => {
    const response = await server.inject({ method: "GET", url: "/venues/not-a-uuid/spaces" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("still answers 404, and reads no spaces, for a soft-deleted or unknown venue", async () => {
    await server.close();
    await build({ venueFound: false });
    const response = await server.inject({ method: "GET", url: `/venues/${VENUE_ID}/spaces` });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(spaceSelect()).toBeUndefined();
    expectNoPrivateText(response.body);
  });
});

describe("GET /venues/:venueId/spaces/:id public shape", () => {
  const url = `/venues/${VENUE_ID}/spaces/${SPACE_ID}`;

  it("returns only the public space fields and the loadout count", async () => {
    const response = await server.inject({ method: "GET", url });
    expect(response.statusCode).toBe(200);
    const { data } = response.json<{ data: Record<string, unknown> }>();
    expect(Object.keys(data).sort()).toEqual([...Object.keys(PUBLIC_SPACE_COLUMNS), "loadoutCount"].sort());
    expect(data).toMatchObject({ id: SPACE_ID, venueId: VENUE_ID, widthM: "21.00", slug: "grand-hall", loadoutCount: 4 });
    expectNoPrivateText(response.body);
  });

  it("names the public columns rather than selecting the whole row", async () => {
    await server.inject({ method: "GET", url });
    expect(spaceSelect()?.fields).toBe(PUBLIC_SPACE_COLUMNS);
    expect(calls.every((call) => call.fields !== undefined)).toBe(true);
  });

  it("still answers 400 for ids that are not UUIDs", async () => {
    const response = await server.inject({ method: "GET", url: `/venues/${VENUE_ID}/spaces/not-a-uuid` });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("still answers 404 for a space that is not live", async () => {
    await server.close();
    await build({ venueFound: true, spaceFound: false });
    const response = await server.inject({ method: "GET", url });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: "NOT_FOUND", error: "Space not found" });
  });

  it("still answers 404, and reads no spaces, for a soft-deleted or unknown venue", async () => {
    await server.close();
    await build({ venueFound: false });
    const response = await server.inject({ method: "GET", url });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: "NOT_FOUND", error: "Venue not found" });
    expect(spaceSelect()).toBeUndefined();
  });
});
