import { describe, it, expect } from "vitest";
import {
  ALIGN_SNAP_M,
  HISTORY_CAP,
  NUDGE_STEP_BIG_M,
  NUDGE_STEP_M,
  ROTATE_STEP_DEG,
  TEMPLATES,
  buildItemForChip,
  buildTemplateItems,
  clampCenterToRoom,
  duplicateItem,
  initialEditorState,
  itemAnchors,
  itemsInsideBox,
  itemsOverlap,
  reduce,
  resizeItem,
  snapToAlignment,
  snapToGrid,
} from "../reducer.js";
import { DEMO_SCENE } from "../demo-scene.js";
import type { BlueprintItem, CatalogueChip, RoundTableItem } from "../types.js";

const round = (id: string, x: number, y: number): RoundTableItem => ({
  id, kind: "round-table", shape: "round",
  center: { x, y }, diameterM: 1.8, seats: 10,
  linen: "Ivory", centrepiece: "Low floral",
});

describe("snapToGrid", () => {
  it("rounds to the nearest 0.5 by default", () => {
    expect(snapToGrid(1.23)).toBe(1);
    expect(snapToGrid(1.26)).toBe(1.5);
    expect(snapToGrid(1.74)).toBe(1.5);
    expect(snapToGrid(1.76)).toBe(2);
  });
  it("respects a custom step", () => {
    expect(snapToGrid(1.23, 0.1)).toBeCloseTo(1.2, 9);
    expect(snapToGrid(1.27, 0.1)).toBeCloseTo(1.3, 9);
  });
});

describe("itemsOverlap", () => {
  it("detects overlapping round tables", () => {
    const a = round("a", 5, 5);
    const b = round("b", 5.5, 5);
    expect(itemsOverlap(a, b)).toBe(true);
  });
  it("separate items do not overlap", () => {
    const a = round("a", 1, 1);
    const b = round("b", 10, 10);
    expect(itemsOverlap(a, b)).toBe(false);
  });
});

describe("reducer: select", () => {
  it("sets the selected id", () => {
    const s = initialEditorState(DEMO_SCENE);
    const s2 = reduce(s, { type: "select", id: "round-3" });
    expect(s2.selectedId).toBe("round-3");
    expect(s2.dirty).toBe(false);
    expect(s2.past).toEqual([]);
  });
  it("select is transient (no history push)", () => {
    const s = reduce(initialEditorState(DEMO_SCENE), { type: "select", id: "round-3" });
    expect(s.past).toEqual([]);
  });
});

describe("reducer: move-to", () => {
  it("moves a round table by updating its center", () => {
    const s = initialEditorState(DEMO_SCENE);
    const s2 = reduce(s, { type: "move-to", id: "round-3", center: { x: 10, y: 5 } });
    const moved = s2.scene.items.find((i) => i.id === "round-3");
    expect(moved).toBeDefined();
    expect((moved as RoundTableItem).center).toEqual({ x: 10, y: 5 });
    expect(s2.dirty).toBe(true);
    expect(s2.past).toHaveLength(1);
  });

  it("moves a rect item by recomputing topLeft from the given centre", () => {
    const s = initialEditorState(DEMO_SCENE);
    const s2 = reduce(s, { type: "move-to", id: "stage", center: { x: 10, y: 3 } });
    const moved = s2.scene.items.find((i) => i.id === "stage");
    expect(moved).toBeDefined();
    if (moved !== undefined && moved.shape === "rect") {
      // Stage is 8×3m, so topLeft = (10-4, 3-1.5) = (6, 1.5)
      expect(moved.topLeft.x).toBeCloseTo(6, 6);
      expect(moved.topLeft.y).toBeCloseTo(1.5, 6);
    }
  });
});

describe("reducer: nudge-selected", () => {
  it("no-op when nothing selected", () => {
    const s = initialEditorState(DEMO_SCENE, null);
    const s2 = reduce(s, { type: "nudge-selected", dx: 1, dy: 1 });
    expect(s2).toBe(s);
  });
  it("nudges the selected item by the delta", () => {
    const s = initialEditorState(DEMO_SCENE, "round-3");
    const s2 = reduce(s, { type: "nudge-selected", dx: NUDGE_STEP_M, dy: 0 });
    const item = s2.scene.items.find((i) => i.id === "round-3") as RoundTableItem;
    const originalCentre = (DEMO_SCENE.items.find((i) => i.id === "round-3") as RoundTableItem).center;
    expect(item.center.x).toBeCloseTo(originalCentre.x + NUDGE_STEP_M, 6);
    expect(item.center.y).toBeCloseTo(originalCentre.y, 6);
  });
  it("respects NUDGE_STEP_BIG_M for large nudges", () => {
    const s = initialEditorState(DEMO_SCENE, "round-3");
    const s2 = reduce(s, { type: "nudge-selected", dx: NUDGE_STEP_BIG_M, dy: 0 });
    const item = s2.scene.items.find((i) => i.id === "round-3") as RoundTableItem;
    const originalCentre = (DEMO_SCENE.items.find((i) => i.id === "round-3") as RoundTableItem).center;
    expect(item.center.x).toBeCloseTo(originalCentre.x + 1, 6);
  });
});

