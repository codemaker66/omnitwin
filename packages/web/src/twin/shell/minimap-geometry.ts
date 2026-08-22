import type { TwinScanNode } from "@omnitwin/types";

// -----------------------------------------------------------------------------
// minimap-geometry — the plan view's arithmetic, with no React in it.
//
// The design study shipped a plan made of hand-scattered dots stamped
// "SCHEMATIC", because the dots were drawn rather than measured. Every node in
// the manifest already carries a surveyed pose (`node.pose.t`, E57 world, Z-up,
// metres), so the drawing can simply BE the survey. This module is the part
// that turns those poses into a drawing, kept pure so the claim "this is where
// the scanner stood" is provable by a test rather than by looking at it.
//
// THE PROJECTION is the house convention, not a new one: (t[0], −t[1]).
// TwinMinimap has drawn its dots at (t.x, −t.y) since Phase 1, so plan-space x
// is E57 x and plan-space y grows DOWN the screen while E57 y grows north. Two
// modules disagreeing on that would put the same hall on screen two ways.
//
// THE YAW CHAIN is where a plan view goes silently wrong, so it is written out
// once, here, and pinned by tests at the four cardinal yaws:
//
//   `yaw` is the three.js YXZ Euler y the walk's camera carries (WalkControls
//   sets `frameEuler.set(pitch, yaw, 0, "YXZ")`). At yaw 0 the camera looks
//   down three −Z. Rotating (0, 0, −1) about three +Y by yaw gives a forward of
//   (−sin yaw, 0, −cos yaw). twin-basis' `threeDirToE57` maps a three direction
//   [x, y, z] to E57 [x, −z, y], so the E57 heading is (−sin yaw, cos yaw).
//   Projecting that with (x, −y) lands on plan (−sin yaw, −cos yaw).
//
//   Read it back: yaw 0 → (0, −1), straight up the screen, which is E57 +Y —
//   north, the direction TWIN_MINIMAP_NORTH anchors. Positive yaw → −x, i.e.
//   screen LEFT, which is what WalkControls means by "grab-the-world: +yaw
//   turns left". Flip one sign anywhere in that chain and the cone points out
//   of the room the visitor is looking into, while still looking like a cone.
//
// ASPECT RATIO is the other silent failure. The returned viewBox is in PLAN
// METRES on both axes — one unit of x and one unit of y are the same distance —
// so the drawing cannot squash. The tempting alternative (normalise each axis
// into 0…1) draws a long oblong room as a square, which is not a plan of
// anything. How oblong the rooms this ships against actually are is not restated
// here, in prose or otherwise: the figures live in TRADES_HALL_ROOM_DIMENSIONS
// (lib/trades-hall-venue-truth.ts) and this module's tests join them from there.
// Where a host wants the box to fill a known frame exactly, pass
// `aspect`: the box GROWS on its deficient axis about the same centre. It never
// shrinks, so a fitted node is never cropped out of the drawing it belongs to.
// -----------------------------------------------------------------------------

/** A point on the plan, in metres. +x is E57 +x; +y runs DOWN the screen. */
export interface PlanPoint {
  readonly x: number;
  readonly y: number;
}

/** An SVG viewBox in plan metres — the same units on both axes, always. */
export interface PlanViewBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A viewpoint reduced to the two numbers a plan needs, id still attached. */
export interface PlanNode {
  readonly id: string;
  readonly point: PlanPoint;
}

/** Just enough of a DOMRect to map a pointer into plan space, so the maths can
 *  be unit-tested without a layout engine (happy-dom measures nothing). */
export interface PlanClientRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The smallest extent a fitted axis may have, in metres.
 *
 * Not cosmetic. A capture can legitimately produce a set with zero extent on an
 * axis — a single viewpoint, or a corridor of scans down one wall at identical
 * E57 y — and SVG treats a viewBox with a zero width or height as a signal to
 * disable rendering of the element ENTIRELY. The plan would vanish, not merely
 * look thin, and nothing in the console would say why.
 */
