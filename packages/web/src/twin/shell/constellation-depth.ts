import { smoothstep } from "../../lib/cloth-geometry.js";
import { MESH_OFFSET_M } from "../twin-basis.js";

// -----------------------------------------------------------------------------
// constellation-depth — how the floor graph relates to the room it lies in.
//
// FloorConstellation used to draw every mark at one flat opacity with nothing in
// front of it. Two things gave that away as a decal stuck to the lens rather
// than paint on the boards: a mark for the room beyond showed straight through
// the wall, and a mark 25 m down the building shouted exactly as loudly as the
// one under your feet. This module owns both fixes — the depth policy and the
// falloff curve — because both are arithmetic, and arithmetic tuned by eye
// inside a component is arithmetic nobody can check.
//
// HOW MUCH OF THIS IS REAL, AND HOW IT WAS ESTABLISHED. Every constant below was
// measured against the flagship bundle in packages/web/public/twin/trades-hall
// (149 poses; mesh/dollhouse.glb — 144 primitives, 330,200 triangles, 419,218
// vertices), walked offline in node on 2026-08-05:
//
//   • From scan_028, 37 of the 83 same-storey marks are behind building
//     geometry. Nearly half the graph was being drawn through walls.
//   • Those marks lie between 2.55 m and 25.10 m away (median 12.18 m), seen at
//     sines of elevation between 0.056 and 0.547 (median 0.121) — i.e. the
//     median mark is viewed at about 7° above the floor plane. Grazing is the
//     normal case here, not an edge case.
//   • Casting straight down from all 149 poses, the mesh's own floor sits BELOW
//     the graph's pose-derived floor at 148 of them (median 0.116 m below). The
//     single exception is scan_145, where it sits 0.092 m ABOVE.
//
// THE OCCLUSION MECHANISM, AND WHY IT IS THIS ONE.
//
// Walk mode writes NO depth at all: PanoStage's sphere is transparent with
// depthWrite off, and ParallaxStage's mesh is mounted only while a hop is in
// flight — which is exactly when the constellation is unmounted. So the
// `depthTest` the component always had was inert; there was never anything in
// the depth buffer for it to lose to. Occlusion therefore needs a depth source,
// and there are only two honest ways to get one:
//
//   (a) a depth-only prepass of the real building mesh, letting the GPU do a
//       per-pixel depth test — what this module configures; or
//   (b) a CPU occlusion query, raycasting eye→mark against the mesh per frame.
//
// (b) was rejected on measurement, not taste: three's Mesh.raycast is a linear
// scan of every triangle, and the offline run above took 0.9 s to cast 83 rays
// at this mesh. Per frame that is three orders of magnitude over budget, and
// closing the gap means a BVH this repo does not ship. (a) costs one extra
// draw, is exact to the pixel, and clips a nav EDGE where it crosses a wall —
// which (b), being per-mark, cannot do at all.
//
// TWO THINGS THE PREPASS MUST GET RIGHT, OR IT IS WORSE THAN NOTHING:
//
// 1. It must be QUEUED AFTER THE PANORAMA. The occluder writes depth and no
//    colour. Drawn first — the natural place for an opaque prepass — it would
//    fail the pano sphere's depth test across every pixel the building covers
//    and erase the photograph. That is why the occluder material is flagged
//    transparent: it lands in the transparent queue, where renderOrder decides,
//    and it sits above every renderOrder PanoStage uses.
// 2. It must be LOWERED. The mesh floor and the pose-derived floor datum are
//    two independent estimates of one plane, and at scan_145 they disagree by
//    0.092 m in the fatal direction — the mesh floor above the graph, swallowing
//    it whole. Lowering the occluder by CONSTELLATION_OCCLUDER_DROP_M puts the
//    mesh floor provably below the graph everywhere, and it is free: re-running
//    the sight-line count from scan_028 with the occluder lowered by 0, 0.10,
//    0.25, 0.50 and 1.00 m returned 37 of 83 blocked EVERY time. Sight lines to
//    floor marks descend, so they cross walls around eye height and never near
//    the skirting; lowering the walls' feet costs no occlusion. What it does
//    cost is honest and small: anything under a quarter metre tall — a step, a
//    threshold, a plinth — stops hiding a mark behind it.
//
// Nothing here hides a mark by rule, by room, or by distance: the occlusion is
// per-pixel against the real building or it does not happen at all.
//
// WHAT IS AND IS NOT SWITCHED ON. This module and FloorConstellation implement
// the mechanism; they do not turn it on. Occlusion happens only for a
// FloorConstellation that is GIVEN `occluderMeshUrl`, and the only mount site in
// the app — TwinViewer — does not pass it today. So as the tree stands the
// shipped graph is UNOCCLUDED, exactly as it was before this module existed, and
// every constant below is a loaded gun rather than a fired one. The integration
// that fires it is one prop, and it is written down in FloorConstellationProps.
//
// EVERY NUMBER ABOVE WAS RE-DERIVED, NOT INHERITED. The counts were re-run
// against the same bundle on 2026-08-05 from a clean script (three's GLTFLoader
// plus the meshopt decoder, raycasting the real primitives), and reproduce to
// the digit: 144 primitives / 330,200 triangles / 419,218 vertices; 148 of 149
// poses with the mesh floor below the graph floor, median 0.1164 m; scan_145 the
// lone exception at 0.0916 m above; 83 same-storey marks from scan_028 of which
// 37 blocked; sight lines 2.55 / 12.18 / 25.09 m at sines 0.056 / 0.121 / 0.547;
// and 37 of 83 still blocked at occluder drops of 0, 0.10, 0.25, 0.50 and 1.00 m.
// The 83 rays took 1.14 s, which re-confirms why (b) was rejected.
//
// A NOTE ON NON-FINITE INPUT, WHICH IS WHY THE GUARDS BELOW READ ODDLY.
// Every weight here ends up in the alpha channel of a GPU buffer, and a NaN
// alpha is not a quiet mark — it is undefined behaviour with a bright default.
// The obvious guard, `if (!(distanceM > 0)) return 1`, is true for NaN as well
// as for zero, so a pose that has gone NaN takes the "you are standing on it"
// branch and paints the LOUDEST mark on the floor. Finiteness is therefore
// always tested before zero, and every return runs through `safeWeight`.
// -----------------------------------------------------------------------------

