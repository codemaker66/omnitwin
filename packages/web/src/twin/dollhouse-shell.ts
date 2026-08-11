import { Matrix4, type BufferGeometry, type Object3D, type Texture } from "three";

// -----------------------------------------------------------------------------
// dollhouse-shell — pruning the through-the-glass tears out of the dollhouse
// GLB at load time.
//
// THE DEFECT. The capture is a Matterport-style depth-fusion scan. Where the
// scanner looked through GLASS it got no honest depth, so every window bay
// fused into a curtain of pale blue ribbons hanging in mid-air in front of the
// wall, textured with the sky the camera saw through the window. From outside
// the building — the vantage this stage exists to offer — those bays read as
// torn holes, and the model reads as broken, because it is.
//
// WHY THE SIGNAL IS NOT GEOMETRIC. Measured against the shipped asset (330,200
// triangles across 144 chunks, 3,520.9 m2 of surface), every geometric
// candidate fails, and two fail with the sign flipped:
//
//   - Long edges select the GOOD geometry. The decimator leaves flat plaster,
//     floorboards and ceiling as a few big panels; rendering only triangles
//     with edges over 0.8 m draws a clean, complete room.
//   - Edge-on-ness to the nearest capture pose selects the CEILING. A patch of
//     ceiling far across the room is grazing to every scanner beneath it, so
//     pruning on it punches holes in the frieze and the dome.
//   - Sliver aspect ratio scatters uniformly over the room and does not
//     concentrate at the windows at all.
//   - Normal incoherence against welded neighbours selects the CHANDELIERS.
//
// That last one is the crux. The ribbons are locally smooth, well-formed, and
// well-connected — geometrically they are indistinguishable from the ornament
// hanging beside them. There is no per-triangle geometric threshold that keeps
// a chandelier and drops a tear.
//
// WHAT DOES SEPARATE THEM is radiometric, and it is separating for a physical
// reason rather than a cosmetic one: the tears exist precisely where the sensor
// saw daylight through glass, so the texture fused onto them is that daylight —
// bright and blue. The hall itself is mahogany, gilt and cream: warm
// everywhere, with red at or above blue on essentially every real surface.
//
// The rule is applied to CONNECTED COMPONENTS, not to triangles. A painting
// with a blue sky in it, or a blue panel in the dome glazing, is a small blue
// patch inside a large component that is overwhelmingly warm, and survives. A
// tear is a component that is blue nearly all the way through, and does not.
// Judging per triangle instead would eat the paintings.
//
// WHY AT LOAD TIME AND NOT IN THE FORGE. Repairing the asset in the forge is
// the correct durable fix and this module is not a substitute for it. It cannot
// ship from this lane today, and the tears are on the live site now. This pass
// is measured, reversible, changes no shipped byte, and costs one traversal of
// a mesh we have already paid to download and decode.
//
// WHAT THIS MODULE DOES NOT FIX — measured in the browser against the shipped
// asset, 2026-08-11, and written down here because the temptation to retune
// these thresholds until it does is strong and would be wasted work.
//
// There is a second, larger defect that looks superficially the same: a curtain
// of pale shreds hanging down the west flank of the Grand Hall. It is NOT a
// through-the-glass tear and none of the rules below can see it.
//
//   - It is not daylight. Raycast over the shred region, 569 front-most faces:
//     median blue-minus-red is -25, i.e. frankly WARM. The wall beside it is
//     -36 and the dome -60. It is pale plaster-coloured, not sky-coloured, so
//     no seed ever fires on it.
//   - It is not small. Half its faces have a longest edge over 0.35 m (median
//     0.37 m, p90 1.24 m), so maxTearEdgeM excludes them as structure before
//     any texel is read.
//   - It is not separable. Against control samples on the wall, the dome and
//     the floor it sits INSIDE the range of real architecture on every measure
//     this module can take: sliver thinness (3.0 vs the wall's 4.8), per-face
//     roughness, open-edge fraction (0.49 vs the floor's 0.77), component size,
//     and distance to the nearest capture pose (2.6 m vs the wall's 3.3 m).
//   - It is not debris. Welded globally it belongs to the 287,923-triangle
//     component that is the building, so the island pass cannot reach it.
//
//   The one thing that does separate it is WHERE it is: it occupies a slab of
//   the capture outside the Grand Hall's footprint, which makes it a question
//   of which room the dollhouse is showing rather than of which triangles are
//   sound. Fixing it belongs to room scoping or to the forge, not here.
// -----------------------------------------------------------------------------

