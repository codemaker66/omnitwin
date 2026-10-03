import { describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import { writeVenueInventory } from "../services/venue-inventory.js";

// ---------------------------------------------------------------------------
// A first count of an item, through the service every stock correction takes,
// records the role of whoever counted it: a venue's managers keep its stock
// with its administrators (Blake, 29 September 2026). The inventory suites on
// real PostgreSQL prove the same; this one runs in CI.
//
// The database is a queued stub, as in venue-inventory-read-access.test.ts:
// each awaited query takes the next queued row set, in the order
// writeVenueInventory issues them inside its transaction.
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-000000000001";
const ASSET = "00000000-0000-4000-8000-000000000002";
const ACTOR = "00000000-0000-4000-8000-000000000003";
let queued: unknown[][] = [];

/** A thenable that answers every builder call with itself and resolves to the
 *  next queued row set. */
function queryStub(): unknown {
  const target = (): unknown => target;
  return new Proxy(target, {
    get(_unused, property) {
      if (property === "then") return (resolve: (rows: unknown[]) => unknown) => resolve(queued.shift() ?? []);
      return () => queryStub();
    },
    apply() {
      return queryStub();
    },
  });
}

/** A database whose transaction runs its work on the queued stub. */
function stubDatabase(): Database {
  const stub: unknown = { transaction: <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work(queryStub()) };
  return stub as Database;
}
const db = stubDatabase();

describe("a first count of an item", () => {
  it.each(["manager", "admin"] as const)("records a %s's first count in their role", async (role) => {
    // The venue's row version, no earlier receipt for the command, no stock
    // yet, the catalogue item, then the stock and receipt written.
    queued = [[{ id: VENUE }], [], [], [{ id: ASSET }], [], []];
    const response = await writeVenueInventory(db, { userId: ACTOR, role, venueId: VENUE }, {
      commandId: "00000000-0000-4000-8000-000000000004", venueId: VENUE, assetDefinitionId: ASSET, expectedRevision: null,
      ownedQuantity: 4, damagedQuantity: 0, unavailableQuantity: 0, hires: [], storageLocation: "AV cupboard", status: "active",
      reason: "First count",
    });
    expect(response.data.receipt).toMatchObject({ kind: "created", actorUserId: ACTOR, actorRole: role, before: null });
    expect(response.data.stock.revision).toBe(1);
    expect(queued).toEqual([]);
  });

  it("refuses a first count by a role that does not keep the stock, before any query", async () => {
    queued = [[{ id: VENUE }]];
    await expect(writeVenueInventory(db, { userId: ACTOR, role: "staff", venueId: VENUE }, {
      commandId: "00000000-0000-4000-8000-000000000005", venueId: VENUE, assetDefinitionId: ASSET, expectedRevision: null,
      ownedQuantity: 4, damagedQuantity: 0, unavailableQuantity: 0, hires: [], storageLocation: null, status: "active", reason: "First count",
    })).rejects.toThrow(/administrators and managers/u);
    expect(queued).toEqual([[{ id: VENUE }]]);
  });
});
