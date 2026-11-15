import { describe, it, expect } from "vitest";
import type { PlacedObject } from "../../../api/configurations.js";
import { getCatalogueItemBySlug } from "../../catalogue.js";
import { emptyGuestList, SEATS_MAX, SEATS_MIN, type GuestList, type KitTable } from "../model.js";
import { planTables, tablesDiffer } from "../plan-tables.js";

// Fixtures use real catalogue pieces, found by slug, so the tests follow the catalogue.
function assetId(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error("fixture slug missing from the catalogue");
  return item.id;
}

const ROUND_TABLE = assetId("round-table-6ft");
const TRESTLE_6FT = assetId("trestle-6ft");
const CHAIR = assetId("banquet-chair");
const STAGE = assetId("staging-deck-6x4");
const SERVICE_TABLE = assetId("cake-cutting-table");

let serial = 0;

function piece(
  assetDefinitionId: string,
  groupId: string | null | undefined,
  x: string | number = "0",
  z: string | number = "0",
): PlacedObject {
  serial += 1;
  return {
    id: `placed-${String(serial)}`,
    configurationId: "configuration-1",
    assetDefinitionId,
    positionX: String(x),
    positionY: "0",
    positionZ: String(z),
    rotationX: "0",
    rotationY: "0",
    rotationZ: "0",
    scale: "1",
    sortOrder: serial,
    metadata: groupId === undefined ? null : { groupId },
  };
}

function chairs(count: number, groupId: string | null | undefined, x: string | number = "0", z: string | number = "0"): PlacedObject[] {
  return Array.from({ length: count }, () => piece(CHAIR, groupId, x, z));
}

function listWithTables(count: number): GuestList {
  const tables: KitTable[] = Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    number: i + 1,
    name: "",
    seats: 10,
  }));
  return { ...emptyGuestList("plan-1", "2027-01-01T00:00:00.000Z"), tables };
}

