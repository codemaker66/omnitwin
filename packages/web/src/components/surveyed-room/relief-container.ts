// ---------------------------------------------------------------------------
// GHR1 relief containers, for any surveyed room
//
// The format the Grand Hall's walls-relief.bin introduced (hall-relief.ts),
// read the same way but with any relief id: the tools write one entry per
// wall, and one for a ceiling's relief, each a height field meshed from the
// scan:
//
//   "GHR1", u32 entry count, then per entry (4-byte aligned):
//   char[12] id (ASCII, NUL-padded), u32 vertex count, u32 triangle count,
//   u32 index bytes, f32[6] ranges (u0 u1 v0 v1 depth0 depth1),
//   u16[vertices × 3] quantised (u, v, depth), indices (u16 | u32)
//
// Positions are entry-local: for a wall, u along it, v up and depth into the
// room; for a ceiling, u = planner x, v = planner z, depth down from the
// ceiling's reference height.
// ---------------------------------------------------------------------------

export interface ReliefMesh {
  readonly id: string;
  /** (u, v, depth) per vertex, metres. */
  readonly positions: Float32Array;
  /** Three per triangle. */
  readonly indices: Uint32Array;
}

export interface ReliefContainerOptions {
  /** Most entries the file may hold; more is refused. */
  readonly maxEntries?: number;
  /** Names the file in error messages. */
  readonly label?: string;
}

/** Longest relief id, in bytes: the container's id field. */
export const RELIEF_ID_BYTES = 12;

const MAGIC = [0x47, 0x48, 0x52, 0x31] as const;
const HEADER_BYTES = 48;
const RELIEF_ID = /^[\x21-\x7e]{1,12}$/;

/**
 * Whether a string can be a relief id: 1 to 12 bytes of printable ASCII
 * without spaces, so it survives the container's NUL padding unchanged.
 */
export function isReliefId(id: string): boolean {
  return RELIEF_ID.test(id);
}

function align(offset: number): number {
  return (offset + 3) & ~3;
}

/** The id in a 12-byte field, or a reason it is not one. */
function readId(bytes: Uint8Array): { readonly id: string } | { readonly fault: string } {
  let end = bytes.indexOf(0);
  if (end === -1) end = bytes.length;
  for (let i = end; i < bytes.length; i++) {
    if (bytes[i] !== 0) return { fault: "an id with a NUL inside it" };
  }
  const id = String.fromCharCode(...bytes.subarray(0, end));
  if (!isReliefId(id)) return { fault: end === 0 ? "an empty id" : `id ${JSON.stringify(id)} is not printable ASCII` };
  return { id };
}

/** Reads a GHR1 container, rejecting anything malformed. */
export function parseReliefContainer(buffer: ArrayBuffer, options: ReliefContainerOptions = {}): Map<string, ReliefMesh> {
  const label = options.label ?? "Surveyed room relief";
  const fail = (reason: string): never => {
    throw new Error(`${label}: ${reason}`);
  };
  const view = new DataView(buffer);
  if (buffer.byteLength < 8 || MAGIC.some((byte, i) => view.getUint8(i) !== byte)) fail("not a relief file");
  const count = view.getUint32(4, true);
  if (options.maxEntries !== undefined && count > options.maxEntries) {
    fail(`${String(count)} entries, more than the ${String(options.maxEntries)} expected`);
  }
  const entries = new Map<string, ReliefMesh>();
  let offset = 8;
  for (let e = 0; e < count; e++) {
    if (offset + HEADER_BYTES > buffer.byteLength) fail("truncated header");
    const read = readId(new Uint8Array(buffer, offset, RELIEF_ID_BYTES));
    if ("fault" in read) return fail(`entry ${String(e)} has ${read.fault}`);
    const id = read.id;
    if (entries.has(id)) fail(`entry "${id}" twice`);
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
    entries.set(id, { id, positions, indices });
  }
  return entries;
}

/** Throws unless the container holds exactly the expected ids (in any order). */
export function assertReliefIds(relief: ReadonlyMap<string, ReliefMesh>, expected: readonly string[], label = "Surveyed room relief"): void {
  const wanted = new Set(expected);
  if (wanted.size !== expected.length) throw new Error(`${label}: the expected ids repeat one`);
  const missing = [...wanted].filter((id) => !relief.has(id));
  const extra = [...relief.keys()].filter((id) => !wanted.has(id));
  if (missing.length === 0 && extra.length === 0) return;
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`missing ${missing.map((id) => `"${id}"`).join(", ")}`);
  if (extra.length > 0) parts.push(`unexpected ${extra.map((id) => `"${id}"`).join(", ")}`);
  throw new Error(`${label}: ${parts.join("; ")}`);
}