describe("reducer: rotate-selected", () => {
  it("rotates a rect item by the step", () => {
    const s = initialEditorState(DEMO_SCENE, "stage");
    const s2 = reduce(s, { type: "rotate-selected", deltaDeg: ROTATE_STEP_DEG });
    const stage = s2.scene.items.find((i) => i.id === "stage");
    expect(stage?.rotationDeg).toBe(90);
  });
  it("accumulates rotations modulo 360", () => {
    let s = initialEditorState(DEMO_SCENE, "stage");
    for (let i = 0; i < 5; i += 1) {
      s = reduce(s, { type: "rotate-selected", deltaDeg: ROTATE_STEP_DEG });
    }
    // 5 × 90 = 450 → 90 mod 360.
    const stage = s.scene.items.find((i) => i.id === "stage");
    expect(stage?.rotationDeg).toBe(90);
  });
});

describe("reducer: remove + remove-selected", () => {
  it("removes an item by id", () => {
    const s = initialEditorState(DEMO_SCENE);
    const s2 = reduce(s, { type: "remove", id: "stage" });
    expect(s2.scene.items.find((i) => i.id === "stage")).toBeUndefined();
    expect(s2.past).toHaveLength(1);
  });
  it("clears selection if the removed id was selected", () => {
    const s = initialEditorState(DEMO_SCENE, "stage");
    const s2 = reduce(s, { type: "remove", id: "stage" });
    expect(s2.selectedId).toBeNull();
  });
  it("remove-selected no-ops when nothing selected", () => {
    const s = initialEditorState(DEMO_SCENE, null);
    const s2 = reduce(s, { type: "remove-selected" });
    expect(s2).toBe(s);
  });
  it("remove-selected deletes + clears selection", () => {
    const s = initialEditorState(DEMO_SCENE, "stage");
    const s2 = reduce(s, { type: "remove-selected" });
    expect(s2.selectedId).toBeNull();
    expect(s2.scene.items.find((i) => i.id === "stage")).toBeUndefined();
  });
});

describe("reducer: add", () => {
  it("appends the item and can auto-select", () => {
    const s = initialEditorState(DEMO_SCENE, null);
    const item: BlueprintItem = round("new-1", 5, 5);
    const s2 = reduce(s, { type: "add", item, select: true });
    expect(s2.scene.items).toContain(item);
    expect(s2.selectedId).toBe("new-1");
    expect(s2.dirty).toBe(true);
  });
  it("does not auto-select when select=false", () => {
    const s = initialEditorState(DEMO_SCENE, null);
    const item: BlueprintItem = round("new-2", 5, 5);
    const s2 = reduce(s, { type: "add", item, select: false });
    expect(s2.selectedId).toBeNull();
  });
});

describe("reducer: set-event-type / set-guests", () => {
  it("updates the event type (transient, no history push)", () => {
    const s = initialEditorState(DEMO_SCENE);
    const s2 = reduce(s, { type: "set-event-type", eventType: "gala" });
    expect(s2.scene.eventType).toBe("gala");
    expect(s2.past).toHaveLength(0);
  });
  it("clamps guestCount to 0 minimum", () => {
    const s = initialEditorState(DEMO_SCENE);
    const s2 = reduce(s, { type: "set-guests", guestCount: -10 });
    expect(s2.scene.guestCount).toBe(0);
  });
});

describe("reducer: undo / redo", () => {
  it("undo restores the previous scene", () => {
    const s = initialEditorState(DEMO_SCENE, "round-3");
    const s2 = reduce(s, { type: "move-to", id: "round-3", center: { x: 10, y: 10 } });
    const s3 = reduce(s2, { type: "undo" });
    expect(s3.scene).toEqual(s.scene);
    expect(s3.future).toHaveLength(1);
  });
  it("redo re-applies the mutation", () => {
    const s = initialEditorState(DEMO_SCENE, "round-3");
    const moved = reduce(s, { type: "move-to", id: "round-3", center: { x: 10, y: 10 } });
    const undone = reduce(moved, { type: "undo" });
    const redone = reduce(undone, { type: "redo" });
    expect(redone.scene).toEqual(moved.scene);
  });
  it("new mutation after undo clears the future stack", () => {
    const s = initialEditorState(DEMO_SCENE, "round-3");
    const moved = reduce(s, { type: "move-to", id: "round-3", center: { x: 10, y: 10 } });
    const undone = reduce(moved, { type: "undo" });
    const other = reduce(undone, { type: "move-to", id: "round-3", center: { x: 6, y: 4 } });
    expect(other.future).toEqual([]);
  });
  it("undo on empty stack is a no-op", () => {
    const s = initialEditorState(DEMO_SCENE);
    const s2 = reduce(s, { type: "undo" });
    expect(s2).toBe(s);
  });
  it("history is capped at HISTORY_CAP entries", () => {
    let s = initialEditorState(DEMO_SCENE, "round-3");
    for (let i = 0; i < HISTORY_CAP + 10; i += 1) {
      s = reduce(s, { type: "move-to", id: "round-3", center: { x: i / 10, y: 0 } });
    }
    expect(s.past.length).toBeLessThanOrEqual(HISTORY_CAP);
  });
});