/**
 * How the graph quietens with distance and with viewing angle.
 *
 * Both terms are needed and neither substitutes for the other. Distance alone
 * leaves the far end of a long room a solid speckle of equal-weight marks;
 * grazing alone leaves a mark two metres away at the same weight whether you
 * are looking down at it or across it.
 */
export interface ConstellationFalloff {
  /** Within this radius distance costs nothing — the marks at your feet. */
  readonly fullM: number;
  /** By this radius the distance term has bottomed out at `farWeight`. */
  readonly fadeM: number;
  /** The floor of the distance term. Never 0: see the note below. */
  readonly farWeight: number;
  /** The weight of a sight line lying flat in the floor plane. */
  readonly grazeFloor: number;
  /** Softening applied to sin(elevation) before it is mixed in. */
  readonly grazeExponent: number;
}

/**
 * Tuned against the measured capture, not by eye.
 *
 * `fadeM` is 26 m because the longest same-storey sight line measured from
 * scan_028 is 25.10 m: the farthest mark in the building lands just short of
 * the floor rather than being clipped flat several metres early.
 *
 * `farWeight` and `grazeFloor` are both deliberately well above zero. A mark
 * that fades to nothing is not a quiet mark, it is a missing viewpoint — the
 * graph would be claiming the walk stops where the fade does. Quiet is the
 * requirement; absent is a lie. Together they hold the worst case (25.10 m at
 * sin 0.056) at roughly a sixth of the weight of the mark underfoot.
 *
 * `grazeExponent` is below 1 on purpose. True decal foreshortening is linear in
 * sin(elevation), which at the measured median (0.121) would erase the graph
 * outright. The marks are billboarded — they stay legible edge-on by design —
 * so this term is not simulating foreshortening, it is borrowing its direction:
 * the further from overhead you view a mark, the less it insists.
 */
export const CONSTELLATION_FALLOFF: ConstellationFalloff = {
  fullM: 3,
  fadeM: 26,
  farWeight: 0.28,
  grazeFloor: 0.45,
  grazeExponent: 0.6,
};

/**
 * Metres the depth-only occluder is lowered, in three-world Y.
 *
 * 0.25 m against a worst measured disagreement of 0.092 m (scan_145): the
 * margin is for the next capture, whose tripod height is its own, not this
 * one's. Measured to cost zero wall occlusion — see the header. It is also
 * orders of magnitude above the depth buffer's resolution at these ranges, so
 * the graph can never z-fight the floor it lies on.
 */
