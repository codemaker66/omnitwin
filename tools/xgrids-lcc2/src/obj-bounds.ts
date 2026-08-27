// ---------------------------------------------------------------------------
// Room frame recovery from an XGRIDS room mesh (`mesh-files/<Room>.obj`).
//
// Why this exists: a handheld SLAM capture's bounding box is the volume the
// operator *walked*, not the room. Trades Hall captures run 2-6x the published
// room size because the walk includes corridors, stairwells and the approach.
// Taking the raw bounds would place every room wrong on screen — which is how
// the Reception Room ended up with a hand-tuned "not a signed alignment" scale.
//
// So we measure the room instead of assuming it: on each axis, keep the
// dominant *occupied* run and discard sparse tails. A corridor spur is a thin
// trail of vertices; a room is a dense slab. That difference is measurable, and
// this module refuses rather than guesses when it is not.
//
// All coordinates are XGRIDS' native Z-up metres. Converting to the scene's
// Y-up frame is the caller's job (see `align.ts`).
// ---------------------------------------------------------------------------

export type Vec3 = [number, number, number];

/** Below this a mesh cannot support an honest measurement. */
const MIN_VERTICES_FOR_MEASUREMENT = 64;

/** Histogram resolution used to find occupied runs. */
const SPAN_BIN_COUNT = 96;

/**
 * A bin counts as occupied at this fraction of the densest bin.
 *
 * This governs the horizontal axes only, where a room's histogram is fairly
 * flat and a corridor spur is genuinely sparse. The vertical axis does not use
 * a density ratio at all — see `verticalRoomSpan` for why.
 */
const SPAN_DENSITY_FLOOR = 0.1;

/**
 * Occupied bins separated by no more than this are still one run.
 *
 * Real room meshes are not solid: doorways, window reveals, furniture shadows
 * and occlusion from the operator's own path punch genuine holes in the
 * histogram. Measured against the Trades Hall captures, a tolerance of two bins
 * at this resolution fragments a single gallery into five runs and reports a
 * 10 m room as 3 m. Scaling the tolerance with the bin count keeps the rule
 * stable if SPAN_BIN_COUNT is ever retuned.
 */
const SPAN_MAX_GAP_BINS = Math.max(2, Math.round(SPAN_BIN_COUNT * 0.06));

/** Half-width of the moving average applied before thresholding, which keeps a
 *  one-bin dropout from splitting an otherwise solid wall. */
const SPAN_SMOOTHING_RADIUS = 1;

/**
 * How to reduce an axis histogram to a single span.
 *
 * - `"run"`: the longest contiguous occupied run. Correct for the two
 *   horizontal axes, where a corridor spur is *connected* to the room and
 *   moderately dense, so only run analysis separates the two.
 * - `"extent"`: lowest to highest occupied bin. Correct for the vertical axis,
 *   where a room is bimodal by construction — a dense floor and a dense
 *   ceiling with legitimately empty air between them. Run analysis would pick
 *   one slab and report a room a few centimetres tall.
 *
 * Both modes discard bins below the density floor, so sparse outliers (a stray
 * sub-floor point, a thin stairwell trail) are excluded either way.
 */
export type SpanMode = "run" | "extent";

/**
 * Reads vertex positions from OBJ text. Only `v` records are of interest;
 * `vn`/`vt`/`f` are ignored, and a record whose first three fields are not all
 * finite numbers is skipped rather than becoming NaN coordinates downstream.
 */