describe("reducer: move-silent", () => {
  it("updates the item position without pushing history", () => {
    const s = initialEditorState(DEMO_SCENE);
    const s2 = reduce(s, { type: "move-silent", id: "round-3", center: { x: 10, y: 5 } });
    const moved = s2.scene.items.find((i) => i.id === "round-3") as RoundTableItem;
    expect(moved.center).toEqual({ x: 10, y: 5 });
    expect(s2.past).toHaveLength(0);
    expect(s2.future).toHaveLength(0);
    expect(s2.dirty).toBe(true);
  });

  it("rapid move-silent spam produces exactly zero history entries", () => {
    let s = initialEditorState(DEMO_SCENE);
    for (let i = 0; i < 30; i += 1) {
      s = reduce(s, { type: "move-silent", id: "round-3", center: { x: i / 10, y: 0 } });
    }
    expect(s.past).toHaveLength(0);
  });
});

describe("reducer: stamp-history", () => {
  it("pushes the supplied snapshot onto past", () => {
    const s = initialEditorState(DEMO_SCENE);
    const s2 = reduce(s, { type: "stamp-history", snapshot: s.scene });
    expect(s2.past).toHaveLength(1);
    expect(s2.past[0]).toBe(s.scene);
    expect(s2.future).toHaveLength(0);
    expect(s2.dirty).toBe(true);
  });

  it("clears future stack", () => {
    // Set up a scenario where future is non-empty, then stamp.
    let s = initialEditorState(DEMO_SCENE, "round-3");
    s = reduce(s, { type: "move-to", id: "round-3", center: { x: 10, y: 10 } });
    s = reduce(s, { type: "undo" });
    expect(s.future).toHaveLength(1);
    s = reduce(s, { type: "stamp-history", snapshot: s.scene });
    expect(s.future).toHaveLength(0);
  });
});

describe("reducer: drag-coalesce flow", () => {
  it("silent moves during drag + single stamp-history = 1 undo step restores pre-drag", () => {
    let s = initialEditorState(DEMO_SCENE, "round-3");
    const preDragScene = s.scene;
    const preDragCentre = (preDragScene.items.find((i) => i.id === "round-3") as RoundTableItem).center;
    // Simulate 60 frames of pointer-drag motion.
    for (let i = 0; i < 60; i += 1) {
      s = reduce(s, { type: "move-silent", id: "round-3", center: { x: i / 10, y: 0 } });
    }
    // One stamp on release coalesces the whole drag into a single undo step.
    s = reduce(s, { type: "stamp-history", snapshot: preDragScene });
    expect(s.past).toHaveLength(1);
    // Undo should fully restore pre-drag state in a single action.
    const undone = reduce(s, { type: "undo" });
    expect(undone.past).toHaveLength(0);
    const restored = undone.scene.items.find((i) => i.id === "round-3") as RoundTableItem;
    expect(restored.center).toEqual(preDragCentre);
  });
});

describe("clampCenterToRoom", () => {
  const room = { widthM: 21, lengthM: 10 };

  it("leaves a centre inside the room untouched (round kind)", () => {
    expect(clampCenterToRoom({ x: 10, y: 5 }, room, "round-table")).toEqual({ x: 10, y: 5 });
  });

  it("clamps to the left edge minus half-footprint", () => {
    const clamped = clampCenterToRoom({ x: -5, y: 5 }, room, "round-table");
    expect(clamped.x).toBe(0.9);
    expect(clamped.y).toBe(5);
  });

  it("clamps to the right edge", () => {
    const clamped = clampCenterToRoom({ x: 100, y: 5 }, room, "round-table");
    expect(clamped.x).toBe(room.widthM - 0.9);
  });

  it("stage uses a larger half-footprint", () => {
    const clamped = clampCenterToRoom({ x: 0, y: 0 }, room, "stage");
    expect(clamped.x).toBe(2);
    expect(clamped.y).toBe(2);
  });

  it("defaults (no kind) to a 1 m half-footprint", () => {
    const clamped = clampCenterToRoom({ x: -100, y: -100 }, room);
    expect(clamped.x).toBe(1);
    expect(clamped.y).toBe(1);
  });
});

describe("reducer: duplicate-selected", () => {
  it("no-op when nothing selected", () => {
    const s = initialEditorState(DEMO_SCENE, null);
    const s2 = reduce(s, { type: "duplicate-selected", idSeed: 999 });
    expect(s2).toBe(s);
  });

  it("clones the selected item + selects the copy + pushes history", () => {
    const s = initialEditorState(DEMO_SCENE, "round-3");
    const s2 = reduce(s, { type: "duplicate-selected", idSeed: 999 });
    expect(s2.scene.items.length).toBe(DEMO_SCENE.items.length + 1);
    expect(s2.selectedId).not.toBe("round-3");
    expect(s2.past).toHaveLength(1);
  });

  it("clone is offset from the original", () => {
    const s = initialEditorState(DEMO_SCENE, "round-3");
    const s2 = reduce(s, { type: "duplicate-selected", idSeed: 999 });
    const original = DEMO_SCENE.items.find((i) => i.id === "round-3") as RoundTableItem;
    const copy = s2.scene.items.find((i) => i.id === s2.selectedId) as RoundTableItem;
    expect(copy.center.x).not.toBe(original.center.x);
    expect(copy.center.y).not.toBe(original.center.y);
  });
});

