import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// ---------------------------------------------------------------------------
// Crafted furniture geometry
//
// Every helper returns an indexed geometry with exactly position, normal and
// uv, so parts that share a material always merge (here, and again in the
// instancing harvest). UVs are in metres; the shared textures carry their
// real tile size, so wood grain, weave and felt keep one texel density on
// every part of every model.
// ---------------------------------------------------------------------------

export type Vec3 = readonly [number, number, number];

/** Deterministic random in [0, 1) for a seed and index. */
export function seeded(seed: number, index: number): number {
  let h = (seed * 2654435761 + index * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Keeps only position, normal and uv, indexed, so any two parts can merge. */
export function normalizeAttributes(source: BufferGeometry): BufferGeometry {
  let geometry = source;
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== "position" && name !== "normal" && name !== "uv") geometry.deleteAttribute(name);
  }
  if (!geometry.hasAttribute("normal")) geometry.computeVertexNormals();
  if (!geometry.hasAttribute("uv")) {
    const count = geometry.getAttribute("position").count;
    geometry.setAttribute("uv", new Float32BufferAttribute(new Float32Array(count * 2), 2));
  }
  if (geometry.index === null) {
    const indexed = mergeVertices(geometry);
    if (indexed !== geometry) source.dispose();
    geometry = indexed;
  }
  geometry.clearGroups();
  return geometry;
}

/**
 * Replaces UVs with metric box projection: each vertex takes the two world
 * axes across its dominant normal, so texel density is uniform. `grain`
 * chooses which axis the texture's u follows on faces that contain it.
 */
export function boxProjectUvs(geometry: BufferGeometry, grain: "x" | "y" | "z" = "x"): BufferGeometry {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = new Float32Array(position.count * 2);
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const nx = Math.abs(normal.getX(index));
    const ny = Math.abs(normal.getY(index));
    const nz = Math.abs(normal.getZ(index));
    let u: number;
    let v: number;
    if (nx >= ny && nx >= nz) {
      // Face across x: axes z and y.
      [u, v] = grain === "y" ? [y, z] : [z, y];
    } else if (ny >= nz) {
      // Face across y: axes x and z.
      [u, v] = grain === "z" ? [z, x] : [x, z];
    } else {
      // Face across z: axes x and y.
      [u, v] = grain === "y" ? [y, x] : [x, y];
    }
    uv[index * 2] = u;
    uv[index * 2 + 1] = v;
  }
  geometry.setAttribute("uv", new BufferAttribute(uv, 2));
  return geometry;
}

/** A box with rounded edges, centred on `centre`, metric UVs. */
export function roundedBox(
  size: Vec3,
  radius: number,
  centre: Vec3 = [0, 0, 0],
  options: { readonly segments?: number; readonly grain?: "x" | "y" | "z" } = {},
): BufferGeometry {
  const r = Math.max(0.0005, Math.min(radius, size[0] / 2 - 1e-4, size[1] / 2 - 1e-4, size[2] / 2 - 1e-4));
  const geometry = new RoundedBoxGeometry(size[0], size[1], size[2], options.segments ?? 2, r);
  geometry.translate(centre[0], centre[1], centre[2]);
  return normalizeAttributes(boxProjectUvs(geometry, options.grain ?? "x"));
}

export interface TubeOptions {
  /** Points along the tube's centre line. */
  readonly points: readonly Vec3[];
  readonly radius: number;
  /** Segments per metre of length (at least 8 in total). */
  readonly segmentsPerMetre?: number;
  readonly radialSegments?: number;
  /** Curve tension; low values keep bends tight like bent steel. */
  readonly tension?: number;
  readonly closed?: boolean;
}

/** A tube along a smooth curve through `points`, like a bent steel frame. */
export function tube(options: TubeOptions): BufferGeometry {
  const curve = new CatmullRomCurve3(
    options.points.map(([x, y, z]) => new Vector3(x, y, z)),
    options.closed ?? false,
    "catmullrom",
    options.tension ?? 0.15,
  );
  const length = curve.getLength();
  const segments = Math.max(8, Math.round(length * (options.segmentsPerMetre ?? 60)));
  const radial = options.radialSegments ?? 10;
  const geometry = new TubeGeometry(curve, segments, options.radius, radial, options.closed ?? false);
  // Metric UVs: u along the tube, v around it.
  const uv = geometry.getAttribute("uv");
  for (let index = 0; index < uv.count; index += 1) {
    uv.setXY(index, uv.getX(index) * length, uv.getY(index) * Math.PI * 2 * options.radius);
  }
  return normalizeAttributes(geometry);
}

