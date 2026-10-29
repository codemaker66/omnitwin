// ---------------------------------------------------------------------------
// Lean planner furniture — render decision rules
//
// The mobile/tablet lean path was previously verified only by grepping
// PlacedFurniture.tsx for identifier spellings. Those assertions never execute
// the logic, so they pass even when it is inverted. The decisions are exported
// pure predicates, so execute them: no WebGL, no R3F tree, no happy-dom
// limitation applies to a boolean.
//
// Wiring (does the JSX actually call these?) stays in PlacedFurniture.test.ts.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  COMPACT_PLANNER_OVERLAY_MIN_VIEWPORT_WIDTH,
  MAX_LEAN_CONSTRAINT_VIOLATION_SKINS,
  NAMEPLATE_CLEARANCE_M,
  NAMEPLATE_MAX_WIDTH_M,
  cameraReferenceGlowRadius,
  furnitureNamePlateYOffset,
  leanSweepCandidates,
  nameplatePlaneSize,
  nameplateText,
  placementViolationIds,
  primaryNameplateId,
  shouldRenderIndividualFurnitureModel,
  shouldLimitPlannerFurnitureOverlays,
  visibleConstraintViolationIds,
} from "../PlacedFurniture.js";
import { CATALOGUE_ITEMS, getCatalogueItemBySlug } from "../../lib/catalogue.js";
import { createPlacedItem, type PlacedItem } from "../../lib/placement.js";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";

function catalogueIdAt(index: number): string {
  const item = CATALOGUE_ITEMS[index];
  if (item === undefined) throw new Error(`missing catalogue fixture at ${String(index)}`);
  return item.id;
}

describe("shouldLimitPlannerFurnitureOverlays", () => {
  it("limits overlay work strictly below the viewport threshold", () => {
    expect(shouldLimitPlannerFurnitureOverlays(COMPACT_PLANNER_OVERLAY_MIN_VIEWPORT_WIDTH - 1)).toBe(true);
    expect(shouldLimitPlannerFurnitureOverlays(COMPACT_PLANNER_OVERLAY_MIN_VIEWPORT_WIDTH)).toBe(false);
    expect(shouldLimitPlannerFurnitureOverlays(COMPACT_PLANNER_OVERLAY_MIN_VIEWPORT_WIDTH + 1)).toBe(false);
  });

  it("limits overlay work on a wide canvas while the camera moves", () => {
    expect(shouldLimitPlannerFurnitureOverlays(2560, true)).toBe(true);
  });

  it("treats camera interaction as inactive when the caller omits it", () => {
    expect(shouldLimitPlannerFurnitureOverlays(2560)).toBe(false);
  });

  it("keeps a zero-width canvas on the lean path rather than the full one", () => {
    expect(shouldLimitPlannerFurnitureOverlays(0)).toBe(true);
  });
});

describe("cameraReferenceGlowRadius", () => {
  it("tracks the same normalized X/Z footprint as the rendered furniture", () => {
    const item = { width: 1.8, depth: 0.9 };
    const base = cameraReferenceGlowRadius(item, 1);
    expect(cameraReferenceGlowRadius(item, 2)).toBeCloseTo(base * 2);
    expect(cameraReferenceGlowRadius(item, 0)).toBe(base);
  });
});

describe("furnitureNamePlateYOffset", () => {
  it("puts the plate's lower edge 0.9 m above the visible scaled top", () => {
    const table = { height: 0.75 };
    expect(NAMEPLATE_CLEARANCE_M).toBe(0.9);
    expect(furnitureNamePlateYOffset(table, 2)).toBeCloseTo(2.4);
    expect(furnitureNamePlateYOffset(table, 0)).toBeCloseTo(1.65);
  });
});

describe("nameplateText", () => {
  it("reads the label, then the grouped seat count when there is one", () => {
    expect(nameplateText("  Table 4 ", 10)).toBe("Table 4 · 10 seats");
    expect(nameplateText("Table 4", 1)).toBe("Table 4 · 1 seat");
    expect(nameplateText("Table 4", 0)).toBe("Table 4");
    expect(nameplateText("Table 4")).toBe("Table 4");
  });
});

describe("nameplatePlaneSize", () => {
  it("keeps the texture's aspect and never exceeds 2.4 m", () => {
    const [widest, widestHeight] = nameplatePlaneSize(1024, 176);
    expect(widest).toBeCloseTo(NAMEPLATE_MAX_WIDTH_M);
    expect(widest / widestHeight).toBeCloseTo(1024 / 176);
    const [narrow, narrowHeight] = nameplatePlaneSize(512, 176);
    expect(narrow).toBeCloseTo(1.2);
    expect(narrowHeight).toBeCloseTo(widestHeight);
    expect(nameplatePlaneSize(4096, 176)[0]).toBe(NAMEPLATE_MAX_WIDTH_M);
    expect(nameplatePlaneSize(0, 176)).toEqual([0, 0]);
  });
});