describe("duplicateItem", () => {
  it("preserves seat count + linen + centrepiece on round table", () => {
    const r: RoundTableItem = round("r1", 5, 5);
    const copy = duplicateItem(r, 42) as RoundTableItem;
    expect(copy.seats).toBe(r.seats);
    expect(copy.linen).toBe(r.linen);
    expect(copy.centrepiece).toBe(r.centrepiece);
    expect(copy.id).not.toBe(r.id);
    expect(copy.id).toContain("42");
  });

  it("preserves width/length on rect items", () => {
    const src = DEMO_SCENE.items.find((i) => i.id === "stage");
    if (src === undefined) throw new Error("fixture missing stage");
    const copy = duplicateItem(src, 7);
    expect(copy.kind).toBe(src.kind);
    if (src.shape === "rect" && copy.shape === "rect") {
      expect(copy.widthM).toBe(src.widthM);
      expect(copy.lengthM).toBe(src.lengthM);
    }
  });
});

describe("TEMPLATES + buildTemplateItems", () => {
  const room = { widthM: 21, lengthM: 10 };

  it("exports three templates (banquet / ceremony / cabaret)", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(["banquet", "ceremony", "cabaret"]);
  });

  it.each<["banquet" | "ceremony" | "cabaret"]>([["banquet"], ["ceremony"], ["cabaret"]])("builds non-empty items for %s", (id) => {
    const items = buildTemplateItems(id, room, 120, 100);
    expect(items.length).toBeGreaterThan(0);
    // Every template item has a non-empty id and a valid kind.
    for (const it of items) {
      expect(it.id.length).toBeGreaterThan(0);
      expect(it.kind.length).toBeGreaterThan(0);
    }
  });

  it("banquet includes a top table + dancefloor + rounds", () => {
    const items = buildTemplateItems("banquet", room, 180, 100);
    const kinds = items.map((i) => i.kind);
    expect(kinds).toContain("top-table");
    expect(kinds).toContain("dancefloor");
    expect(kinds).toContain("round-table");
  });

  it("ceremony includes a stage + long tables", () => {
    const items = buildTemplateItems("ceremony", room, 150, 100);
    const kinds = items.map((i) => i.kind);
    expect(kinds).toContain("stage");
    expect(kinds).toContain("long-table");
  });

  it("cabaret includes stage + bar + dancefloor + round tables", () => {
    const items = buildTemplateItems("cabaret", room, 100, 100);
    const kinds = items.map((i) => i.kind);
    expect(kinds).toContain("stage");
    expect(kinds).toContain("bar");
    expect(kinds).toContain("dancefloor");
    expect(kinds).toContain("round-table");
  });

  it("template item count scales with guest count (banquet rounds)", () => {
    const small = buildTemplateItems("banquet", room, 40, 1).filter((i) => i.kind === "round-table");
    const large = buildTemplateItems("banquet", room, 200, 1).filter((i) => i.kind === "round-table");
    expect(large.length).toBeGreaterThan(small.length);
  });
});

describe("reducer: apply-template + clear-scene", () => {
  it("apply-template replaces items + clears selection", () => {
    const s = initialEditorState(DEMO_SCENE, "round-3");
    const s2 = reduce(s, { type: "apply-template", templateId: "banquet", idSeed: 500 });
    expect(s2.selectedId).toBeNull();
    expect(s2.scene.items).not.toEqual(DEMO_SCENE.items);
    expect(s2.scene.items.length).toBeGreaterThan(0);
    expect(s2.past).toHaveLength(1);
  });

  it("clear-scene wipes all items", () => {
    const s = initialEditorState(DEMO_SCENE, "round-3");
    const s2 = reduce(s, { type: "clear-scene" });
    expect(s2.scene.items).toEqual([]);
    expect(s2.selectedId).toBeNull();
    expect(s2.past).toHaveLength(1);
  });

  it("clear-scene on an already-empty scene is a no-op", () => {
    const empty = initialEditorState({ ...DEMO_SCENE, items: [] }, null);
    const s2 = reduce(empty, { type: "clear-scene" });
    expect(s2).toBe(empty);
  });
});

describe("itemAnchors", () => {
  it("computes centre + edges for a round table", () => {
    const r = round("r", 5, 5);
    const a = itemAnchors(r);
    expect(a.cx).toBe(5);
    expect(a.cy).toBe(5);
    expect(a.left).toBeCloseTo(4.1, 6);
    expect(a.right).toBeCloseTo(5.9, 6);
    expect(a.top).toBeCloseTo(4.1, 6);
    expect(a.bottom).toBeCloseTo(5.9, 6);
  });
});