export const PLAN_MIN_EXTENT_M = 1;

/** Cone tessellation when the caller states none — smooth at a ~5 m radius. */
const DEFAULT_CONE_SEGMENTS = 12;

/** Coordinates are rounded to 0.1 mm before they reach an attribute string:
 *  full float64 spelling adds ~15 characters per number across ~600 numbers
 *  for no visible difference at any plan scale. */
const COORD_DECIMALS = 4;

/** Round-number ladder for the scale bar, in metres. Sub-metre rungs exist
 *  because a single-room plan can span less than a metre of node spread. */
const SCALE_BAR_LADDER: readonly number[] = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000,
];

/** Normalise −0 to 0. Negative zero survives arithmetic, compares unequal to 0
 *  under Object.is, and reads as "-0" to anyone debugging a coordinate. */
function zeroed(value: number): number {
  return value === 0 ? 0 : value;
}

function round(value: number): number {
  const factor = 10 ** COORD_DECIMALS;
  return zeroed(Math.round(value * factor) / factor);
}

/**
 * E57 world translation (Z-up, metres) → plan coordinates.
 *
 * The height is dropped, deliberately and without a floor-drop correction: a
 * plan is an overhead read, and which storey it belongs to is `node.floor`'s
 * job. Callers must filter by storey before fitting — see ViewpointPlan.
 */
export function projectPlanPoint(t: readonly [number, number, number]): PlanPoint {
  return { x: zeroed(t[0]), y: zeroed(-t[1]) };
}

/** Plan coordinates → the E57 world x/y they came from. The exact inverse of
 *  `projectPlanPoint`; the E57 z it dropped is not recoverable and is not
 *  claimed to be. */
export function planPointToE57XY(point: PlanPoint): readonly [number, number] {
  return [zeroed(point.x), zeroed(-point.y)];
}

/** Project a manifest node list, keeping ids attached so a hit can be named. */
export function toPlanNodes(nodes: readonly TwinScanNode[]): readonly PlanNode[] {
  return nodes.map((node) => ({ id: node.id, point: projectPlanPoint(node.pose.t) }));
}

export interface FitPlanOptions {
  /** Breathing room around the extremal nodes, in metres. */
  readonly marginM: number;
  /**
   * Optional target width/height. The box grows on whichever axis falls short,
   * about the same centre — so a host that sizes its frame to this ratio needs
   * no letterboxing and the metre scale stays identical on both axes.
   */
  readonly aspect?: number;
}

/** Grow (never shrink) a box until width/height equals `aspect`. */
function expandToAspect(box: PlanViewBox, aspect: number | undefined): PlanViewBox {
  if (aspect === undefined || !Number.isFinite(aspect) || aspect <= 0) {
    return box;
  }
  const current = box.width / box.height;
  if (current < aspect) {
    const width = box.height * aspect;
    return { x: box.x - (width - box.width) / 2, y: box.y, width, height: box.height };
  }
  if (current > aspect) {
    const height = box.width / aspect;
    return { x: box.x, y: box.y - (height - box.height) / 2, width: box.width, height };
  }
  return box;
}

/**
 * Fit a viewBox around a set of plan points, in metres, aspect intact.
 *
 * Points carrying a non-finite coordinate are discarded whole: a pose is one
 * unit, so a NaN x must not let its partner y stretch the box on its own. An
 * empty set (or one where every point was discarded) yields a small finite box
 * at the origin rather than a NaN-spelled viewBox, which browsers ignore
 * silently.
 */
