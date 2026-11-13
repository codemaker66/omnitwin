// ---------------------------------------------------------------------------
// The Grand Hall's floor: oak strips, drawn per pixel
//
// The survey's floor photograph is washed out by the windows' glare and
// blurred where stations overlapped, so the floor is drawn instead, to the
// floor's own measurements: oak strips 73 mm wide (the spacing of the board
// seams in the survey's floor image, 8.3 mm a pixel) running the length of
// the hall, in honey tones with each board its own, end joints staggered row
// by row, and a satin varnish that reflects the room. Its diffuse light is the
// hall's own baked light, like every other surface, so it changes with the
// mood; furniture grounds itself on it with contact shadows and occlusion.
//
// Everything is computed from the fragment's world position, so the boards
// are crisp at any distance and never repeat; the grain is one small texture
// generated on first use and offset per board.
// ---------------------------------------------------------------------------

import { Color, DataTexture, LinearFilter, LinearMipmapLinearFilter, RedFormat, RepeatWrapping, UnsignedByteType } from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { dFdx, dFdy, float, floor, fract, fwidth, hash, mix, positionWorld, smoothstep, texture, vec2, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";

/** Width of one oak strip, metres (seam spacing measured on the survey's floor image). */
export const FLOOR_BOARD_WIDTH = 0.073;
/** The gap between strips and at their end joints, metres. */
export const FLOOR_SEAM = 0.0016;
/**
 * Where each part of the pattern gives way to its average, in boards per pixel
 * across the strips. The 1.6 mm seams would alias first, so they fade into the
 * darkening they average to while a board is still a few pixels wide; a board's
 * own tone and grain read as a mosaic until boards are about a pixel wide. The
 * floor stays boards into the distance instead of changing pattern part way
 * across, as one early fade of everything made it do.
 */
export const FLOOR_DETAIL_FADE = { seams: [0.2, 0.6], tone: [0.45, 1.5] } as const;
/** Shortest and longest board in a row, metres. */
export const FLOOR_BOARD_LENGTH: readonly [number, number] = [0.55, 1.45];
/** How much of the board the grain texture spans along and across, metres. */
const GRAIN_SPAN: readonly [number, number] = [1.6, 0.3];
/** How far each row's end joints are shifted along the hall, at most, metres. */
const ROW_STAGGER = 11.0;

/**
 * Added to every row and column index before it seeds three's hash(), which
 * reads its seed as an unsigned integer (`seed.toUint()`, WGSL `u32()`): a
 * negative float becomes 0 and a fraction is dropped. Rows count negative
 * across the window half of the hall (z < 0) and columns toward the fireplace,
 * so without the offset nearly every row of that half drew the same stagger
 * and the same board length, and their boards a handful of repeating tones.
 * Raised by this much, every index in the hall is positive, and every seed
 * stays under 2^24, where a float still holds whole numbers exactly.
 */
export const FLOOR_SEED_OFFSET = 4096;

/** Each value the pattern draws from the hash, as row and column multipliers and an offset. */
const FLOOR_SEEDS = {
  stagger: { row: 1, column: 0, add: 17.31 },
  length: { row: 3.17, column: 0, add: 5.9 },
  tone: { row: 127.1, column: 311.7, add: 0 },
  figure: { row: 269.5, column: 183.3, add: 7.0 },
} as const;

type FloorSeedName = keyof typeof FLOOR_SEEDS;

/** The seed one value is hashed from, for a row and column already raised by FLOOR_SEED_OFFSET. */
function seedValue(name: FloorSeedName, row: number, column: number): number {
  const seed = FLOOR_SEEDS[name];
  return row * seed.row + column * seed.column + seed.add;
}

/** The same seed in the shader (a row's own values take no column). */
function seedNode(name: FloorSeedName, row: Node<"float">, column?: Node<"float">): Node<"float"> {
  const seed = FLOOR_SEEDS[name];
  const fromRow = row.mul(seed.row);
  const fromBoth = column === undefined || seed.column === 0 ? fromRow : fromRow.add(column.mul(seed.column));
  return fromBoth.add(seed.add);
}

/**
 * three r186's hash() on the CPU, in [0, 1): the seed converted to u32 as WGSL
 * does (truncated; negative to 0), then the PCG steps in 32-bit arithmetic.
 */
export function floorHash(seed: number): number {
  const integer = seed > 0 ? Math.min(4294967295, Math.trunc(Math.fround(seed))) : 0;
  const state = (Math.imul(integer >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  const result = ((word >>> 22) ^ word) >>> 0;
  return Math.fround(result) / 4294967296;
}

/** The seeds the floor hashes at a floor point, and the row and column they come from. */
export interface FloorSeedInputs {
  /** Row and column indices as raised by FLOOR_SEED_OFFSET. */
  readonly row: number;
  readonly column: number;
  readonly stagger: number;
  readonly length: number;
  readonly tone: number;
  readonly figure: number;
}

/**
 * The hash seeds of the board under (x, z), computed as the shader computes
 * them (oakFloorNodes), so tests can hold every seed in the hall above zero.
 */
export function floorSeedInputs(x: number, z: number): FloorSeedInputs {
  const row = Math.floor(z / FLOOR_BOARD_WIDTH) + FLOOR_SEED_OFFSET;
  const stagger = seedValue("stagger", row, 0);
  const length = seedValue("length", row, 0);
  const boardLength = FLOOR_BOARD_LENGTH[0] + (FLOOR_BOARD_LENGTH[1] - FLOOR_BOARD_LENGTH[0]) * floorHash(length);
  const column = Math.floor((x + floorHash(stagger) * ROW_STAGGER) / boardLength) + FLOOR_SEED_OFFSET;
  return { row, column, stagger, length, tone: seedValue("tone", row, column), figure: seedValue("figure", row, column) };
}

/** Honey oak in three tones (sRGB), from the panoramas' boards in daylight. */
const OAK = {
  pale: new Color("#d3b07e"),
  honey: new Color("#bb9363"),
  amber: new Color("#9a7248"),
  seam: new Color("#2e2216"),
} as const;

const GRAIN_SIZE: readonly [number, number] = [1024, 192];

/** Periodic value noise on an integer lattice, so the texture tiles. */
function latticeNoise(width: number, height: number, cellsX: number, cellsY: number, seed: number): Float32Array {
  const lattice = new Float32Array(cellsX * cellsY);
  let state = seed >>> 0;
  for (let i = 0; i < lattice.length; i++) {
    // xorshift32
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    lattice[i] = state / 4294967296;
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const gy = (y / height) * cellsY;
    const y0 = Math.floor(gy);
    const ty = gy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    const r0 = (y0 % cellsY) * cellsX;
    const r1 = ((y0 + 1) % cellsY) * cellsX;
    for (let x = 0; x < width; x++) {
      const gx = (x / width) * cellsX;
      const x0 = Math.floor(gx);
      const tx = gx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const c0 = x0 % cellsX;
      const c1 = (x0 + 1) % cellsX;
      const a = lattice[r0 + c0] ?? 0;
      const b = lattice[r0 + c1] ?? 0;
      const c = lattice[r1 + c0] ?? 0;
      const d = lattice[r1 + c1] ?? 0;
      out[y * width + x] = (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
    }
  }
  return out;
}

/**
 * Oak grain as a tiling grey texture: long streaks along the board (low
 * frequency along, high across), a slow figure, and the short pale rays
 * that quarter-sawn oak shows.
 */
export function generateOakGrain(width = GRAIN_SIZE[0], height = GRAIN_SIZE[1]): Uint8Array {
  const streaks = latticeNoise(width, height, 24, 96, 0x9e3779b9);
  const fine = latticeNoise(width, height, 64, 160, 0x7f4a7c15);
  const figure = latticeNoise(width, height, 6, 12, 0x94d049bb);
  const rays = latticeNoise(width, height, 160, 40, 0x2545f491);
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    const streak = streaks[i] ?? 0;
    const f = fine[i] ?? 0;
    const fig = figure[i] ?? 0;
    const ray = Math.max(0, (rays[i] ?? 0) - 0.82) * 4.5;
    // Grain lines are the sharpened streaks; the figure bends their strength.
    const lines = Math.pow(Math.abs(Math.sin((streak * 9 + fig * 3) * Math.PI)), 6);
    const value = 0.55 + 0.25 * (f - 0.5) + 0.22 * (fig - 0.5) - 0.32 * lines + 0.35 * ray;
    data[i] = Math.max(0, Math.min(255, Math.round(value * 255)));
  }
  return data;
}

let grainTexture: DataTexture | null = null;

/** The shared grain texture, generated on first use (never disposed: one per page). */
export function oakGrainTexture(): DataTexture {
  if (grainTexture !== null) return grainTexture;
  const [width, height] = GRAIN_SIZE;
  const created = new DataTexture(generateOakGrain(width, height), width, height, RedFormat, UnsignedByteType);
  created.wrapS = RepeatWrapping;
  created.wrapT = RepeatWrapping;
  created.magFilter = LinearFilter;
  created.minFilter = LinearMipmapLinearFilter;
  created.generateMipmaps = true;
  created.anisotropy = 8;
  created.needsUpdate = true;
  created.name = "grand-hall-oak-grain";
  grainTexture = created;
  return created;
}

/** Coverage of a seam line of half-width `half` at coordinate `d` (distance to it), antialiased. */
function seamCoverage(distance: Node<"float">, half: number): Node<"float"> {
  const width = fwidth(distance).max(1e-5);
  return float(1).sub(smoothstep(float(half).sub(width), float(half).add(width), distance));
}

export interface OakFloorNodes {
  /** Albedo in linear light. */
  readonly albedo: Node<"vec3">;
  readonly roughness: Node<"float">;
}

/** Albedo and roughness of the oak floor at the fragment's world position. */
export function oakFloorNodes(): OakFloorNodes {
  const p = positionWorld.xz;
  // Rows across the hall (z); boards along it (x).
  const across = p.y.div(FLOOR_BOARD_WIDTH);
  // Row and column indices raised clear of zero before they seed the hash
  // (FLOOR_SEED_OFFSET), so both halves of the hall draw their own boards.
  const row = floor(across).add(FLOOR_SEED_OFFSET);
  const v = fract(across);
  const rowSeed = hash(seedNode("stagger", row));
  const length = mix(float(FLOOR_BOARD_LENGTH[0]), float(FLOOR_BOARD_LENGTH[1]), hash(seedNode("length", row)));
  const along = p.x.add(rowSeed.mul(ROW_STAGGER)).div(length);
  const column = floor(along).add(FLOOR_SEED_OFFSET);
  const u = fract(along);
  const board = hash(seedNode("tone", row, column));
  const boardB = hash(seedNode("figure", row, column));

  // Grain: the shared texture, offset and flipped per board.
  const grainUv = vec2(
    p.x.div(GRAIN_SPAN[0]).add(board.mul(37.0)),
    v.mul(FLOOR_BOARD_WIDTH / GRAIN_SPAN[1]).add(boardB.mul(5.0)),
  );
  // The offset jumps at every seam, and a mip level taken from it would jump to
  // the coarsest along each one: take it from the continuous floor instead.
  const continuousUv = vec2(p.x.div(GRAIN_SPAN[0]), p.y.div(GRAIN_SPAN[1]));
  const grain = texture(oakGrainTexture(), grainUv).grad(dFdx(continuousUv), dFdy(continuousUv)).r;

  // Where boards grow too small to resolve, each part of the pattern fades
  // toward its average (FLOOR_DETAIL_FADE): the seams first, the tones later.
  const boardsPerPixel = fwidth(across);
  const seamDetail = float(1).sub(smoothstep(FLOOR_DETAIL_FADE.seams[0], FLOOR_DETAIL_FADE.seams[1], boardsPerPixel));
  const detail = float(1).sub(smoothstep(FLOOR_DETAIL_FADE.tone[0], FLOOR_DETAIL_FADE.tone[1], boardsPerPixel));

  // Tone: honey throughout, a few boards a shade paler or deeper.
  const tone = board.sub(0.5).mul(detail).add(0.5);
  const honey = vec3(OAK.honey.r, OAK.honey.g, OAK.honey.b);
  const toward = mix(vec3(OAK.amber.r, OAK.amber.g, OAK.amber.b), vec3(OAK.pale.r, OAK.pale.g, OAK.pale.b), smoothstep(0.0, 1.0, tone));
  const base = mix(honey, toward, smoothstep(0.5, 1.0, tone.sub(0.5).abs().mul(2)).mul(0.36));
  // Grain darkens and lightens within a board; light falls off a little at its ends.
  const figure = grain.sub(0.5).mul(detail.mul(0.38)).add(1.0);
  const endShade = smoothstep(0.0, 0.06, u).mul(smoothstep(1.0, 0.94, u)).mul(detail.mul(0.06)).add(float(1).sub(detail.mul(0.06)));
  const boardColour = base.mul(figure).mul(endShade).mul(boardB.sub(0.5).mul(detail.mul(0.06)).add(1.0));

  // Seams along each strip and at each end joint.
  const sideDistance = v.min(float(1).sub(v)).mul(FLOOR_BOARD_WIDTH);
  const endDistance = u.min(float(1).sub(u)).mul(length);
  const seam = seamCoverage(sideDistance, FLOOR_SEAM * 0.5).max(seamCoverage(endDistance, FLOOR_SEAM * 0.5)).mul(seamDetail);
  // Unresolved seams still darken the floor by the share of it they cover.
  const seamShare = float(1).sub(seamDetail).mul(FLOOR_SEAM / FLOOR_BOARD_WIDTH);
  const albedo = mix(boardColour, vec3(OAK.seam.r, OAK.seam.g, OAK.seam.b), seam.mul(0.85).add(seamShare));

  // Satin varnish: a little rougher across worn boards and in the seams.
  const roughness = float(0.3).add(boardB.sub(0.5).mul(detail.mul(0.08))).add(grain.sub(0.5).mul(0.05)).add(seam.mul(0.4));
  return { albedo, roughness };
}

/**
 * The floor's material: oak lit by `irradiance` (the hall's baked light for the
 * current mood), glossy enough to reflect the room's environment and the
 * chandeliers' highlights.
 */
export function createOakFloorMaterial(irradiance: Node<"vec3">, chandeliersAway: Node<"float"> | null = null): MeshStandardNodeMaterial {
  const { albedo, roughness } = oakFloorNodes();
  const material = new MeshStandardNodeMaterial({ metalness: 0, fog: false });
  // Diffuse light is baked: the floor's real-time lights add only reflections.
  material.colorNode = vec3(0);
  material.emissiveNode = albedo.mul(irradiance);
  // Where the chandeliers are not drawn (`chandeliersAway` 1: in Plan, and in
  // the overview from high up), their sharp reflections straight below them
  // read as five spotlights on the floor with nothing to cast them: there the
  // varnish's reflections soften into the floor's sheen.
  material.roughnessNode = chandeliersAway === null ? roughness : mix(roughness, float(PLAN_FLOOR_ROUGHNESS), chandeliersAway);
  return material;
}

/** The floor's roughness where the chandeliers whose reflections it carries are not drawn. */
export const PLAN_FLOOR_ROUGHNESS = 0.62;