export interface ShellPruneThresholds {
  /** A daylight SEED texel is at least this bright (0-255, channel mean). */
  readonly minGlassLuma: number;
  /** ...and at least this much bluer than red (blue minus red, signed). */
  readonly minGlassBlueBias: number;
  /**
   * A tear GROWS from its seeds through any texel at least this blue-versus-red
   * — negative, so "neutral or cool" spreads and only a frankly warm texel
   * blocks. This is what carries the prune across a window's dark glazing bars
   * without letting it cross onto the mahogany around the bay.
   */
  readonly spreadBlueBias: number;
  /**
   * A face whose longest edge exceeds this is STRUCTURE, never a tear, and it
   * also blocks a growing tear from crossing it.
   *
   * This is the sharpest measurement in the whole study, and it runs opposite
   * to intuition: rendering only the triangles with edges over 0.8 m draws a
   * clean, complete room, because the decimator leaves flat plaster, parquet
   * and ceiling as a few big panels while the tears stay dense and small. It is
   * what stops a bright reflection on the floor from opening a hole in it.
   */
  readonly maxTearEdgeM: number;
  /**
   * A grown region is only a tear if its faces disagree with their neighbours
   * about which way they point by at least this many degrees on average.
   *
   * This is what separates a TEAR from a WINDOW. Both are daylight. But where
   * the scan resolved the glass into a flat plausible pane — the Reception
   * Room's arched sashes, the roof lantern — the surface is coherent, and
   * removing it just leaves a black hole where a window used to be, which is a
   * worse defect than the one being fixed. A shredded ribbon is incoherent:
   * consecutive faces landed at unrelated depths. Keep the panes, cut the
   * shreds.
   */
  readonly minRegionRoughnessDeg: number;
  /**
   * A grown region is only a tear if at least this share of its edges is open —
   * shared with no other triangle.
   *
   * The sharpest of the three region tests, and the one that finally separates
   * a tear from a pane. A shredded ribbon is RAGGED: it is a strip of surface
   * with torn edges all down both sides. A window that resolved into a flat
   * pane is welded into the wall around it and has almost no free edge at all.
   */
  readonly minRegionOpenEdgeFraction: number;
  /**
   * A grown region is only a tear if it is at least this many times taller than
   * it is wide (extent along the capture frame's up axis, over its larger
   * horizontal extent).
   *
   * THE decisive test, and the one that finally separates a tear from a window.
   * Both are daylight; both can be ragged; both can be rough. But a tear HANGS —
   * it is a ribbon two to five metres tall and a handful of centimetres wide,
   * because the depth error runs along the scanner's ray and the ray sweeps
   * vertically. A window, a roof lantern, a glazed vault is a broad flat sheet
   * of the building's envelope. Nothing that is part of the building is five
   * times taller than it is wide.
   */
  readonly minRegionVerticalAspect: number;
  /**
   * A grown region is only a tear if at least this share of it was a daylight
   * seed rather than a neutral face it spread through.
   *
   * This is the control that keeps neutral architecture. A tear is daylight
   * with a few dark mullions bridging it, so its seed share is high. A pale
   * plaster vault with one rooflight in it is one seed and ten thousand neutral
   * faces, so its share is tiny and it survives — where a bare "did it touch a
   * seed" test would have eaten the whole ceiling.
   */
  readonly minRegionSeedFraction: number;
  /**
   * Abandon a grown region larger than this and keep it. The tears are ribbons
   * of a few thousand faces; the cap is the guarantee that a bad frame of
   * reference can never remove a wall, a floor or a ceiling.
   */
  readonly maxRegionTriangles: number;
  /**
   * Drop connected islands smaller than this outright. Zero disables the
   * island pass — see the shipped constant's note; a zero here is a defect,
   * and `shellPassesEnabled` is the assertion that keeps one from shipping.
   *
   * The island must be welded ACROSS chunks to mean anything. Measured on the
   * shipped asset: welding globally resolves 330,200 triangles into 326
   * components, one of which holds 287,923 (the building) and the next largest
   * only 6,853 — so "small" is a sharp statement about debris. Welding per
   * chunk instead, as an earlier draft of this module did, resolves nothing:
   * the tiler cuts every real surface at the chunk boundary, so a threshold of
   * 32 removed 15.8% of the model and 128 removed 38.3%, almost all of it
   * wall, floor and ceiling.
   */
  readonly minIslandTriangles: number;
  /**
   * Abandon the island pass entirely, changing nothing, if it would remove
   * more than this share of the model.
   *
   * The structural guarantee, not a tuning knob. Every number in this file is
   * calibrated against one capture; the cap is what makes the failure mode of
   * a different capture "does nothing" instead of "deletes the building". The
   * per-chunk weld above would have been refused by it on sight.
   */
  readonly maxIslandRemovalFraction: number;
  /**
   * A small component is only debris if nothing else comes within this
   * distance of it. Zero disables the guard, which is not a safe thing to do —
   * see the note beside the guard in pruneShellIslands for the holes that
   * appear in the floor when it is off.
   */
  readonly islandClearanceM: number;
  /** Vertices within this distance are one vertex when welding. */
  readonly weldToleranceM: number;
  /** Edge of the square texture grid each chunk's map is decimated to. */
  readonly textureGridSize: number;
}

/**
 * Calibrated against the shipped trades-hall dollhouse.glb by capture, not by
 * taste: each threshold was moved until the window bays stopped shredding, and
 * stopped one step before the paintings and the dome glazing began to go.
 */
export const DOLLHOUSE_SHELL_PRUNE: ShellPruneThresholds = {
  minGlassLuma: 150,
  minGlassBlueBias: 14,
  spreadBlueBias: 0,
  maxTearEdgeM: 0.35,
  minRegionRoughnessDeg: 8,
  minRegionOpenEdgeFraction: 0.08,
  minRegionVerticalAspect: 3,
  minRegionSeedFraction: 0.25,
  maxRegionTriangles: 3000,
  minIslandTriangles: 512,
  maxIslandRemovalFraction: 0.12,
  islandClearanceM: 0.12,
  weldToleranceM: 0.004,
  textureGridSize: 256,
};

/**
 * Every pass this module owns, and whether the shipped thresholds actually
 * arm it.
 *
 * A threshold set to its own disabling value is the failure this module is
 * most exposed to, because it is silent: the pass runs, reports zero, costs a
 * traversal, and looks exactly like a pass that found nothing to do. It has
 * happened once already — `minIslandTriangles: 0` shipped with a doc comment
 * that said "Zero disables the island pass" a dozen lines above it. This is
 * the assertion that a test can hold, so the next one fails loudly.
 */
export function shellPassesEnabled(
  thresholds: ShellPruneThresholds = DOLLHOUSE_SHELL_PRUNE,
): { readonly tears: boolean; readonly islands: boolean } {
  return {
    tears:
      thresholds.maxTearEdgeM > 0 &&
      thresholds.maxRegionTriangles > 0 &&
      thresholds.minRegionSeedFraction <= 1 &&
      thresholds.textureGridSize > 0,
    islands:
      thresholds.minIslandTriangles > 0 &&
      thresholds.maxIslandRemovalFraction > 0 &&
      thresholds.islandClearanceM > 0,
  };
}