export function fitPlanViewBox(
  points: readonly PlanPoint[],
  options: FitPlanOptions,
): PlanViewBox {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  if (!Number.isFinite(minX)) {
    return expandToAspect(
      {
        x: -PLAN_MIN_EXTENT_M / 2,
        y: -PLAN_MIN_EXTENT_M / 2,
        width: PLAN_MIN_EXTENT_M,
        height: PLAN_MIN_EXTENT_M,
      },
      options.aspect,
    );
  }

  const margin = Number.isFinite(options.marginM) ? Math.max(options.marginM, 0) : 0;
  let x = minX - margin;
  let y = minY - margin;
  let width = maxX - minX + margin * 2;
  let height = maxY - minY + margin * 2;

  if (width < PLAN_MIN_EXTENT_M) {
    x -= (PLAN_MIN_EXTENT_M - width) / 2;
    width = PLAN_MIN_EXTENT_M;
  }
  if (height < PLAN_MIN_EXTENT_M) {
    y -= (PLAN_MIN_EXTENT_M - height) / 2;
    height = PLAN_MIN_EXTENT_M;
  }

  return expandToAspect({ x, y, width, height }, options.aspect);
}

/** The viewBox as SVG spells it. */
export function formatViewBox(box: PlanViewBox): string {
  return [round(box.x), round(box.y), round(box.width), round(box.height)]
    .map((value) => String(value))
    .join(" ");
}

/**
 * The unit plan-space direction the camera faces at `yaw` (three YXZ radians).
 *
 * See the yaw chain in this file's header for the derivation. Summarised:
 * three −Z at yaw 0 is E57 +Y is plan −y, and positive yaw turns left, so the
 * answer is (−sin yaw, −cos yaw).
 */
export function planViewDirection(yaw: number): PlanPoint {
  return { x: zeroed(-Math.sin(yaw)), y: zeroed(-Math.cos(yaw)) };
}

/**
 * Horizontal field of view (radians) from three's VERTICAL `camera.fov`
 * (degrees) and the viewport aspect — the identity PerspectiveCamera itself
 * applies, h = 2·atan(tan(v/2)·aspect).
 *
 * Exported so the host never hand-rolls it. Passing the vertical fov straight
 * into the cone draws a wedge narrower than what the visitor can actually see,
 * which reads as "the plan disagrees with the view" rather than as a bug.
 */
export function horizontalFovRad(verticalFovDeg: number, aspect: number): number {
  const vertical = (verticalFovDeg * Math.PI) / 180;
  if (!Number.isFinite(aspect) || aspect <= 0) {
    return vertical;
  }
  return 2 * Math.atan(Math.tan(vertical / 2) * aspect);
}

export interface ViewConeOptions {
  /** Where the visitor is standing, in plan metres. */
  readonly origin: PlanPoint;
  /** Camera yaw, three-space YXZ radians. */
  readonly yaw: number;
  /** HORIZONTAL field of view in radians — see `horizontalFovRad`. */
  readonly fovRad: number;
  /** How far the wedge reaches, in plan metres. */
  readonly radiusM: number;
  /** Arc tessellation. Forced to an even number ≥ 2 (see below). */
  readonly segments?: number;
}

/**
 * The view cone as a polygon: apex first, then the arc from the left edge round
 * to the right edge.
 *
 * The segment count is forced EVEN so the arc's middle vertex lies exactly on
 * the view direction. That is not tidiness — it is what makes the direction
 * testable: with an odd count there is no vertex on the axis to assert against,
 * and a sign flip could only be caught by eye.
 *
 * A non-positive fov or radius returns no polygon at all, so a caller that has
 * not yet been handed a camera draws nothing rather than a degenerate spike.
 */
export function viewConePolygon(options: ViewConeOptions): readonly PlanPoint[] {
  const { origin, yaw, fovRad, radiusM } = options;
  if (!(fovRad > 0) || !(radiusM > 0) || !Number.isFinite(yaw)) {
    return [];
  }

  const requested = options.segments ?? DEFAULT_CONE_SEGMENTS;
  const bounded = Number.isFinite(requested) ? Math.max(Math.ceil(requested), 2) : 2;
  const segments = bounded % 2 === 0 ? bounded : bounded + 1;

  const direction = planViewDirection(yaw);
  const half = fovRad / 2;
  const points: PlanPoint[] = [origin];
  for (let i = 0; i <= segments; i += 1) {
    // Rotating the direction VECTOR (rather than taking atan2 of it and adding)
    // keeps the midpoint exactly on the axis: at i = segments/2 the angle is
    // zero and the rotation is the identity.
    const angle = -half + (fovRad * i) / segments;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = direction.x * cos - direction.y * sin;
    const dy = direction.x * sin + direction.y * cos;
    points.push({ x: origin.x + dx * radiusM, y: origin.y + dy * radiusM });
  }
  return points;
}

