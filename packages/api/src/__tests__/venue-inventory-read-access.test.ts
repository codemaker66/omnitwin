import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { Database } from "../db/client.js";
import { venueInventoryRoutes } from "../routes/venue-inventory.js";

// Who may READ the venue's counts. The denial cases live in
// venue-inventory-routes.test.ts; this file pins the other half — that a
// hallkeeper laying a room, a coordinator and a planner actually get through
// to the data, which a denial-only suite cannot show.
//
// The database is a queued stub rather than a real one: the subject here is
// the gate, and a stub keeps these cases in the fast suite. Each awaited
// query takes the next queued row set, in the order listVenueInventory and
// readVenueInventoryHistory issue them.

const venueId = "00000000-0000-4000-8000-000000000001";
const assetId = "00000000-0000-4000-8000-000000000002";
const otherVenueId = "00000000-0000-4000-8000-000000000009";
const base = `/venues/${venueId}/inventory`;
let server: FastifyInstance;
let queued: unknown[][];

function headers(role: string, scopedVenue: string | null = venueId, platformRole = "none") {
  return { authorization: `Bearer ${JSON.stringify({ id: "00000000-0000-4000-8000-000000000003",
    email: "inventory@example.test", name: "Inventory reader", role, venueId: scopedVenue, platformRole })}` };
}

/** A thenable that answers every builder call with itself and resolves to the
 *  next queued row set, so one stub serves both read paths. */
function queryStub(): unknown {
  const target = (): unknown => target;
  return new Proxy(target, {
    get(_unused, property) {
      if (property === "then") {
        return (resolve: (rows: unknown[]) => unknown) => resolve(queued.shift() ?? []);
      }
      return () => queryStub();
    },
    apply() {
      return queryStub();
    },
  });
}

beforeEach(async () => {
  queued = [];
  server = Fastify({ logger: false });
  await server.register(venueInventoryRoutes, { db: queryStub() as Database, prefix: "/venues" });
  await server.ready();
});

afterEach(async () => { await server.close(); });

describe("venue inventory read access", () => {
  it.each(["admin", "staff", "hallkeeper", "planner"])("lets %s at the venue read the counts", async (role) => {
    queued = [[{ id: venueId }], []];
    const response = await server.inject({ method: "GET", url: base, headers: headers(role) });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { items: unknown[] } }>().data.items).toEqual([]);
  });

  it.each(["admin", "staff", "hallkeeper", "planner"])("lets %s at the venue read one item's history", async (role) => {
    queued = [[{ id: venueId }], [{ id: assetId }], []];
    const response = await server.inject({ method: "GET", url: `${base}/${assetId}/history`, headers: headers(role) });
    expect(response.statusCode).toBe(200);
  });

  it("refuses a customer role and anyone scoped to another venue", async () => {
    for (const auth of [headers("client"), headers("hallkeeper", otherVenueId), headers("staff", null)]) {
      const response = await server.inject({ method: "GET", url: base, headers: auth });
      expect(response.statusCode).toBe(403);
      expect(response.json<{ code: string }>().code).toBe("FORBIDDEN");
    }
    // Nothing was queued, so a leak past the gate would have failed loudly.
    expect(queued).toEqual([]);
  });

  // The one behaviour this lane deliberately changed, and the one the previous
  // suite stopped asserting when it moved to the write surface. A Venviewer
  // platform administrator assigned to this venue passes every venue gate
  // (utils/query's isPlatformAdmin precedent), so they read the counts — even
  // holding a customer role, because platform authority is the separate axis.
  // Pinned here rather than argued in a report: if Lane 8's review reverses
  // that precedent, this is the test that flips.
  it("lets a venue-scoped platform administrator read, whatever their user role", async () => {
    queued = [[{ id: venueId }], []];
    const response = await server.inject({
      method: "GET", url: base, headers: headers("client", venueId, "admin"),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { items: unknown[] } }>().data.items).toEqual([]);
  });

  it("refuses platform authority that is not scoped to this venue", async () => {
    const response = await server.inject({
      method: "GET", url: base, headers: headers("admin", null, "admin"),
    });
    // Past the role gate, stopped by the tenancy assertion in the service.
    expect(response.statusCode).toBe(403);
    expect(queued).toEqual([]);
  });

  it("still refuses every reader but the venue administrator an adjustment", async () => {
    for (const role of ["staff", "hallkeeper", "planner", "client"]) {
      const response = await server.inject({ method: "POST", url: `${base}/${assetId}/adjustments`,
        headers: headers(role),
        payload: { commandId: "00000000-0000-4000-8000-000000000004", expectedRevision: null,
          ownedQuantity: 200, damagedQuantity: 0, unavailableQuantity: 0, hires: [],
          storageLocation: "East store", status: "active", reason: "Physical count" } });
      expect(response.statusCode).toBe(403);
    }
  });
});