/** A short cylinder (foot glide, castor, post) between two heights at (x, z). */
export function post(
  centre: readonly [number, number],
  bottom: number,
  top: number,
  radiusBottom: number,
  radiusTop: number = radiusBottom,
  radialSegments = 14,
): BufferGeometry {
  const height = Math.max(1e-4, top - bottom);
  const geometry = new CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, 1, false);
  geometry.translate(centre[0], bottom + height / 2, centre[1]);
  return normalizeAttributes(geometry);
}

/** A surface of revolution about the y axis from a [radius, y] profile (top to bottom or bottom to top). */
export function lathe(profile: readonly (readonly [number, number])[], segments = 48): BufferGeometry {
  const points = profile.map(([r, y]) => new Vector2(Math.max(0, r), y));
  const geometry = new LatheGeometry(points, segments);
  // Metric UVs: u around the widest circumference, v along the profile.
  let arc = 0;
  const arcs = [0];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a !== undefined && b !== undefined) arc += a.distanceTo(b);
    arcs.push(arc);
  }
  const widest = Math.max(...points.map((p) => p.x));
  const uv = geometry.getAttribute("uv");
  for (let index = 0; index < uv.count; index += 1) {
    const ring = index % points.length;
    uv.setXY(index, uv.getX(index) * Math.PI * 2 * widest, arcs[ring] ?? 0);
  }
  return normalizeAttributes(geometry);
}

/** mergeGeometries returns null when attribute sets differ, though its typings omit it. */
function tryMerge(geometries: BufferGeometry[]): BufferGeometry | null {
  return mergeGeometries(geometries, false);
}

/** Merges same-material parts into one geometry; disposes the inputs. */
export function mergeParts(parts: readonly BufferGeometry[]): BufferGeometry {
  if (parts.length === 1) {
    const only = parts[0];
    if (only !== undefined) return only;
  }
  const merged = tryMerge(parts.map(normalizeAttributes));
  for (const part of parts) part.dispose();
  if (merged === null) throw new Error("Crafted furniture parts could not be merged");
  return merged;
}

// ---------------------------------------------------------------------------
// Grids: a cloth or panel surface sampled on a (columns × rows) lattice.
// ---------------------------------------------------------------------------

/**
 * Builds an indexed surface from a grid of points (rows of equal length).
 * `closed` joins the last column to the first; a duplicate seam column keeps
 * the UVs continuous and its normals are averaged with the first column's.
 * Triangles face the side the right-hand rule gives for (column, row) order.
 */