/** Points as SVG's `points` attribute spells them. */
export function formatPolygonPoints(points: readonly PlanPoint[]): string {
  return points
    .map((point) => `${String(round(point.x))},${String(round(point.y))}`)
    .join(" ");
}

export interface PlanHit {
  readonly id: string;
  readonly distanceM: number;
}

export interface NearestPlanNodeOptions {
  /** Beyond this, no hit is reported at all (metres). */
  readonly maxDistanceM?: number;
}

/**
 * The viewpoint nearest a plan coordinate — the inverse of the drawing, used
 * for click-to-travel on the plan's empty floor.
 *
 * Ties break on list order (strictly-less-than), so the same click always picks
 * the same viewpoint. A nondeterministic teleport is far worse than a slightly
 * arbitrary one: the visitor cannot learn a control that moves.
 *
 * The caller passes only the nodes it actually DREW — filtering by storey here
 * would need `node.floor`, and a plan that travels to a viewpoint it is not
 * showing is a teleport out of the room with no visible cause.
 */
export function nearestPlanNode(
  nodes: readonly PlanNode[],
  point: PlanPoint,
  options: NearestPlanNodeOptions = {},
): PlanHit | null {
  let best: PlanHit | null = null;
  for (const node of nodes) {
    const distanceM = Math.hypot(node.point.x - point.x, node.point.y - point.y);
    if (!Number.isFinite(distanceM)) {
      continue;
    }
    if (best === null || distanceM < best.distanceM) {
      best = { id: node.id, distanceM };
    }
  }
  if (best === null) {
    return null;
  }
  const limit = options.maxDistanceM;
  if (limit !== undefined && best.distanceM > limit) {
    return null;
  }
  return best;
}

/**
 * The closest any two viewpoints in the set stand to each other, in metres.
 *
 * This exists to size the marks' invisible hit discs. A hit disc is only an
 * honest control while the discs stay DISJOINT: if two overlap, a click in the
 * overlap is resolved by SVG paint order — whichever mark was drawn last — not
 * by distance, so the nearest viewpoint does not win and the plan's whole
 * click model is a lie at exactly the density where it matters. Clamping the
 * radius to half this figure makes disjointness a property of the drawing:
 * for any point p inside node A's disc, and any other node B,
 *   d(p, B) ≥ d(A, B) − d(p, A) ≥ 2r − r = r ≥ d(p, A)
 * so A is provably the nearest node to every point its own disc contains.
 *
 * O(n²) and deliberately so: it runs once per storey (149 nodes ≈ 11k
 * distance evaluations, sub-millisecond), never per frame. A capture an order
 * of magnitude larger would want a grid, and would say so with a test.
 *
 * Fewer than two nodes have no spacing to speak of and return Infinity, which
 * leaves the caller's own radius as the only constraint — correct, because a
 * lone mark cannot overlap anything.
 */
export function minimumNodeSpacingM(nodes: readonly PlanNode[]): number {
  let smallest = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    if (a === undefined) {
      continue;
    }
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j];
      if (b === undefined) {
        continue;
      }
      const distanceM = Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y);
      // Two scans registered to the SAME plan coordinate (a re-shoot from one
      // tripod position, or two storeys' worth of node filtered into one list)
      // would otherwise force the radius to zero and leave the marks with no
      // hit area at all. Coincident marks cannot be told apart by pointer
      // anyway, so they are excluded and the floor's nearest-node resolution
      // handles that click — by distance, with a documented tie-break.
      if (!Number.isFinite(distanceM) || distanceM <= 0) {
        continue;
      }
      smallest = Math.min(smallest, distanceM);
    }
  }
  return smallest;
}