describe("snapToAlignment", () => {
  const neighbour = round("n", 10, 5);

  it("returns the original centre when nothing is within threshold", () => {
    const out = snapToAlignment({ x: 0, y: 0 }, 0.9, 0.9, [neighbour], ALIGN_SNAP_M);
    expect(out.center.x).toBe(0);
    expect(out.center.y).toBe(0);
    expect(out.guides).toHaveLength(0);
  });

  it("pulls centre-to-centre when the dragged item is nearly aligned with a neighbour on X", () => {
    const out = snapToAlignment({ x: 10 + 0.1, y: 3 }, 0.9, 0.9, [neighbour]);
    expect(out.center.x).toBeCloseTo(10, 6);
    expect(out.guides.some((g) => g.axis === "x" && g.value === 10)).toBe(true);
  });

  it("pulls centre-to-centre when the dragged item is nearly aligned with a neighbour on Y", () => {
    const out = snapToAlignment({ x: 2, y: 5 + 0.1 }, 0.9, 0.9, [neighbour]);
    expect(out.center.y).toBeCloseTo(5, 6);
    expect(out.guides.some((g) => g.axis === "y" && g.value === 5)).toBe(true);
  });

  it("emits up to two guides (one per axis) when both align", () => {
    const out = snapToAlignment({ x: 10 + 0.1, y: 5 + 0.1 }, 0.9, 0.9, [neighbour]);
    expect(out.guides).toHaveLength(2);
  });

  it("the nearest anchor wins when multiple candidates are in range", () => {
    const a = round("a", 10, 5);
    const b = round("b", 10.05, 5);
    // b is slightly closer to the 10.08 dragged centre.
    const out = snapToAlignment({ x: 10.08, y: 0 }, 0.9, 0.9, [a, b]);
    const guide = out.guides.find((g) => g.axis === "x");
    expect(guide?.value).toBe(10.05);
  });
});

describe("resizeItem", () => {
  const stage: BlueprintItem = {
    id: "stage", kind: "stage", shape: "rect",
    topLeft: { x: 1, y: 1 }, widthM: 8, lengthM: 3,
  };

  it("NW handle drags top-left corner", () => {
    const out = resizeItem(stage, "nw", { x: 0, y: 0 });
    if (out.shape === "rect") {
      expect(out.topLeft).toEqual({ x: 0, y: 0 });
      expect(out.widthM).toBe(9);
      expect(out.lengthM).toBe(4);
    }
  });

  it("SE handle extends width + length", () => {
    const out = resizeItem(stage, "se", { x: 12, y: 6 });
    if (out.shape === "rect") {
      expect(out.topLeft).toEqual({ x: 1, y: 1 });
      expect(out.widthM).toBe(11);
      expect(out.lengthM).toBe(5);
    }
  });

  it("enforces a 0.5 m minimum footprint", () => {
    const out = resizeItem(stage, "se", { x: 1.1, y: 1.1 });
    if (out.shape === "rect") {
      expect(out.widthM).toBeCloseTo(0.5, 6);
      expect(out.lengthM).toBeCloseTo(0.5, 6);
    }
  });

  it("round tables are returned unchanged", () => {
    const r = round("r", 5, 5);
    const out = resizeItem(r, "se", { x: 100, y: 100 });
    expect(out).toBe(r);
  });
});

describe("itemsInsideBox", () => {
  const a = round("a", 5, 5);
  const b = round("b", 10, 5);
  const c = round("c", 15, 8);

  it("returns items fully enclosed", () => {
    const hits = itemsInsideBox([a, b, c], { left: 4, top: 4, right: 11, bottom: 6 });
    expect(hits).toEqual(["a", "b"]);
  });

  it("returns items that merely overlap the box", () => {
    const hits = itemsInsideBox([a, b, c], { left: 4.5, top: 4.5, right: 5.2, bottom: 5.2 });
    expect(hits).toContain("a");
  });

  it("empty box selects nothing", () => {
    const hits = itemsInsideBox([a, b, c], { left: 1, top: 1, right: 1, bottom: 1 });
    expect(hits).toEqual([]);
  });

  it("handles inverted coordinates (dragged from bottom-right to top-left)", () => {
    const hits = itemsInsideBox([a, b, c], { left: 11, top: 6, right: 4, bottom: 4 });
    expect(hits).toEqual(["a", "b"]);
  });

  it("preserves input order", () => {
    const hits = itemsInsideBox([c, a, b], { left: 0, top: 0, right: 20, bottom: 20 });
    expect(hits).toEqual(["c", "a", "b"]);
  });
});