export function parseObjVertices(text: string): Vec3[] {
  const verts: Vec3[] = [];
  for (const rawLine of text.split("\n")) {
    // Guard on "v " so vn/vt records never reach the number parse.
    if (rawLine.length < 2 || rawLine[0] !== "v" || (rawLine[1] !== " " && rawLine[1] !== "\t")) {
      continue;
    }
    const fields = rawLine.slice(1).trim().split(/\s+/);
    if (fields.length < 3) continue;
    const x = Number(fields[0]);
    const y = Number(fields[1]);
    const z = Number(fields[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    verts.push([x, y, z]);
  }
  return verts;
}

/**
 * The dominant occupied run of `values`, as [low, high] in value space.
 *
 * Builds a histogram and keeps bins holding at least `SPAN_DENSITY_FLOOR` of
 * the peak, then reduces them per `mode`. Sparse drift never reaches the
 * density floor, so it is excluded without needing to know in advance how much
 * drift a given capture carries.
 */
export function denseSpan(
  values: readonly number[],
  mode: SpanMode = "run",
): readonly [number, number] | null {
  if (values.length === 0) return null;

  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (max - min < 1e-9) return [min, max];

  const width = (max - min) / SPAN_BIN_COUNT;
  const counts = new Array<number>(SPAN_BIN_COUNT).fill(0);
  for (const value of values) {
    const index = Math.min(SPAN_BIN_COUNT - 1, Math.floor((value - min) / width));
    counts[index] = (counts[index] ?? 0) + 1;
  }

  // Smooth before thresholding so a single empty bin inside a solid surface
  // does not read as the end of the room.
  const smoothed = counts.map((_, bin) => {
    let total = 0;
    let samples = 0;
    for (let offset = -SPAN_SMOOTHING_RADIUS; offset <= SPAN_SMOOTHING_RADIUS; offset += 1) {
      const neighbour = counts[bin + offset];
      if (neighbour === undefined) continue;
      total += neighbour;
      samples += 1;
    }
    return samples === 0 ? 0 : total / samples;
  });

  const peak = Math.max(...smoothed);
  const threshold = peak * SPAN_DENSITY_FLOOR;
  const occupied = smoothed.map((count) => count >= threshold);

  if (mode === "extent") {
    const first = occupied.indexOf(true);
    if (first === -1) return [min, max];
    const last = occupied.lastIndexOf(true);
    return [min + first * width, min + (last + 1) * width];
  }

  let bestStart = -1;
  let bestEnd = -1;
  let bestMass = -1;
  let index = 0;
  while (index < SPAN_BIN_COUNT) {
    if (occupied[index] !== true) {
      index += 1;
      continue;
    }
    const start = index;
    let end = index;
    let cursor = index;
    while (cursor < SPAN_BIN_COUNT) {
      if (occupied[cursor] === true) {
        end = cursor;
        cursor += 1;
        continue;
      }
      // Look ahead across a permitted gap for the run to resume.
      let gap = 0;
      while (cursor + gap < SPAN_BIN_COUNT && occupied[cursor + gap] !== true) gap += 1;
      if (gap > SPAN_MAX_GAP_BINS || cursor + gap >= SPAN_BIN_COUNT) break;
      cursor += gap;
    }
    let mass = 0;
    for (let bin = start; bin <= end; bin += 1) mass += counts[bin] ?? 0;
    if (mass > bestMass) {
      bestMass = mass;
      bestStart = start;
      bestEnd = end;
    }
    index = Math.max(cursor, end + 1);
  }

  if (bestStart < 0) return [min, max];
  return [min + bestStart * width, min + (bestEnd + 1) * width];
}

/**
 * Tallest thing that can still be one room, dome and gallery included.
 *
 * The Grand Hall is the ceiling case at roughly 7 m of wall plus a 7 m dome.
 */
const MAX_ROOM_HEIGHT_M = 16;

/**
 * The vertical span of the room, using a physical prior rather than a density
 * ratio.
 *
 * A density threshold cannot separate a room from the stairwell above it: how
 * far the room's own bins stand above the rest depends entirely on how flat and
 * how densely sampled its floor happens to be, which varies from capture to
 * capture. Tuning that ratio to fit one capture breaks another — measured
 * directly across the eight Trades Hall rooms.
 *
 * What does not vary is that a room has a bounded height. So take the band of
 * at most `MAX_ROOM_HEIGHT_M` holding the most geometry — the room, because
 * that is where the surfaces are — and then trim to the occupied part of it.
 * A stairwell climbing 20 m out of the room can never win that contest.
 */
export function verticalRoomSpan(values: readonly number[]): readonly [number, number] | null {
  if (values.length === 0) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (max - min <= MAX_ROOM_HEIGHT_M) return denseSpan(values, "run");

  const binHeight = (max - min) / SPAN_BIN_COUNT;
  const counts = new Array<number>(SPAN_BIN_COUNT).fill(0);
  for (const value of values) {
    const index = Math.min(SPAN_BIN_COUNT - 1, Math.floor((value - min) / binHeight));
    counts[index] = (counts[index] ?? 0) + 1;
  }

  const windowBins = Math.max(1, Math.floor(MAX_ROOM_HEIGHT_M / binHeight));
  let bestStart = 0;
  let bestMass = -1;
  let running = 0;
  for (let bin = 0; bin < SPAN_BIN_COUNT; bin += 1) {
    running += counts[bin] ?? 0;
    if (bin >= windowBins) running -= counts[bin - windowBins] ?? 0;
    if (running > bestMass) {
      bestMass = running;
      bestStart = Math.max(0, bin - windowBins + 1);
    }
  }

  const low = min + bestStart * binHeight;
  const high = min + Math.min(SPAN_BIN_COUNT, bestStart + windowBins) * binHeight;
  // Trim the winning band to the part that is actually occupied.
  const within = values.filter((value) => value >= low && value <= high);
  return denseSpan(within, "run");
}

export interface RoomFrame {
  /** Occupied-room bounds in XGRIDS Z-up metres. */
  readonly min: Vec3;
  readonly max: Vec3;
  /** Centre of the occupied room. */
  readonly center: Vec3;
  /** Occupied extent per axis, in metres. */
  readonly extent: Vec3;
  /** Dense floor height (Z-up). */
  readonly floorZ: number;
  /** Dense ceiling height (Z-up). */
  readonly ceilingZ: number;
  /** Share of source vertices inside the frame. Low values mean the capture is
   *  mostly not-this-room, and the measurement deserves human review. */
  readonly retainedFraction: number;
}

/**
 * Measures the occupied room from mesh vertices, or returns null when the mesh
 * is too sparse to support an honest answer.
 */
export function roomFrameFromVertices(sourceVertices: readonly Vec3[]): RoomFrame | null {
  if (sourceVertices.length < MIN_VERTICES_FOR_MEASUREMENT) return null;
  const vertices = sourceVertices;

  // Axes 0 and 1 are horizontal: a run of occupancy, which excludes corridors
  // leading away from the room. Axis 2 is XGRIDS' Z-up vertical, which uses the
  // room-height prior to exclude the storey below and the stairwell above.
  const axisValues = (axis: 0 | 1 | 2): number[] => vertices.map((vertex) => vertex[axis]);
  const spanX = denseSpan(axisValues(0), "run");
  const spanY = denseSpan(axisValues(1), "run");
  const spanZ = verticalRoomSpan(axisValues(2));
  if (spanX === null || spanY === null || spanZ === null) return null;

  const min: Vec3 = [spanX[0], spanY[0], spanZ[0]];
  const max: Vec3 = [spanX[1], spanY[1], spanZ[1]];

  let retained = 0;
  for (const vertex of sourceVertices) {
    if (
      vertex[0] >= min[0] && vertex[0] <= max[0] &&
      vertex[1] >= min[1] && vertex[1] <= max[1] &&
      vertex[2] >= min[2] && vertex[2] <= max[2]
    ) {
      retained += 1;
    }
  }

  return {
    min,
    max,
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    extent: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    floorZ: min[2],
    ceilingZ: max[2],
    retainedFraction: retained / sourceVertices.length,
  };
}
