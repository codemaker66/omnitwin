import { describe, expect, it } from "vitest";
import type { TwinScanNode } from "@omnitwin/types";
import { TRADES_HALL_ROOM_DIMENSIONS } from "../../../lib/trades-hall-venue-truth.js";
import {
  PLAN_MIN_EXTENT_M,
  chooseScaleBarM,
  fitPlanViewBox,
  formatPolygonPoints,
  formatViewBox,
  horizontalFovRad,
  minimumNodeSpacingM,
  nearestPlanNode,
  nearestPlanNodeInDirection,
  planPointFromClient,
  planPointToE57XY,
  planViewDirection,
  projectPlanPoint,
  toPlanNodes,
  viewConePolygon,
  type PlanPoint,
} from "../minimap-geometry.js";
import { yawToMinimapRotationDeg } from "../../TwinMinimap.js";

// -----------------------------------------------------------------------------
// minimap-geometry — the plan view's arithmetic, with no React anywhere near it.
//
// This module is the part of a plan view that can be silently, beautifully
// wrong: a squashed room still looks like a room, and a cone pointing 180° out
// still looks like a cone. So the tests here are written to catch exactly those
// two failures — an aspect ratio quietly normalised away, and a sign flip in the
// yaw chain (three YXZ yaw → E57 world → the house's (x, −y) plan projection).
//
// The sign-flip guard is deliberately doubled: the four cardinal yaws are pinned
// with strict inequalities (a flip changes the SIGN, which no float tolerance
// can hide), AND the direction is cross-checked against the SHIPPED convention
// in TwinMinimap.yawToMinimapRotationDeg. If the two ever disagree, one of them
// is wrong and this file says so before a guest sees a backwards cone.
// -----------------------------------------------------------------------------

/** Synthetic pose: E57 metres, Z-up, level tripod at the usual 1.5 m head. */
function node(id: string, x: number, y: number, floor = 0): TwinScanNode {
  return {
    id,
    index: Number(id.slice(-3)),
    pose: { q: [1, 0, 0, 0], t: [x, y, 1.5] },
    floor,
    roomSlug: null,
  };
}

/** Rotate a plan vector clockwise by `deg` on a y-down screen — the transform an
 *  SVG `rotate(deg)` applies. Used to re-derive the cone direction from
 *  TwinMinimap's shipped rotation, independently of planViewDirection. */
function rotateClockwise(point: PlanPoint, deg: number): PlanPoint {
  const rad = (deg * Math.PI) / 180;
  return {
    x: point.x * Math.cos(rad) - point.y * Math.sin(rad),
    y: point.x * Math.sin(rad) + point.y * Math.cos(rad),
  };
}

describe("projectPlanPoint / planPointToE57XY", () => {
  it("uses the house projection (t[0], −t[1]) and drops the height", () => {
    expect(projectPlanPoint([3, 4, 1.5])).toEqual({ x: 3, y: -4 });
    expect(projectPlanPoint([-2.5, -7, 5.6])).toEqual({ x: -2.5, y: 7 });
  });

  it("never emits negative zero, so no viewBox or polygon string carries one", () => {
    expect(Object.is(projectPlanPoint([1, 0, 1.5]).y, 0)).toBe(true);
    expect(Object.is(projectPlanPoint([0, 1, 1.5]).x, 0)).toBe(true);
  });

  it("round-trips plan coordinates back to the E57 x/y they came from", () => {
    for (const t of [
      [0, 0, 1.5],
      [12.25, -3.75, 1.5],
      [-8.5, 21, 5.6],
    ] as const) {
      const [x, y] = planPointToE57XY(projectPlanPoint(t));
      expect(x).toBe(t[0]);
      expect(y).toBe(t[1]);
    }
  });

  it("projects a node list while keeping ids attached", () => {
    const planNodes = toPlanNodes([node("scan_000", 0, 0), node("scan_001", 2.5, -1)]);
    expect(planNodes).toEqual([
      { id: "scan_000", point: { x: 0, y: 0 } },
      { id: "scan_001", point: { x: 2.5, y: 1 } },
    ]);
  });
});