describe("reducer: multi-select", () => {
  it("select mirrors selectedIds", () => {
    const s = initialEditorState(DEMO_SCENE, null);
    const s2 = reduce(s, { type: "select", id: "round-3" });
    expect(s2.selectedId).toBe("round-3");
    expect(s2.selectedIds).toEqual(["round-3"]);
  });

  it("toggle-select adds an id + updates primary", () => {
    const s = initialEditorState(DEMO_SCENE, "round-3");
    const s2 = reduce(s, { type: "toggle-select", id: "round-4" });
    expect(s2.selectedIds).toEqual(["round-3", "round-4"]);
    expect(s2.selectedId).toBe("round-3");
  });

  it("toggle-select removes an already-selected id", () => {
    const s = initialEditorState(DEMO_SCENE, "round-3");
    const added = reduce(s, { type: "toggle-select", id: "round-4" });
    const removed = reduce(added, { type: "toggle-select", id: "round-4" });
    expect(removed.selectedIds).toEqual(["round-3"]);
  });

  it("select-all selects every item", () => {
    const s = initialEditorState(DEMO_SCENE, null);
    const s2 = reduce(s, { type: "select-all" });
    expect(s2.selectedIds).toHaveLength(DEMO_SCENE.items.length);
  });

  it("select-ids with an empty array clears selection", () => {
    const s = initialEditorState(DEMO_SCENE, "round-3");
    const s2 = reduce(s, { type: "select-ids", ids: [] });
    expect(s2.selectedId).toBeNull();
    expect(s2.selectedIds).toEqual([]);
  });

  it("remove-selected wipes the entire selection set", () => {
    const s = initialEditorState(DEMO_SCENE, "round-3");
    const twoSelected = reduce(s, { type: "toggle-select", id: "round-4" });
    const wiped = reduce(twoSelected, { type: "remove-selected" });
    expect(wiped.scene.items.find((i) => i.id === "round-3")).toBeUndefined();
    expect(wiped.scene.items.find((i) => i.id === "round-4")).toBeUndefined();
    expect(wiped.selectedIds).toEqual([]);
  });

  it("nudge-selected moves every selected item by the same delta", () => {
    const s = initialEditorState(DEMO_SCENE, "round-3");
    const twoSelected = reduce(s, { type: "toggle-select", id: "round-4" });
    const nudged = reduce(twoSelected, { type: "nudge-selected", dx: 1, dy: 0 });
    const r3 = nudged.scene.items.find((i) => i.id === "round-3") as RoundTableItem;
    const r4 = nudged.scene.items.find((i) => i.id === "round-4") as RoundTableItem;
    const orig3 = (DEMO_SCENE.items.find((i) => i.id === "round-3") as RoundTableItem).center;
    const orig4 = (DEMO_SCENE.items.find((i) => i.id === "round-4") as RoundTableItem).center;
    expect(r3.center.x).toBeCloseTo(orig3.x + 1, 6);
    expect(r4.center.x).toBeCloseTo(orig4.x + 1, 6);
  });

  it("rotate-selected rotates every selected item", () => {
    const s = initialEditorState(DEMO_SCENE, "stage");
    const multi = reduce(s, { type: "toggle-select", id: "top-table" });
    const rotated = reduce(multi, { type: "rotate-selected", deltaDeg: 90 });
    expect(rotated.scene.items.find((i) => i.id === "stage")?.rotationDeg).toBe(90);
    expect(rotated.scene.items.find((i) => i.id === "top-table")?.rotationDeg).toBe(90);
  });

  it("duplicate-selected clones every selected item", () => {
    const s = initialEditorState(DEMO_SCENE, "round-3");
    const multi = reduce(s, { type: "toggle-select", id: "round-4" });
    const dup = reduce(multi, { type: "duplicate-selected", idSeed: 500 });
    expect(dup.scene.items.length).toBe(DEMO_SCENE.items.length + 2);
    expect(dup.selectedIds).toHaveLength(2);
  });

  it("remove (single) strips the id from selectedIds", () => {
    const s = initialEditorState(DEMO_SCENE, "round-3");
    const multi = reduce(s, { type: "toggle-select", id: "round-4" });
    const removed = reduce(multi, { type: "remove", id: "round-3" });
    expect(removed.selectedIds).toEqual(["round-4"]);
    expect(removed.selectedId).toBe("round-4");
  });
});

describe("reducer: mark-saved", () => {
  it("clears the dirty flag + stamps lastSavedAtMs", () => {
    const s = initialEditorState(DEMO_SCENE, "round-3");
    const moved = reduce(s, { type: "move-to", id: "round-3", center: { x: 10, y: 10 } });
    expect(moved.dirty).toBe(true);
    const saved = reduce(moved, { type: "mark-saved" });
    expect(saved.dirty).toBe(false);
    expect(saved.scene.lastSavedAtMs).not.toBeNull();
  });
});

describe("buildItemForChip", () => {
  const centre = { x: 5, y: 5 };

  it("builds a round-table item", () => {
    const chip: CatalogueChip = { label: "Round 10", kind: "round-table", marker: "circle" };
    const item = buildItemForChip(chip, centre, 1);
    expect(item.kind).toBe("round-table");
    expect(item.id).toContain("round-table");
  });

  it("round tables seat 10 by default", () => {
    const item = buildItemForChip({ label: "Round 10", kind: "round-table", marker: "circle" }, centre, 1);
    if (item.kind === "round-table") {
      expect(item.seats).toBe(10);
      expect(item.diameterM).toBe(1.8);
    } else {
      throw new Error("Expected round-table");
    }
  });

  it("dancefloor is centred around the drop point", () => {
    const item = buildItemForChip({ label: "Dancefloor", kind: "dancefloor", marker: "sparkle" }, centre, 1);
    if (item.shape === "dancefloor") {
      expect(item.topLeft.x).toBeCloseTo(5 - 2, 6);
      expect(item.topLeft.y).toBeCloseTo(5 - 1.5, 6);
    }
  });

  it("stage is built with default 4×2m dimensions", () => {
    const item = buildItemForChip({ label: "Stage", kind: "stage", marker: "square-filled" }, centre, 1);
    if (item.shape === "rect" && item.kind === "stage") {
      expect(item.widthM).toBe(4);
      expect(item.lengthM).toBe(2);
    }
  });

  it("long-table defaults to 12 seats, 3×0.9m", () => {
    const item = buildItemForChip({ label: "Long 12", kind: "long-table", marker: "square-outline" }, centre, 1);
    if (item.shape === "rect" && item.kind === "long-table") {
      expect(item.seats).toBe(12);
      expect(item.widthM).toBe(3);
      expect(item.lengthM).toBe(0.9);
    }
  });

  it("bar defaults to 3m × 0.7m", () => {
    const item = buildItemForChip({ label: "Bar", kind: "bar", marker: "bar" }, centre, 1);
    if (item.kind === "bar" && item.shape === "bar") {
      expect(item.widthM).toBe(3);
      expect(item.lengthM).toBe(0.7);
    }
  });
});

