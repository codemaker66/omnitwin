import { describe, it, expect, beforeEach } from "vitest";
import {
  computeSnapGuides,
  deduplicateGuides,
  SNAP_GUIDE_THRESHOLD,
  SNAP_GUIDE_COLOR,
  SNAP_GUIDE_Y,
  SNAP_GUIDE_DASH,
  SNAP_GUIDE_GAP,
} from "../snap-guide.js";
import type { SnapGuide } from "../snap-guide.js";
import { createPlacedItem, resetPlacedIdCounter } from "../placement.js";

beforeEach(() => {
  resetPlacedIdCounter();
});

const tableId = "round-table-6ft";
const chairId = "banquet-chair";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("snap guide constants", () => {
  it("threshold is positive", () => {
    expect(SNAP_GUIDE_THRESHOLD).toBeGreaterThan(0);
  });

  it("color is orange", () => {
    expect(SNAP_GUIDE_COLOR).toBe("#ff8800");
  });

  it("Y is above guideline Y (0.005)", () => {
    expect(SNAP_GUIDE_Y).toBeGreaterThan(0.005);
  });

  it("dash and gap are positive", () => {
    expect(SNAP_GUIDE_DASH).toBeGreaterThan(0);
    expect(SNAP_GUIDE_GAP).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// computeSnapGuides — center alignment
// ---------------------------------------------------------------------------

describe("computeSnapGuides center alignment", () => {
  it("returns empty array when no placed items", () => {
    const guides = computeSnapGuides(0, 0, tableId, 0, [], new Set());
    expect(guides).toHaveLength(0);
  });

  it("detects center-X alignment (same X, different Z)", () => {
    const placed = [createPlacedItem(chairId, 0, 6, 0)];
    const guides = computeSnapGuides(0, 0, tableId, 0, placed, new Set());
    const xGuide = guides.find((g) => g.axis === "z" && g.kind === "center");
    expect(xGuide).toBeDefined();
    expect(xGuide?.coord).toBe(0);
  });

  it("detects center-Z alignment (same Z, different X)", () => {
    const placed = [createPlacedItem(chairId, 8, 0, 0)];
    const guides = computeSnapGuides(0, 0, tableId, 0, placed, new Set());
    const zGuide = guides.find((g) => g.axis === "x" && g.kind === "center");
    expect(zGuide).toBeDefined();
    expect(zGuide?.coord).toBe(0);
  });

  it("no guide when items are far apart on both axes", () => {
    const placed = [createPlacedItem(chairId, 10, 10, 0)];
    const guides = computeSnapGuides(0, 0, tableId, 0, placed, new Set());
    const centerGuides = guides.filter((g) => g.kind === "center");
    expect(centerGuides).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computeSnapGuides — edge alignment
// ---------------------------------------------------------------------------

describe("computeSnapGuides edge alignment", () => {
  it("detects right-left edge alignment", () => {
    // Place two items so the right edge of the dragged item aligns with the
    // left edge of the placed item. Round table is 1.83m = 3.66 render,
    // half = 1.83. Chair is 0.45m = 0.9 render, half = 0.45.
    // dragX = 0, drag right edge = 1.83.
    // Placed chair at x = 1.83 + 0.45 = 2.28 → chair left edge = 2.28 - 0.45 = 1.83.
    const placed = [createPlacedItem(chairId, 2.28, 0, 0)];
    const guides = computeSnapGuides(0, 0, tableId, 0, placed, new Set());
    const edgeGuides = guides.filter((g) => g.kind === "edge" && g.axis === "z");
    expect(edgeGuides.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// computeSnapGuides — threshold boundary
// ---------------------------------------------------------------------------

describe("computeSnapGuides threshold", () => {
  it("triggers at just under threshold", () => {
    const offset = SNAP_GUIDE_THRESHOLD * 0.9;
    const placed = [createPlacedItem(chairId, offset, 6, 0)];
    const guides = computeSnapGuides(0, 0, tableId, 0, placed, new Set());
    const centerX = guides.find((g) => g.axis === "z" && g.kind === "center");
    expect(centerX).toBeDefined();
  });

  it("does NOT trigger at just over threshold", () => {
    const offset = SNAP_GUIDE_THRESHOLD * 1.5;
    const placed = [createPlacedItem(chairId, offset, 6, 0)];
    const guides = computeSnapGuides(0, 0, tableId, 0, placed, new Set());
    const centerX = guides.find((g) => g.axis === "z" && g.kind === "center");
    expect(centerX).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// computeSnapGuides — exclude IDs
// ---------------------------------------------------------------------------

describe("computeSnapGuides excludeIds", () => {
  it("excludes items in the exclude set", () => {
    const item = createPlacedItem(chairId, 0, 6, 0);
    const guides = computeSnapGuides(0, 0, tableId, 0, [item], new Set([item.id]));
    expect(guides).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computeSnapGuides — unknown catalogue item
// ---------------------------------------------------------------------------

describe("computeSnapGuides unknown items", () => {
  it("returns empty for unknown drag item", () => {
    const placed = [createPlacedItem(chairId, 0, 6, 0)];
    const guides = computeSnapGuides(0, 0, "nonexistent", 0, placed, new Set());
    expect(guides).toHaveLength(0);
  });

  it("skips placed items with unknown catalogueItemId", () => {
    const item = createPlacedItem("nonexistent", 0, 6, 0);
    const guides = computeSnapGuides(0, 0, tableId, 0, [item], new Set());
    expect(guides).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// deduplicateGuides
// ---------------------------------------------------------------------------

describe("deduplicateGuides", () => {
  it("returns empty for empty input", () => {
    expect(deduplicateGuides([])).toHaveLength(0);
  });

  it("returns single guide unchanged", () => {
    const input: SnapGuide[] = [{ axis: "x", kind: "center", coord: 5, start: 0, end: 10 }];
    const result = deduplicateGuides(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(input[0]);
  });

  it("merges guides at the same coord and axis", () => {
    const input: SnapGuide[] = [
      { axis: "z", kind: "edge", coord: 3, start: 0, end: 5 },
      { axis: "z", kind: "edge", coord: 3, start: 3, end: 8 },
    ];
    const result = deduplicateGuides(input);
    expect(result).toHaveLength(1);
    expect(result[0]?.start).toBe(0);
    expect(result[0]?.end).toBe(8);
  });

  it("does NOT merge guides on different axes", () => {
    const input: SnapGuide[] = [
      { axis: "x", kind: "center", coord: 3, start: 0, end: 5 },
      { axis: "z", kind: "center", coord: 3, start: 0, end: 5 },
    ];
    const result = deduplicateGuides(input);
    expect(result).toHaveLength(2);
  });

  it("does NOT merge guides at different coords", () => {
    const input: SnapGuide[] = [
      { axis: "x", kind: "edge", coord: 1, start: 0, end: 5 },
      { axis: "x", kind: "edge", coord: 5, start: 0, end: 5 },
    ];
    const result = deduplicateGuides(input);
    expect(result).toHaveLength(2);
  });

  it("promotes kind to center if any merged guide is center", () => {
    const input: SnapGuide[] = [
      { axis: "z", kind: "edge", coord: 3, start: 0, end: 5 },
      { axis: "z", kind: "center", coord: 3, start: 2, end: 7 },
    ];
    const result = deduplicateGuides(input);
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("center");
  });
});

// ---------------------------------------------------------------------------
// computeSnapGuides — guide line extent
// ---------------------------------------------------------------------------

describe("computeSnapGuides line extent", () => {
  it("guide line extends between the two items with margin", () => {
    // Table at x=0, chair at x=0 z=10 → center-X guide runs along Z
    const placed = [createPlacedItem(chairId, 0, 10, 0)];
    const guides = computeSnapGuides(0, 0, tableId, 0, placed, new Set());
    const centerGuide = guides.find((g) => g.axis === "z" && g.kind === "center");
    expect(centerGuide).toBeDefined();
    // start should be below 0 (drag Z) and end above 10 (placed Z)
    expect(centerGuide!.start).toBeLessThan(0);
    expect(centerGuide!.end).toBeGreaterThan(10);
  });
});
