import { describe, it, expect } from "vitest";
import { CANONICAL_ASSETS } from "@omnitwin/types";
import {
  adaptEditorStateToBlueprintScene,
  blueprintPointToEditorPosition,
  editorObjectToBlueprintItem,
  editorPositionToBlueprintPoint,
} from "../adapt.js";
import type { EditorObject } from "../../../stores/editor-store.js";

// ---------------------------------------------------------------------------
// adapt — chair grouping regression tests
//
// The 2D blueprint previously drew chairs as a uniform algorithmic ring
// derived from the table's `seats` count. When chairs were placed near a
// wall in 3D, the auto-arrange offset them inward — but the 2D ring
// ignored those offsets and showed chairs poking through walls.
//
// The adapter now collects chair PlacedItems by groupId and attaches
// their actual positions to the round-table item's `chairs` field, so
// the renderer draws what the 3D scene actually contains. Editor X/Z
// positions are render-space units; blueprint X/Y positions are real
// metres, so every coordinate must pass through the scale conversion.
// ---------------------------------------------------------------------------

const ROUND_TABLE = CANONICAL_ASSETS.find(
  (a) => a.category === "table" && a.tableShape === "round",
);
const CHAIR = CANONICAL_ASSETS.find((a) => a.category === "chair");

const SPACE = { name: "Test", widthM: "10", lengthM: "10" } as const;

function makeObj(
  id: string,
  assetDefinitionId: string,
  positionX: number,
  positionZ: number,
  groupId: string | null = null,
): EditorObject {
  return {
    id,
    assetDefinitionId,
    positionX,
    positionY: 0,
    positionZ,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    scale: 1,
    sortOrder: 0,
    clothed: false,
    groupId,
    notes: "",
  };
}

describe("adaptEditorStateToBlueprintScene — chair grouping", () => {
  it("converts between editor render-space and blueprint metre-space", () => {
    expect(editorPositionToBlueprintPoint(2, -4, { widthM: 10, lengthM: 8 })).toEqual({
      x: 6,
      y: 2,
    });
    expect(blueprintPointToEditorPosition({ x: 6, y: 2 }, { widthM: 10, lengthM: 8 })).toEqual({
      positionX: 2,
      positionZ: -4,
    });
  });

  it("attaches grouped chairs to their round table", () => {
    expect(ROUND_TABLE, "round table asset must exist").toBeDefined();
    expect(CHAIR, "chair asset must exist").toBeDefined();
    if (ROUND_TABLE === undefined || CHAIR === undefined) return;

    const objects: readonly EditorObject[] = [
      makeObj("table-1", ROUND_TABLE.id, 0, 0, "g1"),
      makeObj("chair-1", CHAIR.id, 2, 0, "g1"),
      makeObj("chair-2", CHAIR.id, -2, 0, "g1"),
      makeObj("chair-3", CHAIR.id, 0, 2, "g1"),
    ];
    const scene = adaptEditorStateToBlueprintScene({
      space: SPACE,
      objects,
      lastSavedAt: null,
    });
    const table = scene.items.find((i) => i.id === "table-1");
    expect(table).toBeDefined();
    expect(table?.shape).toBe("round");
    if (table === undefined || table.shape !== "round") return;
    expect(table.chairs).toBeDefined();
    expect(table.chairs).toHaveLength(3);
    // 3D render-space centre-origin → real-world blueprint corner-origin.
    // Room is 10 × 10m → offset is (+5, +5); render-space is divided by 2.
    expect(table.chairs?.[0]).toEqual({ x: 6, y: 5 });
    expect(table.chairs?.[1]).toEqual({ x: 4, y: 5 });
    expect(table.chairs?.[2]).toEqual({ x: 5, y: 6 });
  });

  it("leaves chairs undefined when the table has no group", () => {
    expect(ROUND_TABLE).toBeDefined();
    if (ROUND_TABLE === undefined) return;
    const objects: readonly EditorObject[] = [makeObj("table-1", ROUND_TABLE.id, 0, 0, null)];
    const scene = adaptEditorStateToBlueprintScene({
      space: SPACE,
      objects,
      lastSavedAt: null,
    });
    const table = scene.items.find((i) => i.id === "table-1");
    if (table === undefined || table.shape !== "round") return;
    expect(table.chairs).toBeUndefined();
  });

  it("excludes chairs that don't share the table's groupId", () => {
    expect(ROUND_TABLE).toBeDefined();
    expect(CHAIR).toBeDefined();
    if (ROUND_TABLE === undefined || CHAIR === undefined) return;

    const objects: readonly EditorObject[] = [
      makeObj("table-1", ROUND_TABLE.id, 0, 0, "g1"),
      makeObj("chair-1", CHAIR.id, 2, 0, "g1"),
      makeObj("chair-foreign", CHAIR.id, 5, 5, "g2"),
      makeObj("chair-loose", CHAIR.id, -2, -2, null),
    ];
    const scene = adaptEditorStateToBlueprintScene({
      space: SPACE,
      objects,
      lastSavedAt: null,
    });
    const table = scene.items.find((i) => i.id === "table-1");
    if (table === undefined || table.shape !== "round") return;
    expect(table.chairs).toHaveLength(1);
    expect(table.chairs?.[0]).toEqual({ x: 6, y: 5 });
  });

  it("editorObjectToBlueprintItem returns table without chairs when no map supplied", () => {
    expect(ROUND_TABLE).toBeDefined();
    if (ROUND_TABLE === undefined) return;
    const item = editorObjectToBlueprintItem(
      makeObj("t1", ROUND_TABLE.id, 0, 0, "g1"),
      { widthM: 10, lengthM: 10 },
    );
    expect(item).not.toBeNull();
    if (item === null || item.shape !== "round") return;
    expect(item.chairs).toBeUndefined();
  });
});