describe("fitPlanViewBox", () => {
  /**
   * The footprint under test is a REAL room's, JOINED from the venue truth
   * rather than typed out here.
   *
   * Two reasons, and the second is the load-bearing one. House law: a CI-pinned
   * dimension is never restated, and a test fixture is not an exemption any more
   * than a comment is — a literal here would go stale silently the day the venue
   * republishes. And the failure this fixture exists to catch (an axis
   * normalised away, so an oblong room is drawn square) can only bite on a
   * footprint that is genuinely oblong, which is a property of the real room and
   * not of a number someone chose. Every expectation below is derived from the
   * same two figures, so the suite tracks the truth file rather than shadowing
   * it. See TRADES_HALL_ROOM_DIMENSIONS in lib/trades-hall-venue-truth.ts.
   */
  const grandHall = TRADES_HALL_ROOM_DIMENSIONS["grand-hall"];
  if (grandHall === undefined) {
    throw new Error(
      "TRADES_HALL_ROOM_DIMENSIONS lost its grand-hall entry; this suite joins it rather than restating it",
    );
  }
  const lengthM = grandHall.lengthM;
  const widthM = grandHall.widthM;
  const hall: readonly PlanPoint[] = [
    { x: 0, y: 0 },
    { x: lengthM, y: 0 },
    { x: lengthM, y: widthM },
    { x: 0, y: widthM },
  ];

  it("keeps a real, oblong room rectangular — it must never be drawn square", () => {
    const box = fitPlanViewBox(hall, { marginM: 1 });
    expect(box.width).toBe(lengthM + 2);
    expect(box.height).toBe(widthM + 2);
    expect(box.width / box.height).toBeCloseTo((lengthM + 2) / (widthM + 2), 12);
    // The failure this exists for: an independent per-axis normalisation, which
    // returns a square box and draws the hall as tall as it is long. The
    // fixture only has teeth while the room really is oblong, so that is
    // asserted rather than assumed.
    expect(lengthM).not.toBe(widthM);
    expect(box.width).not.toBe(box.height);
  });

  it("contains every point with exactly the stated margin on all four sides", () => {
    const box = fitPlanViewBox(hall, { marginM: 2 });
    expect(box.x).toBe(-2);
    expect(box.y).toBe(-2);
    expect(box.width).toBe(lengthM + 4);
    expect(box.height).toBe(widthM + 4);
    for (const point of hall) {
      expect(point.x).toBeGreaterThanOrEqual(box.x);
      expect(point.x).toBeLessThanOrEqual(box.x + box.width);
      expect(point.y).toBeGreaterThanOrEqual(box.y);
      expect(point.y).toBeLessThanOrEqual(box.y + box.height);
    }
  });

  it("gives a single node a real box centred on it, never a zero-area one", () => {
    const box = fitPlanViewBox([{ x: 5, y: -3 }], { marginM: 0 });
    expect(box.width).toBe(PLAN_MIN_EXTENT_M);
    expect(box.height).toBe(PLAN_MIN_EXTENT_M);
    expect(box.x + box.width / 2).toBeCloseTo(5, 12);
    expect(box.y + box.height / 2).toBeCloseTo(-3, 12);
  });

  it("gives a perfectly collinear run a non-zero extent on its flat axis", () => {
    // A corridor of scans down one wall: every y identical. Without a floor the
    // viewBox height is 0, and SVG disables rendering of the whole element.
    const corridor = [
      { x: 0, y: 4 },
      { x: 6, y: 4 },
      { x: 12, y: 4 },
    ];
    const box = fitPlanViewBox(corridor, { marginM: 0 });
    expect(box.width).toBe(12);
    expect(box.height).toBe(PLAN_MIN_EXTENT_M);
    expect(box.y + box.height / 2).toBeCloseTo(4, 12);
  });

  it("returns a finite, non-empty box for an empty node set", () => {
    const box = fitPlanViewBox([], { marginM: 2 });
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    expect(Number.isFinite(box.x)).toBe(true);
    expect(Number.isFinite(box.y)).toBe(true);
  });

  it("ignores a non-finite pose instead of poisoning the whole box", () => {
    // A pose is a unit: a NaN on one axis discards the whole point, so the
    // partner coordinate (y = 30 here) cannot stretch the box on its own.
    const box = fitPlanViewBox([{ x: 0, y: 0 }, { x: NaN, y: 30 }, { x: 10, y: 4 }], {
      marginM: 0,
    });
    expect(box.width).toBe(10);
    expect(box.height).toBe(4);
  });

  it("grows WIDTH when the host frame is wider than the footprint, and never crops", () => {
    // The fitted box is (length + 2) × (width + 2), which is wider than tall but
    // not 3:1. A 3:1 HUD strip is wider still, so the only way to reach it
    // without cropping is to add plan metres in x.
    const box = fitPlanViewBox(hall, { marginM: 1, aspect: 3 });
    expect(box.width / box.height).toBeCloseTo(3, 12);
    expect(box.height).toBe(widthM + 2);
    expect(box.width).toBe((widthM + 2) * 3);
    // Still centred on the same footprint, and still containing all of it.
    expect(box.x + box.width / 2).toBeCloseTo(lengthM / 2, 12);
    for (const point of hall) {
      expect(point.x).toBeGreaterThanOrEqual(box.x);
      expect(point.x).toBeLessThanOrEqual(box.x + box.width);
    }
  });

  it("grows HEIGHT when the footprint is wider than the host frame", () => {
    const box = fitPlanViewBox(hall, { marginM: 1, aspect: 3 / 2 });
    expect(box.width / box.height).toBeCloseTo(3 / 2, 12);
    expect(box.width).toBe(lengthM + 2);
    expect(box.height).toBeCloseTo((lengthM + 2) / 1.5, 12);
    expect(box.y + box.height / 2).toBeCloseTo(widthM / 2, 12);
    for (const point of hall) {
      expect(point.y).toBeGreaterThanOrEqual(box.y);
      expect(point.y).toBeLessThanOrEqual(box.y + box.height);
    }
  });

  it("formats a viewBox as SVG expects, without float noise", () => {
    expect(formatViewBox({ x: -2, y: -2, width: 25, height: 14 })).toBe("-2 -2 25 14");
    expect(formatViewBox({ x: 0.1 + 0.2, y: -0, width: 1, height: 1 })).toBe("0.3 0 1 1");
  });
});

