import { describe, it, expect } from "vitest";
import { CANONICAL_ASSETS } from "@omnitwin/types";
import {
  adaptEditorStateToBlueprintScene,
  blueprintPointToEditorPosition,
  editorObjectToBlueprintItem,
  editorPositionToBlueprintPoint,
  itemKindForAsset,
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
const POSEUR_TABLE = CANONICAL_ASSETS.find((a) => a.slug === "poseur-table");
const BLACK_POSEUR_TABLE = CANONICAL_ASSETS.find((a) => a.slug === "poseur-table-black");
const WHITE_POSEUR_TABLE = CANONICAL_ASSETS.find((a) => a.slug === "poseur-table-white");
const MIC_STAND = CANONICAL_ASSETS.find((a) => a.slug === "mic-stand");
const PROJECTOR = CANONICAL_ASSETS.find((a) => a.slug === "projector");
const BLACK_TABLE_CLOTH = CANONICAL_ASSETS.find((a) => a.slug === "black-table-cloth");

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
    clothed: false, clothStyle: null, tableSetting: null,
    groupId,
    notes: "",
  };
}

describe("adaptEditorStateToBlueprintScene — chair grouping", () => {
  it("omits a retained dressing applicator from Blueprint items", () => {
    expect(BLACK_TABLE_CLOTH).toBeDefined();
    if (BLACK_TABLE_CLOTH === undefined) return;
    const leaked = makeObj("legacy-cloth", BLACK_TABLE_CLOTH.id, 0, 0);

    expect(itemKindForAsset(BLACK_TABLE_CLOTH)).toBeNull();
    expect(editorObjectToBlueprintItem(leaked, { widthM: 10, lengthM: 10 }))
      .toBeNull();
    expect(adaptEditorStateToBlueprintScene({
      space: SPACE,
      objects: [leaked],
      lastSavedAt: null,
    }).items).toEqual([]);
  });

  it("converts between editor render-space and blueprint metre-space", () => {
    // Editor space is true metres, so (1, -2) in a 10 × 8m room maps to the
    // blueprint's top-left origin as (5 + 1, 4 - 2) = (6, 2). These inputs
    // read (2, -4) while the editor carried doubled render units.
    expect(editorPositionToBlueprintPoint(1, -2, { widthM: 10, lengthM: 8 })).toEqual({
      x: 6,
      y: 2,
    });
    expect(blueprintPointToEditorPosition({ x: 6, y: 2 }, { widthM: 10, lengthM: 8 })).toEqual({
      positionX: 1,
      positionZ: -2,
    });
  });

  it("attaches grouped chairs to their round table", () => {
    expect(ROUND_TABLE, "round table asset must exist").toBeDefined();
    expect(CHAIR, "chair asset must exist").toBeDefined();
    if (ROUND_TABLE === undefined || CHAIR === undefined) return;

    const objects: readonly EditorObject[] = [
      makeObj("table-1", ROUND_TABLE.id, 0, 0, "g1"),
      makeObj("chair-1", CHAIR.id, 1, 0, "g1"),
      makeObj("chair-2", CHAIR.id, -1, 0, "g1"),
      makeObj("chair-3", CHAIR.id, 0, 1, "g1"),
    ];
    const scene = adaptEditorStateToBlueprintScene({
      space: SPACE,
      objects,
      lastSavedAt: null,
    });
    const table = scene.items.find((i) => i.id === "table-1");
    expect(table).toBeDefined();
    expect(table?.shape).toBe("round");
    if (table === undefined || table.kind !== "round-table") return;
    expect(table.chairs).toBeDefined();
    expect(table.chairs).toHaveLength(3);
    // 3D centre-origin → blueprint corner-origin. Room is 10 × 10m, so the
    // offset is (+5, +5). The scene is in true metres, so a chair at editor
    // x = 1 lands at blueprint x = 6.
    expect(table.chairs?.[0]).toEqual({ x: 6, y: 5 });
    expect(table.chairs?.[1]).toEqual({ x: 4, y: 5 });
    expect(table.chairs?.[2]).toEqual({ x: 5, y: 6 });
  });

  it("uses the hand-authored Grand Hall footprint instead of stale API dimensions", () => {
    const scene = adaptEditorStateToBlueprintScene({
      space: { name: "Grand Hall", widthM: "21.00", lengthM: "10.00" },
      objects: [],
      lastSavedAt: null,
    });

    expect(scene.room).toEqual({ widthM: 21, lengthM: 10.5 });
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
    if (table === undefined || table.kind !== "round-table") return;
    expect(table.chairs).toBeUndefined();
  });

  it("excludes chairs that don't share the table's groupId", () => {
    expect(ROUND_TABLE).toBeDefined();
    expect(CHAIR).toBeDefined();
    if (ROUND_TABLE === undefined || CHAIR === undefined) return;

    const objects: readonly EditorObject[] = [
      makeObj("table-1", ROUND_TABLE.id, 0, 0, "g1"),
      makeObj("chair-1", CHAIR.id, 1, 0, "g1"),
      makeObj("chair-foreign", CHAIR.id, 5, 5, "g2"),
      makeObj("chair-loose", CHAIR.id, -2, -2, null),
    ];
    const scene = adaptEditorStateToBlueprintScene({
      space: SPACE,
      objects,
      lastSavedAt: null,
    });
    const table = scene.items.find((i) => i.id === "table-1");
    if (table === undefined || table.kind !== "round-table") return;
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
    if (item === null || item.kind !== "round-table") return;
    expect(item.chairs).toBeUndefined();
  });

  it("normalizes invalid scale to 1 for the Hallkeeper/blueprint footprint", () => {
    expect(ROUND_TABLE).toBeDefined();
    if (ROUND_TABLE === undefined) return;
    const base = editorObjectToBlueprintItem(
      makeObj("base", ROUND_TABLE.id, 0, 0),
      { widthM: 10, lengthM: 10 },
    );
    const invalid = editorObjectToBlueprintItem(
      { ...makeObj("invalid", ROUND_TABLE.id, 0, 0), scale: Number.NaN },
      { widthM: 10, lengthM: 10 },
    );
    expect(base?.shape).toBe("round");
    expect(invalid?.shape).toBe("round");
    if (base === null || base.shape !== "round" || invalid === null || invalid.shape !== "round") return;
    expect(invalid.diameterM).toBe(base.diameterM);
  });

  it("preserves black and white linen labels for 2D blueprint output", () => {
    expect(ROUND_TABLE).toBeDefined();
    if (ROUND_TABLE === undefined) return;

    const black = editorObjectToBlueprintItem(
      { ...makeObj("black", ROUND_TABLE.id, 0, 0), clothed: true, clothStyle: "black" },
      { widthM: 10, lengthM: 10 },
    );
    const white = editorObjectToBlueprintItem(
      { ...makeObj("white", ROUND_TABLE.id, 2, 0), clothed: true, clothStyle: "white" },
      { widthM: 10, lengthM: 10 },
    );

    expect(black?.shape).toBe("round");
    expect(white?.shape).toBe("round");
    if (
      black === null
      || black.kind !== "round-table"
      || white === null
      || white.kind !== "round-table"
    ) return;
    expect(black.linen).toBe("Black");
    expect(white.linen).toBe("Ivory");
  });

  it("represents a poseur as a standing-table footprint, never a seated round", () => {
    expect(POSEUR_TABLE, "poseur table asset must exist").toBeDefined();
    if (POSEUR_TABLE === undefined) return;

    expect(itemKindForAsset(POSEUR_TABLE)).toBe("poseur-table");
    const item = editorObjectToBlueprintItem(
      makeObj("poseur-1", POSEUR_TABLE.id, 1, -2),
      { widthM: 10, lengthM: 10 },
    );

    expect(item).toEqual({
      id: "poseur-1",
      kind: "poseur-table",
      shape: "round",
      center: { x: 6, y: 3 },
      diameterM: 0.6,
      rotationDeg: 0,
    });
    expect(item).not.toHaveProperty("seats");
  });

  it("carries intrinsic poseur linen into Blueprint truth without applied metadata", () => {
    expect(BLACK_POSEUR_TABLE).toBeDefined();
    expect(WHITE_POSEUR_TABLE).toBeDefined();
    if (BLACK_POSEUR_TABLE === undefined || WHITE_POSEUR_TABLE === undefined) return;

    const black = editorObjectToBlueprintItem(
      makeObj("poseur-black", BLACK_POSEUR_TABLE.id, 0, 0),
      { widthM: 10, lengthM: 10 },
    );
    const white = editorObjectToBlueprintItem(
      makeObj("poseur-white", WHITE_POSEUR_TABLE.id, 2, 0),
      { widthM: 10, lengthM: 10 },
    );

    expect(black?.kind).toBe("poseur-table");
    expect(white?.kind).toBe("poseur-table");
    if (black?.kind !== "poseur-table" || white?.kind !== "poseur-table") return;
    expect(black.linen).toBe("Black");
    expect(white.linen).toBe("Ivory");
    expect(black).not.toHaveProperty("seats");
    expect(white).not.toHaveProperty("seats");
  });

  it("keeps the bare poseur eligible for applied linen in Blueprint output", () => {
    expect(POSEUR_TABLE).toBeDefined();
    if (POSEUR_TABLE === undefined) return;
    const item = editorObjectToBlueprintItem(
      {
        ...makeObj("poseur-dressed", POSEUR_TABLE.id, 0, 0),
        clothed: true,
        clothStyle: "white",
      },
      { widthM: 10, lengthM: 10 },
    );

    expect(item?.kind).toBe("poseur-table");
    if (item?.kind !== "poseur-table") return;
    expect(item.linen).toBe("Ivory");
    expect(item).not.toHaveProperty("seats");
  });

  it("represents a mic stand as an exact zero-seat floor-equipment footprint", () => {
    expect(MIC_STAND, "mic stand asset must exist").toBeDefined();
    if (MIC_STAND === undefined) return;

    expect(itemKindForAsset(MIC_STAND)).toBe("mic-stand");
    const item = editorObjectToBlueprintItem(
      makeObj("mic-stand-1", MIC_STAND.id, 1, -2),
      { widthM: 10, lengthM: 10 },
    );

    expect(item).toEqual({
      id: "mic-stand-1",
      kind: "mic-stand",
      shape: "rect",
      topLeft: { x: 5.75, y: 2.75 },
      widthM: 0.5,
      lengthM: 0.5,
      rotationDeg: 0,
    });
    expect(item).not.toHaveProperty("seats");
  });

  it("continues to omit tiny tabletop AV from the Blueprint floor plan", () => {
    expect(PROJECTOR, "projector asset must exist").toBeDefined();
    if (PROJECTOR === undefined) return;

    expect(itemKindForAsset(PROJECTOR)).toBeNull();
    expect(editorObjectToBlueprintItem(
      makeObj("projector-1", PROJECTOR.id, 0, 0),
      { widthM: 10, lengthM: 10 },
    )).toBeNull();
  });
});