export const CONSTELLATION_OCCLUDER_DROP_M = 0.25;

/**
 * The draw stack in walk mode, and why it is these numbers.
 *
 * PanoStage draws the resting sphere at renderOrder 0 and the arriving one at 1
 * (both transparent, depthWrite off). The occluder must come after both — ahead
 * of them it would erase the photograph — and the graph must come after the
 * occluder or it is never tested against the depth the occluder wrote. Sitting
 * above BOTH pano orders, rather than merely above the one on screen at rest,
 * keeps the stack correct even if the constellation is ever mounted mid-hop.
 *
 * NavMarkers stay at renderOrder 0, below the occluder, and that is deliberate:
 * the rings are clickable, and their hit disc is raycast, not depth-tested. A
 * ring hidden behind a wall while still answering clicks would be a dead button
 * in reverse — invisible, and live. The affordance keeps its own visibility;
 * only the map is occluded.
 */
export const CONSTELLATION_OCCLUDER_RENDER_ORDER = 2;
export const CONSTELLATION_RENDER_ORDER = 3;

/**
 * Where the occluder's root sits in three-world metres: the mesh's calibrated
 * offset, lowered by the drop.
 *
 * Joined from MESH_OFFSET_M rather than written out, because that constant is
 * twin-basis's single alignment surface for this mesh and it is expected to
 * move — it is calibrated through the visual gate. An occluder that hardcoded
 * `[0, -drop, 0]` would keep working right up until the day the mesh is nudged,
 * and then quietly start clipping the graph against a building standing
 * somewhere the building is not.
 */
export function constellationOccluderPosition(): [number, number, number] {
  return [
    MESH_OFFSET_M[0],
    MESH_OFFSET_M[1] - CONSTELLATION_OCCLUDER_DROP_M,
    MESH_OFFSET_M[2],
  ];
}

/**
 * The flags the two weighted layers (edges and marks) must carry.
 *
 * `vertexColors` is the entire falloff: three compiles USE_COLOR_ALPHA only
 * when a material asks for vertex colours AND the attribute has four
 * components. Miss either and nothing errors — the weights are simply ignored
 * and every mark draws at full strength, which looks exactly like the bug this
 * module exists to fix.
 *
 * `depthTest` is the occlusion. `depthWrite` stays off so the graph never
 * punches a hole in the nav rings: the rings are the affordance and outrank the
 * map, and a map that occludes its own affordance has inverted the hierarchy.
 */
export const CONSTELLATION_WEIGHTED_MATERIAL = {
  vertexColors: true,
  transparent: true,
  depthTest: true,
  depthWrite: false,
} as const;

/**
 * The halo's flags — deliberately WITHOUT `vertexColors`.
 *
 * The rings are ringGeometry, which has no colour attribute. A material that
 * declares USE_COLOR over a geometry that supplies no colours reads the
 * disabled attribute's default, which is black: the "you are here" halo would
 * render as three dark rings on the floorboards. The halo carries one uniform
 * opacity instead, which is all it ever needed — it marks a single point, so it
 * has no distance to fall off over.
 */
export const CONSTELLATION_HALO_MATERIAL = {
  transparent: true,
  depthTest: true,
  depthWrite: false,
} as const;

/**
 * The depth-only occluder's flags: write depth, write no colour.
 *
 * `transparent` is not decoration here, it is the mechanism. It puts the
 * occluder in the transparent queue, where renderOrder decides the draw order,
 * so it can be placed AFTER the panorama. An opaque occluder would draw in the
 * opaque pass — before every pano sphere — and the sphere, which depth-tests,
 * would then fail across every pixel of the building. The visitor would be
 * standing in a black room.
 */
export const CONSTELLATION_OCCLUDER_MATERIAL = {
  colorWrite: false,
  depthWrite: true,
  depthTest: true,
  transparent: true,
} as const;

/**
 * How far the eye must travel before the weights are recomputed, in metres.
 *
 * The weights depend on camera POSITION only — never on where it is pointed —
 * so a look-drag, which is most of what happens in walk mode, must not rewrite
 * a single buffer. Two centimetres is far below what any weight can visibly
 * respond to and far below one walk step.
 */
export const CONSTELLATION_REWEIGHT_EPSILON_M = 0.02;

