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
import { resolveRoomGeometry } from "../../../data/room-geometries.js";
import { plannerRoomOf } from "../../room-floor.js";
import { clampCenterToRoom } from "../reducer.js";
import { computeStatusMetrics } from "../geometry.js";
import { seatingCountsFromPlacedItems } from "../../seating-counts.js";
import { createPlacedItem } from "../../placement.js";
import { getLayerRows, inspectorTitle, itemAreaM2, totalSeats } from "../geometry.js";

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

describe("imported furniture footprints", () => {
  it.each(["room-divider", "servery-unit"])("retains the named rotated and scaled %s footprint without seating", (slug) => {
    const asset = CANONICAL_ASSETS.find((candidate) => candidate.slug === slug);
    if (asset === undefined) throw new Error(`Missing ${slug}`);
    const object = { ...makeObj(slug, asset.id, 1, -2), scale: 1.5, rotationY: Math.PI / 3 };
    const scene = adaptEditorStateToBlueprintScene({ objects: [object], space: SPACE, lastSavedAt: null });
    const item = scene.items[0];
    expect(item).toMatchObject({
      kind: "floor-equipment", shape: "rect", label: asset.name,
      widthM: asset.widthM * 1.5, lengthM: asset.depthM * 1.5,
      topLeft: { x: 6 - asset.widthM * 0.75, y: 3 - asset.depthM * 0.75 },
    });
    if (item === undefined) throw new Error("Missing footprint");
    expect(item.rotationDeg).toBeCloseTo(60);
    expect(item).not.toHaveProperty("seats");
    expect(itemAreaM2(item)).toBeCloseTo(asset.widthM * asset.depthM * 2.25);
    expect(totalSeats([item])).toBe(0);
    expect(getLayerRows(scene)[0]?.label).toContain(asset.name);
    expect(inspectorTitle(item)).toContain(asset.name.toUpperCase());
  });

  it("reports the cake table's included cloth without inventing a colour", () => {
    const asset = CANONICAL_ASSETS.find((candidate) => candidate.slug === "cake-cutting-table");
    if (asset === undefined) throw new Error("Missing cake table");
    const item = editorObjectToBlueprintItem({ ...makeObj("cake", asset.id, 0, 0), clothed: true, clothStyle: "black" }, { widthM: 10, lengthM: 10 });
    expect(item).toMatchObject({ linen: "Included cloth", seats: undefined });
  });
});

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
    clothed: false, clothStyle: null, tableSetting: null, chairStyle: null, centerpiece: null,
    groupId,
    notes: "",
  };
}