export function gridSurface(
  rows: readonly (readonly Vec3[])[],
  uvs: readonly (readonly (readonly [number, number])[])[],
  options: { readonly closed?: boolean; readonly flip?: boolean } = {},
): BufferGeometry {
  const rowCount = rows.length;
  const columns = rows[0]?.length ?? 0;
  const positions = new Float32Array(rowCount * columns * 3);
  const uvArray = new Float32Array(rowCount * columns * 2);
  rows.forEach((row, r) => {
    row.forEach(([x, y, z], c) => {
      const index = r * columns + c;
      positions[index * 3] = x;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = z;
      const [u, v] = uvs[r]?.[c] ?? [0, 0];
      uvArray[index * 2] = u;
      uvArray[index * 2 + 1] = v;
    });
  });
  const indices: number[] = [];
  for (let r = 0; r < rowCount - 1; r += 1) {
    for (let c = 0; c < columns - 1; c += 1) {
      const a = r * columns + c;
      const b = a + 1;
      const d = a + columns;
      const e = d + 1;
      if (options.flip === true) indices.push(a, b, d, b, e, d);
      else indices.push(a, d, b, b, d, e);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvArray, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  if (options.closed === true) {
    // The first and last columns are the same points: share their normals.
    const normal = geometry.getAttribute("normal");
    const n = new Vector3();
    for (let r = 0; r < rowCount; r += 1) {
      const first = r * columns;
      const last = first + columns - 1;
      n.set(
        normal.getX(first) + normal.getX(last),
        normal.getY(first) + normal.getY(last),
        normal.getZ(first) + normal.getZ(last),
      ).normalize();
      normal.setXYZ(first, n.x, n.y, n.z);
      normal.setXYZ(last, n.x, n.y, n.z);
    }
  }
  return geometry;
}

// ---------------------------------------------------------------------------
// Cloth
// ---------------------------------------------------------------------------

/** Smoothly varying fold offset around a closed loop: irregular rounded folds. */
export function foldWave(phase: number, folds: number, seed: number, irregularity = 0.55): number {
  // A main fold frequency whose phase drifts slowly around the loop, plus a
  // softer second harmonic, gives folds of varied width and depth.
  const drift = Math.sin(phase + seeded(seed, 1) * 6.283) * irregularity
    + Math.sin(2 * phase + seeded(seed, 2) * 6.283) * irregularity * 0.5;
  const main = Math.sin(folds * phase + drift * 2.2 + seeded(seed, 3) * 6.283);
  const second = Math.sin((folds + 3) * phase + seeded(seed, 4) * 6.283) * 0.35;
  const depth = 0.75 + 0.25 * Math.sin(3 * phase + seeded(seed, 5) * 6.283);
  return (main + second) / 1.35 * depth;
}

/**
 * Angles round a cloth's roll over a table's edge, from the top's plane to
 * hanging straight down. A first small step keeps the normals where the
 * roll meets the flat top within a degree or two of upright, so the join
 * between the two surfaces (clothSurface) does not show.
 */
function rollAngles(steps: number): number[] {
  const angles = [0.05];
  for (let i = 1; i <= steps; i += 1) angles.push((i / steps) * (Math.PI / 2));
  return angles;
}

/**
 * A cloth from its rows: the flat top (rows up to `topRings`) mapped flat in
 * plan, so the weave keeps its scale right to the middle of the table; the
 * rest mapped along the outline and down the drop. The two share the edge
 * ring's positions, so they meet without a crack.
 */
function clothSurface(
  rows: readonly (readonly Vec3[])[],
  uvs: readonly (readonly (readonly [number, number])[])[],
  topRings: number,
): BufferGeometry {
  const topRows = rows.slice(0, topRings + 1);
  const topUvs = topRows.map((row) => row.map(([x, , z]): readonly [number, number] => [x, z]));
  const parts = [
    gridSurface(topRows, topUvs, { closed: true, flip: true }),
    gridSurface(rows.slice(topRings), uvs.slice(topRings), { closed: true, flip: true }),
  ];
  const merged = tryMerge(parts);
  for (const part of parts) part.dispose();
  if (merged === null) throw new Error("Cloth surfaces could not be merged");
  return merged;
}

export interface RoundClothOptions {
  /** Radius of the table top the cloth lies on. */
  readonly radius: number;
  /** Height of the table top. */
  readonly top: number;
  /** Height of the hem at a fold's crest. */
  readonly hem: number;
  /** Radius of the roll over the table's edge. */
  readonly edge?: number;
  /** How far the crests flare out by the hem. */
  readonly flare?: number;
  /** Number of folds around the cloth. */
  readonly folds: number;
  /** Fold amplitude at the hem (radial, metres): half the crest-to-trough depth. */
  readonly foldDepth: number;
  /**
   * Where a fold's centre line sits: 0 centres the folds on the table's
   * edge; 1 keeps every crest within the flare and folds the cloth inward
   * only. Chairs pulled up to a table need crests that stay close.
   */
  readonly inward?: number;
  /** How quickly folds open below the edge: an exponent on the drop. */
  readonly growth?: number;
  /** How irregular the folds are, from 0 (even) to about 1. */
  readonly irregularity?: number;
  /**
   * Fold profile, from 1 (a sine) to 0.5 (rounded crests between sharp
   * creases, the way heavy linen hangs).
   */
  readonly crease?: number;
  /** How far the hem lifts in a fold's trough. */
  readonly hemLift?: number;
  /** Slow vertical undulation of the hem, for a cloth that does not reach the floor. */
  readonly hemWave?: number;
  readonly seed?: number;
  /** Columns per fold; enough to keep a deep fold smoothly shaded. */
  readonly samplesPerFold?: number;
  readonly rows?: number;
}

/**
 * A round cloth: a flat top, a roll over the edge, and a skirt whose spare
 * fabric gathers into folds as it falls. A cloth's circumference grows with
 * every centimetre it drops while the table it hangs from does not, so its
 * folds open from nothing at the edge to their full depth at the hem.
 */
export function roundCloth(options: RoundClothOptions): BufferGeometry {
  const samplesPerFold = options.samplesPerFold ?? 12;
  const segments = Math.max(96, Math.round(options.folds * samplesPerFold));
  const skirtRows = options.rows ?? 18;
  const edge = options.edge ?? 0.018;
  const flare = options.flare ?? 0.02;
  const inward = options.inward ?? 0.5;
  const growth = options.growth ?? 0.65;
  const irregularity = options.irregularity ?? 0.35;
  const crease = options.crease ?? 0.6;
  const hemLift = options.hemLift ?? 0;
  const hemWave = options.hemWave ?? 0;
  const seed = options.seed ?? 1;
  const r = options.radius;
  const skirtTop = options.top - edge;
  const drop = Math.max(0.01, skirtTop - options.hem);

  // The profile: rings across the top, around the edge roll, down the skirt.
  interface Ring { readonly radius: number; readonly y: number; readonly t: number }
  const profile: Ring[] = [];
  const topRings = 3;
  for (let i = 0; i <= topRings; i += 1) {
    profile.push({ radius: (r - edge) * Math.sqrt(i / topRings), y: options.top, t: 0 });
  }
  for (const a of rollAngles(4)) {
    profile.push({ radius: r - edge + Math.sin(a) * edge, y: skirtTop + Math.cos(a) * edge, t: 0 });
  }
  for (let i = 1; i <= skirtRows; i += 1) {
    // Rows bunch towards the edge, where the folds are born.
    const t = Math.pow(i / skirtRows, 1.25);
    profile.push({ radius: r, y: skirtTop - drop * t, t });
  }

  // Each column's fold, worked out once: its wave and its slow hem undulation.
  const waves: number[] = [];
  const hemWaves: number[] = [];
  for (let s = 0; s <= segments; s += 1) {
    const phase = (s / segments) * Math.PI * 2;
    waves.push(creased(foldWave(phase, options.folds, seed, irregularity), crease));
    hemWaves.push(foldWave(phase, 3, seed + 7, 0.8));
  }

  const rows: Vec3[][] = [];
  const uvs: [number, number][][] = [];
  let arc = 0;
  profile.forEach((ring, index) => {
    if (index > 0) {
      const previous = profile[index - 1];
      if (previous !== undefined) arc += Math.hypot(ring.radius - previous.radius, ring.y - previous.y);
    }
    const amplitude = options.foldDepth * Math.pow(ring.t, growth);
    const row: Vec3[] = [];
    const uvRow: [number, number][] = [];
    for (let s = 0; s <= segments; s += 1) {
      const phase = (s / segments) * Math.PI * 2;
      const wave = waves[s] ?? 0;
      const radius = ring.radius + ring.t * ring.t * flare + amplitude * (wave - inward);
      const lift = Math.pow(ring.t, 4) * (hemLift * (1 - wave) * 0.5 + hemWave * (hemWaves[s] ?? 0));
      row.push([Math.cos(phase) * radius, ring.y + lift, Math.sin(phase) * radius]);
      uvRow.push([phase * r, arc]);
    }
    rows.push(row);
    uvs.push(uvRow);
  });
  return clothSurface(rows, uvs, topRings);
}

export interface RectClothOptions {
  /** Table top size (x by z). */
  readonly width: number;
  readonly depth: number;
  readonly top: number;
  /** Hem height along the sides. */
  readonly hem: number;
  /** Radius of the roll over the table's edges. */
  readonly edge?: number;
  /** Corner radius of the hanging cloth at the hem: corners round as they fall. */
  readonly cornerDrape?: number;
  /** How far the sides drift out by the hem. */
  readonly flare?: number;
  /** Soft folds per metre along the sides. */
  readonly sideFolds?: number;
  /** Side fold amplitude at the hem. */
  readonly foldDepth?: number;
  /** Folds in each corner's cascade. */
  readonly cornerFolds?: number;
  /** Corner cascade amplitude at the hem. */
  readonly cornerDepth?: number;
  /** How far along the sides each corner's cascade reaches (metres). */
  readonly cornerSpread?: number;
  /** How far a corner's cascade stands out at the hem. */
  readonly cornerFlare?: number;
  /** How much lower each corner hangs than the sides, as a square cloth's corners do. */
  readonly cornerDrop?: number;
  /** How far a floor-length cloth tucks under where it meets the floor. */
  readonly pool?: number;
  /** Irregularity of the hem's height. */
  readonly hemVariation?: number;
  /** Fold profile, from 1 (a sine) to 0.5 (rounded crests between creases). */
  readonly crease?: number;
  readonly seed?: number;
  /** Columns per metre of perimeter. */
  readonly density?: number;
  readonly rows?: number;
}

/**
 * How a rounded rectangle's outline is shared between its four sides and four
 * corners. Rows built from one layout keep their vertices in the same place
 * along the outline, so a cloth's columns hang straight as its corners round.
 */
export interface OutlineLayout {
  readonly shares: readonly number[];
  readonly total: number;
}

export function outlineLayout(halfW: number, halfD: number, radius: number): OutlineLayout {
  const sideX = Math.max(0, 2 * (halfW - radius));
  const sideZ = Math.max(0, 2 * (halfD - radius));
  const arc = (Math.PI / 2) * Math.max(radius, 1e-4);
  const shares = [sideX, arc, sideZ, arc, sideX, arc, sideZ, arc];
  return { shares, total: shares.reduce((sum, value) => sum + value, 0) };
}

interface OutlinePoint {
  readonly x: number;
  readonly z: number;
  readonly nx: number;
  readonly nz: number;
  /** 1 at the middle of a corner arc, 0 along the sides. */
  readonly corner: number;
}

/** The point at `t` in [0, 1) on a rounded rectangle, placed by a fixed layout. */
export function roundedRectPoint(
  halfW: number,
  halfD: number,
  radius: number,
  t: number,
  layout: OutlineLayout = outlineLayout(halfW, halfD, radius),
): OutlinePoint {
  const r = Math.max(1e-4, Math.min(radius, halfW, halfD));
  const sideX = Math.max(0, 2 * (halfW - r));
  const sideZ = Math.max(0, 2 * (halfD - r));
  let remaining = (((t % 1) + 1) % 1) * layout.total;
  for (let segment = 0; segment < 8; segment += 1) {
    const share = layout.shares[segment] ?? 0;
    if (remaining <= share || segment === 7) {
      const f = share === 0 ? 0 : Math.min(1, remaining / share);
      const corner = segment % 2 === 1 ? Math.sin(Math.PI * f) : 0;
      switch (segment) {
        case 0: return { x: -halfW + r + f * sideX, z: -halfD, nx: 0, nz: -1, corner };
        case 2: return { x: halfW, z: -halfD + r + f * sideZ, nx: 1, nz: 0, corner };
        case 4: return { x: halfW - r - f * sideX, z: halfD, nx: 0, nz: 1, corner };
        case 6: return { x: -halfW, z: halfD - r - f * sideZ, nx: -1, nz: 0, corner };
        default: {
          const cornerIndex = (segment - 1) / 2;
          const centres: readonly (readonly [number, number])[] = [
            [halfW - r, -halfD + r],
            [halfW - r, halfD - r],
            [-halfW + r, halfD - r],
            [-halfW + r, -halfD + r],
          ];
          const startAngles = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
          const [cx, cz] = centres[cornerIndex] ?? [0, 0];
          const angle = (startAngles[cornerIndex] ?? 0) + f * (Math.PI / 2);
          return { x: cx + Math.cos(angle) * r, z: cz + Math.sin(angle) * r, nx: Math.cos(angle), nz: Math.sin(angle), corner };
        }
      }
    }
    remaining -= share;
  }
  return { x: -halfW + r, z: -halfD, nx: 0, nz: -1, corner: 0 };
}

/** Reshapes a fold wave in [-1, 1]: `crease` below 1 sharpens its troughs into creases. */
export function creased(wave: number, crease: number): number {
  const clamped = Math.max(-1, Math.min(1, wave));
  return 2 * Math.pow((1 + clamped) / 2, crease) - 1;
}

/** Signed distance (metres along the outline) from `u` to the nearest of `centres` on a loop of `total`. */
function nearestOnLoop(u: number, centres: readonly number[], total: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const centre of centres) {
    for (const candidate of [centre - total, centre, centre + total]) {
      const offset = u - candidate;
      if (Math.abs(offset) < Math.abs(best)) best = offset;
    }
  }
  return best;
}

/** Where each corner arc's middle lies along a layout, in metres from its start. */
export function layoutCornerCentres(layout: OutlineLayout): number[] {
  const centres: number[] = [];
  let run = 0;
  layout.shares.forEach((share, index) => {
    if (index % 2 === 1) centres.push(run + share / 2);
    run += share;
  });
  return centres;
}

/**
 * A rectangular cloth: a flat top, a roll over the edges, sides that fall
 * almost flat in a few soft folds, and corners where the spare cloth gathers
 * into a cascade that stands out and spreads as it reaches the hem.
 */
export function rectCloth(options: RectClothOptions): BufferGeometry {
  const edge = options.edge ?? 0.015;
  const cornerDrape = options.cornerDrape ?? 0.06;
  const flare = options.flare ?? 0.006;
  const sideFolds = options.sideFolds ?? 1.6;
  const foldDepth = options.foldDepth ?? 0.008;
  const cornerFolds = options.cornerFolds ?? 3;
  const cornerDepth = options.cornerDepth ?? 0.02;
  const cornerSpread = options.cornerSpread ?? 0.12;
  const cornerFlare = options.cornerFlare ?? 0.02;
  const cornerDrop = options.cornerDrop ?? 0;
  const pool = options.pool ?? 0;
  const hemVariation = options.hemVariation ?? 0.006;
  const crease = options.crease ?? 0.7;
  const seed = options.seed ?? 3;
  const halfW = options.width / 2;
  const halfD = options.depth / 2;
  const perimeter = 2 * (options.width + options.depth);
  const columns = Math.max(96, Math.round(perimeter * (options.density ?? 90)));
  const skirtRows = options.rows ?? 14;
  const skirtTop = options.top - edge;
  const drop = Math.max(0.01, skirtTop - options.hem);

  interface Row {
    readonly inset: number;
    readonly y: number;
    readonly radius: number;
    readonly t: number;
    /** The top's rings are the edge ring scaled towards the middle, closing on a point. */
    readonly scale: number;
  }
  const profile: Row[] = [];
  const topRings = 3;
  for (let i = 0; i <= topRings; i += 1) {
    profile.push({ inset: edge, y: options.top, radius: edge, t: 0, scale: i / topRings });
  }
  for (const a of rollAngles(3)) {
    profile.push({ inset: edge - Math.sin(a) * edge, y: skirtTop + Math.cos(a) * edge, radius: edge, t: 0, scale: 1 });
  }
  for (let i = 1; i <= skirtRows; i += 1) {
    // Rows bunch towards the edge, where the corners begin to fold.
    const t = Math.pow(i / skirtRows, 1.15);
    profile.push({ inset: 0, y: skirtTop - drop * t, radius: edge + (cornerDrape - edge) * Math.pow(t, 0.7), t, scale: 1 });
  }

  // One layout for every row, sized by the hem's rounded corners, so columns
  // keep their place along the outline from the top to the hem.
  const layout = outlineLayout(halfW, halfD, cornerDrape);
  const corners = layoutCornerCentres(layout);
  const dropSpread = 0.36 * Math.min(options.width, options.depth);
  const cascadeLength = 3 * cornerSpread;
  const sideFoldCount = Math.max(4, Math.round(perimeter * sideFolds));
  interface Column {
    readonly s: number;
    readonly u: number;
    /** 1 at a corner, falling away along the sides. */
    readonly corner: number;
    /** How much of a corner's extra drop this column takes. */
    readonly dropShape: number;
    readonly side: number;
    readonly cascade: number;
    readonly hemNoise: number;
  }
  const columnData: Column[] = [];
  for (let c = 0; c <= columns; c += 1) {
    const s = c / columns;
    const u = s * layout.total;
    const phase = s * Math.PI * 2;
    const toCorner = nearestOnLoop(u, corners, layout.total);
    columnData.push({
      s,
      u,
      corner: Math.exp(-((toCorner / cornerSpread) ** 2)),
      dropShape: Math.exp(-((toCorner / dropSpread) ** 2)),
      side: creased(foldWave(phase, sideFoldCount, seed, 0.9), crease),
      cascade: creased(Math.cos((2 * Math.PI * toCorner * cornerFolds) / cascadeLength), crease),
      hemNoise: foldWave(phase, 5, seed + 13, 0.9),
    });
  }

  const rows: Vec3[][] = [];
  const uvs: [number, number][][] = [];
  let arcV = 0;
  let previousY = profile[0]?.y ?? 0;
  let previousInset = profile[0]?.inset ?? 0;
  for (const ring of profile) {
    // (The top's rows take flat UVs in clothSurface; v counts from the edge.)
    arcV += Math.hypot(ring.y - previousY, ring.inset - previousInset);
    previousY = ring.y;
    previousInset = ring.inset;
    const w = Math.max(1e-4, halfW - ring.inset);
    const d = Math.max(1e-4, halfD - ring.inset);
    const radius = Math.min(ring.radius, w - 1e-4, d - 1e-4);
    const t = ring.t;
    // A floor-length cloth tucks under a little where it meets the floor.
    const tuck = pool * Math.pow(Math.max(0, (t - 0.85) / 0.15), 2);
    const row: Vec3[] = [];
    const uvRow: [number, number][] = [];
    for (const column of columnData) {
      const point = roundedRectPoint(w, d, Math.max(radius, 1e-4), column.s, layout);
      const out = flare * t * t
        + column.corner * cornerFlare * Math.pow(t, 1.5)
        + (1 - column.corner) * foldDepth * Math.pow(t, 1.2) * (column.side - 0.3)
        + column.corner * cornerDepth * Math.pow(t, 0.8) * column.cascade
        - tuck * (1 - column.corner);
      const y = ring.y
        - t * t * cornerDrop * column.dropShape
        + Math.pow(t, 3) * hemVariation * column.hemNoise;
      row.push([(point.x + point.nx * out) * ring.scale, Math.max(0.003, y), (point.z + point.nz * out) * ring.scale]);
      uvRow.push([column.u, arcV]);
    }
    rows.push(row);
    uvs.push(uvRow);
  }
  return clothSurface(rows, uvs, topRings);
}

export interface GatheredSkirtOptions {
  readonly width: number;
  readonly depth: number;
  /** Height of the table top. */
  readonly top: number;
  /** How far below the top the skirt is pinned. */
  readonly pinned: number;
  readonly hem: number;
  /** How far out from the table's edge the skirt hangs at its pins. */
  readonly offset?: number;
  /** Distance between folds along the skirt. */
  readonly spacing: number;
  /** Fold amplitude once the gathers have opened. */
  readonly foldDepth: number;
  /** How far below the pins the gathers take to open. */
  readonly emergeOver: number;
  readonly crease?: number;
  readonly seed?: number;
}

/** How far a layer pinned under a table's edge has come away from it, 0 to 1. */
export function emergence(below: number, pinned: number, emergeOver: number): number {
  const k = Math.max(0, Math.min(1, (below - pinned) / emergeOver));
  return k * k * (3 - 2 * k);
}

/** A gathered skirt round a rectangular table, hanging straight in even folds. */
export function gatheredSkirt(options: GatheredSkirtOptions): BufferGeometry {
  const halfW = options.width / 2;
  const halfD = options.depth / 2;
  const radius = 0.03;
  const layout = outlineLayout(halfW, halfD, radius);
  const folds = Math.max(8, Math.round(layout.total / options.spacing));
  const columns = folds * 8;
  const offset = options.offset ?? 0.002;
  const crease = options.crease ?? 0.75;
  const seed = options.seed ?? 19;
  const bottom = options.top - options.hem;
  const opened = options.pinned + options.emergeOver;
  const depths = [
    options.pinned,
    options.pinned + options.emergeOver * 0.3,
    options.pinned + options.emergeOver * 0.6,
    opened,
    opened + (bottom - opened) * 0.5,
    bottom,
  ];
  const waves: number[] = [];
  for (let c = 0; c <= columns; c += 1) waves.push(creased(foldWave((c / columns) * Math.PI * 2, folds, seed, 0.15), crease));
  const rows: Vec3[][] = [];
  const uvs: [number, number][][] = [];
  for (const below of depths) {
    const open = emergence(below, options.pinned, options.emergeOver);
    const row: Vec3[] = [];
    const uvRow: [number, number][] = [];
    for (let c = 0; c <= columns; c += 1) {
      const s = c / columns;
      const point = roundedRectPoint(halfW, halfD, radius, s, layout);
      const out = offset + open * options.foldDepth * ((waves[c] ?? 0) + 1);
      row.push([point.x + point.nx * out, options.top - below, point.z + point.nz * out]);
      uvRow.push([s * layout.total, below]);
    }
    rows.push(row);
    uvs.push(uvRow);
  }
  return gridSurface(rows, uvs, { closed: true, flip: true });
}

// ---------------------------------------------------------------------------
// Upholstery
// ---------------------------------------------------------------------------

export type Vec2 = readonly [number, number];

/**
 * Samples a closed polygon with rounded corners, counter-clockwise in (a, b),
 * with the outward normal at every sample.
 */
export function roundedOutline(
  corners: readonly Vec2[],
  radius: number,
  samplesPerCorner = 6,
  samplesPerMetre = 60,
): { readonly points: Vec2[]; readonly normals: Vec2[] } {
  const points: Vec2[] = [];
  const normals: Vec2[] = [];
  const count = corners.length;
  const arcs: { centre: Vec2; start: number; sweep: number; inStart: Vec2; outEnd: Vec2 }[] = [];
  for (let i = 0; i < count; i += 1) {
    const previous = corners[(i - 1 + count) % count] ?? [0, 0];
    const current = corners[i] ?? [0, 0];
    const next = corners[(i + 1) % count] ?? [0, 0];
    const inDir = normalize2([current[0] - previous[0], current[1] - previous[1]]);
    const outDir = normalize2([next[0] - current[0], next[1] - current[1]]);
    const turn = Math.acos(Math.max(-1, Math.min(1, inDir[0] * outDir[0] + inDir[1] * outDir[1])));
    const tangentLength = radius * Math.tan(turn / 2);
    const inStart: Vec2 = [current[0] - inDir[0] * tangentLength, current[1] - inDir[1] * tangentLength];
    const outEnd: Vec2 = [current[0] + outDir[0] * tangentLength, current[1] + outDir[1] * tangentLength];
    // Counter-clockwise: the arc centre lies to the left of the travel direction.
    const left: Vec2 = [-inDir[1], inDir[0]];
    const centre: Vec2 = [inStart[0] + left[0] * radius, inStart[1] + left[1] * radius];
    const start = Math.atan2(inStart[1] - centre[1], inStart[0] - centre[0]);
    arcs.push({ centre, start, sweep: turn, inStart, outEnd });
  }
  for (let i = 0; i < count; i += 1) {
    const arc = arcs[i];
    const nextArc = arcs[(i + 1) % count];
    if (arc === undefined || nextArc === undefined) continue;
    for (let k = 0; k <= samplesPerCorner; k += 1) {
      const angle = arc.start + (k / samplesPerCorner) * arc.sweep;
      const nx = Math.cos(angle);
      const ny = Math.sin(angle);
      points.push([arc.centre[0] + nx * radius, arc.centre[1] + ny * radius]);
      normals.push([nx, ny]);
    }
    // The straight run to the next corner's arc.
    const from = arc.outEnd;
    const to = nextArc.inStart;
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const steps = Math.max(1, Math.round(length * samplesPerMetre));
    const dir = normalize2([to[0] - from[0], to[1] - from[1]]);
    const outward: Vec2 = [dir[1], -dir[0]];
    for (let k = 1; k < steps; k += 1) {
      const f = k / steps;
      points.push([from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f]);
      normals.push(outward);
    }
  }
  return { points, normals };
}

function normalize2(v: Vec2): Vec2 {
  const length = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / length, v[1] / length];
}

