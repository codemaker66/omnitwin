import { describe, it, expect, beforeEach } from "vitest";
import { useGuidelineStore } from "../../stores/guideline-store.js";
import {
  detectWallHit,
  computeGuideline,
  GUIDELINE_COLOR,
  GUIDELINE_Y,
} from "../../lib/guideline.js";
import type { Point3 } from "../../lib/measurement.js";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../constants/scale.js";
import { RENDER_SCALE } from "../../constants/scale.js";

// ---------------------------------------------------------------------------
// These tests verify TapeMeasure's integration with the guideline store and
// the wall detection + guideline computation used when the user clicks walls.
// The component itself is an R3F controller — we test the store interactions
// and pure function pipeline that the component drives.
// ---------------------------------------------------------------------------

const { width, length } = GRAND_HALL_RENDER_DIMENSIONS;
const halfWidth = width / 2;
const halfLength = length / 2;

beforeEach(() => {
  useGuidelineStore.setState({
    active: false,
    guidelines: [],
    nextId: 1,
  });
});

describe("TapeMeasure store integration", () => {
  it("T key toggle: store starts inactive, toggle activates", () => {
    expect(useGuidelineStore.getState().active).toBe(false);
    useGuidelineStore.getState().toggle();
    expect(useGuidelineStore.getState().active).toBe(true);
  });

  it("full flow: activate → click left wall → guideline placed", () => {
    useGuidelineStore.getState().activate();

    const hitPoint: Point3 = [-halfWidth, 3.5, 4];
    const wallHit = detectWallHit(hitPoint, "wall-left");
    expect(wallHit).not.toBeNull();
    if (wallHit === null) return;

    useGuidelineStore.getState().placeGuideline(wallHit);
    const guidelines = useGuidelineStore.getState().guidelines;
    expect(guidelines).toHaveLength(1);
    expect(guidelines[0]?.axis).toBe("x");
    expect(guidelines[0]?.fixedCoord).toBe(4); // Z where user clicked
  });

  it("full flow: activate → click back wall → guideline placed", () => {
    useGuidelineStore.getState().activate();

    const hitPoint: Point3 = [7, 2, -halfLength];
    const wallHit = detectWallHit(hitPoint, "wall-back");
    expect(wallHit).not.toBeNull();
    if (wallHit === null) return;

    useGuidelineStore.getState().placeGuideline(wallHit);
    const guidelines = useGuidelineStore.getState().guidelines;
    expect(guidelines).toHaveLength(1);
    expect(guidelines[0]?.axis).toBe("z");
    expect(guidelines[0]?.fixedCoord).toBe(7); // X where user clicked
  });

  it("clicking floor does not place a guideline", () => {
    useGuidelineStore.getState().activate();

    const hitPoint: Point3 = [5, 0, 3];
    const wallHit = detectWallHit(hitPoint, "floor");
    expect(wallHit).toBeNull();
  });

  it("Escape clears all guidelines", () => {
    useGuidelineStore.getState().activate();

    const hit1 = detectWallHit([-halfWidth, 3, 2], "wall-left");
    const hit2 = detectWallHit([5, 3, -halfLength], "wall-back");
    if (hit1) useGuidelineStore.getState().placeGuideline(hit1);
    if (hit2) useGuidelineStore.getState().placeGuideline(hit2);

    expect(useGuidelineStore.getState().guidelines).toHaveLength(2);
    useGuidelineStore.getState().clearAll();
    expect(useGuidelineStore.getState().guidelines).toHaveLength(0);
  });

  it("dismiss removes individual guideline", () => {
    useGuidelineStore.getState().activate();

    const hit1 = detectWallHit([-halfWidth, 3, 2], "wall-left");
    const hit2 = detectWallHit([5, 3, -halfLength], "wall-back");
    if (hit1) useGuidelineStore.getState().placeGuideline(hit1);
    if (hit2) useGuidelineStore.getState().placeGuideline(hit2);

    useGuidelineStore.getState().removeGuideline(1);
    const remaining = useGuidelineStore.getState().guidelines;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(2);
  });
});

describe("guideline geometry correctness", () => {
  it("X-axis guideline spans full room width", () => {
    const wallHit = detectWallHit([-halfWidth, 3, 5], "wall-left");
    expect(wallHit).not.toBeNull();
    if (wallHit === null) return;

    const g = computeGuideline(wallHit, 1);
    expect(g.start[0]).toBe(-halfWidth);
    expect(g.end[0]).toBe(halfWidth);
    expect(g.start[2]).toBe(5);
    expect(g.end[2]).toBe(5);
    expect(g.start[1]).toBe(GUIDELINE_Y);
  });

  it("Z-axis guideline spans full room length", () => {
    const wallHit = detectWallHit([3, 2, -halfLength], "wall-back");
    expect(wallHit).not.toBeNull();
    if (wallHit === null) return;

    const g = computeGuideline(wallHit, 1);
    expect(g.start[2]).toBe(-halfLength);
    expect(g.end[2]).toBe(halfLength);
    expect(g.start[0]).toBe(3);
    expect(g.end[0]).toBe(3);
  });

  it("guideline real distance accounts for RENDER_SCALE", () => {
    const wallHit = detectWallHit([-halfWidth, 3, 0], "wall-left");
    if (wallHit === null) return;
    const g = computeGuideline(wallHit, 1);
    // X-axis guideline: real distance = render width / RENDER_SCALE = 42 / 2 = 21
    expect(g.realDistance).toBeCloseTo(width / RENDER_SCALE);
  });

  it("dashed line colour matches constant", () => {
    expect(GUIDELINE_COLOR).toBe("#5080b0");
  });
});

describe("wainscoting click works same as wall", () => {
  it("wainscot-right produces same axis as wall-right", () => {
    const wallResult = detectWallHit([halfWidth, 3, 2], "wall-right");
    const wainscotResult = detectWallHit([halfWidth, 0.5, 2], "wainscot-right");
    expect(wallResult?.axis).toBe(wainscotResult?.axis);
    expect(wallResult?.wallCoord).toBe(wainscotResult?.wallCoord);
  });

  it("wainscot-back produces same axis as wall-back", () => {
    const wallResult = detectWallHit([4, 3, -halfLength], "wall-back");
    const wainscotResult = detectWallHit([4, 0.5, -halfLength], "wainscot-back");
    expect(wallResult?.axis).toBe(wainscotResult?.axis);
    expect(wallResult?.wallCoord).toBe(wainscotResult?.wallCoord);
  });
});