/**
 * Reads off a typed array are `number | undefined` under
 * noUncheckedIndexedAccess. Every call site below is bounded by a count taken
 * from the same buffer, so the fallback is unreachable; it exists so the
 * arithmetic stays finite rather than producing NaN if that bound ever breaks.
 */
function componentAt(buffer: ArrayLike<number>, index: number): number {
  return buffer[index] ?? 0;
}

/** A chunk's texture decimated to a small RGBA grid, ready to sample. */
export interface ShellTextureGrid {
  readonly size: number;
  /** RGBA rows, top-left origin — the glTF UV origin once flipY is resolved. */
  readonly data: Uint8ClampedArray;
}

/**
 * What a texel says about the surface it was fused onto.
 *
 *  - `daylight` — bright AND at least as blue as it is red. Sky through glass.
 *    Nothing in this hall is both: the plaster and gilt are just as bright, and
 *    frankly warm.
 *  - `neutral`  — not warm. The dark glazing bars of a window, the grey haze
 *    around a blown-out pane. On its own this means nothing; it is only ever
 *    used to carry a prune outward from a daylight seed.
 *  - `surface`  — warm. Mahogany, gilt, cream plaster, parquet. A wall.
 */
export type ShellTexelClass = "daylight" | "neutral" | "surface";

export function classifyTexel(
  r: number,
  g: number,
  b: number,
  thresholds: ShellPruneThresholds = DOLLHOUSE_SHELL_PRUNE,
): ShellTexelClass {
  const blueBias = b - r;
  if ((r + g + b) / 3 >= thresholds.minGlassLuma && blueBias >= thresholds.minGlassBlueBias) {
    return "daylight";
  }
  return blueBias >= thresholds.spreadBlueBias ? "neutral" : "surface";
}

/** Nearest-texel sample with wrapped UVs; out-of-range UVs are common in scans. */
export function sampleTexelClass(
  grid: ShellTextureGrid,
  u: number,
  v: number,
  thresholds: ShellPruneThresholds = DOLLHOUSE_SHELL_PRUNE,
): ShellTexelClass {
  if (grid.size <= 0 || !Number.isFinite(u) || !Number.isFinite(v)) {
    return "surface";
  }
  const wrap = (value: number): number => {
    const fraction = value - Math.floor(value);
    return Math.min(grid.size - 1, Math.max(0, Math.floor(fraction * grid.size)));
  };
  const offset = (wrap(v) * grid.size + wrap(u)) * 4;
  return classifyTexel(
    componentAt(grid.data, offset),
    componentAt(grid.data, offset + 1),
    componentAt(grid.data, offset + 2),
    thresholds,
  );
}

/**
 * Decimate a loaded texture to a small RGBA grid via a 2D canvas.
 *
 * Returns null wherever that is impossible — no DOM, no 2D context, an image
 * that has not decoded, or a cross-origin canvas taint. Every caller treats
 * null as "no radiometric evidence", which degrades to leaving the mesh
 * untouched rather than to guessing.
 */
export function readTextureGrid(
  texture: Texture | null | undefined,
  size: number,
): ShellTextureGrid | null {
  const image: unknown = texture?.image;
  if (image === null || image === undefined || typeof document === "undefined" || size <= 0) {
    return null;
  }
  const drawable = image as CanvasImageSource;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) {
      return null;
    }
    // glTF pins flipY=false so v runs top-down, matching canvas rows. A texture
    // that says otherwise is drawn flipped so the grid is always top-down.
    if (texture?.flipY === true) {
      context.translate(0, size);
      context.scale(1, -1);
    }
    context.drawImage(drawable, 0, 0, size, size);
    return { size, data: context.getImageData(0, 0, size, size).data };
  } catch {
    return null;
  }
}

/**
 * Longest edge of the triangle whose three vertices start at `a`, `b`, `c` in
 * a packed xyz buffer. Metres, given a buffer already in the shell frame.
 */