export interface CushionOptions {
  /** Closed outline in the cushion's plane (a, b), counter-clockwise, with outward normals. */
  readonly outline: { readonly points: readonly Vec2[]; readonly normals: readonly Vec2[] };
  /** Full thickness, from the underside to the edge of the top. */
  readonly thickness: number;
  /** How far the top domes up at the centre. */
  readonly dome?: number;
  /** Radius of the rolled edge (at most half the thickness). */
  readonly edge?: number;
  /** Rings across the top face. */
  readonly faceRings?: number;
  /** Rings across the flat underside, which is seldom seen (defaults to faceRings). */
  readonly undersideRings?: number;
  /** Steps round the rolled edge. */
  readonly edgeSteps?: number;
}

/**
 * An upholstered cushion: a domed top, a rolled edge and a flat underside,
 * built in its own plane with the thickness along +y (top at +thickness/2).
 * UVs unfold the fabric over the edge, so a pattern wraps without a seam.
 */
export function cushion(options: CushionOptions): BufferGeometry {
  const { points, normals } = options.outline;
  const half = options.thickness / 2;
  const edge = Math.min(options.edge ?? half * 0.9, half);
  const dome = options.dome ?? 0;
  const faceRings = options.faceRings ?? 5;
  const undersideRings = Math.max(1, options.undersideRings ?? faceRings);
  const edgeSteps = options.edgeSteps ?? 8;
  // Centre of the outline, for the face rings to shrink towards.
  let ca = 0;
  let cb = 0;
  for (const [a, b] of points) {
    ca += a;
    cb += b;
  }
  ca /= points.length;
  cb /= points.length;

  interface Ring { readonly shrink: number; readonly inset: number; readonly y: number; readonly unfold: number }
  const rings: Ring[] = [];
  // Top face: from the centre out to where the edge begins to roll.
  for (let i = 0; i <= faceRings; i += 1) {
    const f = i / faceRings;
    const domeHeight = dome * (1 - f * f);
    rings.push({ shrink: f, inset: edge, y: half - edge * 0 + domeHeight, unfold: 0 });
  }
  // The rolled edge: a half round from the top face to the underside.
  for (let k = 1; k < edgeSteps; k += 1) {
    const angle = (k / edgeSteps) * Math.PI;
    rings.push({ shrink: 1, inset: edge - Math.sin(angle) * edge, y: Math.cos(angle) * half, unfold: angle * edge });
  }
  // Underside: back to the centre.
  for (let i = undersideRings; i >= 0; i -= 1) {
    const f = i / undersideRings;
    rings.push({ shrink: f, inset: edge, y: -half, unfold: Math.PI * edge + (1 - f) * 0.5 });
  }

  const rows: Vec3[][] = [];
  const uvs: [number, number][][] = [];
  const closed = points.length;
  for (const ring of rings) {
    const row: Vec3[] = [];
    const uvRow: [number, number][] = [];
    for (let s = 0; s <= closed; s += 1) {
      const p = points[s % closed] ?? [0, 0];
      const n = normals[s % closed] ?? [0, 0];
      // Inset along the normal, then shrink the face towards the centre.
      const ia = p[0] - n[0] * ring.inset;
      const ib = p[1] - n[1] * ring.inset;
      const a = ca + (ia - ca) * ring.shrink;
      const b = cb + (ib - cb) * ring.shrink;
      row.push([a, ring.y, b]);
      uvRow.push([a + n[0] * ring.unfold, b + n[1] * ring.unfold]);
    }
    rows.push(row);
    uvs.push(uvRow);
  }
  return gridSurface(rows, uvs, { closed: true, flip: true });
}