/**
 * The nearest viewpoint lying in a given SCREEN direction from another — the
 * arrow-key move, matching TwinMinimap's directional walk.
 *
 * Candidates must lie strictly forward of the origin along the direction
 * (dot product > 0); among those the closest by true distance wins, so a node
 * slightly off-axis but adjacent beats one far away but perfectly aligned.
 * Nothing that way returns null rather than wrapping around: a selection that
 * teleports to the far wall when the visitor presses ArrowUp once too often is
 * indistinguishable from a bug.
 */
export function nearestPlanNodeInDirection(
  nodes: readonly PlanNode[],
  fromId: string,
  direction: PlanPoint,
): PlanHit | null {
  const origin = nodes.find((node) => node.id === fromId);
  if (origin === undefined) {
    return null;
  }
  let best: PlanHit | null = null;
  for (const node of nodes) {
    if (node.id === fromId) {
      continue;
    }
    const dx = node.point.x - origin.point.x;
    const dy = node.point.y - origin.point.y;
    if (dx * direction.x + dy * direction.y <= 1e-9) {
      continue;
    }
    const distanceM = Math.hypot(dx, dy);
    if (best === null || distanceM < best.distanceM) {
      best = { id: node.id, distanceM };
    }
  }
  return best;
}

/**
 * A pointer position in client (page) pixels → plan metres, for an SVG drawn
 * with `preserveAspectRatio="xMidYMid meet"`.
 *
 * Implemented rather than delegated to `getScreenCTM()` for two reasons: the
 * transform is four lines of arithmetic that can be unit-tested, and happy-dom
 * implements neither `getScreenCTM` nor layout — so a component that relied on
 * it would have its whole click path untestable.
 *
 * Returns null when the element has not been measured (a zero rect: unmounted,
 * `display: none`, or any headless environment) instead of NaN coordinates that
 * would silently resolve to whichever viewpoint sorted first.
 */
export function planPointFromClient(
  rect: PlanClientRect,
  box: PlanViewBox,
  clientX: number,
  clientY: number,
): PlanPoint | null {
  if (!(rect.width > 0) || !(rect.height > 0) || !(box.width > 0) || !(box.height > 0)) {
    return null;
  }
  // "meet": one uniform scale, the smaller of the two, drawing centred.
  const scale = Math.min(rect.width / box.width, rect.height / box.height);
  if (!(scale > 0) || !Number.isFinite(scale)) {
    return null;
  }
  const offsetX = (rect.width - box.width * scale) / 2;
  const offsetY = (rect.height - box.height * scale) / 2;
  return {
    x: box.x + (clientX - rect.left - offsetX) / scale,
    y: box.y + (clientY - rect.top - offsetY) / scale,
  };
}

/**
 * The largest round number of metres that fits inside `spanM` — the scale bar's
 * length.
 *
 * A plan without a scale is a diagram; a plan with one is an instrument, and
 * this is the only figure on it that a reader will measure against. It is
 * derived from the drawing's own extent (which comes from surveyed poses), so
 * it never restates a published venue dimension.
 *
 * A degenerate span falls back to the smallest rung rather than 0: a zero-length
 * bar under a "0 m" label is a broken instrument, which is worse than no
 * instrument.
 */
export function chooseScaleBarM(spanM: number): number {
  const smallest = SCALE_BAR_LADDER[0] ?? 1;
  if (!Number.isFinite(spanM) || spanM <= 0) {
    return smallest;
  }
  let chosen = smallest;
  for (const rung of SCALE_BAR_LADDER) {
    if (rung <= spanM) {
      chosen = rung;
    }
  }
  return Math.min(chosen, spanM);
}