describe("planViewDirection", () => {
  it("faces screen-up at yaw 0 — three −Z is E57 +Y is plan −y", () => {
    const direction = planViewDirection(0);
    expect(direction.x).toBeCloseTo(0, 12);
    expect(direction.y).toBe(-1);
  });

  it("turns LEFT on positive yaw, and would fail loudly on a sign flip", () => {
    // WalkControls: "grab-the-world: +yaw turns left". A flipped sign sends the
    // cone to +x here, which no tolerance can absorb — the sign is the test.
    const left = planViewDirection(Math.PI / 2);
    expect(left.x).toBeLessThan(-0.99);
    expect(left.y).toBeCloseTo(0, 12);

    const right = planViewDirection(-Math.PI / 2);
    expect(right.x).toBeGreaterThan(0.99);
    expect(right.y).toBeCloseTo(0, 12);

    const back = planViewDirection(Math.PI);
    expect(back.y).toBeGreaterThan(0.99);
    expect(back.x).toBeCloseTo(0, 12);
  });

  it("agrees with the SHIPPED minimap rotation for arbitrary yaws", () => {
    // TwinMinimap draws a canonical up-pointing wedge and rotates it by
    // yawToMinimapRotationDeg. Re-deriving the direction that way must land on
    // the same vector — two independent expressions of one convention.
    for (const yaw of [0, 0.3, 1.1, -0.7, Math.PI / 3, -2.4, 5.9]) {
      const viaRotation = rotateClockwise({ x: 0, y: -1 }, yawToMinimapRotationDeg(yaw));
      const direct = planViewDirection(yaw);
      expect(direct.x).toBeCloseTo(viaRotation.x, 12);
      expect(direct.y).toBeCloseTo(viaRotation.y, 12);
    }
  });

  it("is always a unit vector", () => {
    for (const yaw of [0, 0.9, -3.3, 12.7]) {
      const direction = planViewDirection(yaw);
      expect(Math.hypot(direction.x, direction.y)).toBeCloseTo(1, 12);
    }
  });
});