describe("planTables", () => {
  it("counts dining tables only: no chairs, no stage, no service table", () => {
    const objects: PlacedObject[] = [];
    for (let i = 0; i < 18; i += 1) {
      const group = `group-${String(i)}`;
      objects.push(piece(ROUND_TABLE, group, i * 3, 0), ...chairs(10, group, i * 3, 0));
    }
    objects.push(piece(STAGE, undefined, 0, -10), piece(SERVICE_TABLE, undefined, 5, -10));
    expect(planTables(objects).tables).toBe(18);
  });

  it("a table's seats are the chairs grouped with it, or its usual number when it has none", () => {
    const grouped = [piece(ROUND_TABLE, "g1"), ...chairs(8, "g1")];
    expect(planTables(grouped).seatsEach).toEqual([8]);
    expect(planTables([piece(ROUND_TABLE, undefined)]).seatsEach).toEqual([10]);
    expect(planTables([piece(TRESTLE_6FT, null)]).seatsEach).toEqual([6]);
  });

  it("an unknown piece is ignored, not an error", () => {
    const unknown = piece("not-in-the-catalogue", "g1");
    expect(planTables([unknown]).tables).toBe(0);
    expect(planTables([unknown, ...chairs(3, "g1")])).toEqual({ tables: 0, seatsEach: [] });
  });

  it("an empty room has no tables", () => {
    expect(planTables([])).toEqual({ tables: 0, seatsEach: [] });
  });

  it("chairs of another group, or of no group, do not count for a table", () => {
    const objects = [
      piece(ROUND_TABLE, "g1"),
      ...chairs(7, "g1"),
      ...chairs(5, "g2"),
      ...chairs(4, null),
      ...chairs(3, ""),
      ...chairs(2, undefined),
    ];
    expect(planTables(objects).seatsEach).toEqual([7]);
  });

  it("a table with an empty group id does not collect chairs with an empty group id", () => {
    const objects = [piece(ROUND_TABLE, ""), ...chairs(3, "")];
    expect(planTables(objects).seatsEach).toEqual([10]);
  });

  it("only chairs count: a stage or service table in the group adds no seat", () => {
    const objects = [piece(ROUND_TABLE, "g1"), ...chairs(6, "g1"), piece(STAGE, "g1"), piece(SERVICE_TABLE, "g1")];
    expect(planTables(objects).seatsEach).toEqual([6]);
  });

  it("when one group holds several tables, each chair counts for the nearest table", () => {
    const objects = [
      piece(ROUND_TABLE, "g1", 0, 0),
      piece(ROUND_TABLE, "g1", 10, 0),
      ...chairs(3, "g1", 1, 0),
      ...chairs(5, "g1", 9, 1),
    ];
    expect(planTables(objects).seatsEach).toEqual([3, 5]);
  });

  it("a chair whose position does not parse counts as infinitely far, and a table still takes it when nothing is nearer", () => {
    const objects = [
      piece(ROUND_TABLE, "g1", 0, 0),
      piece(ROUND_TABLE, "g1", 10, 0),
      ...chairs(2, "g1", 9, 0),
      piece(CHAIR, "g1", "not a number", "0"),
    ];
    // The unparseable chair ties on infinite distance with both tables: the first table takes it.
    expect(planTables(objects).seatsEach).toEqual([1, 2]);
  });

  it("a chair with a parseable position goes to the nearer table even when another chair's position is unparseable", () => {
    const objects = [
      piece(ROUND_TABLE, "g1", "oops", "0"),
      piece(ROUND_TABLE, "g1", 10, 0),
      piece(CHAIR, "g1", 9, 0),
    ];
    expect(planTables(objects).seatsEach).toEqual([10, 1]);
  });

  it("seatsEach has one figure a table, in the order the tables appear", () => {
    const objects = [
      piece(ROUND_TABLE, "a"),
      ...chairs(4, "b"),
      piece(TRESTLE_6FT, "b"),
      piece(STAGE, undefined),
      piece(ROUND_TABLE, "c"),
      ...chairs(9, "a"),
    ];
    expect(planTables(objects)).toEqual({ tables: 3, seatsEach: [9, 4, 10] });
  });

  it("clamps every figure to the kit's seat range", () => {
    const crowded = [piece(ROUND_TABLE, "g1"), ...chairs(40, "g1")];
    expect(planTables(crowded).seatsEach).toEqual([SEATS_MAX]);
    // A table is always seated by at least SEATS_MIN, whatever the catalogue says.
    for (const figure of planTables([piece(ROUND_TABLE, "g1"), piece(TRESTLE_6FT, "g2")]).seatsEach) {
      expect(figure).toBeGreaterThanOrEqual(SEATS_MIN);
      expect(figure).toBeLessThanOrEqual(SEATS_MAX);
    }
  });

  it("a piece with null metadata is handled without an error", () => {
    const bare = piece(ROUND_TABLE, undefined);
    expect(bare.metadata).toBeNull();
    expect(() => planTables([bare, piece(CHAIR, undefined)])).not.toThrow();
    expect(planTables([bare]).seatsEach).toEqual([10]);
  });

  it("does not change the objects it is given", () => {
    const objects = [piece(ROUND_TABLE, "g1"), ...chairs(4, "g1")];
    const before = JSON.stringify(objects);
    planTables(objects);
    expect(JSON.stringify(objects)).toBe(before);
  });
});

describe("tablesDiffer", () => {
  const list18 = listWithTables(18);

  it("says nothing when the counts agree, and both numbers when they do not", () => {
    expect(tablesDiffer({ tables: 18, seatsEach: [] }, list18)).toBeNull();
    expect(tablesDiffer({ tables: 17, seatsEach: [] }, list18)).toEqual({ room: 17, list: 18 });
  });

  it("says nothing while the list has no tables yet", () => {
    expect(tablesDiffer({ tables: 17, seatsEach: [] }, listWithTables(0))).toBeNull();
    expect(tablesDiffer({ tables: 0, seatsEach: [] }, listWithTables(0))).toBeNull();
  });

  it("reports a room with none when the list has some", () => {
    expect(tablesDiffer({ tables: 0, seatsEach: [] }, list18)).toEqual({ room: 0, list: 18 });
  });
});