export function longestEdgeM(
  points: ArrayLike<number>,
  a: number,
  b: number,
  c: number,
): number {
  const ax = componentAt(points, a);
  const ay = componentAt(points, a + 1);
  const az = componentAt(points, a + 2);
  const bx = componentAt(points, b);
  const by = componentAt(points, b + 1);
  const bz = componentAt(points, b + 2);
  const cx = componentAt(points, c);
  const cy = componentAt(points, c + 1);
  const cz = componentAt(points, c + 2);
  return Math.sqrt(
    Math.max(
      (bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2,
      (cx - ax) ** 2 + (cy - ay) ** 2 + (cz - az) ** 2,
      (cx - bx) ** 2 + (cy - by) ** 2 + (cz - bz) ** 2,
    ),
  );
}

/**
 * Angle in degrees between two unit normals, unsigned and orientation-blind: a
 * neighbouring triangle wound the other way describes the same surface, so 175
 * degrees of disagreement is 5 degrees of roughness, not 175.
 */
export function normalDeviationDeg(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number {
  const dot = Math.min(1, Math.max(-1, ax * bx + ay * by + az * bz));
  const angle = (Math.acos(Math.abs(dot)) * 180) / Math.PI;
  return Number.isFinite(angle) ? angle : 0;
}

/** Undirected edge key over welded vertex ids (both below 2^21). */
function edgeKey(u: number, v: number): number {
  return u < v ? u * 2 ** 21 + v : v * 2 ** 21 + u;
}

/** Union-find over welded vertices, with path compression. */
function findRoot(parent: Int32Array, start: number): number {
  let root = start;
  let next = componentAt(parent, root);
  while (next !== root) {
    const grandparent = componentAt(parent, next);
    parent[root] = grandparent;
    root = grandparent;
    next = componentAt(parent, root);
  }
  return root;
}

/**
 * Weld positions onto a lattice so that UV seams — which duplicate a vertex
 * without separating the surface — do not read as boundaries. The packed key
 * stays inside Number.MAX_SAFE_INTEGER for any coordinate within +/-260 m of
 * the origin at 4 mm tolerance, which the twin's 27 m extent clears.
 */
function weldKey(x: number, y: number, z: number, tolerance: number): number {
  const qx = Math.round(x / tolerance) + 65536;
  const qy = Math.round(y / tolerance) + 65536;
  const qz = Math.round(z / tolerance) + 65536;
  return qx * 2 ** 34 + qy * 2 ** 17 + qz;
}

export interface ShellPruneOutcome {
  /** Triangles the geometry had before the pass. */
  readonly trianglesBefore: number;
  /** Triangles remaining after it. */
  readonly trianglesAfter: number;
  /** Removed because their component sampled as daylight through glass. */
  readonly tearsRemoved: number;
}

const EMPTY_OUTCOME: ShellPruneOutcome = {
  trianglesBefore: 0,
  trianglesAfter: 0,
  tearsRemoved: 0,
};

/**
 * Per-triangle roughness: the mean angle, in degrees, between a face's normal
 * and the normals of the faces sharing its welded edges. A face with no
 * neighbours at all is loose debris and scores the maximum.
 */
export interface ShellSurfaceStats {
  /** Mean neighbour normal deviation, degrees, per triangle. */
  readonly roughnessDeg: Float64Array;
  /** How many of each triangle's three edges no other triangle shares (0-3). */
  readonly openEdges: Uint8Array;
}

export function triangleSurfaceStats(
  points: ArrayLike<number>,
  index: ArrayLike<number>,
  welded: ArrayLike<number>,
  triangleCount: number,
): ShellSurfaceStats {
  const normals = new Float64Array(triangleCount * 3);
  for (let t = 0; t < triangleCount; t += 1) {
    const ia = componentAt(index, t * 3) * 3;
    const ib = componentAt(index, t * 3 + 1) * 3;
    const ic = componentAt(index, t * 3 + 2) * 3;
    const ux = componentAt(points, ib) - componentAt(points, ia);
    const uy = componentAt(points, ib + 1) - componentAt(points, ia + 1);
    const uz = componentAt(points, ib + 2) - componentAt(points, ia + 2);
    const vx = componentAt(points, ic) - componentAt(points, ia);
    const vy = componentAt(points, ic + 1) - componentAt(points, ia + 1);
    const vz = componentAt(points, ic + 2) - componentAt(points, ia + 2);
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (length > 0) {
      normals[t * 3] = nx / length;
      normals[t * 3 + 1] = ny / length;
      normals[t * 3 + 2] = nz / length;
    }
  }

  const sum = new Float64Array(triangleCount);
  const count = new Int32Array(triangleCount);
  const owner = new Map<number, number>();
  for (let t = 0; t < triangleCount; t += 1) {
    const va = componentAt(welded, componentAt(index, t * 3));
    const vb = componentAt(welded, componentAt(index, t * 3 + 1));
    const vc = componentAt(welded, componentAt(index, t * 3 + 2));
    const keys = [edgeKey(va, vb), edgeKey(vb, vc), edgeKey(vc, va)];
    for (const key of keys) {
      const other = owner.get(key);
      if (other === undefined) {
        owner.set(key, t);
        continue;
      }
      if (other === t) {
        continue;
      }
      const deviation = normalDeviationDeg(
        componentAt(normals, other * 3),
        componentAt(normals, other * 3 + 1),
        componentAt(normals, other * 3 + 2),
        componentAt(normals, t * 3),
        componentAt(normals, t * 3 + 1),
        componentAt(normals, t * 3 + 2),
      );
      // Read through componentAt for the same reason every other access in
      // this file does: noUncheckedIndexedAccess types a typed-array read as
      // `number | undefined`, so `+=` neither compiles nor, if it did, would
      // mean addition on the undefined branch.
      sum[other] = componentAt(sum, other) + deviation;
      sum[t] = componentAt(sum, t) + deviation;
      count[other] = componentAt(count, other) + 1;
      count[t] = componentAt(count, t) + 1;
    }
  }

  const roughnessDeg = new Float64Array(triangleCount);
  const openEdges = new Uint8Array(triangleCount);
  for (let t = 0; t < triangleCount; t += 1) {
    const neighbours = componentAt(count, t);
    roughnessDeg[t] = neighbours > 0 ? componentAt(sum, t) / neighbours : 90;
    openEdges[t] = Math.max(0, 3 - neighbours);
  }
  return { roughnessDeg, openEdges };
}

/**
 * How much taller than wide a region's bounds are, in the capture frame (Z-up).
 * A hanging ribbon scores high; a sheet of building envelope scores below one.
 * An absent or degenerate box scores 0, which never passes a positive gate.
 */
export function verticalAspect(box: ArrayLike<number> | undefined): number {
  if (box === undefined || box.length < 6) {
    return 0;
  }
  const width = Math.max(
    componentAt(box, 1) - componentAt(box, 0),
    componentAt(box, 3) - componentAt(box, 2),
  );
  const height = componentAt(box, 5) - componentAt(box, 4);
  if (!(width > 0) || !Number.isFinite(height)) {
    return 0;
  }
  return height / width;
}

/** The slice of BufferAttribute this pass reads, structurally typed. */
interface AttributeReader {
  readonly count: number;
  getX: (index: number) => number;
  getY: (index: number) => number;
  getZ: (index: number) => number;
}

function isAttributeReader(value: unknown): value is AttributeReader {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<AttributeReader>;
  return (
    typeof candidate.count === "number" &&
    typeof candidate.getX === "function" &&
    typeof candidate.getY === "function" &&
    typeof candidate.getZ === "function"
  );
}

/**
 * Prune one indexed geometry in place.
 *
 * `toShellFrame` is the chunk's transform relative to the GLB root — the GLB
 * stores each chunk quantized about its own origin, so the weld tolerance only
 * means metres after this matrix. `grid` is the chunk's texture decimated for
 * sampling; pass null to run the island rule alone.
 *
 * Only the index buffer is rewritten. Positions, UVs and the texture are left
 * untouched, so nothing downstream that addresses vertices by index can drift.
 */
export function pruneShellGeometry(
  geometry: BufferGeometry,
  toShellFrame: Matrix4,
  grid: ShellTextureGrid | null,
  thresholds: ShellPruneThresholds = DOLLHOUSE_SHELL_PRUNE,
): ShellPruneOutcome {
  const index = geometry.getIndex();
  const position: unknown = geometry.getAttribute("position");
  if (index === null || !isAttributeReader(position)) {
    return EMPTY_OUTCOME;
  }
  const vertexCount = position.count;
  const triangleCount = Math.floor(index.count / 3);
  if (vertexCount === 0 || triangleCount === 0) {
    return EMPTY_OUTCOME;
  }
  const uvCandidate: unknown = geometry.getAttribute("uv");
  const uv = isAttributeReader(uvCandidate) ? uvCandidate : null;
  const source = index.array;

  // 1. Put every vertex in shell metres once, then weld, so that UV seams do
  //    not read as component boundaries and so edge lengths mean metres.
  const m = toShellFrame.elements;
  const points = new Float64Array(vertexCount * 3);
  const welded = new Int32Array(vertexCount);
  const lattice = new Map<number, number>();
  for (let v = 0; v < vertexCount; v += 1) {
    const px = position.getX(v);
    const py = position.getY(v);
    const pz = position.getZ(v);
    const x =
      componentAt(m, 0) * px + componentAt(m, 4) * py + componentAt(m, 8) * pz + componentAt(m, 12);
    const y =
      componentAt(m, 1) * px + componentAt(m, 5) * py + componentAt(m, 9) * pz + componentAt(m, 13);
    const z =
      componentAt(m, 2) * px + componentAt(m, 6) * py + componentAt(m, 10) * pz + componentAt(m, 14);
    points[v * 3] = x;
    points[v * 3 + 1] = y;
    points[v * 3 + 2] = z;
    const key = weldKey(x, y, z, thresholds.weldToleranceM);
    const first = lattice.get(key);
    if (first === undefined) {
      lattice.set(key, v);
      welded[v] = v;
    } else {
      welded[v] = first;
    }
  }

  // 2. Classify every face by the texel its UV centroid lands on.
  //
  //    Judged per triangle and NOT per connected component: measured, the
  //    ribbons fuse into the wall chunk they hang off, so a component-level
  //    vote dilutes to nothing and removes 3% of the tears.
  const survivor = new Uint8Array(triangleCount).fill(1);
  const classes = new Uint8Array(triangleCount); // 0 surface, 1 neutral, 2 daylight
  if (grid !== null && uv !== null) {
    for (let t = 0; t < triangleCount; t += 1) {
      const ia = componentAt(source, t * 3);
      const ib = componentAt(source, t * 3 + 1);
      const ic = componentAt(source, t * 3 + 2);
      if (
        longestEdgeM(points, ia * 3, ib * 3, ic * 3) > thresholds.maxTearEdgeM
      ) {
        continue; // structure: neither seed nor conductor
      }
      const u = (uv.getX(ia) + uv.getX(ib) + uv.getX(ic)) / 3;
      const v = (uv.getY(ia) + uv.getY(ib) + uv.getY(ic)) / 3;
      const texel = sampleTexelClass(grid, u, v, thresholds);
      classes[t] = texel === "daylight" ? 2 : texel === "neutral" ? 1 : 0;
    }
  }

  // 3. Grow each tear from its daylight seeds through the neutral faces around
  //    it, and stop at the first warm one. A window's dark glazing bars are
  //    neutral, so the ribbon comes away whole instead of leaving a lace of
  //    mullions behind; the mahogany that frames the bay is warm, so the growth
  //    stops there. A region that grows past the cap is abandoned intact — that
  //    is the guarantee that this can never take a wall.
  let tearsRemoved = 0;
  if (grid !== null && uv !== null) {
    const regionOf = new Int32Array(vertexCount);
    for (let v = 0; v < vertexCount; v += 1) {
      regionOf[v] = componentAt(welded, v);
    }
    const union = (left: number, right: number): void => {
      const rootLeft = findRoot(regionOf, left);
      const rootRight = findRoot(regionOf, right);
      if (rootLeft !== rootRight) {
        regionOf[rootLeft] = rootRight;
      }
    };
    for (let t = 0; t < triangleCount; t += 1) {
      if (componentAt(classes, t) === 0) {
        continue;
      }
      const va = componentAt(welded, componentAt(source, t * 3));
      union(va, componentAt(welded, componentAt(source, t * 3 + 1)));
      union(va, componentAt(welded, componentAt(source, t * 3 + 2)));
    }
    const stats = triangleSurfaceStats(points, source, welded, triangleCount);
    const regionSize = new Map<number, number>();
    const regionSeeds = new Map<number, number>();
    const regionRoughness = new Map<number, number>();
    const regionOpenEdges = new Map<number, number>();
    // [minX,maxX,minY,maxY,minZ,maxZ] in the capture frame, which is Z-up.
    const regionBox = new Map<number, Float64Array>();
    for (let t = 0; t < triangleCount; t += 1) {
      const kind = componentAt(classes, t);
      if (kind === 0) {
        continue;
      }
      const root = findRoot(regionOf, componentAt(welded, componentAt(source, t * 3)));
      regionSize.set(root, (regionSize.get(root) ?? 0) + 1);
      regionRoughness.set(
        root,
        (regionRoughness.get(root) ?? 0) + componentAt(stats.roughnessDeg, t),
      );
      regionOpenEdges.set(root, (regionOpenEdges.get(root) ?? 0) + componentAt(stats.openEdges, t));
      if (kind !== 2) {
        continue;
      }
      regionSeeds.set(root, (regionSeeds.get(root) ?? 0) + 1);
      // The box spans the DAYLIGHT faces only. Including the neutral faces the
      // tear grew through would inflate it with the wall it hangs off, and the
      // shape test would stop meaning anything.
      let box = regionBox.get(root);
      if (box === undefined) {
        box = new Float64Array([Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]);
        regionBox.set(root, box);
      }
      for (let corner = 0; corner < 3; corner += 1) {
        const p = componentAt(source, t * 3 + corner) * 3;
        for (let axis = 0; axis < 3; axis += 1) {
          const value = componentAt(points, p + axis);
          box[axis * 2] = Math.min(componentAt(box, axis * 2), value);
          box[axis * 2 + 1] = Math.max(componentAt(box, axis * 2 + 1), value);
        }
      }
    }
    for (let t = 0; t < triangleCount; t += 1) {
      if (componentAt(classes, t) === 0) {
        continue;
      }
      const root = findRoot(regionOf, componentAt(welded, componentAt(source, t * 3)));
      const size = regionSize.get(root) ?? 0;
      if (
        size > 0 &&
        size <= thresholds.maxRegionTriangles &&
        (regionSeeds.get(root) ?? 0) / size >= thresholds.minRegionSeedFraction &&
        (regionRoughness.get(root) ?? 0) / size >= thresholds.minRegionRoughnessDeg &&
        (regionOpenEdges.get(root) ?? 0) / (size * 3) >= thresholds.minRegionOpenEdgeFraction &&
        verticalAspect(regionBox.get(root)) >= thresholds.minRegionVerticalAspect
      ) {
        survivor[t] = 0;
        tearsRemoved += 1;
      }
    }
  }

  // The island sweep does NOT live here. A chunk is a spatial tile, so every
  // real surface crossing its boundary arrives as a small piece, and "small
  // component within one chunk" is a statement about the tiler rather than
  // about the capture. It runs once, globally, in pruneShellIslands.
  if (tearsRemoved === 0) {
    return {
      trianglesBefore: triangleCount,
      trianglesAfter: triangleCount,
      tearsRemoved: 0,
    };
  }
  const compacted: number[] = [];
  for (let t = 0; t < triangleCount; t += 1) {
    if (componentAt(survivor, t) === 1) {
      compacted.push(
        componentAt(source, t * 3),
        componentAt(source, t * 3 + 1),
        componentAt(source, t * 3 + 2),
      );
    }
  }
  geometry.setIndex(compacted);

  return {
    trianglesBefore: triangleCount,
    trianglesAfter: compacted.length / 3,
    tearsRemoved,
  };
}

/** One chunk of the shell, with the transform that puts it in shell metres. */
export interface ShellChunk {
  readonly geometry: BufferGeometry;
  readonly toShellFrame: Matrix4;
}

export interface ShellIslandOutcome {
  /** Triangles considered across every chunk. */
  readonly triangles: number;
  /** Connected components found once the chunks were welded to each other. */
  readonly islands: number;
  /** Triangles in the largest component — the building, when this is working. */
  readonly largestIsland: number;
  /** Triangles removed. Zero when refused. */
  readonly removed: number;
  /** True when the removal cap fired and nothing was changed. */
  readonly refused: boolean;
}

const EMPTY_ISLAND_OUTCOME: ShellIslandOutcome = {
  triangles: 0,
  islands: 0,
  largestIsland: 0,
  removed: 0,
  refused: false,
};

/**
 * Drop free-floating debris, judged over the WHOLE shell at once.
 *
 * The capture leaves confetti: filaments and flakes hanging in the air that
 * touch nothing. They are the one defect in this asset that is genuinely
 * separable, and the separation is topological rather than radiometric — the
 * building is one connected surface and the debris is not part of it.
 *
 * The weld has to span chunks for that sentence to be true. Each chunk is a
 * spatial tile of one continuous scan, so a wall is delivered as a dozen
 * pieces that are only neighbours across a tile seam; judging components
 * inside a chunk measures the tiler and removes architecture. Welding every
 * chunk onto one lattice first is what makes the largest component the
 * building rather than a tile of it.
 *
 * Refuses, changing nothing, if it would take more than the capped share.
 */
export function pruneShellIslands(
  chunks: readonly ShellChunk[],
  thresholds: ShellPruneThresholds = DOLLHOUSE_SHELL_PRUNE,
): ShellIslandOutcome {
  if (thresholds.minIslandTriangles <= 0 || chunks.length === 0) {
    return EMPTY_ISLAND_OUTCOME;
  }

  // 1. One lattice for the whole shell. Every chunk's vertices are pushed
  //    through its own transform first, so a seam shared by two tiles lands on
  //    a single lattice cell and the two tiles become one component.
  const lattice = new Map<number, number>();
  const latticeX: number[] = [];
  const latticeY: number[] = [];
  const latticeZ: number[] = [];
  const chunkFaces: Int32Array[] = [];
  let triangles = 0;
  for (const chunk of chunks) {
    const index = chunk.geometry.getIndex();
    const position: unknown = chunk.geometry.getAttribute("position");
    if (index === null || !isAttributeReader(position)) {
      chunkFaces.push(new Int32Array(0));
      continue;
    }
    const faceCount = Math.floor(index.count / 3);
    const source = index.array;
    const m = chunk.toShellFrame.elements;
    const ids = new Int32Array(position.count);
    for (let v = 0; v < position.count; v += 1) {
      const px = position.getX(v);
      const py = position.getY(v);
      const pz = position.getZ(v);
      const x =
        componentAt(m, 0) * px + componentAt(m, 4) * py + componentAt(m, 8) * pz + componentAt(m, 12);
      const y =
        componentAt(m, 1) * px + componentAt(m, 5) * py + componentAt(m, 9) * pz + componentAt(m, 13);
      const z =
        componentAt(m, 2) * px + componentAt(m, 6) * py + componentAt(m, 10) * pz + componentAt(m, 14);
      const key = weldKey(x, y, z, thresholds.weldToleranceM);
      const existing = lattice.get(key);
      if (existing === undefined) {
        ids[v] = lattice.size;
        lattice.set(key, lattice.size);
        latticeX.push(x);
        latticeY.push(y);
        latticeZ.push(z);
      } else {
        ids[v] = existing;
      }
    }
    const faces = new Int32Array(faceCount * 3);
    for (let f = 0; f < faceCount * 3; f += 1) {
      faces[f] = componentAt(ids, componentAt(source, f));
    }
    chunkFaces.push(faces);
    triangles += faceCount;
  }
  if (triangles === 0) {
    return EMPTY_ISLAND_OUTCOME;
  }

  // 2. Union-find over the shared lattice.
  const parent = new Int32Array(lattice.size);
  for (let i = 0; i < parent.length; i += 1) {
    parent[i] = i;
  }
  const union = (left: number, right: number): void => {
    const rootLeft = findRoot(parent, left);
    const rootRight = findRoot(parent, right);
    if (rootLeft !== rootRight) {
      parent[rootLeft] = rootRight;
    }
  };
  for (const faces of chunkFaces) {
    for (let f = 0; f < faces.length; f += 3) {
      union(componentAt(faces, f), componentAt(faces, f + 1));
      union(componentAt(faces, f), componentAt(faces, f + 2));
    }
  }
  const islandSize = new Map<number, number>();
  for (const faces of chunkFaces) {
    for (let f = 0; f < faces.length; f += 3) {
      const root = findRoot(parent, componentAt(faces, f));
      islandSize.set(root, (islandSize.get(root) ?? 0) + 1);
    }
  }
  let largestIsland = 0;
  for (const size of islandSize.values()) {
    largestIsland = Math.max(largestIsland, size);
  }

  // 3. The clearance guard, and the reason this pass is safe to arm at all.
  //
  //    "Small component" is NOT the same claim as "debris", and assuming it is
  //    punches holes in the floor. Measured: the decimator leaves patches of
  //    real, coplanar floor as their own components — welded at 4 mm they do
  //    not join the boards around them — and dropping those left black holes in
  //    the middle of the parquet at every threshold tried, 64 through 512.
  //
  //    What actually distinguishes debris is that it hangs in the AIR: nothing
  //    else is anywhere near it. So a small component is only debris if no
  //    surviving vertex lies within islandClearanceM of any of its own. A flake
  //    lying in the floor, or stuck to a wall, is spared — the conservative
  //    direction, because a hole in the floor is a worse defect than a speck.
  const spared = new Set<number>();
  const clearance = thresholds.islandClearanceM;
  const islandOfVertex = (v: number): number => findRoot(parent, v);
  const sizeOfVertex = (v: number): number => islandSize.get(islandOfVertex(v)) ?? 0;
  if (clearance > 0) {
    const occupied = new Set<number>();
    for (let v = 0; v < lattice.size; v += 1) {
      if (sizeOfVertex(v) < thresholds.minIslandTriangles) {
        continue;
      }
      occupied.add(
        weldKey(componentAt(latticeX, v), componentAt(latticeY, v), componentAt(latticeZ, v), clearance),
      );
    }
    // weldKey packs the quantised axes at fixed strides, so stepping a cell is
    // adding a stride rather than re-deriving the key.
    const strideX = 2 ** 34;
    const strideY = 2 ** 17;
    for (let v = 0; v < lattice.size; v += 1) {
      const size = sizeOfVertex(v);
      if (size === 0 || size >= thresholds.minIslandTriangles) {
        continue;
      }
      const root = islandOfVertex(v);
      if (spared.has(root)) {
        continue;
      }
      const key = weldKey(
        componentAt(latticeX, v),
        componentAt(latticeY, v),
        componentAt(latticeZ, v),
        clearance,
      );
      for (let dx = -1; dx <= 1 && !spared.has(root); dx += 1) {
        for (let dy = -1; dy <= 1 && !spared.has(root); dy += 1) {
          for (let dz = -1; dz <= 1; dz += 1) {
            if (occupied.has(key + dx * strideX + dy * strideY + dz)) {
              spared.add(root);
              break;
            }
          }
        }
      }
    }
  }

  let doomed = 0;
  for (const [root, size] of islandSize) {
    if (size < thresholds.minIslandTriangles && !spared.has(root)) {
      doomed += size;
    }
  }

  const survey = {
    triangles,
    islands: islandSize.size,
    largestIsland,
  };
  if (doomed === 0) {
    return { ...survey, removed: 0, refused: false };
  }
  // 3. The cap. Measured, this pass takes 3.5% of the shipped asset; anything
  //    near the cap means the weld has stopped describing the building, and
  //    the only safe response to that is to do nothing at all.
  if (doomed / triangles > thresholds.maxIslandRemovalFraction) {
    return { ...survey, removed: 0, refused: true };
  }

  let removed = 0;
  chunks.forEach((chunk, i) => {
    const faces = chunkFaces[i];
    const index = chunk.geometry.getIndex();
    if (faces === undefined || faces.length === 0 || index === null) {
      return;
    }
    const source = index.array;
    const compacted: number[] = [];
    for (let f = 0; f < faces.length; f += 3) {
      const root = findRoot(parent, componentAt(faces, f));
      if ((islandSize.get(root) ?? 0) < thresholds.minIslandTriangles && !spared.has(root)) {
        removed += 1;
        continue;
      }
      compacted.push(
        componentAt(source, f),
        componentAt(source, f + 1),
        componentAt(source, f + 2),
      );
    }
    if (compacted.length !== faces.length) {
      chunk.geometry.setIndex(compacted);
    }
  });

  return { ...survey, removed, refused: false };
}

export interface ShellPruneReport extends ShellPruneOutcome {
  /** Indexed meshes visited. */
  readonly meshes: number;
  /** Meshes for which a texture grid could be read. */
  readonly meshesSampled: number;
  /** What the global island pass found and did. */
  readonly islands: ShellIslandOutcome;
  /** Wall-clock cost of the whole traversal, milliseconds. */
  readonly elapsedMs: number;
}

interface GeometryBearing extends Object3D {
  readonly geometry: BufferGeometry;
  readonly material: unknown;
}

function hasGeometry(object: Object3D): object is GeometryBearing {
  if (!("geometry" in object)) {
    return false;
  }
  const geometry: unknown = (object as { geometry?: unknown }).geometry;
  return (
    typeof geometry === "object" &&
    geometry !== null &&
    "getIndex" in geometry &&
    typeof (geometry as BufferGeometry).getIndex === "function"
  );
}

/** The colour map of a mesh's material, whatever flavour of material it is. */
function colorMapOf(material: unknown): Texture | null {
  const first = Array.isArray(material) ? (material[0] as unknown) : material;
  if (typeof first !== "object" || first === null || !("map" in first)) {
    return null;
  }
  const map: unknown = (first as { map?: unknown }).map;
  return typeof map === "object" && map !== null ? (map as Texture) : null;
}

/** Marker so a cached GLTF scene is only ever pruned once per session. */
const PRUNED_FLAG = "dollhouseShellPruned";

/**
 * Prune every indexed mesh under `root`.
 *
 * drei caches GLTF scenes across mounts, so this is idempotent: a geometry that
 * has already been pruned is skipped and reported as unchanged.
 */
export function pruneDollhouseShell(
  root: Object3D,
  thresholds: ShellPruneThresholds = DOLLHOUSE_SHELL_PRUNE,
): ShellPruneReport {
  const startedAt = Date.now();
  // This is COSMETIC repair, and it runs inside a render-phase useMemo. If the
  // root cannot supply world matrices there is no way to do the job — but the
  // honest failure is to leave the shell untouched, not to throw. A torn window
  // bay is a blemish; an exception here unmounts the whole dollhouse and the
  // visitor loses the building. Skip, and report having changed nothing.
  if (
    typeof root.updateMatrixWorld !== "function" ||
    typeof root.traverse !== "function"
  ) {
    return {
      ...EMPTY_OUTCOME,
      meshes: 0,
      meshesSampled: 0,
      islands: EMPTY_ISLAND_OUTCOME,
      elapsedMs: 0,
    };
  }
  root.updateMatrixWorld(true);
  const rootInverse = new Matrix4().copy(root.matrixWorld).invert();

  let meshes = 0;
  let meshesSampled = 0;
  let trianglesBefore = 0;
  let tearsRemoved = 0;
  let alreadyPruned = 0;
  const chunks: ShellChunk[] = [];

  root.traverse((object) => {
    if (!hasGeometry(object)) {
      return;
    }
    const { geometry } = object;
    if (geometry.getIndex() === null) {
      return;
    }
    meshes += 1;
    // Every chunk joins the island pass regardless, because that pass judges
    // components across chunks and a chunk held back would sever the surface
    // its neighbours weld to — turning a wall into debris.
    const toShellFrame = new Matrix4().multiplyMatrices(rootInverse, object.matrixWorld);
    chunks.push({ geometry, toShellFrame });
    if (geometry.userData[PRUNED_FLAG] === true) {
      alreadyPruned += 1;
      trianglesBefore += Math.floor((geometry.getIndex()?.count ?? 0) / 3);
      return;
    }
    const grid = readTextureGrid(colorMapOf(object.material), thresholds.textureGridSize);
    if (grid !== null) {
      meshesSampled += 1;
    }
    const outcome = pruneShellGeometry(geometry, toShellFrame, grid, thresholds);
    geometry.userData[PRUNED_FLAG] = true;
    trianglesBefore += outcome.trianglesBefore;
    tearsRemoved += outcome.tearsRemoved;
  });

  // A scene drei has handed back from cache is already repaired; re-welding
  // 330k vertices to discover that would cost a second of the visitor's time
  // for nothing.
  const islands =
    alreadyPruned === meshes && meshes > 0
      ? EMPTY_ISLAND_OUTCOME
      : pruneShellIslands(chunks, thresholds);

  let trianglesAfter = 0;
  for (const chunk of chunks) {
    trianglesAfter += Math.floor((chunk.geometry.getIndex()?.count ?? 0) / 3);
  }

  return {
    meshes,
    meshesSampled,
    trianglesBefore,
    trianglesAfter,
    tearsRemoved,
    islands,
    elapsedMs: Date.now() - startedAt,
  };
}
