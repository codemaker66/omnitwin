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
  LEAN_PLANNER_FURNITURE_MIN_VIEWPORT_WIDTH,
  MAX_LEAN_CONSTRAINT_VIOLATION_SKINS,
  leanSweepCandidates,
  placementViolationIds,
  shouldRenderIndividualFurnitureModel,
  shouldUseLeanPlannerFurniture,
  visibleConstraintViolationIds,
} from "../PlacedFurniture.js";
import { CATALOGUE_ITEMS } from "../../lib/catalogue.js";
import { createPlacedItem, type PlacedItem } from "../../lib/placement.js";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";

function catalogueIdAt(index: number): string {
  const item = CATALOGUE_ITEMS[index];
  if (item === undefined) throw new Error(`missing catalogue fixture at ${String(index)}`);
  return item.id;
}

describe("shouldUseLeanPlannerFurniture", () => {
  it("engages the lean path strictly below the viewport threshold", () => {
    expect(shouldUseLeanPlannerFurniture(LEAN_PLANNER_FURNITURE_MIN_VIEWPORT_WIDTH - 1)).toBe(true);
    expect(shouldUseLeanPlannerFurniture(LEAN_PLANNER_FURNITURE_MIN_VIEWPORT_WIDTH)).toBe(false);
    expect(shouldUseLeanPlannerFurniture(LEAN_PLANNER_FURNITURE_MIN_VIEWPORT_WIDTH + 1)).toBe(false);
  });

  it("drops even a wide desktop canvas to the lean path while the camera moves", () => {
    expect(shouldUseLeanPlannerFurniture(2560, true)).toBe(true);
  });

  it("treats camera interaction as inactive when the caller omits it", () => {
    expect(shouldUseLeanPlannerFurniture(2560)).toBe(false);
  });

  it("keeps a zero-width canvas on the lean path rather than the full one", () => {
    expect(shouldUseLeanPlannerFurniture(0)).toBe(true);
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
  // [leanRendering, inspected, instanced, instancingFailed] -> renders own model.
  // Hand-written expectations on purpose: deriving them from the predicate's own
  // formula would make this table incapable of catching an inverted condition.
  const CASES: ReadonlyArray<readonly [boolean, boolean, boolean, boolean, boolean]> = [
    [false, false, false, false, true],
    [false, false, false, true, true],
    [false, false, true, false, false],
    [false, false, true, true, true],
    [false, true, false, false, true],
    [false, true, false, true, true],
    [false, true, true, false, true],
    [false, true, true, true, true],
    [true, false, false, false, false],
    [true, false, false, true, false],
    [true, false, true, false, false],
    [true, false, true, true, false],
    [true, true, false, false, true],
    [true, true, false, true, true],
    [true, true, true, false, true],
    [true, true, true, true, true],
  ];

  it.each(CASES)(
    "lean=%s inspected=%s instanced=%s failed=%s renders=%s",
    (leanRendering, inspected, instanced, instancingFailed, expected) => {
      expect(shouldRenderIndividualFurnitureModel({
        leanRendering,
        inspected,
        instanced,
        instancingFailed,
      })).toBe(expected);
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
    // PlacedFurniture.tsx: returning this to 0 silently disables the O(n²)
    // placement sweep as well as the warning skins.
    expect(MAX_LEAN_CONSTRAINT_VIOLATION_SKINS).toBeGreaterThan(0);
  });
});