describe("reducer: toggle-lock", () => {
  it("no-op when selection is empty", () => {
    const s = initialEditorState(DEMO_SCENE, null);
    const s2 = reduce(s, { type: "toggle-lock" });
    expect(s2).toBe(s);
  });

  it("locks an unlocked item and pushes history", () => {
    const s = initialEditorState(DEMO_SCENE, "stage");
    const s2 = reduce(s, { type: "toggle-lock" });
    const stage = s2.scene.items.find((i) => i.id === "stage");
    expect(stage?.locked).toBe(true);
    expect(s2.past).toHaveLength(1);
    expect(s2.dirty).toBe(true);
  });

  it("unlocks when every selected item is already locked", () => {
    const s = initialEditorState(DEMO_SCENE, "stage");
    const locked = reduce(s, { type: "toggle-lock" });
    const unlocked = reduce(locked, { type: "toggle-lock" });
    const stage = unlocked.scene.items.find((i) => i.id === "stage");
    expect(stage?.locked).toBe(false);
  });

  it("locks all in a mixed selection (any-unlocked → lock all)", () => {
    let s = initialEditorState(DEMO_SCENE, "stage");
    s = reduce(s, { type: "toggle-lock" }); // stage locked
    s = reduce(s, { type: "select-ids", ids: ["stage", "bar"] });
    s = reduce(s, { type: "toggle-lock" });
    const stage = s.scene.items.find((i) => i.id === "stage");
    const bar = s.scene.items.find((i) => i.id === "bar");
    expect(stage?.locked).toBe(true);
    expect(bar?.locked).toBe(true);
  });

  it("single-id form toggles just that item and leaves selection untouched", () => {
    let s = initialEditorState(DEMO_SCENE);
    s = reduce(s, { type: "select-ids", ids: ["stage", "bar"] });
    const s2 = reduce(s, { type: "toggle-lock", id: "top-table" });
    expect(s2.scene.items.find((i) => i.id === "top-table")?.locked).toBe(true);
    expect(s2.scene.items.find((i) => i.id === "stage")?.locked ?? false).toBe(false);
    expect(s2.scene.items.find((i) => i.id === "bar")?.locked ?? false).toBe(false);
    expect(s2.selectedIds).toEqual(s.selectedIds);
  });

  it("single-id form is a no-op for an unknown id", () => {
    const s = initialEditorState(DEMO_SCENE);
    const s2 = reduce(s, { type: "toggle-lock", id: "does-not-exist" });
    expect(s2).toBe(s);
  });

  it("single-id form pushes history", () => {
    const s = initialEditorState(DEMO_SCENE);
    const s2 = reduce(s, { type: "toggle-lock", id: "bar" });
    expect(s2.past).toHaveLength(1);
  });
});

describe("reducer: lock guards", () => {
  const lockItem = (s: ReturnType<typeof initialEditorState>, id: string) => {
    const sel = reduce(s, { type: "select", id });
    return reduce(sel, { type: "toggle-lock" });
  };

  it("move-silent ignores locked item", () => {
    const locked = lockItem(initialEditorState(DEMO_SCENE), "round-3");
    const before = locked.scene.items.find((i) => i.id === "round-3") as RoundTableItem;
    const s2 = reduce(locked, { type: "move-silent", id: "round-3", center: { x: 12, y: 7 } });
    expect(s2).toBe(locked);
    const after = s2.scene.items.find((i) => i.id === "round-3") as RoundTableItem;
    expect(after.center).toEqual(before.center);
  });

  it("nudge-selected skips locked items within a multi-selection", () => {
    let s = lockItem(initialEditorState(DEMO_SCENE), "round-1");
    s = reduce(s, { type: "select-ids", ids: ["round-1", "round-2"] });
    const round1Before = s.scene.items.find((i) => i.id === "round-1") as RoundTableItem;
    const round2Before = s.scene.items.find((i) => i.id === "round-2") as RoundTableItem;
    const s2 = reduce(s, { type: "nudge-selected", dx: NUDGE_STEP_M, dy: 0 });
    const round1After = s2.scene.items.find((i) => i.id === "round-1") as RoundTableItem;
    const round2After = s2.scene.items.find((i) => i.id === "round-2") as RoundTableItem;
    expect(round1After.center).toEqual(round1Before.center);
    expect(round2After.center.x).toBeCloseTo(round2Before.center.x + NUDGE_STEP_M, 6);
  });

  it("rotate-selected skips locked items", () => {
    let s = lockItem(initialEditorState(DEMO_SCENE), "stage");
    s = reduce(s, { type: "select-ids", ids: ["stage", "top-table"] });
    const s2 = reduce(s, { type: "rotate-selected", deltaDeg: ROTATE_STEP_DEG });
    const stage = s2.scene.items.find((i) => i.id === "stage");
    const top = s2.scene.items.find((i) => i.id === "top-table");
    expect(stage?.rotationDeg ?? 0).toBe(0);
    expect(top?.rotationDeg).toBe(ROTATE_STEP_DEG);
  });

  it("remove by id refuses to delete a locked item", () => {
    const locked = lockItem(initialEditorState(DEMO_SCENE), "bar");
    const s2 = reduce(locked, { type: "remove", id: "bar" });
    expect(s2).toBe(locked);
    expect(s2.scene.items.some((i) => i.id === "bar")).toBe(true);
  });

  it("remove-selected preserves locked items and removes the unlocked ones", () => {
    let s = lockItem(initialEditorState(DEMO_SCENE), "stage");
    s = reduce(s, { type: "select-ids", ids: ["stage", "bar"] });
    const s2 = reduce(s, { type: "remove-selected" });
    expect(s2.scene.items.some((i) => i.id === "stage")).toBe(true);
    expect(s2.scene.items.some((i) => i.id === "bar")).toBe(false);
    expect(s2.selectedIds).toEqual([]);
  });

  it("remove-selected is a no-op when every selected item is locked", () => {
    let s = lockItem(initialEditorState(DEMO_SCENE), "stage");
    s = reduce(s, { type: "select-ids", ids: ["stage"] });
    const s2 = reduce(s, { type: "remove-selected" });
    expect(s2.scene.items.length).toBe(s.scene.items.length);
  });

  it("replace-item-silent refuses to mutate a locked item", () => {
    const locked = lockItem(initialEditorState(DEMO_SCENE), "round-1");
    const target = locked.scene.items.find((i) => i.id === "round-1") as RoundTableItem;
    const mutated: RoundTableItem = { ...target, center: { x: 0.5, y: 0.5 } };
    const s2 = reduce(locked, { type: "replace-item-silent", item: mutated });
    expect(s2).toBe(locked);
  });
});

