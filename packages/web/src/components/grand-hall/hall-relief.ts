// ---------------------------------------------------------------------------
// The walls' relief, as scanned
//
// Every wall is a height field measured from the survey's dollhouse mesh: how
// far each point of the wall stands proud of (or sits behind) the plaster
// plane — pilasters, doorcases, portraits in their frames, the deacons'
// boards, the chimneypiece, the curtains in the windows and the glazing deep
// behind them. tools/grand-hall-survey meshes each wall's depth map and
// simplifies it to within 5 mm, then packs the four meshes into one file:
//
//   "GHR1", u32 wall count, then per wall (4-byte aligned):
//   char[12] wall id, u32 vertex count, u32 triangle count, u32 index bytes,
//   f32[6] ranges (u0 u1 v0 v1 depth0 depth1),
//   u16[vertices × 3] quantised (u, v, depth), indices (u16 | u32)
//
// Positions are wall-local: u along the wall, v up, depth into the room.
// ---------------------------------------------------------------------------

import { hallSurveyUrl } from "./hall-photos.js";
import { HALL_WALLS, type HallWallId } from "./hall-spec.js";

export const WALL_RELIEF_URL = hallSurveyUrl("walls-relief.bin");

export interface WallReliefMesh {
  readonly wall: HallWallId;
  /** (u, v, depth) per vertex, metres. */
  readonly positions: Float32Array;
  /** Three per triangle, counter-clockwise seen from the room. */
  readonly indices: Uint32Array;
}

export type WallRelief = ReadonlyMap<HallWallId, WallReliefMesh>;

const MAGIC = [0x47, 0x48, 0x52, 0x31] as const;
const HEADER_BYTES = 48;

function isWallId(id: string): id is HallWallId {
  return HALL_WALLS.some((wall) => wall.id === id);
}

function align(offset: number): number {
  return (offset + 3) & ~3;
}

function fail(reason: string): never {
  throw new Error(`Grand Hall wall relief: ${reason}`);
}

/** Reads the packed relief, rejecting anything malformed. */
export function parseWallRelief(buffer: ArrayBuffer): WallRelief {
  const view = new DataView(buffer);
  if (buffer.byteLength < 8 || MAGIC.some((byte, i) => view.getUint8(i) !== byte)) fail("not a relief file");
  const count = view.getUint32(4, true);
  if (count > HALL_WALLS.length) fail(`${String(count)} walls`);
  const walls = new Map<HallWallId, WallReliefMesh>();
  let offset = 8;
  for (let w = 0; w < count; w++) {
    if (offset + HEADER_BYTES > buffer.byteLength) fail("truncated header");
    const id = new TextDecoder("ascii").decode(new Uint8Array(buffer, offset, 12)).replace(/\0+$/, "");
    if (!isWallId(id)) fail(`unknown wall "${id}"`);
    if (walls.has(id)) fail(`wall "${id}" twice`);
    const vertexCount = view.getUint32(offset + 12, true);
    const triangleCount = view.getUint32(offset + 16, true);
    const indexBytes = view.getUint32(offset + 20, true);
    if (indexBytes !== 2 && indexBytes !== 4) fail(`index size ${String(indexBytes)}`);
    if (indexBytes === 2 && vertexCount > 65536) fail("16-bit indices for too many vertices");
    const ranges = [0, 1, 2, 3, 4, 5].map((i) => view.getFloat32(offset + 24 + i * 4, true));
    for (let axis = 0; axis < 3; axis++) {
      const lo = ranges[axis * 2] ?? Number.NaN;
      const hi = ranges[axis * 2 + 1] ?? Number.NaN;
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) fail(`range ${String(lo)}..${String(hi)}`);
    }
    offset += HEADER_BYTES;
    const vertexBytes = vertexCount * 6;
    const indexTotal = triangleCount * 3 * indexBytes;
    if (offset + vertexBytes > buffer.byteLength) fail("truncated vertices");
    const quantised = new Uint16Array(buffer.slice(offset, offset + vertexBytes));
    offset = align(offset + vertexBytes);
    if (offset + indexTotal > buffer.byteLength) fail("truncated indices");
    const rawIndices = indexBytes === 2
      ? new Uint16Array(buffer.slice(offset, offset + indexTotal))
      : new Uint32Array(buffer.slice(offset, offset + indexTotal));
    offset = align(offset + indexTotal);
    const positions = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount * 3; i++) {
      const axis = i % 3;
      const lo = ranges[axis * 2] ?? 0;
      const hi = ranges[axis * 2 + 1] ?? 0;
      positions[i] = lo + ((quantised[i] ?? 0) / 65535) * (hi - lo);
    }
    const indices = Uint32Array.from(rawIndices);
    for (const index of indices) if (index >= vertexCount) fail(`index ${String(index)} past ${String(vertexCount)} vertices`);
    walls.set(id, { wall: id, positions, indices });
  }
  return walls;
}

let pending: Promise<WallRelief> | null = null;

/** Fetches the relief once per page; a failure lets a later call retry. */
export function loadWallRelief(): Promise<WallRelief> {
  pending ??= fetch(WALL_RELIEF_URL)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Grand Hall wall relief: HTTP ${String(response.status)}`);
      return parseWallRelief(await response.arrayBuffer());
    })
    .catch((error: unknown) => {
      pending = null;
      throw error;
    });
  return pending;
}