describe("viewConePolygon", () => {
  const origin: PlanPoint = { x: 4, y: -2 };

  it("starts at the apex — the point the visitor is standing on", () => {
    const cone = viewConePolygon({ origin, yaw: 0.4, fovRad: 1, radiusM: 3 });
    expect(cone[0]).toEqual(origin);
  });

  it("puts its arc midpoint exactly along the view direction", () => {
    const yaw = 0.85;
    const radiusM = 3;
    const cone = viewConePolygon({ origin, yaw, fovRad: 1.2, radiusM, segments: 12 });
    // 1 apex + 13 arc vertices; the arc's middle vertex is index 1 + 12/2.
    const middle = cone[7];
    const direction = planViewDirection(yaw);
    expect(middle?.x).toBeCloseTo(origin.x + direction.x * radiusM, 10);
    expect(middle?.y).toBeCloseTo(origin.y + direction.y * radiusM, 10);
  });

  it("points up, left, down and right for the four cardinal yaws", () => {
    const radiusM = 5;
    const cases: readonly (readonly [number, "up" | "left" | "down" | "right"])[] = [
      [0, "up"],
      [Math.PI / 2, "left"],
      [Math.PI, "down"],
      [-Math.PI / 2, "right"],
    ];
    for (const [yaw, expected] of cases) {
      const cone = viewConePolygon({ origin, yaw, fovRad: 0.6, radiusM, segments: 8 });
      const middle = cone[5];
      const dx = (middle?.x ?? 0) - origin.x;
      const dy = (middle?.y ?? 0) - origin.y;
      if (expected === "up") {
        expect(dy).toBeLessThan(-radiusM * 0.99);
      } else if (expected === "down") {
        expect(dy).toBeGreaterThan(radiusM * 0.99);
      } else if (expected === "left") {
        expect(dx).toBeLessThan(-radiusM * 0.99);
      } else {
        expect(dx).toBeGreaterThan(radiusM * 0.99);
      }
    }
  });

  it("spans exactly the horizontal fov it was given", () => {
    const fovRad = 1.15;
    const cone = viewConePolygon({ origin, yaw: 0.3, fovRad, radiusM: 4, segments: 10 });
    const first = cone[1];
    const last = cone[cone.length - 1];
    const a = Math.atan2((first?.y ?? 0) - origin.y, (first?.x ?? 0) - origin.x);
    const b = Math.atan2((last?.y ?? 0) - origin.y, (last?.x ?? 0) - origin.x);
    let span = Math.abs(b - a);
    if (span > Math.PI) {
      span = 2 * Math.PI - span;
    }
    expect(span).toBeCloseTo(fovRad, 10);
  });

  it("keeps every arc vertex on the radius — the cone is a wedge, not a triangle", () => {
    const radiusM = 2.75;
    const cone = viewConePolygon({ origin, yaw: -1.2, fovRad: 1.4, radiusM, segments: 14 });
    for (const point of cone.slice(1)) {
      expect(Math.hypot(point.x - origin.x, point.y - origin.y)).toBeCloseTo(radiusM, 10);
    }
  });

  it("rounds an odd or degenerate segment count up to an even one", () => {
    // The arc midpoint must be a real vertex, or the direction cannot be pinned.
    expect(
      viewConePolygon({ origin, yaw: 0, fovRad: 1, radiusM: 1, segments: 7 }),
    ).toHaveLength(1 + 8 + 1);
    expect(
      viewConePolygon({ origin, yaw: 0, fovRad: 1, radiusM: 1, segments: 0 }),
    ).toHaveLength(1 + 2 + 1);
  });

  it("renders no cone at all for a non-positive radius or fov", () => {
    expect(viewConePolygon({ origin, yaw: 0, fovRad: 0, radiusM: 3 })).toEqual([]);
    expect(viewConePolygon({ origin, yaw: 0, fovRad: 1, radiusM: 0 })).toEqual([]);
  });

  it("formats polygon points for SVG without float noise", () => {
    expect(
      formatPolygonPoints([
        { x: 0, y: 0 },
        { x: 1 / 3, y: -2 },
      ]),
    ).toBe("0,0 0.3333,-2");
  });
});