describe("adaptEditorStateToBlueprintScene — chair grouping", () => {
  it("counts all placed chairs once, including loose chairs and groups shared by tables", () => {
    if (ROUND_TABLE === undefined || CHAIR === undefined) throw new Error("Missing seating fixtures");
    const trestle = CANONICAL_ASSETS.find((asset) => asset.slug === "trestle-6ft");
    if (trestle === undefined) throw new Error("Missing trestle fixture");
    const objects = [
      makeObj("round-1", ROUND_TABLE.id, 0, 0, "shared"),
      makeObj("round-2", ROUND_TABLE.id, 2, 0, "shared"),
      makeObj("trestle", trestle.id, 4, 0, "trestle"),
      makeObj("chair-shared", CHAIR.id, 1, 0, "shared"),
      makeObj("chair-rect", CHAIR.id, 4, 1, "trestle"),
      makeObj("chair-loose", CHAIR.id, 5, 1, null),
      makeObj("unknown", "unknown-id", 0, 0),
    ];
    const scene = adaptEditorStateToBlueprintScene({ space: SPACE, objects, lastSavedAt: null });
    const placed = objects.map((item) => createPlacedItem(item.assetDefinitionId, item.positionX, 0, item.positionZ));
    expect(computeStatusMetrics(scene).totalSeats).toBe(3);
    expect(computeStatusMetrics(scene).totalSeats).toBe(seatingCountsFromPlacedItems(placed).chairs);
  });
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

  it("uses the planner's Grand Hall footprint, its E57 interior, instead of stale API dimensions", () => {
    const scene = adaptEditorStateToBlueprintScene({
      space: { name: "Grand Hall", widthM: "21.00", lengthM: "10.00" },
      objects: [],
      lastSavedAt: null,
    });

    expect(scene.room).toEqual({ widthM: 21.135, lengthM: 10.59 });
  });

  // The Robert Adam Room's walls run from z = −3.7 to z = +9.0 in the editor's scene: its plan is the
  // bounds of those walls, where they stand, not a box of that size centred on the origin (audit editor-save-4).
  describe("the Robert Adam Room's plan", () => {
    const ROBERT_ADAM = { name: "Robert Adam Room", widthM: "9.70", lengthM: "5.60" } as const;
    const sceneWith = (objects: readonly EditorObject[]): ReturnType<typeof adaptEditorStateToBlueprintScene> =>
      adaptEditorStateToBlueprintScene({ space: ROBERT_ADAM, objects, lastSavedAt: null });

    it("draws a round set against the north wall at the top of the plan, and one in the lower section on it", () => {
      if (ROUND_TABLE === undefined) throw new Error("round table asset must exist");
      const radius = ROUND_TABLE.widthM / 2;
      const scene = sceneWith([
        makeObj("north", ROUND_TABLE.id, 0, -3.7 + radius),
        makeObj("lower", ROUND_TABLE.id, -2.9, 6.5),
      ]);
      expect(scene.room.widthM).toBeCloseTo(11.4, 9);
      expect(scene.room.lengthM).toBeCloseTo(12.7, 9);
      const centreOf = (id: string): { readonly x: number; readonly y: number } => {
        const item = scene.items.find((i) => i.id === id);
        if (item === undefined || item.kind !== "round-table") throw new Error(`no round ${id}`);
        return item.center;
      };
      // Its rim on the plan's top edge, as it is on the wall.
      expect(centreOf("north").x).toBeCloseTo(5.7, 9);
      expect(centreOf("north").y).toBeCloseTo(radius, 9);
      // 2.8 m from the west wall and 10.2 m down a 12.7 m plan; the old box drew it past the plan's foot.
      expect(centreOf("lower").x).toBeCloseTo(2.8, 9);
      expect(centreOf("lower").y).toBeCloseTo(10.2, 9);
      expect(centreOf("lower").y + radius).toBeLessThanOrEqual(scene.room.lengthM);
    });

    it("gives a spot on the plan back to the scene where the walls stand", () => {
      const { room } = sceneWith([]);
      // The top of the plan is the north wall, its foot the south recess.
      expect(blueprintPointToEditorPosition({ x: 5.7, y: 0 }, room).positionZ).toBeCloseTo(-3.7, 9);
      expect(blueprintPointToEditorPosition({ x: 0, y: 12.7 }, room).positionX).toBeCloseTo(-5.7, 9);
      expect(blueprintPointToEditorPosition({ x: 0, y: 12.7 }, room).positionZ).toBeCloseTo(9.0, 9);
      for (const [x, z] of [[0, 0], [-2.9, 6.5], [5.1, -3.2], [-5.7, 9]] as const) {
        const there = blueprintPointToEditorPosition(editorPositionToBlueprintPoint(x, z, room), room);
        expect(there.positionX).toBeCloseTo(x, 9);
        expect(there.positionZ).toBeCloseTo(z, 9);
      }
    });

    // The two functions together, and no more than that: no path of the planner composes them. The open
    // layout's 2D drag (pages/BlueprintPage.tsx handleMoveTo) takes the pointer's spot to the scene and writes
    // it with no clamp, in every room, so a piece can still be dragged anywhere there.
    it("takes a spot the plan's clamp has held on the plan back to the scene inside the bounds of the walls, top and foot", () => {
      const { room } = sceneWith([]);
      // The plan's own clamp (the round's 0.9 m), then back to the scene.
      const top = blueprintPointToEditorPosition(clampCenterToRoom({ x: 5.7, y: -5 }, room, "round-table"), room);
      expect(top.positionZ).toBeCloseTo(-3.7 + 0.9, 9);
      const foot = blueprintPointToEditorPosition(clampCenterToRoom({ x: 3, y: 50 }, room, "round-table"), room);
      expect(foot.positionZ).toBeCloseTo(9.0 - 0.9, 9);
    });
  });

  it.each(["Grand Hall", "Reception Room", "Saloon"])("keeps the %s's plan centred on the scene's origin, as its walls are", (name) => {
    const { room } = adaptEditorStateToBlueprintScene({ space: { name, widthM: "1", lengthM: "1" }, objects: [], lastSavedAt: null });
    expect(Object.keys(room).sort()).toEqual(["lengthM", "widthM"]);
    expect(editorPositionToBlueprintPoint(0, 0, room)).toEqual({ x: room.widthM / 2, y: room.lengthM / 2 });
    expect(blueprintPointToEditorPosition({ x: 0, y: 0 }, room)).toEqual({ positionX: -room.widthM / 2, positionZ: -room.lengthM / 2 });
  });

  // A room with no drawing of its own is drawn in 3D from its stored outline (data/room-geometries
  // resolveRoomGeometry, which the room hook hands to lib/room-floor plannerRoomOf). Its plan is the
  // bounds of the same walls, where they stand.
  describe("the plan of a room drawn from its stored outline", () => {
    const corners = (minX: number, minZ: number, maxX: number, maxZ: number): { readonly x: number; readonly y: number }[] =>
      [{ x: minX, y: minZ }, { x: maxX, y: minZ }, { x: maxX, y: maxZ }, { x: minX, y: maxZ }];

    it("stands where the walls do when the outline starts at a corner, not half a room away", () => {
      if (ROUND_TABLE === undefined) throw new Error("round table asset must exist");
      // 12 m by 8 m from (0, 0): the planner's 3D floor runs from x = 0 to 12 and z = 0 to 8.
      const hired = { name: "Hired Hall", widthM: "12.00", lengthM: "8.00", heightM: "4.00", floorPlanOutline: corners(0, 0, 12, 8) };
      const geometry = resolveRoomGeometry(hired);
      if (geometry === null) throw new Error("no geometry");
      const floor = plannerRoomOf(geometry.wallPolygon, geometry.ceilingHeight).floor;
      const scene = adaptEditorStateToBlueprintScene({ space: hired, objects: [makeObj("round", ROUND_TABLE.id, 9, 6)], lastSavedAt: null });
      expect(scene.room).toEqual({ widthM: 12, lengthM: 8, originM: { x: 0, z: 0 } });
      expect(scene.room.originM).toEqual({ x: floor?.minX, z: floor?.minZ });
      // A round at (9, 6) in the scene is 9 m across and 6 m down the plan; the centred box drew it at (15, 10), off a 12 m by 8 m plan.
      const round = scene.items.find((item) => item.id === "round");
      expect(round?.kind === "round-table" ? round.center : null).toEqual({ x: 9, y: 6 });
      expect(blueprintPointToEditorPosition({ x: 9, y: 6 }, scene.room)).toEqual({ positionX: 9, positionZ: 6 });
    });

    it("is centred as before when the outline is the centred rectangle of the stored size", () => {
      const side = { name: "Side Room", widthM: "8.00", lengthM: "4.00", floorPlanOutline: corners(-4, -2, 4, 2) };
      const { room } = adaptEditorStateToBlueprintScene({ space: side, objects: [], lastSavedAt: null });
      expect(room).toEqual({ widthM: 8, lengthM: 4 });
      expect(editorPositionToBlueprintPoint(0, 0, room)).toEqual({ x: 4, y: 2 });
    });

    it("leaves a named room to its own drawing, whatever outline is stored for it", () => {
      // Production stores the Robert Adam Room as a 9.7 m by 5.6 m rectangle; the planner draws its own walls, 11.4 m by 12.7 m.
      const stored = { name: "Robert Adam Room", widthM: "9.70", lengthM: "5.60", floorPlanOutline: corners(-4.85, -2.8, 4.85, 2.8) };
      const { room } = adaptEditorStateToBlueprintScene({ space: stored, objects: [], lastSavedAt: null });
      expect(room.widthM).toBeCloseTo(11.4, 9);
      expect(room.lengthM).toBeCloseTo(12.7, 9);
      expect(room.originM).toEqual({ x: -5.7, z: -3.7 });
      // And the Grand Hall, stored as 21 m by 10 m, keeps its drawn walls, the scan's 21.135 m by 10.59 m (#391), centred.
      const hall = { name: "Grand Hall", widthM: "21.00", lengthM: "10.00", floorPlanOutline: corners(-10.5, -5, 10.5, 5) };
      expect(adaptEditorStateToBlueprintScene({ space: hall, objects: [], lastSavedAt: null }).room).toEqual({ widthM: 21.135, lengthM: 10.59 });
    });

    it("falls back to the stored size, centred, with no outline to draw from", () => {
      const { room } = adaptEditorStateToBlueprintScene({ space: { name: "Unknown Room", widthM: "7.50", lengthM: "3.20", floorPlanOutline: [] }, objects: [], lastSavedAt: null });
      expect(room).toEqual({ widthM: 7.5, lengthM: 3.2 });
    });
  });

  it("supplies an empty actual-chair list when the table has no group", () => {
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
    expect(table.chairs).toEqual([]);
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
