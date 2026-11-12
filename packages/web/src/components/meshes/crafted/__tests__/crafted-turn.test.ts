import { describe, expect, it } from "vitest";
import type { PlacedObject } from "../../../../api/configurations.js";
import { getCatalogueItemBySlug } from "../../../../lib/catalogue.js";
import { CRAFTED_FURNITURE_SLUGS } from "../../../../lib/crafted-furniture.js";
import { createPlacedItem, type PlacedItem } from "../../../../lib/placement.js";
import { editorToBatch, placedObjectToEditor } from "../../../../stores/editor-store.js";
import { editorToPlacedItem, placedItemToEditor } from "../../../editor/EditorBridge.js";
import { craftedTurn, drawnRotationY } from "../crafted-turn.js";

function catalogueId(slug: string): string {
  const item = getCatalogueItemBySlug(slug);
  if (item === undefined) throw new Error(`Missing catalogue fixture ${slug}`);
  return item.id;
}

const ROUND = catalogueId("round-table-6ft-white");

function round(groupId: string | null, x = 0, z = 0, rotationY = 0): PlacedItem {
  return createPlacedItem(ROUND, x, z, rotationY, groupId);
}

/** How far the turns of a set of groups are from all pointing one way: 1 is one bearing, 0 an even spread. */
function resultantLength(turns: readonly number[]): number {
  const x = turns.reduce((sum, turn) => sum + Math.cos(turn), 0);
  const z = turns.reduce((sum, turn) => sum + Math.sin(turn), 0);
  return Math.hypot(x, z) / turns.length;
}

/** The layout as the server saves it and the planner loads it back: a new id, the metadata as sent. */
function savedAndReloaded(placed: PlacedItem, serverId: string): PlacedItem {
  const batch = editorToBatch(placedItemToEditor(placed, undefined));
  const row: PlacedObject = {
    id: serverId,
    configurationId: "00000000-0000-4000-8000-0000000000c1",
    assetDefinitionId: batch.assetDefinitionId,
    positionX: String(batch.positionX),
    positionY: String(batch.positionY),
    positionZ: String(batch.positionZ),
    rotationX: String(batch.rotationX),
    rotationY: String(batch.rotationY),
    rotationZ: String(batch.rotationZ),
    scale: String(batch.scale),
    sortOrder: batch.sortOrder,
    metadata: batch.metadata ?? null,
  };
  return editorToPlacedItem(placedObjectToEditor(row));
}

describe("crafted-turn", () => {
  it("turns a round in a group by an angle of its own, the same wherever the group stands", () => {
    const placed = round("local-6b1f0c7e-1d1a-4a51-9d0e-6f3b2a9c4e11", 2, 3, 0.4);
    const turn = craftedTurn(placed);
    expect(turn).toBeGreaterThan(0);
    expect(turn).toBeLessThan(2 * Math.PI);
    expect(drawnRotationY(placed)).toBeCloseTo(0.4 + turn, 12);

    const moved = { ...placed, x: -7.5, z: 9, rotationY: 1.9 };
    expect(craftedTurn(moved)).toBe(turn);
    expect(drawnRotationY(moved)).toBeCloseTo(1.9 + turn, 12);
  });

  it("keeps a table's turn through a save, which gives it the server's id", () => {
    const placed = round("local-0f6d3c2a-8b4e-4f1d-a2c9-7e5b1d3f9a20", 4, -2, 0.4);
    const reloaded = savedAndReloaded(placed, "3c9e7a51-2f4d-4b8a-9e1c-5d7f3a2b6c80");
    expect(reloaded.id).not.toBe(placed.id);
    expect(reloaded.groupId).toBe(placed.groupId);
    expect(craftedTurn(reloaded)).toBe(craftedTurn(placed));
    expect(drawnRotationY(reloaded)).toBe(drawnRotationY(placed));
  });

  it("keeps the planner's turn for a round on its own and for every piece but a crafted round table", () => {
    expect(craftedTurn(round(null))).toBe(0);
    expect(drawnRotationY(round(null, 0, 0, 0.7))).toBe(0.7);

    const turned = CRAFTED_FURNITURE_SLUGS.filter((slug) => (
      craftedTurn(createPlacedItem(catalogueId(slug), 0, 0, 0, "local-group")) !== 0
    ));
    expect([...turned].sort()).toEqual([
      "cake-cutting-table",
      "poseur-table",
      "poseur-table-black",
      "poseur-table-white",
      "round-cafe-table-white",
      "round-table-6ft",
      "round-table-6ft-black",
      "round-table-6ft-white",
    ]);
    for (const slug of turned) {
      const item = getCatalogueItemBySlug(slug);
      expect(item?.tableShape).toBe("round");
      expect(item?.width).toBe(item?.depth);
    }
    // A table's chairs share its group and keep the planner's turn.
    expect(craftedTurn(createPlacedItem(catalogueId("chiavari-chair"), 0, 0, 0, "local-group"))).toBe(0);
  });

  it("spreads a hall's groups round the whole circle, ids a character apart included", () => {
    const families = [
      Array.from({ length: 18 }, (_unused, index) => `group-${String(index + 1)}`),
      Array.from({ length: 18 }, (_unused, index) => `table-group-${String(index)}`),
      Array.from({ length: 18 }, (_unused, index) => (
        `local-${String(index).padStart(8, "0")}-1d1a-4a51-9d0e-6f3b2a9c4e11`
      )),
    ];
    for (const ids of families) {
      const turns = ids.map((id) => craftedTurn(round(id)));
      expect(new Set(turns).size).toBe(ids.length);
      // Eighteen bearings drawn evenly at random come to about 0.24; a clustered set approaches 1.
      expect(resultantLength(turns)).toBeLessThan(0.5);
      const quadrants = new Set(turns.map((turn) => Math.floor(turn / (Math.PI / 2))));
      expect(quadrants.size).toBe(4);
    }
  });
});