describe("primaryNameplateId", () => {
  function piece(slug: string, id: string, groupId: string | null = null): PlacedItem {
    const item = getCatalogueItemBySlug(slug);
    if (item === undefined) throw new Error(`missing ${slug} fixture`);
    return createPlacedItem(item.id, 0, 0, 0, groupId, 0, id);
  }
  const layout: readonly PlacedItem[] = [
    piece("round-table-6ft", "t1", "g1"),
    piece("banquet-chair", "c1", "g1"),
    piece("banquet-chair", "c2", "g1"),
    piece("round-table-6ft", "t2", "g2"),
    piece("banquet-chair", "c3", "g2"),
    piece("round-table-6ft", "t3"),
    piece("lectern", "l1"),
    piece("banquet-chair", "c4"),
  ];
  const primary = (...ids: string[]): string | null => primaryNameplateId(new Set(ids), layout);

  it("names a single selected table, or the table of one selected group", () => {
    expect(primary("t3")).toBe("t3");
    expect(primary("t1", "c1", "c2")).toBe("t1");
    expect(primary("t1", "c1")).toBe("t1");
  });

  it("names a single selected piece that is neither table nor chair", () => {
    expect(primary("l1")).toBe("l1");
  });

  it("never names a chair", () => {
    expect(primary("c4")).toBeNull();
    expect(primary("c1", "c2")).toBeNull();
  });

  it("names nothing when the selection is more than one unit", () => {
    expect(primary("t1", "t2")).toBeNull();
    expect(primary("t1", "c1", "t2", "c3")).toBeNull();
    expect(primary("t3", "l1")).toBeNull();
    expect(primary("t1", "c4")).toBeNull();
    expect(primary()).toBeNull();
  });

  it("names the one table of a group that also holds another piece", () => {
    const withLectern = [...layout, piece("lectern", "l2", "g1")];
    expect(primaryNameplateId(new Set(["t1", "c1", "l2"]), withLectern)).toBe("t1");
  });
});

describe("visibleConstraintViolationIds", () => {
  const violating: ReadonlySet<string> = new Set(["a", "b", "c", "d"]);
  const none: ReadonlySet<string> = new Set<string>();

  it("suppresses every warning when the cap is zero", () => {
    expect([...visibleConstraintViolationIds(violating, new Set(["a"]), 0)]).toEqual([]);
  });

  it("suppresses every warning for a negative cap rather than throwing", () => {
    expect([...visibleConstraintViolationIds(violating, none, -1)]).toEqual([]);
  });

  it("shows all violations when they fit within the cap", () => {
    expect([...visibleConstraintViolationIds(violating, none, 4)].sort())
      .toEqual(["a", "b", "c", "d"]);
    expect([...visibleConstraintViolationIds(violating, none, 99)].sort())
      .toEqual(["a", "b", "c", "d"]);
  });

  it("spends a scarce budget on the selected violation first", () => {
    expect([...visibleConstraintViolationIds(violating, new Set(["c"]), 1)]).toEqual(["c"]);
    expect([...visibleConstraintViolationIds(violating, new Set(["d"]), 1)]).toEqual(["d"]);
  });

  it("fills the remaining budget from unselected violations", () => {
    const visible = visibleConstraintViolationIds(violating, new Set(["d"]), 2);
    expect(visible.size).toBe(2);
    expect(visible.has("d")).toBe(true);
  });

  it("ignores selected ids that are not themselves violating", () => {
    const visible = visibleConstraintViolationIds(violating, new Set(["not-violating"]), 1);
    expect(visible.size).toBe(1);
    expect(visible.has("not-violating")).toBe(false);
  });

  it("never exceeds the cap even when everything is selected", () => {
    expect(visibleConstraintViolationIds(violating, violating, 2).size).toBe(2);
  });
});

