import { afterEach, describe, expect, it } from "vitest";
import { getCatalogueItem, getCatalogueItemBySlug } from "../catalogue.js";
import { createPlacedItem, computeRotatedFootprint, isWithinRoomBounds, snapToWallEdge } from "../placement.js";
import { createTableGroup, rearrangeTableGroup, tableGroupChairFootprint, tableGroupSeatCapacity, tableGroupPlanningFootprint } from "../table-group.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { toRenderSpace } from "../../constants/scale.js";

function catalogue(slug: string): NonNullable<ReturnType<typeof getCatalogueItemBySlug>> {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`Missing catalogue item ${slug}`);
  return item;
}

describe("new imported seating defaults preserve saved furniture", () => {
  it("uses the Turini's real depth when creating fresh dining chairs", () => {
    const table = catalogue("round-table-6ft-white");
    const turini = catalogue("burgess-turini-18-3");
    const items = createTableGroup(table.id, 0, 0, 0, 8);
    expect(items.slice(1)).toHaveLength(8);
    for (const chair of items.slice(1)) {
      expect(chair.catalogueItemId).toBe(turini.id);
      expect(Math.hypot(chair.x, chair.z)).toBeCloseTo(toRenderSpace(table.width / 2 + turini.depth / 2 + 0.05));
    }
  });

  it("preserves mixed saved chair identities on resize and assigns Turini only to new slots", () => {
    const tableAsset = catalogue("round-table-6ft");
    const legacy = catalogue("banquet-chair");
    const checked = catalogue("checked-banquet-chair");
    const turini = catalogue("burgess-turini-18-3");
    const table = createPlacedItem(tableAsset.id, 0, 0, 0, "saved-group");
    const first = { ...createPlacedItem(legacy.id, 0, 2, 0, "saved-group"), label: "Legacy seat", scale: 1.4, clothed: true, chairStyle: "white-cover-burgundy-sash" };
    const second = { ...createPlacedItem(checked.id, 2, 0, 0, "saved-group"), label: "Checked seat" };
    const snapshot = [table, first, second];
    const before = structuredClone(snapshot);
    const grown = rearrangeTableGroup(table.id, 4, snapshot);
    expect(snapshot).toEqual(before);
    expect(grown.find((item) => item.id === table.id)).toEqual(table);
    expect(grown.find((item) => item.id === first.id)).toMatchObject({ catalogueItemId: legacy.id, label: "Legacy seat", scale: 1.4, clothed: true, chairStyle: "white-cover-burgundy-sash" });
    expect(grown.find((item) => item.id === second.id)).toMatchObject({ catalogueItemId: checked.id, label: "Checked seat" });
    const added = grown.filter((item) => !snapshot.some((old) => old.id === item.id));
    expect(added).toHaveLength(2);
    expect(added.every((item) => item.catalogueItemId === turini.id)).toBe(true);
    const maxDepth = Math.max(legacy.depth * 1.4, checked.depth, turini.depth);
    for (const chair of grown.filter((item) => item.id !== table.id)) {
      expect(Math.hypot(chair.x, chair.z)).toBeCloseTo(toRenderSpace(tableAsset.width / 2 + maxDepth / 2 + 0.05));
    }
    const shrunk = rearrangeTableGroup(table.id, 1, grown);
    expect(shrunk).toHaveLength(2);
    expect(shrunk[1]).toMatchObject({ id: first.id, catalogueItemId: legacy.id, scale: 1.4 });
  });
});

const initialDimensions = useRoomDimensionsStore.getState().dimensions;
afterEach(() => {
  useRoomDimensionsStore.setState({ dimensions: initialDimensions });
  usePlacementStore.setState({ placedItems: [] });
});

describe("complete imported seating footprints", () => {
  it("keeps dialog capacity consistent with oversized saved chairs and new slots", () => {
    const table = createPlacedItem(catalogue("round-table-6ft").id, 0, 0, 0, "saved");
    const chair = { ...createPlacedItem(catalogue("banquet-chair").id, 0, 0, 0, "saved"), scale: 2 };
    const items = [table, chair];
    const capacity = tableGroupSeatCapacity(table, items);
    expect(capacity).toBeLessThan(13);
    for (let requested = 1; requested <= capacity; requested += 1) {
      expect(rearrangeTableGroup(table.id, requested, items)).toHaveLength(requested + 1);
    }
  });

  it("reserves actual scaled chair depth when snapping an existing round group", () => {
    const asset = catalogue("round-table-6ft");
    const table = createPlacedItem(asset.id, 0, 0, 0, "saved");
    const chair = { ...createPlacedItem(catalogue("banquet-chair").id, 0, 0, 0, "saved"), scale: 2 };
    const footprint = tableGroupChairFootprint(table, [table, chair], false);
    const room = { width: 20, length: 20, height: 7 };
    const snapped = snapToWallEdge(8, 0, asset, 0, room, 1, footprint);
    expect(snapped.x + toRenderSpace(Math.hypot(asset.width / 2 + footprint.depth + 0.05, footprint.width / 2))).toBeCloseTo(room.width / 2);
  });

  it("auto-arranges complete chair groups inside the room with clear space between them", () => {
    const table = catalogue("round-table-6ft-white");
    const room = { width: toRenderSpace(20), length: toRenderSpace(10), height: 7 };
    useRoomDimensionsStore.setState({ dimensions: room });
    usePlacementStore.getState().autoArrangeBanquet(table.id, 0, 8);
    const items = usePlacementStore.getState().placedItems;
    const tables = items.filter((item) => item.catalogueItemId === table.id);
    expect(tables.length).toBeGreaterThan(1);
    const footprint = tableGroupPlanningFootprint(table, 8);
    expect(footprint.width).toBeGreaterThan(table.width + 1.2);
    for (const item of items) {
      const asset = getCatalogueItem(item.catalogueItemId);
      if (asset === undefined) throw new Error("Missing placed catalogue item");
      expect(isWithinRoomBounds(item.x, item.z, asset, item.rotationY, room)).toBe(true);
      const a = computeRotatedFootprint(asset, item.rotationY);
      for (const other of items) {
        if (other.groupId === item.groupId) continue;
        const otherAsset = getCatalogueItem(other.catalogueItemId);
        if (otherAsset === undefined) throw new Error("Missing placed catalogue item");
        const b = computeRotatedFootprint(otherAsset, other.rotationY);
        const gapX = Math.abs(item.x - other.x) - a.halfW - b.halfW;
        const gapZ = Math.abs(item.z - other.z) - a.halfD - b.halfD;
        expect(Math.max(gapX, gapZ)).toBeGreaterThanOrEqual(toRenderSpace(1.2) - 1e-8);
      }
    }
  });
});

it("keeps every rotated chair corner inside the wall at the 13-seat limit", () => {
  const table = catalogue("round-table-6ft-white");
  const room = { width: toRenderSpace(10), length: toRenderSpace(10), height: 7 };
  const position = snapToWallEdge(toRenderSpace(4), 0, table, 0, room);
  const group = createTableGroup(table.id, position.x, position.z, 0, 13);
  expect(group).toHaveLength(14);
  for (const item of group) {
    const asset = getCatalogueItem(item.catalogueItemId);
    if (asset === undefined) throw new Error("Missing catalogue fixture");
    expect(isWithinRoomBounds(item.x, item.z, asset, item.rotationY, room)).toBe(true);
  }
});