/** Clamp into the range an alpha channel is allowed to occupy. */
function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/**
 * The last thing every weight passes through: clamped to 0–1, and 0 rather than
 * NaN if the arithmetic broke.
 *
 * `clamp01` alone is not enough — `Math.min(Math.max(NaN, 0), 1)` is NaN, so a
 * clamp is not a sanitiser. Zero is the right failure value precisely because it
 * is the one weight that cannot be mistaken for a claim: a fully transparent
 * mark says nothing, whereas NaN in a vertex alpha is read by the driver as
 * whatever it likes, and in practice that is usually opaque.
 */
function safeWeight(value: number): number {
  return Number.isFinite(value) ? clamp01(value) : 0;
}

/** Is every component of an eye position a real number? */
function isFiniteEye(eye: readonly [number, number, number]): boolean {
  return Number.isFinite(eye[0]) && Number.isFinite(eye[1]) && Number.isFinite(eye[2]);
}

/**
 * Reads off a Float32Array are `number | undefined` under
 * noUncheckedIndexedAccess. Every call site below is bounded by the vertex
 * count, so the fallback is unreachable; it exists so the arithmetic stays
 * finite rather than producing a NaN alpha if that bound ever breaks.
 */
function componentAt(buffer: Float32Array, index: number): number {
  return buffer[index] ?? 0;
}

/**
 * The distance term: 1 near, `farWeight` far, smooth in between.
 *
 * Non-increasing everywhere by construction, which is what stops the graph
 * reading as a ring of brightness at some middle radius.
 */
export function constellationDistanceWeight(
  distanceM: number,
  falloff: ConstellationFalloff = CONSTELLATION_FALLOFF,
): number {
  const { fullM, fadeM, farWeight } = falloff;
  if (!Number.isFinite(distanceM)) {
    return safeWeight(farWeight);
  }
  if (distanceM <= fullM) {
    return 1;
  }
  const faded = smoothstep(distanceM, fullM, fadeM);
  return safeWeight(farWeight + (1 - farWeight) * (1 - faded));
}

/**
 * The grazing term, from the rise between eye and mark and the distance between
 * them — i.e. from sin(elevation), which is the whole of the geometry that
 * matters. Taking the absolute rise makes the term indifferent to which side of
 * the floor plane the eye is on; a zero-length sight line is full weight,
 * because you are standing on the mark, not looking along it.
 *
 * A non-finite sight line is NOT full weight — it is the graze floor. That
 * asymmetry with the zero case is the whole point: standing on a mark is a real
 * situation that must stay bright, whereas a NaN sight line is a broken pose
 * that must not.
 */
export function constellationGrazeWeight(
  riseM: number,
  distanceM: number,
  falloff: ConstellationFalloff = CONSTELLATION_FALLOFF,
): number {
  const { grazeFloor, grazeExponent } = falloff;
  if (!Number.isFinite(riseM) || !Number.isFinite(distanceM)) {
    return safeWeight(grazeFloor);
  }
  if (distanceM === 0) {
    return 1;
  }
  // Clamped, not `Math.min(…, 1)`: a negative distance would otherwise reach
  // Math.pow with a negative base and a fractional exponent, which is NaN.
  const sine = clamp01(Math.abs(riseM) / distanceM);
  return safeWeight(grazeFloor + (1 - grazeFloor) * Math.pow(sine, grazeExponent));
}

/**
 * The weight one vertex of the graph carries, 0–1, from the eye's position
 * alone. Multiplied into the material's alpha, never into its colour: this can
 * quieten a mark, it can never recolour one.
 *
 * The mark under the visitor's feet returns exactly 1 — the standing viewpoint
 * is the one thing on the floor that must never fade. A mark whose pose has
 * gone non-finite returns the quietest weight the curve can produce, which is
 * the opposite end of the range from where the obvious guard would have put it.
 */
export function constellationVertexWeight(
  eye: readonly [number, number, number],
  point: readonly [number, number, number],
  falloff: ConstellationFalloff = CONSTELLATION_FALLOFF,
): number {
  const dx = point[0] - eye[0];
  const rise = point[1] - eye[1];
  const dz = point[2] - eye[2];
  const distanceM = Math.sqrt(dx * dx + rise * rise + dz * dz);
  // Finiteness BEFORE zero. `Math.sqrt` of a NaN pose is NaN, and `!(NaN > 0)`
  // is true, so the natural spelling of this guard hands a broken pose the
  // brightest mark on the floor instead of the quietest.
  if (!Number.isFinite(distanceM)) {
    return safeWeight(falloff.farWeight * falloff.grazeFloor);
  }
  if (distanceM === 0) {
    return 1;
  }
  // Still guarded on the way out: both terms are finite for finite input, but
  // `falloff` is a parameter, and a caller that hands in a nonsense curve must
  // not be able to put NaN into a vertex alpha through it.
  return safeWeight(
    constellationDistanceWeight(distanceM, falloff) *
      constellationGrazeWeight(rise, distanceM, falloff),
  );
}