describe("leanSweepCandidates", () => {
  const items: readonly PlacedItem[] = [
    createPlacedItem(catalogueIdAt(0), 0, 0),
    createPlacedItem(catalogueIdAt(0), 4, 0),
    createPlacedItem(catalogueIdAt(0), 8, 0),
  ];

  it("sweeps every item off the lean path", () => {
    expect(leanSweepCandidates(items, new Set<string>(), false)).toBe(items);
  });

  it("ignores the selection entirely off the lean path", () => {
    const first = items[0];
    if (first === undefined) throw new Error("fixture");
    expect(leanSweepCandidates(items, new Set([first.id]), false)).toHaveLength(3);
  });

  it("filters a retained dressing applicator only when one is actually present", () => {
    const applicator = CATALOGUE_ITEMS.find(({ slug }) => slug === "black-table-cloth");
    if (applicator === undefined) throw new Error("missing applicator fixture");
    const leaked = createPlacedItem(applicator.id, 2, 2);
    const withLegacyRow = [...items, leaked];

    const candidates = leanSweepCandidates(withLegacyRow, new Set<string>(), false);
    expect(candidates).not.toBe(withLegacyRow);
    expect(candidates).toEqual(items);
  });

  it("narrows to what the planner is touching on the lean path", () => {
    const second = items[1];
    if (second === undefined) throw new Error("fixture");
    const scoped = leanSweepCandidates(items, new Set([second.id]), true);
    expect(scoped.map((item) => item.id)).toEqual([second.id]);
  });

  it("sweeps nothing on the lean path when nothing is selected", () => {
    expect(leanSweepCandidates(items, new Set<string>(), true)).toHaveLength(0);
  });
});

describe("placementViolationIds", () => {
  const overlapping: readonly PlacedItem[] = [
    createPlacedItem(catalogueIdAt(0), 0, 0),
    createPlacedItem(catalogueIdAt(0), 0, 0),
  ];

  it("flags furniture stacked on the same spot", () => {
    const ids = placementViolationIds(overlapping, overlapping, GRAND_HALL_RENDER_DIMENSIONS);
    expect(ids.size).toBe(2);
  });

  // The property that makes the lean-path optimisation safe: narrowing the
  // OUTER loop must not change the verdict for any candidate that survives it.
  it("gives a scoped candidate the same verdict as the full sweep", () => {
    const first = overlapping[0];
    if (first === undefined) throw new Error("fixture");
    const full = placementViolationIds(overlapping, overlapping, GRAND_HALL_RENDER_DIMENSIONS);
    const scoped = placementViolationIds([first], overlapping, GRAND_HALL_RENDER_DIMENSIONS);
    expect(scoped.has(first.id)).toBe(full.has(first.id));
    expect(scoped.size).toBe(1);
  });

  it("clears a candidate once the furniture it overlapped is moved away", () => {
    const first = overlapping[0];
    if (first === undefined) throw new Error("fixture");
    const apart: readonly PlacedItem[] = [first, createPlacedItem(catalogueIdAt(0), 9, 4)];
    const ids = placementViolationIds([first], apart, GRAND_HALL_RENDER_DIMENSIONS);
    expect(ids.has(first.id)).toBe(false);
  });
});

describe("shouldRenderIndividualFurnitureModel — full decision table", () => {
  // Inspected, imported and failed-harvest models keep their individual path.
  const CASES: ReadonlyArray<readonly [boolean, boolean, boolean, boolean]> = [
    [false, false, false, true],
    [false, false, true, true],
    [false, true, false, false],
    [false, true, true, true],
    [true, false, false, true],
    [true, false, true, true],
    [true, true, false, true],
    [true, true, true, true],
  ];

  it.each(CASES)(
    "inspected=%s instanced=%s failed=%s renders=%s",
    (inspected, instanced, instancingFailed, expected) => {
      expect(shouldRenderIndividualFurnitureModel({ inspected, instanced, instancingFailed }))
        .toBe(expected);
    },
  );
});

describe("MAX_LEAN_CONSTRAINT_VIOLATION_SKINS — the shipped cap", () => {
  it("ships at exactly one warning on the lean path", () => {
    expect(MAX_LEAN_CONSTRAINT_VIOLATION_SKINS).toBe(1);
  });

  it("spends its single warning on the item the planner is touching", () => {
    const visible = visibleConstraintViolationIds(
      new Set(["a", "b", "c"]),
      new Set(["b"]),
      MAX_LEAN_CONSTRAINT_VIOLATION_SKINS,
    );
    expect([...visible]).toEqual(["b"]);
  });

  it("still surfaces one warning when the planner has selected nothing", () => {
    const visible = visibleConstraintViolationIds(
      new Set(["a", "b", "c"]),
      new Set<string>(),
      MAX_LEAN_CONSTRAINT_VIOLATION_SKINS,
    );
    expect(visible.size).toBe(1);
  });

  it("keeps the placement sweep enabled — a zero cap short-circuits it", () => {
    // Guards the coupling documented at the constraintViolationIds guard in
    // PlacedFurniture.tsx: returning this to 0 silently disables the
    // placement sweep as well as the warning skins.
    expect(MAX_LEAN_CONSTRAINT_VIOLATION_SKINS).toBeGreaterThan(0);
  });
});