describe("horizontalFovRad", () => {
  it("equals the vertical fov on a square viewport", () => {
    expect(horizontalFovRad(60, 1)).toBeCloseTo((60 * Math.PI) / 180, 12);
  });

  it("widens with the viewport, matching three's own perspective maths", () => {
    // h = 2·atan(tan(v/2)·aspect) — the identity PerspectiveCamera applies.
    const vertical = (55 * Math.PI) / 180;
    const aspect = 16 / 9;
    expect(horizontalFovRad(55, aspect)).toBeCloseTo(
      2 * Math.atan(Math.tan(vertical / 2) * aspect),
      12,
    );
    expect(horizontalFovRad(55, aspect)).toBeGreaterThan(vertical);
  });

  it("falls back to the vertical fov for a nonsense aspect", () => {
    expect(horizontalFovRad(60, 0)).toBeCloseTo((60 * Math.PI) / 180, 12);
    expect(horizontalFovRad(60, Number.NaN)).toBeCloseTo((60 * Math.PI) / 180, 12);
  });
});

describe("nearestPlanNode", () => {
  const planNodes = toPlanNodes([
    node("scan_000", 0, 0),
    node("scan_001", 4, 0),
    node("scan_002", 0, 4),
  ]);

  it("finds the closest viewpoint to a plan coordinate", () => {
    const hit = nearestPlanNode(planNodes, { x: 3.6, y: 0.2 });
    expect(hit?.id).toBe("scan_001");
    expect(hit?.distanceM).toBeCloseTo(Math.hypot(0.4, 0.2), 12);
  });

  it("returns null when there is nothing to travel to", () => {
    expect(nearestPlanNode([], { x: 0, y: 0 })).toBeNull();
  });

  it("refuses a hit beyond the stated tolerance rather than teleporting wildly", () => {
    expect(nearestPlanNode(planNodes, { x: 40, y: 40 }, { maxDistanceM: 2 })).toBeNull();
    expect(nearestPlanNode(planNodes, { x: 40, y: 40 })?.id).toBe("scan_001");
  });

  it("breaks an exact tie on document order, so a click is never nondeterministic", () => {
    const tied = toPlanNodes([node("scan_000", -1, 0), node("scan_001", 1, 0)]);
    expect(nearestPlanNode(tied, { x: 0, y: 0 })?.id).toBe("scan_000");
  });
});

describe("minimumNodeSpacingM", () => {
  it("finds the closest pair, not the closest pair in list order", () => {
    // The tight pair is last and out of order on both axes, so a scan that only
    // compared neighbours in the list would report 5 rather than 0.75.
    const planNodes = toPlanNodes([
      node("scan_000", 0, 0),
      node("scan_001", 5, 0),
      node("scan_002", 0, 5),
      node("scan_003", 0.75, 5),
    ]);
    expect(minimumNodeSpacingM(planNodes)).toBeCloseTo(0.75, 12);
  });

  it("returns Infinity when there is no pair to measure", () => {
    // A lone mark cannot overlap anything, so the caller's own radius is the
    // only constraint — an Infinity here is what leaves it unclamped.
    expect(minimumNodeSpacingM([])).toBe(Infinity);
    expect(minimumNodeSpacingM(toPlanNodes([node("scan_000", 0, 0)]))).toBe(Infinity);
  });

  it("ignores coincident poses rather than collapsing the spacing to zero", () => {
    // Two scans registered to one tripod position are real (a re-shoot). Taken
    // literally they would force a zero-radius hit disc, i.e. marks with no
    // pointer target at all — a worse failure than the overlap being avoided.
    const planNodes = toPlanNodes([
      node("scan_000", 2, 2),
      node("scan_001", 2, 2),
      node("scan_002", 2, 3.5),
    ]);
    expect(minimumNodeSpacingM(planNodes)).toBeCloseTo(1.5, 12);
  });

  it("survives a non-finite pose without poisoning the answer", () => {
    const planNodes = toPlanNodes([
      node("scan_000", 0, 0),
      node("scan_001", Number.NaN, 4),
      node("scan_002", 3, 0),
    ]);
    expect(minimumNodeSpacingM(planNodes)).toBeCloseTo(3, 12);
  });

  it("measures a regular grid as its pitch, which is the case that ships", () => {
    // 149 nodes on a 1.5 m grid — the shipped bundle's shape. The clamp that
    // keeps hit discs disjoint is only correct if this is the pitch, not the
    // diagonal (≈2.12) and not the extent.
    const grid = toPlanNodes(
      Array.from({ length: 149 }, (_, index) =>
        node(
          `scan_${String(index).padStart(3, "0")}`,
          (index % 13) * 1.5,
          Math.floor(index / 13) * 1.5,
        ),
      ),
    );
    expect(minimumNodeSpacingM(grid)).toBeCloseTo(1.5, 12);
  });
});