describe("reducer: z-order", () => {
  const idsOf = (state: ReturnType<typeof initialEditorState>) =>
    state.scene.items.map((i) => i.id);

  it("no-op when selection is empty", () => {
    const s = initialEditorState(DEMO_SCENE, null);
    const s2 = reduce(s, { type: "raise-selected" });
    expect(s2).toBe(s);
  });

  it("raise-selected moves a single selection one slot later", () => {
    const s = initialEditorState(DEMO_SCENE, "stage"); // index 0
    const s2 = reduce(s, { type: "raise-selected" });
    const before = idsOf(s);
    const after = idsOf(s2);
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe("stage");
    expect(s2.past).toHaveLength(1);
  });

  it("raise-selected is a no-op at the top of the stack", () => {
    const items = DEMO_SCENE.items;
    const lastId = items[items.length - 1]?.id as string;
    const s = initialEditorState(DEMO_SCENE, lastId);
    const s2 = reduce(s, { type: "raise-selected" });
    expect(s2).toBe(s);
  });

  it("lower-selected moves a single selection one slot earlier", () => {
    const s = initialEditorState(DEMO_SCENE, "top-table"); // index 1
    const s2 = reduce(s, { type: "lower-selected" });
    const before = idsOf(s);
    const after = idsOf(s2);
    expect(after[1]).toBe(before[0]);
    expect(after[0]).toBe("top-table");
  });

  it("lower-selected is a no-op at the bottom of the stack", () => {
    const firstId = DEMO_SCENE.items[0]?.id as string;
    const s = initialEditorState(DEMO_SCENE, firstId);
    const s2 = reduce(s, { type: "lower-selected" });
    expect(s2).toBe(s);
  });

  it("raise-to-top moves selection to the end in original relative order", () => {
    let s = initialEditorState(DEMO_SCENE);
    s = reduce(s, { type: "select-ids", ids: ["stage", "bar"] });
    const s2 = reduce(s, { type: "raise-to-top" });
    const ids = idsOf(s2);
    expect(ids[ids.length - 2]).toBe("stage");
    expect(ids[ids.length - 1]).toBe("bar");
  });

  it("lower-to-bottom moves selection to the start in original relative order", () => {
    let s = initialEditorState(DEMO_SCENE);
    s = reduce(s, { type: "select-ids", ids: ["dancefloor", "bar"] });
    const s2 = reduce(s, { type: "lower-to-bottom" });
    const ids = idsOf(s2);
    expect(ids[0]).toBe("dancefloor");
    expect(ids[1]).toBe("bar");
  });

  it("raise-selected preserves relative order among contiguous selected items", () => {
    // Select two adjacent items (stage=0, top-table=1). Raising should push
    // them as a block, not let them swap past each other.
    let s = initialEditorState(DEMO_SCENE);
    s = reduce(s, { type: "select-ids", ids: ["stage", "top-table"] });
    const s2 = reduce(s, { type: "raise-selected" });
    const ids = idsOf(s2);
    const stageIdx = ids.indexOf("stage");
    const topIdx = ids.indexOf("top-table");
    expect(stageIdx).toBeLessThan(topIdx);
    // Neither overtakes the other.
    expect(topIdx - stageIdx).toBe(1);
  });

  it("raise-to-top is a no-op when the selection is already at the top", () => {
    const items = DEMO_SCENE.items;
    const tailIds = [items[items.length - 2]?.id, items[items.length - 1]?.id].filter(
      (id): id is string => typeof id === "string",
    );
    let s = initialEditorState(DEMO_SCENE);
    s = reduce(s, { type: "select-ids", ids: tailIds });
    const s2 = reduce(s, { type: "raise-to-top" });
    // The items at the top already match the selection in the same order, so
    // no history should be pushed.
    const beforeIds = idsOf(s);
    const afterIds = idsOf(s2);
    expect(afterIds).toEqual(beforeIds);
  });
});