/**
 * A vertex-colour buffer for `vertexCount` vertices, opaque white.
 *
 * Four components, not three, and that is load-bearing: three.js only compiles
 * USE_COLOR_ALPHA — the define that lets a vertex carry alpha at all — when the
 * colour attribute's itemSize is exactly 4. At itemSize 3 the alphas are
 * silently dropped and every mark draws at full weight.
 *
 * Pre-filled opaque so a buffer that is somehow never written reads as the
 * graph always used to look, rather than as an invisible one.
 */
export function makeConstellationWeightBuffer(vertexCount: number): Float32Array {
  return new Float32Array(vertexCount * 4).fill(1);
}

/**
 * Write one RGBA per vertex of `positions`: white, with the falloff weight in
 * alpha. Serves marks and edge endpoints alike — an edge's two ends get their
 * own weights and the GPU interpolates between them, so a corridor running away
 * from the visitor fades along its length instead of switching brightness at
 * some arbitrary midpoint.
 *
 * Refuses an undersized output buffer rather than filling what fits: a silent
 * truncation would leave the tail of the graph frozen at whatever weight it
 * last held, a stripe of bright marks that no longer answer the camera.
 *
 * Refuses a ragged INPUT for the same reason and with the same force. Rounding
 * the vertex count down — the natural spelling — quietly drops the last mark of
 * a positions array that is not a whole number of vertices, and the mark it
 * drops keeps whatever weight it was built with. Both ends of this function are
 * therefore strict: it is the only place where the graph's brightness can
 * silently stop tracking the camera.
 */
export function writeConstellationWeights(
  positions: Float32Array,
  eye: readonly [number, number, number],
  out: Float32Array,
  falloff: ConstellationFalloff = CONSTELLATION_FALLOFF,
): Float32Array {
  if (positions.length % 3 !== 0) {
    throw new RangeError(
      `constellation positions must be whole xyz vertices, got ${String(positions.length)} floats`,
    );
  }
  const vertexCount = positions.length / 3;
  if (out.length < vertexCount * 4) {
    throw new RangeError(
      `constellation weight buffer holds ${String(Math.floor(out.length / 4))} vertices, ` +
        `needs ${String(vertexCount)}`,
    );
  }
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const source = vertex * 3;
    const target = vertex * 4;
    out[target] = 1;
    out[target + 1] = 1;
    out[target + 2] = 1;
    out[target + 3] = constellationVertexWeight(
      eye,
      [
        componentAt(positions, source),
        componentAt(positions, source + 1),
        componentAt(positions, source + 2),
      ],
      falloff,
    );
  }
  return out;
}

/**
 * Has the eye moved enough to be worth rewriting the weights?
 *
 * A null previous eye always says yes: the buffers start opaque, so the first
 * frame is the one frame where skipping the write is visible.
 *
 * A non-finite eye on EITHER side also says yes, and that is not defensive
 * noise. `Math.abs(NaN - x) >= epsilon` is false, so the comparison below
 * answers "no" to a camera that has gone NaN — and keeps answering "no" for
 * ever, because the previous eye it is compared against is then NaN too. The
 * graph would freeze at whatever brightness it last held and never respond to
 * the camera again, including after the camera recovered. Saying yes hands the
 * decision to constellationVertexWeight, which has a non-finite guard of its own
 * and will quieten the marks rather than stick them.
 */
export function constellationNeedsReweight(
  previousEye: readonly [number, number, number] | null,
  eye: readonly [number, number, number],
  epsilonM: number = CONSTELLATION_REWEIGHT_EPSILON_M,
): boolean {
  if (previousEye === null) {
    return true;
  }
  if (!isFiniteEye(previousEye) || !isFiniteEye(eye)) {
    return true;
  }
  return (
    Math.abs(eye[0] - previousEye[0]) >= epsilonM ||
    Math.abs(eye[1] - previousEye[1]) >= epsilonM ||
    Math.abs(eye[2] - previousEye[2]) >= epsilonM
  );
}