describe("nearestPlanNodeInDirection", () => {
  // Plan coords, not E57: a node at E57 y = +4 sits at plan y = −4, i.e. UP.
  const planNodes = toPlanNodes([
    node("scan_000", 0, 0),
    node("scan_001", 4, 0),
    node("scan_002", 0, 4),
    node("scan_003", -6, 0),
  ]);

  it("moves to the nearest viewpoint in the screen direction asked for", () => {
    expect(nearestPlanNodeInDirection(planNodes, "scan_000", { x: 1, y: 0 })?.id).toBe(
      "scan_001",
    );
    expect(nearestPlanNodeInDirection(planNodes, "scan_000", { x: -1, y: 0 })?.id).toBe(
      "scan_003",
    );
    expect(nearestPlanNodeInDirection(planNodes, "scan_000", { x: 0, y: -1 })?.id).toBe(
      "scan_002",
    );
  });

  it("returns null when nothing lies that way, rather than wrapping around", () => {
    expect(nearestPlanNodeInDirection(planNodes, "scan_000", { x: 0, y: 1 })).toBeNull();
  });

  it("returns null for an origin the list does not contain", () => {
    expect(nearestPlanNodeInDirection(planNodes, "scan_404", { x: 1, y: 0 })).toBeNull();
  });
});

describe("planPointFromClient", () => {
  const box = { x: 0, y: 0, width: 20, height: 10 };

  it("maps the centre of the element to the centre of the plan", () => {
    const point = planPointFromClient(
      { left: 100, top: 50, width: 400, height: 200 },
      box,
      300,
      150,
    );
    expect(point?.x).toBeCloseTo(10, 12);
    expect(point?.y).toBeCloseTo(5, 12);
  });

  it("keeps the metre scale identical on both axes when letterboxed", () => {
    // A 400 × 400 element showing a 20 × 10 box: "meet" scales by 20 px/m and
    // centres the drawing vertically, leaving 100 px of letterbox top and bottom.
    const rect = { left: 0, top: 0, width: 400, height: 400 };
    const a = planPointFromClient(rect, box, 0, 100);
    const b = planPointFromClient(rect, box, 400, 300);
    expect(a?.x).toBeCloseTo(0, 12);
    expect(a?.y).toBeCloseTo(0, 12);
    expect(b?.x).toBeCloseTo(20, 12);
    expect(b?.y).toBeCloseTo(10, 12);

    // 100 px right and 100 px down must both be 5 m — the uniform-scale claim.
    const across = planPointFromClient(rect, box, 100, 100);
    const down = planPointFromClient(rect, box, 0, 200);
    expect((across?.x ?? 0) - (a?.x ?? 0)).toBeCloseTo(5, 12);
    expect((down?.y ?? 0) - (a?.y ?? 0)).toBeCloseTo(5, 12);
  });

  it("returns null for an unmeasured element instead of NaN coordinates", () => {
    // happy-dom (and a display:none element in a browser) reports a zero rect.
    expect(planPointFromClient({ left: 0, top: 0, width: 0, height: 0 }, box, 5, 5)).toBeNull();
    expect(
      planPointFromClient(
        { left: 0, top: 0, width: 100, height: 100 },
        { x: 0, y: 0, width: 0, height: 0 },
        5,
        5,
      ),
    ).toBeNull();
  });
});

describe("chooseScaleBarM", () => {
  it("picks a round ladder value that fits inside the target span", () => {
    expect(chooseScaleBarM(25)).toBe(20);
    expect(chooseScaleBarM(60)).toBe(50);
    expect(chooseScaleBarM(140)).toBe(100);
  });

  it("never returns zero, and never exceeds the span it was given", () => {
    for (const span of [0.4, 1, 3, 7.5, 23, 400]) {
      const bar = chooseScaleBarM(span);
      expect(bar).toBeGreaterThan(0);
      expect(bar).toBeLessThanOrEqual(span);
    }
  });

  it("survives a degenerate span without returning a non-finite bar", () => {
    expect(Number.isFinite(chooseScaleBarM(0))).toBe(true);
    expect(chooseScaleBarM(0)).toBeGreaterThan(0);
  });
});
